package api

import (
	"net"
	"net/http"
	"strings"
)

// requestIP returns the real client IP, preferring Cloudflare's CF-Connecting-IP
// (set for all proxied traffic), then the first X-Forwarded-For hop, then the
// raw socket address. Behind Cloudflare, RemoteAddr is the CF edge — not the
// visitor — so the header is authoritative here.
func requestIP(r *http.Request) string {
	if cf := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); cf != "" {
		return cf
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.TrimSpace(strings.Split(xff, ",")[0])
	}
	if ip, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return ip
	}
	return r.RemoteAddr
}

// requestCountry returns the 2-letter ISO country code Cloudflare resolved for
// the client, or "" if not available.
func requestCountry(r *http.Request) string {
	c := strings.TrimSpace(r.Header.Get("CF-IPCountry"))
	if c == "" || c == "XX" || c == "T1" { // XX/T1 = unknown/Tor per Cloudflare
		return ""
	}
	return strings.ToUpper(c)
}
