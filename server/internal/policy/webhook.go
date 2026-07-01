package policy

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// WebhookVerifier verifies webhook signatures from known providers.
type WebhookVerifier struct {
	Provider string // "stripe", "github", "generic"
	Secret   string // signing secret
}

// Verify checks the webhook signature on an incoming request.
// It reads the body, verifies the signature, and resets the body for forwarding.
func (v *WebhookVerifier) Verify(r *http.Request) (bool, error) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return false, fmt.Errorf("read body: %w", err)
	}
	// Reset body so it can be forwarded
	r.Body = io.NopCloser(strings.NewReader(string(body)))

	switch v.Provider {
	case "stripe":
		return v.verifyStripe(r, body)
	case "github":
		return v.verifyGitHub(r, body)
	case "generic":
		return v.verifyGenericHMAC(r, body)
	default:
		return false, fmt.Errorf("unknown provider: %s", v.Provider)
	}
}

// verifyStripe verifies Stripe webhook signatures.
// Stripe uses Stripe-Signature header with format: t=timestamp,v1=signature
func (v *WebhookVerifier) verifyStripe(r *http.Request, body []byte) (bool, error) {
	sigHeader := r.Header.Get("Stripe-Signature")
	if sigHeader == "" {
		return false, nil
	}

	var timestamp, signature string
	for _, part := range strings.Split(sigHeader, ",") {
		kv := strings.SplitN(part, "=", 2)
		if len(kv) != 2 {
			continue
		}
		switch kv[0] {
		case "t":
			timestamp = kv[1]
		case "v1":
			signature = kv[1]
		}
	}

	if timestamp == "" || signature == "" {
		return false, nil
	}

	// Compute expected signature: HMAC-SHA256(secret, "timestamp.body")
	payload := timestamp + "." + string(body)
	expected := computeHMACSHA256(v.Secret, []byte(payload))

	return hmac.Equal([]byte(signature), []byte(expected)), nil
}

// verifyGitHub verifies GitHub webhook signatures.
// GitHub uses X-Hub-Signature-256 header with format: sha256=signature
func (v *WebhookVerifier) verifyGitHub(r *http.Request, body []byte) (bool, error) {
	sigHeader := r.Header.Get("X-Hub-Signature-256")
	if sigHeader == "" {
		return false, nil
	}

	if !strings.HasPrefix(sigHeader, "sha256=") {
		return false, nil
	}

	signature := strings.TrimPrefix(sigHeader, "sha256=")
	expected := computeHMACSHA256(v.Secret, body)

	return hmac.Equal([]byte(signature), []byte(expected)), nil
}

// verifyGenericHMAC verifies a generic HMAC-SHA256 signature.
// Expects X-Signature header containing hex-encoded HMAC-SHA256 of the body.
func (v *WebhookVerifier) verifyGenericHMAC(r *http.Request, body []byte) (bool, error) {
	signature := r.Header.Get("X-Signature")
	if signature == "" {
		signature = r.Header.Get("X-Webhook-Signature")
	}
	if signature == "" {
		return false, nil
	}

	// Strip common prefixes
	signature = strings.TrimPrefix(signature, "sha256=")

	expected := computeHMACSHA256(v.Secret, body)
	return hmac.Equal([]byte(signature), []byte(expected)), nil
}

func computeHMACSHA256(secret string, data []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(data)
	return hex.EncodeToString(mac.Sum(nil))
}

// WebhookMiddleware returns HTTP middleware that verifies webhook signatures.
// Requests with invalid signatures get a 403 response.
func WebhookMiddleware(verifier *WebhookVerifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			valid, err := verifier.Verify(r)
			if err != nil {
				http.Error(w, `{"error":"webhook verification error"}`, http.StatusInternalServerError)
				return
			}
			if !valid {
				http.Error(w, `{"error":"invalid webhook signature"}`, http.StatusForbidden)
				return
			}

			r.Header.Set("X-Deployzy-Webhook-Verified", "true")
			next.ServeHTTP(w, r)
		})
	}
}
