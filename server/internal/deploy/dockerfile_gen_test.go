package deploy

import (
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/serverme/serverme/server/internal/db"
)

var legacyStrip = regexp.MustCompile(`--mount=type=cache,[^ ]* `)

func TestNodeDockerfileMultiStage(t *testing.T) {
	e := &Engine{}
	def := e.generateDockerfile(&db.Project{}, "node")
	for _, want := range []string{" AS build", "COPY --from=build /app /app", "--mount=type=cache,target=/root/.npm ", "npm_config_audit=false"} {
		if !strings.Contains(def, want) {
			t.Errorf("default node Dockerfile missing %q", want)
		}
	}
	if strings.Count(def, "FROM node:") != 2 {
		t.Errorf("default node Dockerfile should have 2 stages")
	}
	if os.Getenv("DUMP_DF") != "" {
		os.WriteFile("/tmp/df_node_default", []byte(def), 0644)
		os.WriteFile("/tmp/df_node_legacy", []byte(legacyStrip.ReplaceAllString(def, "")), 0644)
	}

	custom := e.generateDockerfile(&db.Project{BuildCmd: "npm i -g pm2 && npm run build"}, "node")
	if strings.Contains(custom, "COPY --from=build") || strings.Count(custom, "FROM node:") != 1 {
		t.Errorf("custom build cmd must stay single-stage")
	}
	if !strings.Contains(custom, "EXPOSE 3000") || !strings.Contains(custom, "CMD sh -c") {
		t.Errorf("single-stage Dockerfile lost EXPOSE/CMD")
	}
	if c2 := e.generateDockerfile(&db.Project{InstallCmd: "yarn install"}, "node"); strings.Contains(c2, "--mount=") {
		t.Errorf("custom install must not get an npm cache mount")
	}
	if legacyStrip.MatchString(legacyStrip.ReplaceAllString(def, "")) {
		t.Errorf("legacy strip left a --mount behind")
	}
}

func TestPythonDockerfileDepsFirst(t *testing.T) {
	e := &Engine{}
	def := e.generateDockerfile(&db.Project{}, "python")
	iDeps := strings.Index(def, "COPY .sm-deps requirements.tx[t]")
	iSrc := strings.Index(def, "COPY . .")
	if iDeps < 0 || iSrc < 0 || iDeps > iSrc {
		t.Fatalf("deps must be copied/installed before the source")
	}
	if !strings.Contains(def, "--mount=type=cache,target=/root/.cache/pip") || strings.Contains(def, "--no-cache-dir") {
		t.Errorf("default python should use the pip cache mount, not --no-cache-dir")
	}
	legacy := strings.ReplaceAll(legacyStrip.ReplaceAllString(def, ""), "pip install ", "pip install --no-cache-dir ")
	if strings.Contains(legacy, "--mount=") || !strings.Contains(legacy, "pip install --no-cache-dir -r") {
		t.Errorf("legacy variant must drop mounts and restore --no-cache-dir")
	}
	if os.Getenv("DUMP_DF") != "" {
		os.WriteFile("/tmp/df_py_default", []byte(def), 0644)
		os.WriteFile("/tmp/df_py_legacy", []byte(legacy), 0644)
	}
	custom := e.generateDockerfile(&db.Project{InstallCmd: "pip install -r req/prod.txt"}, "python")
	if strings.Contains(custom, ".sm-deps") || strings.Contains(custom, "--mount=") {
		t.Errorf("custom install must keep the original template")
	}
}
