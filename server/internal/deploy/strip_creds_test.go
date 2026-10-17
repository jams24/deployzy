package deploy

import "testing"

func TestStripRepoCreds(t *testing.T) {
	cases := map[string]string{
		"https://x-access-token:ghs_abc123@github.com/owner/repo.git": "https://github.com/owner/repo.git",
		"https://github.com/owner/repo.git":                           "https://github.com/owner/repo.git",
		"https://user:pass@github.com/o/r":                            "https://github.com/o/r",
	}
	for in, want := range cases {
		if got := stripRepoCreds(in); got != want {
			t.Errorf("stripRepoCreds(%q) = %q, want %q", in, got, want)
		}
	}
}
