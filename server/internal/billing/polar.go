// Polar.sh card-payment integration. Sits alongside InventPay (crypto):
// InventPay handles USDT invoices, Polar handles credit/debit cards.
//
// Uses plain HTTP against the Polar REST API (no official Go SDK). Webhooks
// are verified per the Standard Webhooks scheme: HMAC-SHA256 over
// "{msg-id}.{timestamp}.{body}". See polarWebhookKeys for how the key is
// derived from the secret (it differs between legacy and newer secrets).
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

// PlanForProduct maps a Polar product ID back to our plan name, or "" when
// the product isn't one of our plan products.
func (p *Polar) PlanForProduct(productID string) string {
	if productID == "" {
		return ""
	}
	for plan, id := range p.products {
		if id == productID {
			return plan
		}
	}
	return ""
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

// CreateProductCheckout creates a hosted checkout for an explicit Polar product
// ID (used for AI credit packs, which aren't plan subscriptions). metadata rides
// along so the webhook can attribute the payment.
func (p *Polar) CreateProductCheckout(productID, userID, email, successURL string, amountCents int, metadata map[string]string) (*PolarCheckout, error) {
	if productID == "" {
		return nil, fmt.Errorf("no Polar product configured")
	}
	md := map[string]string{"user_id": userID}
	for k, v := range metadata {
		md[k] = v
	}
	payload := map[string]interface{}{
		"products":             []string{productID},
		"external_customer_id": userID,
		"customer_email":       email,
		"success_url":          successURL,
		"metadata":             md,
	}
	// For a pay-what-you-want product, set the exact amount (minor units).
	if amountCents > 0 {
		payload["amount"] = amountCents
	}
	body, _ := json.Marshal(payload)
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
// BillingReason is "purchase", "subscription_create", "subscription_cycle"
// (a monthly renewal charge) or "subscription_update". Amounts are in cents.
type PolarOrder struct {
	ID             string            `json:"id"`
	Status         string            `json:"status"`
	Paid           bool              `json:"paid"`
	BillingReason  string            `json:"billing_reason"`
	ProductID      string            `json:"product_id"`
	SubscriptionID string            `json:"subscription_id"`
	NetAmount      int64             `json:"net_amount"`
	Metadata       map[string]string `json:"metadata"`
	Customer       struct {
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

	signed := []byte(msgID + "." + timestamp + ".")
	signed = append(signed, body...)

	// Header format: space-separated list of "v1,<base64sig>" entries.
	for _, key := range polarWebhookKeys(p.webhookSecret) {
		mac := hmac.New(sha256.New, key)
		mac.Write(signed)
		expected := base64.StdEncoding.EncodeToString(mac.Sum(nil))
		for _, part := range strings.Fields(sigHeader) {
			if sig, ok := strings.CutPrefix(part, "v1,"); ok {
				if subtle.ConstantTimeCompare([]byte(sig), []byte(expected)) == 1 {
					return true
				}
			}
		}
	}
	return false
}

// polarWebhookKeys returns the HMAC keys a Polar secret can stand for, in the
// order they're tried. Polar changed the scheme on 8 Sept 2026:
//   - Secrets created before then ("Legacy signing" in the dashboard) key the
//     HMAC with the UTF-8 bytes of the FULL "whsec_…" string, prefix included.
//   - Secrets created or reset after then are plain Standard Webhooks: strip
//     "whsec_" and base64-decode the rest.
//
// Both look identical ("whsec_" + 43 chars), so we try both, as Polar's own
// SDKs do. Only keys derived from our configured secret are ever accepted.
func polarWebhookKeys(secret string) [][]byte {
	keys := [][]byte{[]byte(secret)}
	rest := strings.TrimPrefix(secret, "whsec_")
	for _, enc := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding} {
		if k, err := enc.DecodeString(rest); err == nil && len(k) > 0 {
			return append(keys, k)
		}
	}
	return keys
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
