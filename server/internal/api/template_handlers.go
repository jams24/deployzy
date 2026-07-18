package api

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/billing"
	"github.com/serverme/serverme/server/internal/db"
)

func (s *Server) handleListTemplates(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))
	if limit <= 0 {
		limit = 20
	}

	f := db.TemplateFilter{
		Category: q.Get("category"),
		Search:   q.Get("search"),
		Sort:     q.Get("sort"),
		Limit:    limit,
		Offset:   offset,
	}

	var userID string
	if u := auth.GetUser(r); u != nil {
		userID = u.ID
	}

	templates, total, err := s.db.ListTemplates(r.Context(), f, userID)
	if err != nil {
		s.log.Error().Err(err).Msg("list templates")
		writeError(w, http.StatusInternalServerError, "failed to list templates")
		return
	}
	if templates == nil {
		templates = []db.Template{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"templates": templates,
		"total":     total,
		"limit":     limit,
		"offset":    offset,
	})
}

func (s *Server) handleListTemplateCategories(w http.ResponseWriter, r *http.Request) {
	cats, err := s.db.ListTemplateCategories(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list categories")
		return
	}
	if cats == nil {
		cats = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, cats)
}

func (s *Server) handleGetTemplate(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	var userID string
	if u := auth.GetUser(r); u != nil {
		userID = u.ID
	}

	t, err := s.db.GetTemplate(r.Context(), slug, userID)
	if err != nil {
		s.log.Error().Err(err).Str("slug", slug).Msg("get template")
		writeError(w, http.StatusInternalServerError, "failed to get template")
		return
	}
	if t == nil {
		writeError(w, http.StatusNotFound, "template not found")
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) handleToggleTemplateStar(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	slug := chi.URLParam(r, "slug")

	t, err := s.db.GetTemplate(r.Context(), slug, "")
	if err != nil || t == nil {
		writeError(w, http.StatusNotFound, "template not found")
		return
	}

	starred, count, err := s.db.ToggleTemplateStar(r.Context(), t.ID, u.ID)
	if err != nil {
		s.log.Error().Err(err).Msg("toggle template star")
		writeError(w, http.StatusInternalServerError, "failed to toggle star")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"starred":    starred,
		"star_count": count,
	})
}

var slugifyRe = regexp.MustCompile(`[^a-z0-9-]`)

func templateSubdomain(name string) string {
	s := strings.ToLower(name)
	s = strings.ReplaceAll(s, " ", "-")
	s = slugifyRe.ReplaceAllString(s, "")
	s = regexp.MustCompile(`-+`).ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 32 {
		s = s[:32]
	}
	if s == "" {
		s = "app"
	}
	return s
}

func (s *Server) handleDeployFromTemplate(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	slug := chi.URLParam(r, "slug")

	var req struct {
		Name           string            `json:"name"`
		Subdomain      string            `json:"subdomain"`
		EnvVars        map[string]string `json:"env_vars"`
		WorkerServerID string            `json:"worker_server_id"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}

	t, err := s.db.GetTemplate(r.Context(), slug, u.ID)
	if err != nil || t == nil {
		writeError(w, http.StatusNotFound, "template not found")
		return
	}

	// Validate required env vars
	for _, ev := range t.EnvVars {
		if ev.Required && ev.Type != "auto" {
			if val, ok := req.EnvVars[ev.Key]; !ok || val == "" {
				writeError(w, http.StatusBadRequest, "missing required env var: "+ev.Key)
				return
			}
		}
	}

	// Plan limit check
	if err := billing.EnsureCanCreate(r.Context(), s.db, u, billing.DimProject); err != nil {
		writeError(w, http.StatusPaymentRequired, err.Error())
		return
	}

	name := req.Name
	if name == "" {
		name = t.Name
	}

	subdomain := req.Subdomain
	if subdomain == "" {
		subdomain = templateSubdomain(name)
	}

	// Ensure subdomain is available; append a suffix if not
	base := subdomain
	for i := 1; i <= 10; i++ {
		available, _ := s.db.CheckSubdomainAvailable(r.Context(), subdomain, u.ID)
		if available {
			break
		}
		subdomain = base + "-" + strconv.Itoa(i)
	}

	project, err := s.db.CreateProject(r.Context(), u.ID, name, subdomain, "docker")
	if err != nil {
		writeError(w, http.StatusConflict, "subdomain already taken")
		return
	}

	// Merge user-supplied env vars with defaults from template schema
	merged := map[string]string{}
	for _, schema := range t.EnvVars {
		if schema.Default != "" {
			merged[schema.Key] = schema.Default
		}
	}
	for k, v := range req.EnvVars {
		if v != "" {
			merged[k] = v
		}
	}
	if len(merged) > 0 {
		s.db.UpdateProjectEnvVars(r.Context(), project.ID, merged)
		project.EnvVars = merged
	}

	// Set deploy source: docker image or git repo
	if t.DockerImage != nil && *t.DockerImage != "" {
		if isSafeImageRef(*t.DockerImage) {
			s.db.SetProjectSource(r.Context(), project.ID, "image", *t.DockerImage)
			project.DeploySource = "image"
			project.ImageRef = *t.DockerImage
		}
	} else if t.SourceRepo != nil && *t.SourceRepo != "" {
		if isSafeRepoURL(*t.SourceRepo) {
			s.db.UpdateProjectConfig(r.Context(), project.ID, *t.SourceRepo, "main", "", "", merged)
			project.RepoURL = *t.SourceRepo
			project.Branch = "main"
		}
	}

	s.db.ReserveSubdomainAuto(r.Context(), u.ID, subdomain)

	// Assign to BYOC server if the user requested it and owns that server
	if req.WorkerServerID != "" {
		srv, err := s.db.GetWorkerServer(r.Context(), req.WorkerServerID)
		if err == nil && srv != nil && srv.UserID != nil && *srv.UserID == u.ID {
			s.db.AssignProjectServer(r.Context(), project.ID, req.WorkerServerID)
			project.WorkerServerID = req.WorkerServerID
		}
	}

	// Bump deploy counter asynchronously
	go s.db.IncrementTemplateDeployCount(r.Context(), t.ID)

	writeJSON(w, http.StatusCreated, map[string]any{
		"project":     project,
		"post_deploy": t.PostDeploy,
	})
}
