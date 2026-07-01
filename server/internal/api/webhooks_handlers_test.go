package api

import "testing"

func TestIsValidWebhookURL(t *testing.T) {
	ok := []string{"https://example.com/hook", "https://api.app.io:8443/x"}
	for _, s := range ok {
		if !isValidWebhookURL(s) {
			t.Errorf("expected %q valid", s)
		}
	}
	// Reject non-https, missing host, and loopback (SSRF guard).
	bad := []string{"", "http://example.com", "https://", "ftp://x", "https://localhost/x", "https://127.0.0.1", "https://0.0.0.0/y", "not a url"}
	for _, s := range bad {
		if isValidWebhookURL(s) {
			t.Errorf("expected %q rejected", s)
		}
	}
}
