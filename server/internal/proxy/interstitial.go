package proxy

import (
	_ "embed"
	"html/template"
	"net/http"
	"net/url"
	"strings"
	"time"
)

//go:embed interstitial.html
var interstitialHTML string

var interstitialTmpl = template.Must(template.New("interstitial").Parse(interstitialHTML))

// interstitialCookie is set once a visitor acknowledges the tunnel warning.
// It is scoped per-host (Path=/) so acknowledging one tunnel doesn't suppress
// the warning on a different tunnel host.
const interstitialCookie = "_dz_ack"

// interstitialContinueParam is the query key the "Continue to site" button uses.
// When present we set the ack cookie and redirect to the clean URL.
const interstitialContinueParam = "__dz_continue"

// interstitialTTL is how long an acknowledgement lasts before the warning
// shows again for the same visitor + host.
const interstitialTTL = 24 * time.Hour

type interstitialData struct {
	Host        string // hostname shown to the visitor
	HostParam   string // URL-escaped host for the report link
	ContinueURL string // relative URL that sets the ack cookie
}

// maybeServeInterstitial shows the tunnel safety warning on the first HTML
// page navigation to a tunnel host. It returns true if it handled the request
// (either by serving the warning or by processing the continue click), meaning
// the caller must stop and not forward to the tunnel.
//
// It only intercepts real top-level document navigations so APIs, assets,
// WebSocket upgrades, and CLI/programmatic clients pass straight through.
func (p *HTTPProxy) maybeServeInterstitial(w http.ResponseWriter, r *http.Request, hostname string) bool {
	// Continue click: set the ack cookie and redirect to the same URL without
	// the marker param. This runs before the cookie/HTML checks so the button
	// always works.
	if r.URL.Query().Get(interstitialContinueParam) != "" {
		http.SetCookie(w, &http.Cookie{
			Name:     interstitialCookie,
			Value:    "1",
			Path:     "/",
			MaxAge:   int(interstitialTTL.Seconds()),
			HttpOnly: true,
			// External tunnel traffic is always HTTPS (Caddy/Cloudflare terminate
			// TLS and proxy to us over plain HTTP), so mark the cookie Secure
			// unconditionally rather than trusting the internal scheme.
			Secure:   true,
			SameSite: http.SameSiteLaxMode,
		})
		q := r.URL.Query()
		q.Del(interstitialContinueParam)
		clean := r.URL.Path
		if enc := q.Encode(); enc != "" {
			clean += "?" + enc
		}
		http.Redirect(w, r, clean, http.StatusFound)
		return true
	}

	// Already acknowledged within the TTL — let it through.
	if c, err := r.Cookie(interstitialCookie); err == nil && c.Value == "1" {
		return false
	}

	// Only gate genuine top-level HTML navigations.
	if !isTopLevelHTMLNav(r) {
		return false
	}

	data := interstitialData{
		Host:      hostname,
		HostParam: url.QueryEscape(hostname),
	}
	// Continue URL = current path/query with the marker appended.
	q := r.URL.Query()
	q.Set(interstitialContinueParam, "1")
	data.ContinueURL = r.URL.Path + "?" + q.Encode()

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
	w.WriteHeader(http.StatusOK)
	_ = interstitialTmpl.Execute(w, data)
	return true
}

// isTopLevelHTMLNav reports whether the request looks like a browser loading a
// page in the address bar (as opposed to an XHR/fetch, asset, or API call).
func isTopLevelHTMLNav(r *http.Request) bool {
	if r.Method != http.MethodGet {
		return false
	}
	// WebSocket / other upgrades are never document loads.
	if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	// Fetch metadata (sent by modern browsers) is the most reliable signal.
	if dest := r.Header.Get("Sec-Fetch-Dest"); dest != "" {
		return dest == "document"
	}
	if mode := r.Header.Get("Sec-Fetch-Mode"); mode != "" {
		return mode == "navigate"
	}
	// Fallback for clients without fetch metadata: require an HTML Accept and
	// exclude obvious non-navigation requests.
	if r.Header.Get("X-Requested-With") != "" {
		return false
	}
	return strings.Contains(r.Header.Get("Accept"), "text/html")
}
