package proxy

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"github.com/serverme/serverme/proto"
	"github.com/serverme/serverme/server/internal/analytics"
	"github.com/serverme/serverme/server/internal/control"
	"github.com/serverme/serverme/server/internal/inspect"
	"github.com/serverme/serverme/server/internal/tunnel"
)

const maxBodyCapture = 10 * 1024 // 10KB

// ProjectLookup finds deployed projects by subdomain.
type ProjectLookup interface {
	GetProjectPort(subdomain string) (int, bool)
	// GetProjectRouting returns (port, projectID, ok). Implementations that
	// haven't been updated yet can return ("", "", false) — the proxy will
	// just skip the analytics event in that case.
	GetProjectRouting(subdomain string) (int, string, bool)
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

	// Strip www. prefix — redirect to non-www
	if strings.HasPrefix(hostname, "www.") {
		target := "https://" + strings.TrimPrefix(hostname, "www.") + r.URL.RequestURI()
		http.Redirect(w, r, target, http.StatusMovedPermanently)
		return
	}

	tun := p.registry.LookupByHost(hostname)
	if tun == nil {
		// Check if this is a deployed project (subdomain path: myapp.serverme.site)
		if p.projects != nil {
			parts := strings.SplitN(hostname, ".", 2)
			if len(parts) >= 1 {
				if port, projID, ok := p.projects.GetProjectRouting(parts[0]); ok {
					p.proxyToProject(w, r, port, projID)
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
						if port, projID, pok := p.projects.GetProjectRouting(targetSub); pok {
							p.proxyToProject(w, r, port, projID)
							return
						}
					}
				}
				if tun == nil {
					http.Error(w, "Domain is configured but the target service is not running.", http.StatusBadGateway)
					return
				}
			}
		}

		if tun == nil {
			p.log.Debug().Str("host", hostname).Msg("no tunnel found")
			http.Error(w, "Tunnel not found. If you're trying to connect, make sure your tunnel is active.", http.StatusNotFound)
			return
		}
	}

	// Check basic auth if configured
	if tun.Auth != "" {
		if !checkBasicAuth(r, tun.Auth) {
			w.Header().Set("WWW-Authenticate", `Basic realm="ServerMe"`)
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
	}

	// Capture request body if inspection enabled
	var reqBody []byte
	if tun.Inspect && r.Body != nil {
		reqBody, _ = io.ReadAll(io.LimitReader(r.Body, maxBodyCapture))
		r.Body = io.NopCloser(bytes.NewReader(reqBody))
	}

	// Get the control connection for this tunnel's client
	conn, ok := p.manager.Get(tun.ClientID)
	if !ok {
		p.log.Warn().Str("client_id", tun.ClientID).Msg("client not connected")
		http.Error(w, "Tunnel client is not connected", http.StatusBadGateway)
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

	// Add forwarding headers
	r.Header.Set("X-Forwarded-For", clientIP(r))
	r.Header.Set("X-Forwarded-Proto", schemeFromRequest(r))
	r.Header.Set("X-Forwarded-Host", r.Host)

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

// proxyToProject reverse-proxies a request to a deployed project's container
// and records an analytics event on the way out.
func (p *HTTPProxy) proxyToProject(w http.ResponseWriter, r *http.Request, port int, projectID string) {
	start := time.Now()
	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = "http"
			req.URL.Host = fmt.Sprintf("127.0.0.1:%d", port)
			req.Host = r.Host
		},
	}
	rw := &captureRW{ResponseWriter: w, status: 200}
	proxy.ServeHTTP(rw, r)

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
			Country:     strings.ToUpper(country),
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

// HealthHandler returns a simple health check response.
func HealthHandler(startTime time.Time) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"ok","uptime":"%s","version":"%s"}`,
			time.Since(startTime).Round(time.Second), proto.Version)
	}
}
