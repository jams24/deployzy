// Polar.sh card-payment integration. Sits alongside InventPay (crypto):
// InventPay handles USDT invoices, Polar handles credit/debit cards.
//
// Uses plain HTTP against the Polar REST API (no official Go SDK). Webhooks
// are verified per the Standard Webhooks spec Polar uses: HMAC-SHA256 over
// "{msg-id}.{timestamp}.{body}" keyed with the base64-decoded whsec_ secret.
package billing

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type Polar struct {
	accessToken   string
	webhookSecret string
	baseURL       string
	products      map[string]string // plan name → Polar product ID
	client        *http.Client
}

// NewPolar creates a Polar client. sandbox switches to the sandbox API host.
// products maps plan names ("pro", "team") to Polar product IDs.
func NewPolar(accessToken, webhookSecret string, products map[string]string, sandbox bool) *Polar {
	base := "https://api.polar.sh"
	if sandbox {
		base = "https://sandbox-api.polar.sh"
	}
	return &Polar{
		accessToken:   accessToken,
		webhookSecret: webhookSecret,
		baseURL:       base,
		products:      products,
		client:        &http.Client{Timeout: 15 * time.Second},
	}
}

// HasPlan reports whether a Polar product is configured for the plan.
func (p *Polar) HasPlan(plan string) bool {
	_, ok := p.products[plan]
	return ok
}

// PolarCheckout is the subset of the checkout response we care about.
type PolarCheckout struct {
	ID  string `json:"id"`
	URL string `json:"url"`
}

// CreateCheckout creates a hosted checkout session for the given plan and
// returns the URL to redirect the user to. userID and plan ride along in
// metadata so the webhook can attribute the payment.
func (p *Polar) CreateCheckout(plan, userID, email, successURL string) (*PolarCheckout, error) {
	productID, ok := p.products[plan]
	if !ok {
		return nil, fmt.Errorf("no Polar product configured for plan %q", plan)
	}

	body, err := json.Marshal(map[string]interface{}{
		"products":             []string{productID},
		"external_customer_id": userID,
		"customer_email":       email,
		"success_url":          successURL,
		"metadata": map[string]string{
			"user_id": userID,
			"plan":    plan,
		},
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", p.baseURL+"/v1/checkouts/", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+p.accessToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("polar checkout failed: HTTP %d: %s", resp.StatusCode, truncate(string(respBody), 300))
	}

	var out PolarCheckout
	if err := json.Unmarshal(respBody, &out); err != nil {
		return nil, fmt.Errorf("polar checkout: decode response: %w", err)
	}
	if out.URL == "" {
		return nil, fmt.Errorf("polar checkout: response missing url")
	}
	return &out, nil
}

// PolarWebhookEvent is the envelope of a Polar webhook payload.
type PolarWebhookEvent struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

// PolarOrder is the subset of order/subscription webhook data we consume.
type PolarOrder struct {
	ID       string            `json:"id"`
	Status   string            `json:"status"`
	Paid     bool              `json:"paid"`
	Metadata map[string]string `json:"metadata"`
	Customer struct {
		ExternalID string `json:"external_id"`
		Email      string `json:"email"`
	} `json:"customer"`
}

// VerifyWebhook validates a Standard Webhooks signature. All three headers
// (webhook-id, webhook-timestamp, webhook-signature) are required; a request
// missing any of them fails verification — never treat unsigned payloads as
// trusted.
func (p *Polar) VerifyWebhook(body []byte, headers http.Header) bool {
	if p.webhookSecret == "" {
		return false
	}
	msgID := headers.Get("webhook-id")
	timestamp := headers.Get("webhook-timestamp")
	sigHeader := headers.Get("webhook-signature")
	if msgID == "" || timestamp == "" || sigHeader == "" {
		return false
	}

	// Reject stale timestamps (>5 min skew) to blunt replay attacks.
	if ts, err := strconv.ParseInt(timestamp, 10, 64); err != nil {
		return false
	} else if d := time.Since(time.Unix(ts, 0)); d > 5*time.Minute || d < -5*time.Minute {
		return false
	}

	secret := strings.TrimPrefix(p.webhookSecret, "whsec_")
	key, err := base64.StdEncoding.DecodeString(secret)
	if err != nil {
		// Secret may be raw rather than base64 — use as-is.
		key = []byte(secret)
	}

	mac := hmac.New(sha256.New, key)
	fmt.Fprintf(mac, "%s.%s.", msgID, timestamp)
	mac.Write(body)
	expected := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	// Header format: space-separated list of "v1,<base64sig>" entries.
	for _, part := range strings.Fields(sigHeader) {
		if sig, ok := strings.CutPrefix(part, "v1,"); ok {
			if subtle.ConstantTimeCompare([]byte(sig), []byte(expected)) == 1 {
				return true
			}
		}
	}
	return false
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
