package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/notify"
)

// --- Teams ---

func (s *Server) handleCreateTeam(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		writeError(w, http.StatusBadRequest, "team name required")
		return
	}

	team, err := s.db.CreateTeam(r.Context(), req.Name, u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create team")
		return
	}

	writeJSON(w, http.StatusCreated, team)
}

func (s *Server) handleListTeams(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	teams, err := s.db.ListUserTeams(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list teams")
		return
	}
	if teams == nil {
		writeJSON(w, http.StatusOK, []struct{}{})
		return
	}
	writeJSON(w, http.StatusOK, teams)
}

func (s *Server) handleGetTeam(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	teamID := chi.URLParam(r, "teamId")

	role, isMember := s.db.IsTeamMember(r.Context(), teamID, u.ID)
	if !isMember {
		writeError(w, http.StatusForbidden, "not a team member")
		return
	}

	team, err := s.db.GetTeam(r.Context(), teamID)
	if err != nil || team == nil {
		writeError(w, http.StatusNotFound, "team not found")
		return
	}

	members, _ := s.db.ListTeamMembers(r.Context(), teamID)
	invitations, _ := s.db.ListPendingInvitations(r.Context(), teamID)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"team":        team,
		"role":        role,
		"members":     members,
		"invitations": invitations,
	})
}

func (s *Server) handleDeleteTeam(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	teamID := chi.URLParam(r, "teamId")

	if err := s.db.DeleteTeam(r.Context(), teamID, u.ID); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// --- Invitations ---

func (s *Server) handleInviteMember(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	teamID := chi.URLParam(r, "teamId")

	role, isMember := s.db.IsTeamMember(r.Context(), teamID, u.ID)
	if !isMember || (role != "owner" && role != "admin") {
		writeError(w, http.StatusForbidden, "only owners and admins can invite")
		return
	}

	var req struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Email == "" {
		writeError(w, http.StatusBadRequest, "email required")
		return
	}
	if req.Role == "" {
		req.Role = "member"
	}
	if req.Role == "owner" {
		writeError(w, http.StatusBadRequest, "cannot invite as owner")
		return
	}

	inv, err := s.db.InviteToTeam(r.Context(), teamID, req.Email, req.Role, u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create invitation")
		return
	}

	// Build the invite URL
	inviteURL := "https://deployzy.com/invite/" + inv.Token

	// Send invite email asynchronously
	if s.emailSvc != nil {
		team, _ := s.db.GetTeam(r.Context(), teamID)
		teamName := teamID
		if team != nil {
			teamName = team.Name
		}
		inviter, _ := s.db.GetUserByID(r.Context(), u.ID)
		inviterName := u.Email
		if inviter != nil && inviter.Name != "" {
			inviterName = inviter.Name
		}
		emailSvc := s.emailSvc
		go func() {
			subject := inviterName + " invited you to join " + teamName + " on Deployzy"
			body := notify.TeamInviteEmail(inviterName, teamName, inviteURL)
			if err := emailSvc.SendOne(req.Email, subject, body); err != nil {
				s.log.Warn().Err(err).Str("to", req.Email).Msg("failed to send team invite email")
			}
		}()
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"invitation": inv,
		"invite_url": inviteURL,
	})
}

func (s *Server) handleAcceptInvitation(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	token := chi.URLParam(r, "token")

	if err := s.db.AcceptInvitation(r.Context(), token, u.ID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "accepted"})
}

func (s *Server) handleCancelInvitation(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	teamID := chi.URLParam(r, "teamId")
	inviteID := chi.URLParam(r, "inviteId")

	role, isMember := s.db.IsTeamMember(r.Context(), teamID, u.ID)
	if !isMember || (role != "owner" && role != "admin") {
		writeError(w, http.StatusForbidden, "insufficient permissions")
		return
	}

	if err := s.db.DeleteInvitation(r.Context(), inviteID, teamID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "cancelled"})
}

// --- Members ---

func (s *Server) handleRemoveMember(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	teamID := chi.URLParam(r, "teamId")
	memberID := chi.URLParam(r, "userId")

	role, isMember := s.db.IsTeamMember(r.Context(), teamID, u.ID)
	if !isMember || (role != "owner" && role != "admin") {
		writeError(w, http.StatusForbidden, "insufficient permissions")
		return
	}

	if err := s.db.RemoveTeamMember(r.Context(), teamID, memberID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "removed"})
}

func (s *Server) handleUpdateMemberRole(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	teamID := chi.URLParam(r, "teamId")
	memberID := chi.URLParam(r, "userId")

	role, isMember := s.db.IsTeamMember(r.Context(), teamID, u.ID)
	if !isMember || role != "owner" {
		writeError(w, http.StatusForbidden, "only owner can change roles")
		return
	}

	var req struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Role == "" {
		writeError(w, http.StatusBadRequest, "role required")
		return
	}

	if err := s.db.UpdateMemberRole(r.Context(), teamID, memberID, req.Role); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update role")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}
