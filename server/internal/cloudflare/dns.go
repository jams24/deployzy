package cloudflare

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const apiBase = "https://api.cloudflare.com/client/v4"

// Client manages DNS records via the Cloudflare API.
type Client struct {
	token  string
	zoneID string
	http   *http.Client
}

// New returns a Cloudflare DNS client. Returns nil (safe no-op) if either
// token or zoneID is empty so callers don't need to guard every call.
func New(token, zoneID string) *Client {
	if token == "" || zoneID == "" {
		return nil
	}
	return &Client{
		token:  token,
		zoneID: zoneID,
		http:   &http.Client{Timeout: 15 * time.Second},
	}
}

type dnsRecord struct {
	ID      string `json:"id,omitempty"`
	Type    string `json:"type"`
	Name    string `json:"name"`
	Content string `json:"content"`
	Proxied bool   `json:"proxied"`
	TTL     int    `json:"ttl"` // 1 = auto
}

type cfResponse struct {
	Success bool              `json:"success"`
	Errors  []cfError         `json:"errors"`
	Result  []dnsRecord       `json:"result"`
}

type cfSingleResponse struct {
	Success bool      `json:"success"`
	Errors  []cfError `json:"errors"`
	Result  dnsRecord `json:"result"`
}

type cfError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// UpsertARecord creates or updates an A record for name → ip.
// proxied=false so raw TCP ports (DB, Redis) work directly.
func (c *Client) UpsertARecord(name, ip string, proxied bool) error {
	if c == nil {
		return nil
	}

	existing, err := c.findRecord(name, "A")
	if err != nil {
		return err
	}

	rec := dnsRecord{
		Type:    "A",
		Name:    name,
		Content: ip,
		Proxied: proxied,
		TTL:     1,
	}

	if existing != nil {
		rec.ID = existing.ID
		if existing.Content == ip && existing.Proxied == proxied {
			return nil // already correct, nothing to do
		}
		return c.updateRecord(existing.ID, rec)
	}
	return c.createRecord(rec)
}

// DeleteARecord removes the A record for name if it exists.
func (c *Client) DeleteARecord(name string) error {
	if c == nil {
		return nil
	}
	existing, err := c.findRecord(name, "A")
	if err != nil || existing == nil {
		return err
	}
	return c.deleteRecord(existing.ID)
}

func (c *Client) findRecord(name, recType string) (*dnsRecord, error) {
	url := fmt.Sprintf("%s/zones/%s/dns_records?type=%s&name=%s", apiBase, c.zoneID, recType, name)
	body, err := c.do("GET", url, nil)
	if err != nil {
		return nil, err
	}
	var resp cfResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("parse cf response: %w", err)
	}
	if !resp.Success {
		return nil, cfErrors(resp.Errors)
	}
	if len(resp.Result) == 0 {
		return nil, nil
	}
	return &resp.Result[0], nil
}

func (c *Client) createRecord(rec dnsRecord) error {
	body, _ := json.Marshal(rec)
	url := fmt.Sprintf("%s/zones/%s/dns_records", apiBase, c.zoneID)
	resp, err := c.do("POST", url, body)
	if err != nil {
		return err
	}
	var r cfSingleResponse
	json.Unmarshal(resp, &r)
	if !r.Success {
		return cfErrors(r.Errors)
	}
	return nil
}

func (c *Client) updateRecord(id string, rec dnsRecord) error {
	body, _ := json.Marshal(rec)
	url := fmt.Sprintf("%s/zones/%s/dns_records/%s", apiBase, c.zoneID, id)
	resp, err := c.do("PUT", url, body)
	if err != nil {
		return err
	}
	var r cfSingleResponse
	json.Unmarshal(resp, &r)
	if !r.Success {
		return cfErrors(r.Errors)
	}
	return nil
}

func (c *Client) deleteRecord(id string) error {
	url := fmt.Sprintf("%s/zones/%s/dns_records/%s", apiBase, c.zoneID, id)
	_, err := c.do("DELETE", url, nil)
	return err
}

func (c *Client) do(method, url string, body []byte) ([]byte, error) {
	var reqBody io.Reader
	if body != nil {
		reqBody = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, url, reqBody)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("cloudflare api: %w", err)
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

func cfErrors(errs []cfError) error {
	msgs := make([]string, len(errs))
	for i, e := range errs {
		msgs[i] = fmt.Sprintf("%d: %s", e.Code, e.Message)
	}
	return fmt.Errorf("cloudflare: %s", strings.Join(msgs, "; "))
}
