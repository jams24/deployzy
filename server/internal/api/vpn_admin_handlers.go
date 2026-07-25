package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/serverme/serverme/server/internal/vpn"
)

// Setting keys for the VPN (TuTBot reseller) integration.
const (
	settingVPNBaseURL        = "vpn_base_url"
	settingVPNAPIKey         = "vpn_api_key"
	settingVPNSharedServerID = "vpn_shared_server_id" // TuTBot server_id for the free public pool
	settingVPNFreeDays       = "vpn_free_days"        // account lifetime for free users
	settingVPNFreeMaxLogins  = "vpn_free_max_logins"  // simultaneous logins for free accounts
)

// vpnClient builds a TuTBot client from stored settings. Returns a client whose
// Configured() is false when the admin hasn't set it up yet.
func (s *Server) vpnClient(ctx context.Context) *vpn.Client {
	cfg, _ := s.db.GetSettings(ctx, settingVPNBaseURL, settingVPNAPIKey)
	return vpn.New(cfg[settingVPNBaseURL], cfg[settingVPNAPIKey])
}

// GET /api/v1/admin/vpn/config — never echoes the raw key back.
func (s *Server) handleAdminGetVPNConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.db.GetSettings(r.Context(),
		settingVPNBaseURL, settingVPNAPIKey, settingVPNSharedServerID,
		settingVPNFreeDays, settingVPNFreeMaxLogins)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load settings")
		return
	}
	key := cfg[settingVPNAPIKey]
	masked := ""
	if key != "" {
		if len(key) > 12 {
			masked = key[:12] + "…"
		} else {
			masked = "set"
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"base_url":         cfg[settingVPNBaseURL],
		"api_key_set":      key != "",
		"api_key_preview":  masked,
		"shared_server_id": cfg[settingVPNSharedServerID],
		"free_days":        cfg[settingVPNFreeDays],
		"free_max_logins":  cfg[settingVPNFreeMaxLogins],
	})
}

// PUT /api/v1/admin/vpn/config — updates whichever fields are present. An empty
// api_key is ignored (keeps the existing one) so saving other fields never wipes
// the secret; send api_key:"__clear__" to explicitly remove it.
func (s *Server) handleAdminSetVPNConfig(w http.ResponseWriter, r *http.Request) {
	var body struct {
		BaseURL        *string `json:"base_url"`
		APIKey         *string `json:"api_key"`
		SharedServerID *string `json:"shared_server_id"`
		FreeDays       *string `json:"free_days"`
		FreeMaxLogins  *string `json:"free_max_logins"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	ctx := r.Context()
	set := func(key string, v *string) {
		if v != nil {
			s.db.SetSetting(ctx, key, strings.TrimSpace(*v))
		}
	}
	if body.BaseURL != nil {
		set(settingVPNBaseURL, body.BaseURL)
	}
	if body.APIKey != nil {
		k := strings.TrimSpace(*body.APIKey)
		if k == "__clear__" {
			s.db.SetSetting(ctx, settingVPNAPIKey, "")
		} else if k != "" {
			s.db.SetSetting(ctx, settingVPNAPIKey, k)
		}
	}
	set(settingVPNSharedServerID, body.SharedServerID)
	set(settingVPNFreeDays, body.FreeDays)
	set(settingVPNFreeMaxLogins, body.FreeMaxLogins)

	writeJSON(w, http.StatusOK, map[string]string{"status": "saved"})
}

// POST /api/v1/admin/vpn/test — validates the stored key against the live API.
func (s *Server) handleAdminTestVPN(w http.ResponseWriter, r *http.Request) {
	c := s.vpnClient(r.Context())
	if !c.Configured() {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "Base URL and API key are required."})
		return
	}
	uid, err := c.Ping(r.Context())
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "upstream_user_id": uid})
}
