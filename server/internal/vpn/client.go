// Package vpn is a thin client for the TunnelTweak (TuTBot) Deploy API.
//
// Deployzy acts as a RESELLER: it holds a single TuTBot API key (configured in
// the admin panel) and drives the whole VPN panel — installing the VPN stack on
// a VPS and managing SSH/V2Ray accounts on it — on behalf of Deployzy users.
// Ownership of each TuTBot server_id / tunnel-user is tracked in Deployzy's own
// database (see the vpn_* tables), not by TuTBot, which sees one big customer.
//
// The upstream API shape is documented in the TuTBot repo's deploy_api.py.
package vpn

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Client talks to a single TuTBot deployment with a single reseller key.
type Client struct {
	BaseURL string // e.g. https://tunneltweak.deployzy.com
	APIKey  string // ttk_...
	http    *http.Client
}

// New builds a client. baseURL may include or omit a trailing slash.
func New(baseURL, apiKey string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		APIKey:  apiKey,
		http:    &http.Client{Timeout: 30 * time.Second},
	}
}

// Configured reports whether both a base URL and key are present.
func (c *Client) Configured() bool {
	return c != nil && c.BaseURL != "" && c.APIKey != ""
}

// APIError carries the upstream error envelope {"error":{"code","message"}}.
type APIError struct {
	Status  int
	Code    string
	Message string
}

func (e *APIError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return fmt.Sprintf("tutbot api error (status %d)", e.Status)
}

// do issues a request and decodes the JSON body into out (may be nil).
func (c *Client) do(ctx context.Context, method, path string, body any, out any) error {
	if !c.Configured() {
		return &APIError{Status: 0, Code: "not_configured", Message: "VPN panel is not configured. Set the TunnelTweak API key in the admin panel."}
	}

	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return &APIError{Status: 502, Code: "upstream_unreachable", Message: "Could not reach the VPN backend: " + err.Error()}
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	if resp.StatusCode >= 400 {
		// Try to unwrap the standard envelope; fall back to raw text.
		var env struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal(raw, &env) == nil && env.Error.Message != "" {
			return &APIError{Status: resp.StatusCode, Code: env.Error.Code, Message: env.Error.Message}
		}
		return &APIError{Status: resp.StatusCode, Code: "http_error", Message: strings.TrimSpace(string(raw))}
	}

	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			return err
		}
	}
	return nil
}

