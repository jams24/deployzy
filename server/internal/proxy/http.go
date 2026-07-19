package proxy

import (
	"bufio"
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog"
	"github.com/serverme/serverme/proto"
	"github.com/serverme/serverme/server/internal/analytics"
	"github.com/serverme/serverme/server/internal/control"
	"github.com/serverme/serverme/server/internal/inspect"
	"github.com/serverme/serverme/server/internal/tunnel"
)

//go:embed sm_analytics.js
var smAnalyticsJS []byte

//go:embed error_page.html
var errorPageHTML string

var errorPageTmpl = template.Must(template.New("error").Parse(errorPageHTML))

type errorPageData struct {
	Code      string
	Title     string
	BadgeText string
	DotColor  string
	Heading   string
	Body      string
	Host      string
	Reason    string
	DashURL   string
}

func writeErrorPage(w http.ResponseWriter, status int, data errorPageData) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = errorPageTmpl.Execute(w, data)
}

const maxBodyCapture = 10 * 1024 // 10KB

// ProjectLookup finds deployed projects by subdomain.
type ProjectLookup interface {
	GetProjectPort(subdomain string) (int, bool)
	// GetProjectRouting returns (serverHost, port, projectID, ok).
	// serverHost is "" for platform-local projects (proxy to 127.0.0.1),
	// or the remote VPS IP/host for BYOC projects (proxy directly to that host).
	GetProjectRouting(subdomain string) (string, int, string, bool)
}

// DomainResolver resolves a verified custom domain to its target.
type DomainResolver interface {
	ResolveDomain(hostname string) (targetType, targetSubdomain string, ok bool)
}

// HTTPProxy handles incoming HTTP requests and forwards them through tunnels.
type HTTPProxy struct {
	registry   *tunnel.Registry
	manager    *control.Manager
	store      *inspect.Store
	projects   ProjectLookup
	domains    DomainResolver
	analytics  *analytics.Collector
	baseDomain string
	log        zerolog.Logger
}

// NewHTTPProxy creates a new HTTP proxy handler.
func NewHTTPProxy(registry *tunnel.Registry, manager *control.Manager, store *inspect.Store, log zerolog.Logger) *HTTPProxy {
	return &HTTPProxy{
		registry: registry,
		manager:  manager,
		store:    store,
		log:      log.With().Str("component", "http_proxy").Logger(),
	}
}

// SetProjectLookup sets the project lookup for deployed containers.
func (p *HTTPProxy) SetProjectLookup(pl ProjectLookup) {
	p.projects = pl
}

// SetAnalytics enables server-side analytics capture for deployed projects.
// No-op if a nil collector is passed, so analytics is cleanly optional.
func (p *HTTPProxy) SetAnalytics(c *analytics.Collector) {
	p.analytics = c
}

// SetDomainResolver sets the custom domain resolver.
func (p *HTTPProxy) SetDomainResolver(dr DomainResolver, baseDomain string) {
	p.domains = dr
	p.baseDomain = baseDomain
}

