package db

import "testing"

func TestMaskEmail(t *testing.T) {
	cases := map[string]string{
		"alice@example.com": "al***@example.com",
		"ab@x.io":           "a***@x.io", // short locals reveal only 1 char
		"a@x.io":            "a***@x.io",
		"notanemail":        "notanemail",
	}
	for in, want := range cases {
		if got := maskEmail(in); got != want {
			t.Errorf("maskEmail(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestIsPaidPlan(t *testing.T) {
	for _, p := range []string{"pro", "team"} {
		if !isPaidPlan(p) {
			t.Errorf("%q should be paid", p)
		}
	}
	for _, p := range []string{"free", "", "admin"} {
		if isPaidPlan(p) {
			t.Errorf("%q should not be paid", p)
		}
	}
}
