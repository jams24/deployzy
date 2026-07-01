package deploy

import (
	"strings"
	"testing"

	"github.com/serverme/serverme/server/internal/db"
)

func TestSafeDir(t *testing.T) {
	cases := map[string]string{
		"":             ".",
		"apps/web":     "apps/web",
		"/apps/web/":   "apps/web",
		"./src":        "src",
		"../etc":       ".", // traversal → repo root
		"a;rm -rf /":   ".", // shell metachars → repo root
		"a b":          ".", // space not in allowlist
		"valid_dir-1":  "valid_dir-1",
	}
	for in, want := range cases {
		if got := safeDir(in); got != want {
			t.Errorf("safeDir(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestShellSingleQuote(t *testing.T) {
	if got := shellSingleQuote("abc"); got != "'abc'" {
		t.Errorf("got %q", got)
	}
	// Embedded single quotes must be escaped so the value can't break out.
	got := shellSingleQuote("a'b")
	if !strings.HasPrefix(got, "'") || !strings.HasSuffix(got, "'") || !strings.Contains(got, `'\''`) {
		t.Errorf("unsafe quoting: %q", got)
	}
}

func TestServiceCommandDefaults(t *testing.T) {
	// Explicit commands win; otherwise framework-aware defaults are used.
	if got := msInstall(msProc{install: "custom"}); got != "custom" {
		t.Errorf("explicit install ignored: %q", got)
	}
	if got := msStart(msProc{framework: "python"}); got != "python app.py" {
		t.Errorf("python start default wrong: %q", got)
	}
	if got := msStart(msProc{framework: "node"}); got != "npm start" {
		t.Errorf("node start default wrong: %q", got)
	}
	if got := msBuild(msProc{framework: "nextjs"}); got != "npm run build" {
		t.Errorf("nextjs build default wrong: %q", got)
	}
	if got := msBuild(msProc{framework: "node"}); got != "" {
		t.Errorf("node build should default empty, got %q", got)
	}
}

func TestGenerateServiceEntrypoint(t *testing.T) {
	e := &Engine{}
	procs := []msProc{
		{name: "app", dir: "", port: 3000, framework: "nextjs"},
		{name: "api", dir: "apps/api", port: 4000, framework: "node", env: map[string]string{"MODE": "api"}},
	}
	script := e.generateServiceEntrypoint(procs)
	for _, want := range []string{
		"#!/bin/sh",
		"export PORT=3000",
		"export PORT=4000",
		"cd /app/. ",
		"cd /app/apps/api ",
		"export MODE='api'",
		"exit 1", // dies if any process exits
	} {
		if !strings.Contains(script, want) {
			t.Errorf("entrypoint missing %q\n--- script ---\n%s", want, script)
		}
	}
}

func TestMultiServiceProcsIncludesPrimary(t *testing.T) {
	e := &Engine{}
	p := &db.Project{
		RootDir:  "apps/web",
		StartCmd: "npm start",
		Services: []db.ProjectService{{Name: "api", RootDir: "apps/api", Port: 4000}},
	}
	procs := e.multiServiceProcs(p, "nextjs", 3000)
	if len(procs) != 2 {
		t.Fatalf("expected primary + 1 service, got %d", len(procs))
	}
	if procs[0].port != 3000 || procs[0].dir != "apps/web" {
		t.Errorf("primary proc wrong: %+v", procs[0])
	}
	if procs[1].name != "api" || procs[1].port != 4000 {
		t.Errorf("service proc wrong: %+v", procs[1])
	}
}
