package api

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/serverme/serverme/server/internal/auth"
	"github.com/serverme/serverme/server/internal/billing"
)

// aiAssets embeds each generator's scaffold + JSON schema so the whole AI
// builder ships inside the server binary — no node runtime or filesystem
// dependency on the VPS. The model only ever fills the schema; it never writes
// code, which is what makes this cheap, reliable, and hard to abuse.
//
//go:embed aiassets/portfolio/index.html aiassets/portfolio/Dockerfile aiassets/portfolio.schema.json aiassets/landing/index.html aiassets/landing/Dockerfile aiassets/landing.schema.json
var aiAssets embed.FS

type aiGenerator struct {
	scaffoldDir string   // embed dir with the scaffold (must contain a Dockerfile)
	schemaFile  string   // embed path to the JSON schema
	files       []string // scaffold files (relative names) to include in the build context
	systemHint  string   // what kind of site this is
}

var aiGenerators = map[string]aiGenerator{
	"portfolio": {
		scaffoldDir: "aiassets/portfolio",
		schemaFile:  "aiassets/portfolio.schema.json",
		files:       []string{"index.html", "Dockerfile"},
		systemHint:  "You generate content for a personal PORTFOLIO website.",
	},
	"landing": {
		scaffoldDir: "aiassets/landing",
		schemaFile:  "aiassets/landing.schema.json",
		files:       []string{"index.html", "Dockerfile"},
		systemHint:  "You generate content for a modern PRODUCT / SaaS LANDING PAGE. Make the headline benefit-driven and the features concrete. Only include pricing/testimonials/faq/metrics if the product warrants them.",
	},
}

