package deploy

import (
	"regexp"
	"testing"
)

func TestParseProxyScan(t *testing.T) {
	out := "SMHIT /sm-c1e48df2|edge-ip-version,nezha,\n" +
		"SMHIT /sm-svc-svc_4b04980c|xray,\n" + // service container: ignored
		"noise line\n" +
		"SMHIT /sm-48f437a2-next|edge-ip-version,\n" + // blue-green temp: ignored
		"SMHIT /sm-0492c9d7|edge-ip-version\n"
	hits := parseProxyScan(out)
	if len(hits) != 2 {
		t.Fatalf("want 2 hits, got %d: %+v", len(hits), hits)
	}
	if hits[0].id8 != "c1e48df2" || hits[0].signatures != "edge-ip-version,nezha" {
		t.Fatalf("bad first hit: %+v", hits[0])
	}
	if hits[1].id8 != "0492c9d7" {
		t.Fatalf("bad second hit: %+v", hits[1])
	}
}

// The scan uses `grep -oE` with this pattern; Go's RE2 accepts the same syntax,
// so check it against command lines actually seen on our hosts (2026-10-17).
func TestProxyKitProcPattern(t *testing.T) {
	re := regexp.MustCompile(proxyKitProcPattern)
	abusive := []string{
		".tmp/xyjlbr tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token eyJ",
		"./cloudflared tunnel --no-autoupdate run --token eyJhIjoiOGU1",
		".cache/npm -s nz.lilyonlyone.eu.org:443 -p zwpECA8f39zwI1mlxn --tls",
		"./npm -s nezhak2.btpp.ggff.net:443 -p vortexa --tls --disable-auto-update",
		"/usr/local/bin/xray run -c config.json",
	}
	for _, l := range abusive {
		if !re.MatchString(l) {
			t.Errorf("should match: %s", l)
		}
	}
	benign := []string{
		"node --max-old-space-size=512 src/index.js",
		"python bot.py",
		"next-server (v15.1.0)",
		"gunicorn app:app --bind 0.0.0.0:8000",
		"npm start",
	}
	for _, l := range benign {
		if re.MatchString(l) {
			t.Errorf("should NOT match: %s", l)
		}
	}
}