// MintKey creates a fresh isolated sub-account + API key on TunnelTweak using
// the reseller master key (a different secret from the per-panel APIKey). Used
// by the deploy hook to give each deployed VPN panel its own key. Returns the
// new plaintext ttk_ key.
func (c *Client) MintKey(ctx context.Context, masterKey, label string) (string, error) {
	if c.BaseURL == "" || masterKey == "" {
		return "", &APIError{Status: 0, Code: "not_configured", Message: "VPN base URL or master key not set"}
	}
	body, _ := json.Marshal(map[string]string{"label": label})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/api/v1/admin/keys", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("X-Master-Key", masterKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return "", &APIError{Status: 502, Code: "upstream_unreachable", Message: err.Error()}
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 400 {
		return "", &APIError{Status: resp.StatusCode, Code: "mint_failed", Message: strings.TrimSpace(string(raw))}
	}
	var out struct {
		APIKey string `json:"api_key"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", err
	}
	if out.APIKey == "" {
		return "", &APIError{Status: 500, Code: "mint_empty", Message: "mint returned no key"}
	}
	return out.APIKey, nil
}

// ── Auth self-check ──────────────────────────────────────────────────────

// Ping hits GET /api/v1 to confirm the key is valid. Returns the caller's
// upstream user id on success.
func (c *Client) Ping(ctx context.Context) (int, error) {
	var out struct {
		OK     bool `json:"ok"`
		UserID int  `json:"user_id"`
	}
	if err := c.do(ctx, http.MethodGet, "/api/v1", nil, &out); err != nil {
		return 0, err
	}
	return out.UserID, nil
}

// ── Servers ──────────────────────────────────────────────────────────────

// CreateServerRequest registers a VPS and enqueues the install job.
type CreateServerRequest struct {
	Label          string `json:"label"`
	Host           string `json:"host"`
	SSHPort        int    `json:"ssh_port,omitempty"`
	RootPassword   string `json:"root_password,omitempty"`
	SSHKey         string `json:"ssh_key,omitempty"`
	InstallProfile int    `json:"install_profile,omitempty"` // 1=Full 2=WS+Stunnel 3=DNSTT 4=MgmtOnly
	DNSTTDomain    string `json:"dnstt_domain,omitempty"`
}

type CreateServerResponse struct {
	ServerID int    `json:"server_id"`
	JobID    int    `json:"job_id"`
	Status   string `json:"status"`
	Poll     string `json:"poll"`
	Message  string `json:"message"`
}

func (c *Client) CreateServer(ctx context.Context, req CreateServerRequest) (*CreateServerResponse, error) {
	var out CreateServerResponse
	if err := c.do(ctx, http.MethodPost, "/api/v1/servers", req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Server mirrors the upstream server serialization.
type Server struct {
	ID              int             `json:"id"`
	Label           string          `json:"label"`
	Host            string          `json:"host"`
	SSHPort         int             `json:"ssh_port"`
	IP              string          `json:"ip"`
	InstallProfile  int             `json:"install_profile"`
	ProvisionStatus string          `json:"provision_status"`
	HealthStatus    string          `json:"health_status"`
	Services        map[string]any  `json:"services"`
	Ports           map[string]any  `json:"ports"`
	Domain          string          `json:"domain"`
	DNSTTDomain     string          `json:"dnstt_domain"`
	CreatedAt       string          `json:"created_at"`
}

func (c *Client) GetServer(ctx context.Context, id int) (*Server, error) {
	var out Server
	if err := c.do(ctx, http.MethodGet, fmt.Sprintf("/api/v1/servers/%d", id), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) DeleteServer(ctx context.Context, id int) error {
	return c.do(ctx, http.MethodDelete, fmt.Sprintf("/api/v1/servers/%d", id), nil, nil)
}

// Job is an install/provision job status.
type Job struct {
	ID          int    `json:"id"`
	ServerID    int    `json:"server_id"`
	Type        string `json:"type"`
	Status      string `json:"status"` // queued|running|completed|failed
	Message     string `json:"message"`
	Error       string `json:"error"`
	StartedAt   string `json:"started_at"`
	CompletedAt string `json:"completed_at"`
}

func (c *Client) GetJob(ctx context.Context, id int) (*Job, error) {
	var out Job
	if err := c.do(ctx, http.MethodGet, fmt.Sprintf("/api/v1/jobs/%d", id), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ── Tunnel users (SSH / V2Ray accounts) ──────────────────────────────────

type CreateUserRequest struct {
	Username        string   `json:"username,omitempty"`
	Password        string   `json:"password,omitempty"`
	Days            int      `json:"days,omitempty"`
	MaxLogins       int      `json:"max_logins,omitempty"`
	SelectedConfigs []string `json:"selected_configs,omitempty"`
}

// TunnelUser is a created VPN account. Password/ConnectCode are only present on
// create (returned once) and on password change.
type TunnelUser struct {
	ID          int    `json:"id"`
	ServerID    int    `json:"server_id"`
	Username    string `json:"username"`
	Password    string `json:"password,omitempty"`
	ConnectCode string `json:"connect_code,omitempty"`
	Status      string `json:"status"`
	ExpiresAt   string `json:"expires_at"`
	MaxLogins   int    `json:"max_logins"`
	HasV2Ray    bool   `json:"has_v2ray"`
}

func (c *Client) CreateUser(ctx context.Context, serverID int, req CreateUserRequest) (*TunnelUser, error) {
	var out TunnelUser
	if err := c.do(ctx, http.MethodPost, fmt.Sprintf("/api/v1/servers/%d/users", serverID), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) ListUsers(ctx context.Context, serverID int) ([]TunnelUser, error) {
	var out struct {
		Users []TunnelUser `json:"users"`
	}
	if err := c.do(ctx, http.MethodGet, fmt.Sprintf("/api/v1/servers/%d/users", serverID), nil, &out); err != nil {
		return nil, err
	}
	return out.Users, nil
}

func (c *Client) RenewUser(ctx context.Context, uid, days int) (*TunnelUser, error) {
	var out TunnelUser
	if err := c.do(ctx, http.MethodPost, fmt.Sprintf("/api/v1/users/%d/renew", uid), map[string]int{"days": days}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) DeleteUser(ctx context.Context, uid int) error {
	return c.do(ctx, http.MethodDelete, fmt.Sprintf("/api/v1/users/%d", uid), nil, nil)
}

// ServerConfig is the app-importable connect code + config URL.
type ServerConfig struct {
	ServerID    int    `json:"server_id"`
	ConnectCode string `json:"connect_code"`
	ConfigURL   string `json:"config_url"`
}

func (c *Client) GetServerConfig(ctx context.Context, serverID int) (*ServerConfig, error) {
	var out ServerConfig
	if err := c.do(ctx, http.MethodGet, fmt.Sprintf("/api/v1/servers/%d/config", serverID), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
