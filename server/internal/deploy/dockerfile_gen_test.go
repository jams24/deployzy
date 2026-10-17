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
