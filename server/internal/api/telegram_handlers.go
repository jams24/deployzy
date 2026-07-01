package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/notify"
)

// handleTelegramLinkCode generates a one-time code for linking Telegram.
func (s *Server) handleTelegramLinkCode(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	code, err := s.db.CreateLinkCode(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create link code")
		return
	}

	botUsername := "serverme_alerts_bot"
	if s.telegram != nil {
		botUsername = s.telegramBotUsername
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"code":     code,
		"bot_url":  fmt.Sprintf("https://t.me/%s?start=%s", botUsername, code),
		"bot_name": botUsername,
	})
}

// handleTelegramStatus returns the user's Telegram connection status.
func (s *Server) handleTelegramStatus(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	tc, err := s.db.GetTelegramConnection(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get status")
		return
	}

	if tc == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"connected": false,
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"connected":                true,
		"username":                 tc.Username,
		"first_name":              tc.FirstName,
		"notify_tunnel_connect":    tc.NotifyTunnelConnect,
		"notify_tunnel_disconnect": tc.NotifyTunnelDisconnect,
		"notify_error_spike":       tc.NotifyErrorSpike,
		"notify_traffic_summary":   tc.NotifyTrafficSummary,
		"notify_new_signup":        tc.NotifyNewSignup,
	})
}

// handleTelegramUpdatePrefs updates notification preferences.
func (s *Server) handleTelegramUpdatePrefs(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	var prefs map[string]bool
	if err := json.NewDecoder(r.Body).Decode(&prefs); err != nil {
		writeError(w, http.StatusBadRequest, "invalid preferences")
		return
	}

	if err := s.db.UpdateTelegramPreferences(r.Context(), u.ID, prefs); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update preferences")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// handleTelegramDisconnect unlinks Telegram.
func (s *Server) handleTelegramDisconnect(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	if err := s.db.DeleteTelegramConnection(r.Context(), u.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to disconnect")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "disconnected"})
}

// handleTelegramWebhook processes incoming Telegram updates.
func (s *Server) handleTelegramWebhook(w http.ResponseWriter, r *http.Request) {
	if s.telegram == nil {
		w.WriteHeader(http.StatusOK)
		return
	}

	var update notify.Update
	if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
		w.WriteHeader(http.StatusOK)
		return
	}

	if update.Message == nil || update.Message.Text == "" {
		w.WriteHeader(http.StatusOK)
		return
	}

	msg := update.Message
	text := msg.Text

	// Handle /start command with link code
	if len(text) > 7 && text[:7] == "/start " {
		code := text[7:]
		s.handleTelegramStart(msg, code)
	} else if text == "/start" {
		s.telegram.SendMarkdown(msg.Chat.ID,
			"👋 *Welcome to Deployzy Alerts!*\n\n"+
				"To connect your account, go to your [Deployzy Dashboard](https://deployzy.com/settings) "+
				"and click \"Connect Telegram\".")
	} else if text == "/tunnels" {
		s.handleTelegramTunnels(msg)
	} else if text == "/stats" {
		s.handleTelegramStats(msg)
	} else if text == "/help" {
		s.telegram.SendMarkdown(msg.Chat.ID,
			"*Deployzy Bot Commands*\n\n"+
				"/tunnels — List active tunnels\n"+
				"/stats — Quick traffic stats\n"+
				"/help — Show this message\n\n"+
				"Manage notifications at [deployzy.com/settings](https://deployzy.com/settings)")
	} else {
		s.telegram.SendMarkdown(msg.Chat.ID,
			"I don't understand that command. Try /help")
	}

	w.WriteHeader(http.StatusOK)
}

func (s *Server) handleTelegramStart(msg *notify.Message, code string) {
	ctx := context.Background()

	userID, err := s.db.RedeemLinkCode(ctx, code)
	if err != nil || userID == "" {
		s.telegram.SendMarkdown(msg.Chat.ID,
			"❌ Invalid or expired link code. Please generate a new one from your [dashboard](https://deployzy.com/settings).")
		return
	}

	username := ""
	firstName := ""
	if msg.From != nil {
		username = msg.From.Username
		firstName = msg.From.FirstName
	}

	err = s.db.SaveTelegramConnection(ctx, userID, msg.Chat.ID, username, firstName)
	if err != nil {
		s.telegram.SendMarkdown(msg.Chat.ID, "❌ Failed to link account. Please try again.")
		return
	}

	s.telegram.SendMarkdown(msg.Chat.ID,
		"✅ *Account linked successfully!*\n\n"+
			"You'll now receive notifications for:\n"+
			"• Tunnel connections/disconnections\n"+
			"• Error spikes\n\n"+
			"Manage preferences at [deployzy.com/settings](https://deployzy.com/settings)")
}

func (s *Server) handleTelegramTunnels(msg *notify.Message) {
	tunnels := s.registry.List()
	if len(tunnels) == 0 {
		s.telegram.SendMarkdown(msg.Chat.ID, "No active tunnels.")
		return
	}

	text := "*Active Tunnels*\n\n"
	for _, t := range tunnels {
		text += fmt.Sprintf("🟢 `%s` (%s)\n", t.URL, t.Protocol)
	}
	s.telegram.SendMarkdown(msg.Chat.ID, text)
}

func (s *Server) handleTelegramStats(msg *notify.Message) {
	// Find user by chat ID — simplified, just show global stats
	text := fmt.Sprintf("📊 *Quick Stats*\n\n"+
		"Active tunnels: *%d*\n\n"+
		"For detailed analytics, visit [deployzy.com/analytics](https://deployzy.com/analytics)",
		len(s.registry.List()))
	s.telegram.SendMarkdown(msg.Chat.ID, text)
}
