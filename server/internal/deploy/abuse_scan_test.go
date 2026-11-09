package deploy

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
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

func TestParseProxyScanEvidence(t *testing.T) {
	hits := parseProxyScan("SMHIT /sm-6247e037|bin:xtls/xray-core@*:3000;,|2|841318777|677796578\n")
	if len(hits) != 1 {
		t.Fatalf("want 1 hit, got %+v", hits)
	}
	h := hits[0]
	if h.signatures != "bin:xtls/xray-core@*:3000;" || h.established != 2 || h.rxBytes != 841318777 || h.txBytes != 677796578 {
		t.Fatalf("bad parse: %+v", h)
	}
}

// Cases are the shapes seen on our hosts (2026-11-09) plus the legit ones the
// scanner must leave alone: panels, proxy clients, plain cloudflared.
func TestClassifyProxyHit(t *testing.T) {
	cases := []struct {
		name    string
		sigs    string
		appPort int
		want    proxyVerdict
		says    []string
	}{
		{"vless written in the app's own JS (node-ws)", "src:vless-ws@index.js,bin:nezhahq/agent@-", 8080, verdictServer,
			[]string{"VLESS-over-WebSocket server written in the app's own code (index.js)", "app's public port", "Nezha"}},
		{"vless on the app port", "bin:xtls/xray-core@*:3000;", 3000, verdictServer,
			[]string{"Xray on *:3000", "app's public port"}},
		{"argo kit: sing-box public + tunnel + nezha",
			"edge-ip-version,bin:sagernet/sing-box@0.0.0.0:59499;*:8001;,bin:cloudflare/cloudflared@127.0.0.1:20241;,bin:nezhahq/agent@-", 3000, verdictServer,
			[]string{"sing-box on *:8001", "Nezha"}},
		{"proxy on loopback behind a tunnel", "bin:sagernet/sing-box@127.0.0.1:8001;,bin:cloudflare/cloudflared@127.0.0.1:20241;", 3000, verdictServer,
			[]string{"exposed through a Cloudflare tunnel"}},
		{"nezha agent alone", "bin:nezhahq/agent@-", 8080, verdictKitAgent,
			[]string{"not a VPN", "Review"}},
		{"3x-ui panel, no inbounds yet (xray API on loopback)", "xray,bin:xtls/xray-core@127.0.0.1:62789;", 2053, verdictNone, nil},
		{"app routes its own traffic via a local xray client", "bin:xtls/xray-core@127.0.0.1:10808;[::1]:10808;", 3000, verdictNone, nil},
		{"plain cloudflared tunnel", "edge-ip-version,bin:cloudflare/cloudflared@127.0.0.1:20241;", 3000, verdictNone, nil},
		{"name-only match", "xray", 3000, verdictNone, nil},
		{"old-format evidence without listen info", "bin:xtls/xray-core", 3000, verdictNone, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := classifyProxyHit(proxyHit{signatures: c.sigs, rxBytes: 5 << 20, txBytes: 7 << 20}, c.appPort)
			if f.verdict != c.want {
				t.Fatalf("verdict = %v, want %v (summary %q)", f.verdict, c.want, f.summary)
			}
			for _, s := range c.says {
				if !strings.Contains(f.summary, s) {
					t.Errorf("summary missing %q: %s", s, f.summary)
				}
			}
		})
	}
}

func TestProxyKitEnvHit(t *testing.T) {
	if proxyKitEnvHit(map[string]string{"NEZHA_SERVER": "x"}) == "" {
		t.Error("NEZHA_SERVER alone should block")
	}
	if proxyKitEnvHit(map[string]string{"HY2_PORT": "1", "TUIC_PORT": "2"}) == "" {
		t.Error("two kit port knobs should block")
	}
	if got := proxyKitEnvHit(map[string]string{"S5_PORT": "1080", "DATABASE_URL": "x"}); got != "" {
		t.Errorf("a single generic knob should not block, got %q", got)
	}
}

// Runs the real shell fragment against fixtures shaped like what we found in
// production (2026-11-09) and like legit apps that must not match.
func TestVlessSourceCmd(t *testing.T) {
	if _, err := exec.LookPath("bash"); err != nil {
		t.Skip("bash not available")
	}
	write := func(dir, name, body string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	run := func(dir string) string {
		out, _ := exec.Command("bash", "-c", vlessSourceCmd(shellQuote(dir))).Output()
		return strings.TrimSpace(string(out))
	}

	kit := t.TempDir() // obfuscated node-ws: identifiers renamed, protocol isn't
	write(kit, "index.js", "const { WebSocketServer } = require('ws');\nconst net = require('net');\n"+
		"const p = 'vl' + 'ess';\nw.on('connection', s => s.once('message', m => {\n  const id = m.slice(1, 17);\n"+
		"  const n = m.readUInt8(17);\n  const r = net.createConnection({ host: h, port: m.readUInt16BE(o) });\n}));\n")
	if got := run(kit); !strings.HasSuffix(got, "index.js") {
		t.Errorf("node-ws kit not detected, got %q", got)
	}

	py := t.TempDir() // FastAPI relay
	write(py, "relay_vless.py", "from fastapi import WebSocket\nimport asyncio\nasync def relay(ws: WebSocket):\n"+
		"    data = await ws.receive_bytes()\n    uid = data[1:17]\n    r, w = await asyncio.open_connection(host, port)\n")
	if got := run(py); !strings.HasSuffix(got, "relay_vless.py") {
		t.Errorf("python relay not detected, got %q", got)
	}

	legit := t.TempDir()
	write(legit, "chat.js", "const { WebSocketServer } = require('ws');\nconst net = require('net');\n"+
		"wss.on('connection', s => s.send(name.slice(1, 5)));\nconst db = net.createConnection(5432);\n")
	write(legit, "util.py", "def short(s):\n    return s[1:17]\n") // slice but no dial, no websocket
	write(legit, "proxy.js", "const http = require('http');\nconst c = net.connect(80, host); // plain HTTP proxy, no UUID handshake\n")
	if err := os.MkdirAll(filepath.Join(legit, "node_modules", "lib"), 0o755); err != nil {
		t.Fatal(err)
	}
	write(filepath.Join(legit, "node_modules", "lib"), "vless.js", "WebSocket; x.slice(1, 17); net.createConnection()") // deps are skipped
	if got := run(legit); got != "" {
		t.Errorf("legit app flagged: %q", got)
	}
}
