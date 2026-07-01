package db

import "testing"

func TestValidScope(t *testing.T) {
	for _, s := range []string{"read", "deploy", "full"} {
		if !ValidScope(s) {
			t.Errorf("%q should be valid", s)
		}
	}
	for _, s := range []string{"", "admin", "FULL", "write"} {
		if ValidScope(s) {
			t.Errorf("%q should be invalid", s)
		}
	}
}
