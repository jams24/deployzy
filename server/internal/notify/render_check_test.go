package notify

import (
	"strings"
	"testing"
)

// Every transactional email must carry the brand shell: logo, support link,
// and the trademark line. Guards against a new template inventing its own HTML.
func TestAllEmailsUseBrandShell(t *testing.T) {
	cases := map[string]string{
		"welcome":      WelcomeEmail("Jams"),
		"verify":       VerifyCodeEmail("Jams", "123456"),
		"subscription": SubscriptionEmail("Jams", "pro", "upgrade", 12, "USD", "22 August 2026"),
		"invite":       TeamInviteEmail("Jams", "Acme", "https://deployzy.com/invite/x"),
		"deployfail":   DeployFailedEmail("myapp", "https://myapp.deployzy.com", "https://deployzy.com/projects", "boom"),
		"broadcast":    BroadcastEmail("Hi", "<p>body</p>"),
	}
	for name, html := range cases {
		if !strings.Contains(html, "logo-dark.svg") {
			t.Errorf("%s: missing brand logo", name)
		}
		if !strings.Contains(html, "support@deployzy.com") {
			t.Errorf("%s: missing support contact", name)
		}
		if !strings.Contains(html, "Deployzy™") || !strings.Contains(html, "©") {
			t.Errorf("%s: missing trademark/copyright line", name)
		}
		t.Logf("%-13s %6d bytes  logo✓ support✓ ©✓", name, len(html))
	}
}
