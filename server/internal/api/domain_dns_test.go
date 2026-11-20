package api

import "testing"

func TestNormalizeDomain(t *testing.T) {
	ok := []struct {
		in, want string
		note     bool
	}{
		{"example.com", "example.com", false},
		{"  HTTPS://WWW.Example.com:443/path?q=1 ", "example.com", true},
		{"http://api.example.com/", "api.example.com", false},
		{"shop.example.co.uk.", "shop.example.co.uk", false},
		{"www.example.com", "example.com", true},
		{"my-app.example.io", "my-app.example.io", false},
	}
	for _, c := range ok {
		got, note, err := normalizeDomain(c.in)
		if err != nil || got != c.want || (note != "") != c.note {
			t.Errorf("normalizeDomain(%q) = %q, note %q, err %v; want %q (note=%v)", c.in, got, note, err, c.want, c.note)
		}
	}
	bad := []string{"", "localhost", "foo.deployzy.app", "deployzy.com", "x.deployzy.com", "1.2.3.4", "bad_label.com", "-x.com", "exa mple.com"}
	for _, in := range bad {
		if got, _, err := normalizeDomain(in); err == nil {
			t.Errorf("normalizeDomain(%q) = %q, want error", in, got)
		}
	}
}
