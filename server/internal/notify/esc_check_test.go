package notify

import (
	"strings"
	"testing"
)

func TestNameIsEscapedInEmails(t *testing.T) {
	payload := `<img src=x onerror=alert(1)>`
	html := WelcomeEmail(payload)
	if strings.Contains(html, payload) {
		t.Errorf("XSS: raw user name injected into welcome email HTML")
	}
	inv := TeamInviteEmail(payload, "Acme", "https://deployzy.com/x")
	if strings.Contains(inv, payload) {
		t.Errorf("XSS: raw inviter name injected into invite email HTML")
	}
}
