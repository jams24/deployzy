package notify

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"time"
)

// DeliverWebhook POSTs payload (as JSON) to url, signed with secret via an
// HMAC-SHA256 over the raw body in the X-Deployzy-Signature header. Returns the
// HTTP status code (0 on transport error). Receivers verify the signature with
// the same secret to confirm the request came from Deployzy.
func DeliverWebhook(url, secret string, payload any) int {
	body, _ := json.Marshal(payload)

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	sig := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return 0
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Deployzy-Signature", sig)
	req.Header.Set("User-Agent", "Deployzy-Webhook/1.0")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0
	}
	defer resp.Body.Close()
	return resp.StatusCode
}
