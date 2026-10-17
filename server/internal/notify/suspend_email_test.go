package notify

import (
	"strings"
	"testing"
)

func TestAccountSuspendedEmail(t *testing.T) {
	withApps := AccountSuspendedEmail("Ann <b>", []string{"my-app", "<script>x</script>"})
	for _, want := range []string{"acceptable-use", "support@deployzy.com", "taken offline", "my-app", "&lt;script&gt;", "Ann &lt;b&gt;"} {
		if !strings.Contains(withApps, want) {
			t.Errorf("missing %q", want)
		}
	}
	if strings.Contains(withApps, "<script>") {
		t.Error("app name not escaped")
	}
	// Never reveal how abuse was detected.
	lower := strings.ToLower(withApps)
	for _, leak := range []string{"xray", "v2ray", "cloudflared", "nezha", "fingerprint", "scanner", "7844", "proxy"} {
		if strings.Contains(lower, leak) {
			t.Errorf("email leaks detection detail %q", leak)
		}
	}
	noApps := AccountSuspendedEmail("", nil)
	if strings.Contains(noApps, "taken offline") || strings.Contains(noApps, "Apps taken offline") {
		t.Error("claims apps were taken offline when none were stopped")
	}
	if !strings.Contains(noApps, "Hi,") {
		t.Error("expected generic greeting without a name")
	}
}