// handleAIBuild: prompt -> DeepSeek (constrained to the generator's schema) ->
// content.json -> assemble scaffold build context -> deploy via the existing
// engine -> live URL. Counts against the user's project plan limit.
func (s *Server) handleAIBuild(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)

	var req struct {
		Generator string `json:"generator"`
		Prompt    string `json:"prompt"`
		Subdomain string `json:"subdomain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Prompt) == "" {
		writeError(w, http.StatusBadRequest, "prompt is required")
		return
	}
	if len(req.Prompt) > 1200 {
		writeError(w, http.StatusBadRequest, "prompt too long (max 1200 characters)")
		return
	}
	if req.Generator == "" {
		req.Generator = "portfolio"
	}
	gen, ok := aiGenerators[req.Generator]
	if !ok {
		writeError(w, http.StatusBadRequest, "unknown generator")
		return
	}

	key := os.Getenv("DEEPSEEK_API_KEY")
	if key == "" {
		writeError(w, http.StatusServiceUnavailable, "AI builder isn't configured yet")
		return
	}
	if s.deployer == nil {
		writeError(w, http.StatusServiceUnavailable, "deploy engine not available")
		return
	}

	// A generated site is a real project — enforce the plan's project limit.
	if err := billing.EnsureCanCreate(r.Context(), s.db, u, billing.DimProject); err != nil {
		writeError(w, http.StatusPaymentRequired, err.Error())
		return
	}

	// 1) Generate content.json (the ONLY thing the model produces).
	schema, _ := aiAssets.ReadFile(gen.schemaFile)
	content, name, err := s.deepseekGenerate(r.Context(), key, gen.systemHint, string(schema), req.Prompt)
	if err != nil {
		s.log.Error().Err(err).Msg("ai build: generation failed")
		writeError(w, http.StatusBadGateway, "generation failed, please try again")
		return
	}

	// 2) Create the project (no explicit server -> lands on the platform host,
	//    where upload build-contexts are supported). Framework "docker" so the
	//    engine builds the scaffold's Dockerfile.
	sub := req.Subdomain
	if sub == "" {
		sub = name
	}
	sub = s.uniqueSubdomain(r.Context(), sanitizeSubdomain(sub), u.ID)
	project, err := s.db.CreateProject(r.Context(), u.ID, sub, sub, "docker")
	if err != nil || project == nil {
		writeError(w, http.StatusInternalServerError, "could not create project")
		return
	}
	if err := s.db.SetProjectSource(r.Context(), project.ID, "upload", ""); err != nil {
		s.log.Error().Err(err).Str("project", project.ID).Msg("ai build: set source failed")
	}
	project.DeploySource = "upload"
	s.db.ReserveSubdomainAuto(r.Context(), u.ID, sub)

	// 3) Stage the build context tarball (scaffold files + generated content.json).
	if err := s.stageAIBuildContext(project.ID, gen, content); err != nil {
		s.log.Error().Err(err).Str("project", project.ID).Msg("ai build: stage failed")
		writeError(w, http.StatusInternalServerError, "failed to stage build")
		return
	}

	// 4) Deploy async — same path as every other deploy.
	go func() {
		ctx := context.Background()
		if err := s.deployer.Deploy(ctx, project); err != nil {
			s.log.Error().Err(err).Str("project", project.ID).Msg("ai build: deploy failed")
		}
	}()

	writeJSON(w, http.StatusAccepted, map[string]any{
		"project": project,
		"url":     fmt.Sprintf("https://%s.%s", sub, s.deployer.AppDomain),
		"status":  "deploying",
	})
}

// deepseekGenerate calls DeepSeek (OpenAI-compatible) in JSON mode, constrained
// to the schema. Returns the pretty content.json bytes and a slug derived from
// the generated name.
func (s *Server) deepseekGenerate(ctx context.Context, key, hint, schema, prompt string) ([]byte, string, error) {
	system := hint + ` You output ONLY a single JSON object that strictly matches this JSON Schema — no markdown, no prose, no code fences. Fill every required field with real, specific, human-sounding copy based on the user's request. Write "about" in the first person. Keep it warm, confident, and concrete — never generic AI filler. Pick an accent hex color that suits the subject. If the user gives no real links, omit "url" rather than inventing one.

JSON Schema:
` + schema

	body, _ := json.Marshal(map[string]any{
		"model": "deepseek-chat",
		"messages": []map[string]string{
			{"role": "system", "content": system},
			{"role": "user", "content": prompt},
		},
		"response_format": map[string]string{"type": "json_object"},
		"temperature":     0.7,
		"max_tokens":      2000,
	})

	reqCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	httpReq, _ := http.NewRequestWithContext(reqCtx, http.MethodPost, "https://api.deepseek.com/chat/completions", bytes.NewReader(body))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+key)

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("deepseek status %d", resp.StatusCode)
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, "", err
	}
	if len(out.Choices) == 0 {
		return nil, "", fmt.Errorf("empty completion")
	}

	// Validate it parses as an object, then re-marshal pretty.
	var obj map[string]any
	if err := json.Unmarshal([]byte(out.Choices[0].Message.Content), &obj); err != nil {
		return nil, "", fmt.Errorf("model did not return valid JSON: %w", err)
	}
	pretty, _ := json.MarshalIndent(obj, "", "  ")

	// derive a slug from the most name-like field the generator produced
	// (portfolio → hero.name; landing → brand.name; fallback → meta.title).
	slug := "site"
	if hero, ok := obj["hero"].(map[string]any); ok {
		if n, ok := hero["name"].(string); ok && n != "" {
			slug = n
		}
	}
	if slug == "site" {
		if brand, ok := obj["brand"].(map[string]any); ok {
			if n, ok := brand["name"].(string); ok && n != "" {
				slug = n
			}
		}
	}
	if slug == "site" {
		if meta, ok := obj["meta"].(map[string]any); ok {
			if t, ok := meta["title"].(string); ok && t != "" {
				slug = t
			}
		}
	}
	return pretty, sanitizeSubdomain(slug), nil
}

// stageAIBuildContext writes a .tar.gz build context (scaffold files + the
// generated content.json) to the same staging path the upload deploy uses.
func (s *Server) stageAIBuildContext(projectID string, gen aiGenerator, content []byte) error {
	if err := os.MkdirAll("/tmp/serverme-uploads", 0o755); err != nil {
		return err
	}
	tarPath := fmt.Sprintf("/tmp/serverme-uploads/%s.tar.gz", projectID)
	f, err := os.Create(tarPath)
	if err != nil {
		return err
	}
	defer f.Close()
	gz := gzip.NewWriter(f)
	tw := tar.NewWriter(gz)

	writeEntry := func(name string, data []byte) error {
		if err := tw.WriteHeader(&tar.Header{
			Name: name, Mode: 0o644, Size: int64(len(data)), ModTime: time.Now(),
		}); err != nil {
			return err
		}
		_, err := tw.Write(data)
		return err
	}

	for _, name := range gen.files {
		data, err := aiAssets.ReadFile(gen.scaffoldDir + "/" + name)
		if err != nil {
			return err
		}
		if err := writeEntry(name, data); err != nil {
			return err
		}
	}
	if err := writeEntry("content.json", content); err != nil {
		return err
	}
	if err := tw.Close(); err != nil {
		return err
	}
	return gz.Close()
}

var subSanitize = regexp.MustCompile(`[^a-z0-9-]+`)

func sanitizeSubdomain(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, " ", "-")
	s = subSanitize.ReplaceAllString(s, "")
	s = strings.Trim(s, "-")
	if len(s) > 40 {
		s = s[:40]
	}
	if s == "" {
		s = "site"
	}
	return s
}
