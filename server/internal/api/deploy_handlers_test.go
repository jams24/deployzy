package api

import (
	"testing"

	"github.com/serverme/serverme/server/internal/db"
)

func TestValidateServices(t *testing.T) {
	t.Run("empty is ok", func(t *testing.T) {
		out, errMsg := validateServices(nil)
		if errMsg != "" {
			t.Fatalf("unexpected error: %q", errMsg)
		}
		if len(out) != 0 {
			t.Fatalf("expected empty, got %d", len(out))
		}
	})

	t.Run("valid services are normalised", func(t *testing.T) {
		in := []db.ProjectService{
			{Name: "API", RootDir: "apps/api/", Port: 4000, StartCmd: " npm start "},
			{Name: "worker", RootDir: "worker", Port: 4001},
		}
		out, errMsg := validateServices(in)
		if errMsg != "" {
			t.Fatalf("unexpected error: %q", errMsg)
		}
		if out[0].Name != "api" {
			t.Errorf("name not lowercased: %q", out[0].Name)
		}
		if out[0].RootDir != "apps/api" {
			t.Errorf("root_dir not trimmed: %q", out[0].RootDir)
		}
		if out[0].StartCmd != "npm start" {
			t.Errorf("start_cmd not trimmed: %q", out[0].StartCmd)
		}
	})

	cases := []struct {
		name string
		in   []db.ProjectService
	}{
		{"duplicate names", []db.ProjectService{{Name: "api", Port: 1}, {Name: "api", Port: 2}}},
		{"duplicate ports", []db.ProjectService{{Name: "a", Port: 3000}, {Name: "b", Port: 3000}}},
		{"bad name chars", []db.ProjectService{{Name: "api_svc!", Port: 1}}},
		{"port too low", []db.ProjectService{{Name: "api", Port: 0}}},
		{"port too high", []db.ProjectService{{Name: "api", Port: 70000}}},
		{"path traversal dir", []db.ProjectService{{Name: "api", RootDir: "../etc", Port: 1}}},
		{"shell metachar dir", []db.ProjectService{{Name: "api", RootDir: "a;rm -rf /", Port: 1}}},
		{"absolute escape dir", []db.ProjectService{{Name: "api", RootDir: "/../../root", Port: 1}}},
		{"too many", []db.ProjectService{
			{Name: "a", Port: 1}, {Name: "b", Port: 2}, {Name: "c", Port: 3},
			{Name: "d", Port: 4}, {Name: "e", Port: 5}, {Name: "f", Port: 6},
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, errMsg := validateServices(c.in); errMsg == "" {
				t.Fatalf("expected error for %s, got none", c.name)
			}
		})
	}
}

func TestIsSafeImageRef(t *testing.T) {
	ok := []string{"nginx:alpine", "ghcr.io/you/app:1.2", "registry.io:5000/ns/img@sha256:abc", "postgres"}
	for _, s := range ok {
		if !isSafeImageRef(s) {
			t.Errorf("expected %q to be valid", s)
		}
	}
	bad := []string{"", "-flagged", "nginx;rm -rf /", "img`whoami`", "img$(id)", "a b"}
	for _, s := range bad {
		if isSafeImageRef(s) {
			t.Errorf("expected %q to be rejected", s)
		}
	}
}

func TestIsSafeRepoURL(t *testing.T) {
	if !isSafeRepoURL("https://github.com/you/app.git") {
		t.Error("valid github URL rejected")
	}
	for _, s := range []string{"--upload-pack=evil", "ssh://x", "file:///etc/passwd", "http://x"} {
		if isSafeRepoURL(s) {
			t.Errorf("expected %q rejected", s)
		}
	}
}

func TestIsSafeBranchName(t *testing.T) {
	if !isSafeBranchName("main") || !isSafeBranchName("feature/x-1.2") {
		t.Error("valid branch rejected")
	}
	for _, s := range []string{"-x", "a;b", "a b", "a$(b)"} {
		if isSafeBranchName(s) {
			t.Errorf("expected %q rejected", s)
		}
	}
}
