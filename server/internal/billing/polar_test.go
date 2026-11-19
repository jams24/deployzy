package billing

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

const testPolarSecret = "whsec_9ZigTestTestTestTestTestTestTestTestTes"

func signPolar(key []byte, id, ts string, body []byte) string {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(id + "." + ts + "."))
	mac.Write(body)
	return "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func polarHeaders(id, ts, sig string) http.Header {
	h := http.Header{}
	h.Set("webhook-id", id)
	h.Set("webhook-timestamp", ts)
	h.Set("webhook-signature", sig)
	return h
}

func TestPolarVerifyWebhook(t *testing.T) {
	p := NewPolar("", testPolarSecret, nil, false)
	body := []byte(`{"type":"order.paid","data":{"checkout_id":"abc"}}`)
	id := "msg_1"
	now := strconv.FormatInt(time.Now().Unix(), 10)

	stdKey, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(testPolarSecret, "whsec_"))
	if err != nil {
		t.Fatalf("test secret must decode: %v", err)
	}

	cases := []struct {
		name string
		h    http.Header
		want bool
	}{
		// Polar "Legacy signing" (secrets before 8 Sept 2026): key = full string.
		{"legacy key", polarHeaders(id, now, signPolar([]byte(testPolarSecret), id, now, body)), true},
		// Standard Webhooks (newer secrets): key = base64-decoded remainder.
		{"standard key", polarHeaders(id, now, signPolar(stdKey, id, now, body)), true},
		// Several signatures in one header (secret rotation).
		{"multi sig", polarHeaders(id, now, "v1,bogus "+signPolar([]byte(testPolarSecret), id, now, body)), true},
		// The old, wrong derivation (prefix stripped, not decoded) must not pass.
		{"stripped raw key", polarHeaders(id, now, signPolar([]byte(strings.TrimPrefix(testPolarSecret, "whsec_")), id, now, body)), false},
		{"other secret", polarHeaders(id, now, signPolar([]byte("whsec_someoneelse"), id, now, body)), false},
		{"stale", polarHeaders(id, "1000", signPolar([]byte(testPolarSecret), id, "1000", body)), false},
		{"tampered id", polarHeaders("msg_2", now, signPolar([]byte(testPolarSecret), id, now, body)), false},
		{"unsigned", http.Header{}, false},
	}
	for _, c := range cases {
		if got := p.VerifyWebhook(body, c.h); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}

	if NewPolar("", "", nil, false).VerifyWebhook(body, cases[0].h) {
		t.Error("empty secret must never verify")
	}
}

func TestPolarPlanForProduct(t *testing.T) {
	p := NewPolar("", "", map[string]string{"hobby": "prod_h", "pro": "prod_p", "team": ""}, false)
	for in, want := range map[string]string{"prod_h": "hobby", "prod_p": "pro", "": "", "prod_x": ""} {
		if got := p.PlanForProduct(in); got != want {
			t.Errorf("PlanForProduct(%q) = %q, want %q", in, got, want)
		}
	}
}
