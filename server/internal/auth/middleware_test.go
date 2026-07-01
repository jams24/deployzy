package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestScopeRank(t *testing.T) {
	// read < deploy < full; empty = legacy full; unknown = 0 (deny).
	if !(scopeRank("read") < scopeRank("deploy") && scopeRank("deploy") < scopeRank("full")) {
		t.Fatal("scope ordering broken")
	}
	if scopeRank("") != scopeRank("full") {
		t.Error("empty scope should be treated as full (legacy keys)")
	}
	if scopeRank("bogus") != 0 {
		t.Error("unknown scope should rank 0")
	}
}

func TestRequireScope(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })

	call := func(userScope, required string) int {
		mw := RequireScope(required)(next)
		req := httptest.NewRequest("POST", "/", nil)
		if userScope != "<none>" {
			ctx := context.WithValue(req.Context(), UserContextKey, &AuthenticatedUser{ID: "u", Scope: userScope})
			req = req.WithContext(ctx)
		}
		rec := httptest.NewRecorder()
		mw.ServeHTTP(rec, req)
		return rec.Code
	}

	cases := []struct {
		userScope, required string
		want                int
	}{
		{"full", "deploy", http.StatusOK},
		{"full", "full", http.StatusOK},
		{"deploy", "deploy", http.StatusOK},
		{"deploy", "full", http.StatusForbidden}, // CI key can't manage account
		{"read", "deploy", http.StatusForbidden},
		{"read", "full", http.StatusForbidden},
		{"", "deploy", http.StatusOK}, // legacy key = full
		{"<none>", "deploy", http.StatusForbidden},
	}
	for _, c := range cases {
		if got := call(c.userScope, c.required); got != c.want {
			t.Errorf("scope=%q required=%q: got %d, want %d", c.userScope, c.required, got, c.want)
		}
	}
}
