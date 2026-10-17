package proxy

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rs/zerolog"
)

type fakeProjects struct{ blocked map[string]bool }

func (f fakeProjects) GetProjectPort(string) (int, bool) { return 0, false }
func (f fakeProjects) GetProjectRouting(string) (string, int, string, bool) {
	return "", 0, "", false
}
func (f fakeProjects) IsBandwidthBlocked(id string) bool { return f.blocked[id] }

func TestProxyToProjectBandwidthGate(t *testing.T) {
	// Upstream that would answer 200 if the gate let the request through.
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("app")) }))
	defer up.Close()
	port := up.Listener.Addr().(*net.TCPAddr).Port

	p := NewHTTPProxy(nil, nil, nil, zerolog.Nop())
	p.SetProjectLookup(fakeProjects{blocked: map[string]bool{"over": true}})

	rec := httptest.NewRecorder()
	p.proxyToProject(rec, httptest.NewRequest("GET", "http://a.deployzy.app/", nil), "", port, "over")
	if rec.Code != http.StatusPaymentRequired || !strings.Contains(rec.Body.String(), "monthly bandwidth") {
		t.Fatalf("over-cap project: got %d, want 402 bandwidth page", rec.Code)
	}

	rec = httptest.NewRecorder()
	p.proxyToProject(rec, httptest.NewRequest("GET", "http://b.deployzy.app/", nil), "", port, "fine")
	if rec.Code != 200 || rec.Body.String() != "app" {
		t.Fatalf("under-cap project: got %d %q, want 200 app", rec.Code, rec.Body.String())
	}
}