// ServeHTTP handles an incoming HTTP request by routing it through the appropriate tunnel.
func (p *HTTPProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	hostname := extractHostname(r.Host)

	// /tls/ask — Caddy on-demand TLS gate. Called by Caddy before issuing a
	// new certificate. We approve only:
	//   • deployzy.com itself and known static subdomains (api, www)
	//   • exactly one label before .deployzy.com  (e.g. terra.deployzy.com)
	//   • verified custom domains (resolved by the domain resolver)
	// Multi-label junk like "whm.whm.blog.deployzy.com" is rejected, which
	// prevents bots from exhausting the Let's Encrypt rate limit.
	if r.URL.Path == "/tls/ask" {
		domain := r.URL.Query().Get("domain")
		if p.isCertAllowed(domain) {
			w.WriteHeader(http.StatusOK)
		} else {
			http.Error(w, "not allowed", http.StatusForbidden)
		}
		return
	}

	// Reserved analytics endpoints — handle here and never forward to the container:
	//   /__sm/analytics.js  → the client snippet
	//   /__sm-ingest        → JS beacon POST target
	if r.URL.Path == "/__sm/analytics.js" {
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=3600")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Write(smAnalyticsJS)
		return
	}
	if r.URL.Path == "/__sm-ingest" {
		p.handleAnalyticsIngest(w, r, hostname)
		return
	}

	// Strip www. prefix — redirect to non-www
	if strings.HasPrefix(hostname, "www.") {
		target := "https://" + strings.TrimPrefix(hostname, "www.") + r.URL.RequestURI()
		http.Redirect(w, r, target, http.StatusMovedPermanently)
		return
	}

	tun := p.registry.LookupByHost(hostname)
	if tun == nil {
		// Check if this is a deployed project (subdomain path: myapp.deployzy.com)
		if p.projects != nil {
			parts := strings.SplitN(hostname, ".", 2)
			if len(parts) >= 1 {
				if svrHost, port, projID, ok := p.projects.GetProjectRouting(parts[0]); ok {
					p.proxyToProject(w, r, svrHost, port, projID)
					return
				}
			}
		}

		// Check if this is a verified custom domain
		if p.domains != nil {
			targetType, targetSub, ok := p.domains.ResolveDomain(hostname)
			if ok {
				switch targetType {
				case "tunnel":
					fullHost := targetSub + "." + p.baseDomain
					if t := p.registry.LookupByHost(fullHost); t != nil {
						tun = t
						// Fall through to the tunnel proxy path below
					}
				case "project":
					if p.projects != nil {
						if svrHost, port, projID, pok := p.projects.GetProjectRouting(targetSub); pok {
							p.proxyToProject(w, r, svrHost, port, projID)
							return
						}
					}
				}
				if tun == nil {
					writeErrorPage(w, http.StatusBadGateway, errorPageData{
						Code:      "502",
						Title:     "Service Unavailable",
						BadgeText: "Service offline",
						DotColor:  "#ef4444",
						Heading:   "Service not running",
						Body:      "This domain is configured on Deployzy but the target service isn't running. Start or redeploy it from your dashboard.",
						Host:      hostname,
						Reason:    "service_not_running",
						DashURL:   "https://deployzy.com/projects",
					})
					return
				}
			}
		}

		if tun == nil {
			p.log.Debug().Str("host", hostname).Msg("no tunnel found")
			writeErrorPage(w, http.StatusNotFound, errorPageData{
				Code:      "404",
				Title:     "Not Found",
				BadgeText: "No active deployment",
				DotColor:  "#6b7280",
				Heading:   "Nothing deployed here yet",
				Body:      "This subdomain exists on Deployzy but has no active tunnel or deployment. If you own this project, deploy it from your dashboard.",
				Host:      hostname,
				Reason:    "route_not_registered",
				DashURL:   "https://deployzy.com/projects",
			})
			return
		}
	}

	// Check basic auth if configured
	if tun.Auth != "" {
		if !checkBasicAuth(r, tun.Auth) {
			w.Header().Set("WWW-Authenticate", `Basic realm="Deployzy"`)
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
	}

	// Buffer the full request body before touching the stream. This must happen
	// before inspection so the 10KB capture doesn't replace r.Body with a
	// truncated version while r.ContentLength still holds the original size —
	// that mismatch was sending incomplete JSON to local servers (LM Studio
	// showed "Unterminated string at position 7773"). Buffering also prevents
	// chunked encoding on the smux stream (some servers reject chunked bodies).
	var reqBody []byte
	if r.Body != nil {
		fullBody, _ := io.ReadAll(r.Body)
		r.Body = io.NopCloser(bytes.NewReader(fullBody))
		r.ContentLength = int64(len(fullBody))
		r.TransferEncoding = nil

		if tun.Inspect {
			// Store at most 10KB for the inspector display.
			reqBody = fullBody
			if len(reqBody) > maxBodyCapture {
				reqBody = reqBody[:maxBodyCapture]
			}
		}
	}

	// Get the control connection for this tunnel's client
	conn, ok := p.manager.Get(tun.ClientID)
	if !ok {
		p.log.Warn().Str("client_id", tun.ClientID).Msg("client not connected")
		writeErrorPage(w, http.StatusBadGateway, errorPageData{
			Code:      "502",
			Title:     "Tunnel Offline",
			BadgeText: "Tunnel disconnected",
			DotColor:  "#f59e0b",
			Heading:   "Tunnel client not connected",
			Body:      "The tunnel for this subdomain was registered but the client isn't connected right now. Start the Deployzy client to resume the tunnel.",
			Host:      hostname,
			Reason:    "tunnel_client_disconnected",
			DashURL:   "https://deployzy.com/tunnels",
		})
		return
	}

	// Request a proxy stream from the client
	stream, err := conn.RequestProxy()
	if err != nil {
		p.log.Error().Err(err).Str("url", tun.URL).Msg("failed to get proxy stream")
		http.Error(w, "Failed to connect to tunnel client", http.StatusBadGateway)
		return
	}
	defer stream.Close()

	// Send StartProxy on the data stream
	if err := proto.WriteMsg(stream, proto.TypeStartProxy, &proto.StartProxy{
		URL:        tun.URL,
		ClientAddr: r.RemoteAddr,
	}); err != nil {
		p.log.Error().Err(err).Msg("failed to send StartProxy")
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	// Add forwarding headers (omit X-Forwarded-Host — local AI servers like
	// LM Studio and Ollama use it for origin checks and reject external domains)
	r.Header.Set("X-Forwarded-For", clientIP(r))
	r.Header.Set("X-Forwarded-Proto", schemeFromRequest(r))

	// Write the original HTTP request to the stream
	if err := r.Write(stream); err != nil {
		p.log.Error().Err(err).Msg("failed to write request to stream")
		http.Error(w, "Failed to forward request", http.StatusBadGateway)
		return
	}

	// Read the response from the stream
	resp, err := http.ReadResponse(newBufioReader(stream), r)
	if err != nil {
		p.log.Error().Err(err).Msg("failed to read response from stream")
		http.Error(w, "Failed to read response from tunnel", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// Read response body (capture + forward)
	var respBody bytes.Buffer
	respReader := io.TeeReader(resp.Body, &respBody)

	// Copy response headers
	for key, values := range resp.Header {
		for _, v := range values {
			w.Header().Add(key, v)
		}
	}

	// Write status code
	w.WriteHeader(resp.StatusCode)

	// Stream the response body
	var responseSize int64
	flusher, canFlush := w.(http.Flusher)
	buf := make([]byte, 32*1024)
	for {
		n, err := respReader.Read(buf)
		if n > 0 {
			w.Write(buf[:n])
			responseSize += int64(n)
			if canFlush {
				flusher.Flush()
			}
		}
		if err != nil {
			break
		}
	}

	duration := time.Since(start)

	// Capture for inspection
	if tun.Inspect && p.store != nil {
		reqHeaders := make(map[string]string)
		for k, v := range r.Header {
			if len(v) > 0 {
				reqHeaders[k] = v[0]
			}
		}

		respHeaders := make(map[string]string)
		for k, v := range resp.Header {
			if len(v) > 0 {
				respHeaders[k] = v[0]
			}
		}

		// Limit captured response body
		capturedRespBody := respBody.Bytes()
		if len(capturedRespBody) > maxBodyCapture {
			capturedRespBody = capturedRespBody[:maxBodyCapture]
		}

		captured := &inspect.CapturedRequest{
			TunnelURL:       tun.URL,
			UserID:          tun.UserID,
			Timestamp:       start,
			Duration:        duration / time.Millisecond,
			Method:          r.Method,
			Path:            r.URL.Path,
			Query:           r.URL.RawQuery,
			RequestHeaders:  reqHeaders,
			RequestBody:     reqBody,
			RequestSize:     int64(len(reqBody)),
			StatusCode:      resp.StatusCode,
			ResponseHeaders: respHeaders,
			ResponseBody:    capturedRespBody,
			ResponseSize:    responseSize,
			RemoteAddr:      r.RemoteAddr,
		}

		p.store.Capture(captured)
	}

	p.log.Debug().
		Str("host", hostname).
		Str("method", r.Method).
		Str("path", r.URL.Path).
		Int("status", resp.StatusCode).
		Dur("duration", duration).
		Msg("request proxied")
}

// handleAnalyticsIngest accepts events POSTed by the JS snippet. Events are
// attributed to whichever project the request's Host maps to, so no API key
// or site ID is needed — the user just drops the snippet on their site.
//
// Abuse protection (in order):
//  1. Origin/Referer must match the Host header — blocks curl-based injection
//     from arbitrary machines (real browser requests include this; scripted
//     abuse rarely bothers).
//  2. Per-IP rate limit of 60 events/min to cap any one attacker's impact.
//  3. Bot UAs already marked is_bot and filtered out of dashboards.
func (p *HTTPProxy) handleAnalyticsIngest(w http.ResponseWriter, r *http.Request, hostname string) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if p.analytics == nil || p.projects == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	// Origin / Referer must mention the host we're attributing the event to.
	// A real browser loading the site's JS snippet will always send one.
	// Without this a curl from anywhere on the internet can spam events.
	if !originMatchesHost(r, hostname) {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	// Per-IP rate limit — 60 events/min is plenty for a real SPA (even at
	// one pageview/sec that's an insanely active visitor).
	if !ingestLimiter.allow(clientIP(r)) {
		w.WriteHeader(http.StatusTooManyRequests)
		return
	}

	// Resolve host → projectID.
	var projectID string
	parts := strings.SplitN(hostname, ".", 2)
	if len(parts) >= 1 {
		if _, _, pid, ok := p.projects.GetProjectRouting(parts[0]); ok {
			projectID = pid
		}
	}
	if projectID == "" && p.domains != nil {
		if targetType, targetSub, ok := p.domains.ResolveDomain(hostname); ok && targetType == "project" {
			if _, _, pid, ok := p.projects.GetProjectRouting(targetSub); ok {
				projectID = pid
			}
		}
	}
	if projectID == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	// Read bounded body.
	body, _ := io.ReadAll(io.LimitReader(r.Body, 8*1024))
	var payload struct {
		Type     string                 `json:"type"`
		Name     string                 `json:"name"`
		Path     string                 `json:"path"`
		Referrer string                 `json:"referrer"`
		Props    map[string]interface{} `json:"props"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	ip := clientIP(r)
	ua := r.UserAgent()
	device, browser, os, isBot := analytics.ParseUA(ua)
	country := r.Header.Get("CF-IPCountry")
	if country == "" {
		country = r.Header.Get("X-Country")
	}

	// For custom events we store the event name in the path column prefixed
	// with "event:" — keeps the schema single-table and the top-pages query
	// still meaningful (events show up in a separate "Top events" list if
	// we add one later).
	path := truncate(payload.Path, 200)
	if payload.Type == "event" && payload.Name != "" {
		path = "event:" + truncate(payload.Name, 190)
	}

	p.analytics.Collect(analytics.Event{
		ProjectID:   projectID,
		TS:          time.Now(),
		Path:        path,
		Method:      "JS",
		Status:      200,
		Bytes:       int64(len(body)),
		RefererHost: analytics.RefererHost(payload.Referrer),
		Country:     strings.ToUpper(country),
		IP:          ip,
		Device:      device,
		Browser:     browser,
		OS:          os,
		VisitorHash: p.analytics.HashVisitor(ip, ua),
		IsBot:       isBot,
	})
	w.WriteHeader(http.StatusNoContent)
}

// originMatchesHost returns true if the request's Origin OR Referer header
// hostname matches the target hostname. Used to reject analytics events sent
// from anywhere other than the project's own site.
func originMatchesHost(r *http.Request, host string) bool {
	check := func(s string) bool {
		if s == "" {
			return false
		}
		if i := strings.Index(s, "://"); i >= 0 {
			s = s[i+3:]
		}
		if i := strings.IndexAny(s, "/?#"); i >= 0 {
			s = s[:i]
		}
		// Strip optional :port.
		if i := strings.IndexByte(s, ':'); i >= 0 {
			s = s[:i]
		}
		return strings.EqualFold(s, host) || strings.EqualFold(s, "www."+host)
	}
	return check(r.Header.Get("Origin")) || check(r.Header.Get("Referer"))
}

// ingestLimiter caps unauthenticated analytics events per source IP so a
// single attacker can't pollute dashboards at scale. Per-minute sliding
// window. Lives at package scope because the limiter's in-memory bucket map
// must survive across HTTPProxy instances (there's only one, but still).
var ingestLimiter = newSlidingIPLimiter(60, time.Minute)

// slidingIPLimiter: simple per-IP sliding-window rate limiter with
// opportunistic cleanup. Duplicated intentionally from the api package's
// version so the proxy doesn't have to import api (would be a cycle).
type slidingIPLimiter struct {
	mu      sync.Mutex
	buckets map[string][]time.Time
	max     int
	window  time.Duration
	cleanAt time.Time
}

func newSlidingIPLimiter(max int, window time.Duration) *slidingIPLimiter {
	return &slidingIPLimiter{buckets: map[string][]time.Time{}, max: max, window: window}
}

func (l *slidingIPLimiter) allow(ip string) bool {
	if ip == "" {
		return true
	}
	now := time.Now()
	cutoff := now.Add(-l.window)

	l.mu.Lock()
	defer l.mu.Unlock()

	if now.After(l.cleanAt) {
		for k, ts := range l.buckets {
			fresh := ts[:0]
			for _, t := range ts {
				if t.After(cutoff) {
					fresh = append(fresh, t)
				}
			}
			if len(fresh) == 0 {
				delete(l.buckets, k)
			} else {
				l.buckets[k] = fresh
			}
		}
		l.cleanAt = now.Add(5 * time.Minute)
	}

	hits := l.buckets[ip]
	fresh := hits[:0]
	for _, t := range hits {
		if t.After(cutoff) {
			fresh = append(fresh, t)
		}
	}
	if len(fresh) >= l.max {
		l.buckets[ip] = fresh
		return false
	}
	l.buckets[ip] = append(fresh, now)
	return true
}

// proxyToProject reverse-proxies a request to a deployed project's container.
// serverHost is "" for local platform projects (use 127.0.0.1), or the BYOC
// server's IP/host for containers running on a remote VPS.
func (p *HTTPProxy) proxyToProject(w http.ResponseWriter, r *http.Request, serverHost string, port int, projectID string) {
	start := time.Now()
	targetHost := "127.0.0.1"
	if serverHost != "" {
		targetHost = serverHost
	}
	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = "http"
			req.URL.Host = fmt.Sprintf("%s:%d", targetHost, port)
			req.Host = r.Host
		},
	}
	rw := &captureRW{ResponseWriter: w, status: 200}
	proxy.ServeHTTP(rw, r)

	// Always track egress bytes for bandwidth accounting (all request types).
	if p.analytics != nil && projectID != "" {
		p.analytics.TrackBandwidth(projectID, rw.bytes)
	}

	// Skip analytics for asset requests — keeps the pageview count meaningful.
	if p.analytics != nil && projectID != "" && isPageRequest(r.URL.Path) {
		ip := clientIP(r)
		ua := r.UserAgent()
		device, browser, os, isBot := analytics.ParseUA(ua)
		country := r.Header.Get("CF-IPCountry")
		if country == "" {
			country = r.Header.Get("X-Country")
		}
		p.analytics.Collect(analytics.Event{
			ProjectID:   projectID,
			TS:          start,
			Path:        truncate(r.URL.Path, 200),
			Method:      r.Method,
			Status:      rw.status,
			Bytes:       rw.bytes,
			RefererHost: analytics.RefererHost(r.Referer()),
			Country:     strings.ToUpper(country), // if header already provided it, skip GeoIP
			IP:          ip,                       // for GeoIP lookup in flush loop
			Device:      device,
			Browser:     browser,
			OS:          os,
			VisitorHash: p.analytics.HashVisitor(ip, ua),
			IsBot:       isBot,
		})
	}
}

// captureRW wraps http.ResponseWriter so we can record the final status code
// and total bytes written — ReverseProxy doesn't expose these otherwise.
type captureRW struct {
	http.ResponseWriter
	status      int
	bytes       int64
	wroteHeader bool
}

func (c *captureRW) WriteHeader(code int) {
	if !c.wroteHeader {
		c.status = code
		c.wroteHeader = true
	}
	c.ResponseWriter.WriteHeader(code)
}

func (c *captureRW) Write(b []byte) (int, error) {
	if !c.wroteHeader {
		c.wroteHeader = true
	}
	n, err := c.ResponseWriter.Write(b)
	c.bytes += int64(n)
	return n, err
}

func (c *captureRW) Flush() {
	if f, ok := c.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// isPageRequest filters out asset URLs so pageview counts reflect actual pages.
// This is a heuristic — projects with dynamic routes that have extensions
// (rare) would be undercounted, but the alternative is noisy dashboards.
func isPageRequest(path string) bool {
	dot := strings.LastIndexByte(path, '.')
	if dot < 0 {
		return true
	}
	ext := path[dot:]
	switch ext {
	case ".css", ".js", ".mjs", ".map", ".ico", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif",
		".woff", ".woff2", ".ttf", ".eot", ".otf",
		".mp4", ".webm", ".mp3", ".ogg", ".wav",
		".json", ".xml", ".txt", ".pdf":
		return false
	}
	return true
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// extractHostname removes the port from a host:port string.
func extractHostname(host string) string {
	h, _, err := net.SplitHostPort(host)
	if err != nil {
		return host
	}
	return h
}

// clientIP extracts the client IP from the request.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.Split(xff, ",")[0]
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	return ip
}

// schemeFromRequest determines the request scheme.
func schemeFromRequest(r *http.Request) string {
	if r.TLS != nil {
		return "https"
	}
	return "http"
}

// checkBasicAuth validates basic auth credentials.
func checkBasicAuth(r *http.Request, expected string) bool {
	user, pass, ok := r.BasicAuth()
	if !ok {
		return false
	}
	parts := strings.SplitN(expected, ":", 2)
	if len(parts) != 2 {
		return false
	}
	return user == parts[0] && pass == parts[1]
}

// newBufioReader creates a bufio.Reader for reading HTTP responses.
func newBufioReader(r io.Reader) *bufio.Reader {
	return bufio.NewReaderSize(r, 4096)
}

// isCertAllowed returns true if Caddy should be allowed to obtain a TLS cert
// for the given domain. Rejects multi-label *.deployzy.com junk that bots
// generate, which previously exhausted the Let's Encrypt rate limit.
func (p *HTTPProxy) isCertAllowed(domain string) bool {
	if domain == "" {
		return false
	}
	domain = strings.ToLower(strings.TrimSuffix(domain, "."))

	// Always allow the base domain and its known static subdomains.
	if domain == p.baseDomain || domain == "www."+p.baseDomain ||
		domain == "api."+p.baseDomain {
		return true
	}

	// Allow exactly one label before baseDomain (e.g. terra.deployzy.com).
	if p.baseDomain != "" && strings.HasSuffix(domain, "."+p.baseDomain) {
		sub := strings.TrimSuffix(domain, "."+p.baseDomain)
		// Reject if the subdomain itself contains a dot (multi-label junk).
		if !strings.Contains(sub, ".") && len(sub) > 0 && len(sub) <= 63 {
			return true
		}
		return false
	}

	// Allow verified custom domains.
	if p.domains != nil {
		if _, _, ok := p.domains.ResolveDomain(domain); ok {
			return true
		}
	}

	return false
}

// HealthHandler returns a simple health check response.
func HealthHandler(startTime time.Time) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"ok","uptime":"%s","version":"%s"}`,
			time.Since(startTime).Round(time.Second), proto.Version)
	}
}
