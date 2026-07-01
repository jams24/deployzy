package inspector

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/rs/zerolog"
)

// CapturedRequest mirrors the server-side captured request for local display.
type CapturedRequest struct {
	ID              string            `json:"id"`
	TunnelURL       string            `json:"tunnel_url"`
	Timestamp       time.Time         `json:"timestamp"`
	Duration        int64             `json:"duration_ms"`
	Method          string            `json:"method"`
	Path            string            `json:"path"`
	Query           string            `json:"query,omitempty"`
	StatusCode      int               `json:"status_code"`
	RequestHeaders  map[string]string `json:"request_headers"`
	ResponseHeaders map[string]string `json:"response_headers,omitempty"`
	RequestSize     int64             `json:"request_size"`
	ResponseSize    int64             `json:"response_size"`
	RemoteAddr      string            `json:"remote_addr"`
}

// Inspector runs a local web UI for inspecting tunnel traffic.
type Inspector struct {
	addr     string
	log      zerolog.Logger
	mu       sync.RWMutex
	requests []*CapturedRequest
	maxReqs  int
}

// New creates a new inspector.
func New(addr string, log zerolog.Logger) *Inspector {
	return &Inspector{
		addr:    addr,
		log:     log.With().Str("component", "inspector").Logger(),
		maxReqs: 500,
	}
}

// AddRequest records a proxied request in the inspector.
func (ins *Inspector) AddRequest(req *CapturedRequest) {
	ins.mu.Lock()
	defer ins.mu.Unlock()

	ins.requests = append([]*CapturedRequest{req}, ins.requests...)
	if len(ins.requests) > ins.maxReqs {
		ins.requests = ins.requests[:ins.maxReqs]
	}
}

// Start runs the inspector HTTP server.
func (ins *Inspector) Start() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/requests/clear", ins.handleAPIClear)
	mux.HandleFunc("/api/requests", ins.handleAPIRequests)
	mux.HandleFunc("/", ins.handleUI)

	ins.log.Info().Str("addr", ins.addr).Msg("inspector UI available")

	server := &http.Server{
		Addr:    ins.addr,
		Handler: mux,
	}

	return server.ListenAndServe()
}

func (ins *Inspector) handleAPIRequests(w http.ResponseWriter, r *http.Request) {
	ins.mu.RLock()
	reqs := ins.requests
	ins.mu.RUnlock()

	if reqs == nil {
		reqs = []*CapturedRequest{}
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	json.NewEncoder(w).Encode(reqs)
}

func (ins *Inspector) handleAPIClear(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ins.mu.Lock()
	ins.requests = nil
	ins.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	fmt.Fprint(w, `{"status":"cleared"}`)
}

func (ins *Inspector) handleUI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, inspectorHTML)
}

const inspectorHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Deployzy Inspector</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; background: #0d1117; color: #c9d1d9; }
  .header { background: #161b22; border-bottom: 1px solid #30363d; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; }
  .header h1 { font-size: 18px; color: #58a6ff; }
  .header .stats { font-size: 13px; color: #8b949e; }
  .header button { background: #21262d; color: #c9d1d9; border: 1px solid #30363d; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
  .header button:hover { background: #30363d; }
  .container { display: flex; height: calc(100vh - 57px); }
  .list { width: 45%; border-right: 1px solid #30363d; overflow-y: auto; }
  .detail { width: 55%; overflow-y: auto; padding: 16px; }
  .req-item { padding: 10px 16px; border-bottom: 1px solid #21262d; cursor: pointer; font-size: 13px; }
  .req-item:hover, .req-item.active { background: #161b22; }
  .req-item .method { font-weight: 700; margin-right: 8px; }
  .req-item .path { color: #c9d1d9; }
  .req-item .meta { color: #8b949e; font-size: 11px; margin-top: 4px; }
  .status-2 { color: #3fb950; } .status-3 { color: #d29922; } .status-4 { color: #f85149; } .status-5 { color: #f85149; }
  .method-GET { color: #58a6ff; } .method-POST { color: #3fb950; } .method-PUT { color: #d29922; } .method-DELETE { color: #f85149; }
  .detail h3 { color: #58a6ff; margin: 16px 0 8px; font-size: 14px; }
  .detail pre { background: #161b22; padding: 12px; border-radius: 6px; font-size: 12px; overflow-x: auto; border: 1px solid #30363d; }
  .detail table { width: 100%; font-size: 12px; border-collapse: collapse; }
  .detail td { padding: 4px 8px; border-bottom: 1px solid #21262d; }
  .detail td:first-child { color: #8b949e; width: 35%; }
  .empty { text-align: center; padding: 60px; color: #8b949e; }
  .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; }
</style>
</head>
<body>
<div class="header">
  <h1>Deployzy Inspector</h1>
  <div>
    <span class="stats" id="stats">0 requests</span>
    <button onclick="clearRequests()">Clear</button>
    <button onclick="fetchRequests()">Refresh</button>
  </div>
</div>
<div class="container">
  <div class="list" id="list"><div class="empty">Waiting for requests...</div></div>
  <div class="detail" id="detail"><div class="empty">Select a request to inspect</div></div>
</div>
<script>
let requests = [];
let selected = null;

async function fetchRequests() {
  const res = await fetch('/api/requests');
  requests = await res.json();
  renderList();
  document.getElementById('stats').textContent = requests.length + ' requests';
}

async function clearRequests() {
  await fetch('/api/requests/clear', { method: 'POST' });
  requests = []; selected = null;
  renderList();
  document.getElementById('detail').innerHTML = '<div class="empty">Select a request to inspect</div>';
  document.getElementById('stats').textContent = '0 requests';
}

function renderList() {
  const list = document.getElementById('list');
  if (!requests.length) { list.innerHTML = '<div class="empty">Waiting for requests...</div>'; return; }
  list.innerHTML = requests.map((r, i) => {
    const sc = Math.floor(r.status_code / 100);
    return '<div class="req-item' + (selected === i ? ' active' : '') + '" onclick="selectReq(' + i + ')">' +
      '<span class="method method-' + r.method + '">' + r.method + '</span>' +
      '<span class="badge status-' + sc + '">' + r.status_code + '</span> ' +
      '<span class="path">' + r.path + (r.query ? '?' + r.query : '') + '</span>' +
      '<div class="meta">' + new Date(r.timestamp).toLocaleTimeString() + ' | ' + r.duration_ms + 'ms | ' + r.remote_addr + '</div></div>';
  }).join('');
}

function selectReq(i) {
  selected = i;
  const r = requests[i];
  renderList();
  let html = '<h3>Request</h3><pre>' + r.method + ' ' + r.path + (r.query ? '?' + r.query : '') + '</pre>';
  html += '<h3>Request Headers</h3><table>';
  for (const [k, v] of Object.entries(r.request_headers || {})) html += '<tr><td>' + k + '</td><td>' + v + '</td></tr>';
  html += '</table>';
  if (r.response_headers) {
    html += '<h3>Response Headers</h3><table>';
    for (const [k, v] of Object.entries(r.response_headers)) html += '<tr><td>' + k + '</td><td>' + v + '</td></tr>';
    html += '</table>';
  }
  html += '<h3>Info</h3><table>';
  html += '<tr><td>Status</td><td>' + r.status_code + '</td></tr>';
  html += '<tr><td>Duration</td><td>' + r.duration_ms + 'ms</td></tr>';
  html += '<tr><td>Request Size</td><td>' + r.request_size + ' bytes</td></tr>';
  html += '<tr><td>Response Size</td><td>' + r.response_size + ' bytes</td></tr>';
  html += '<tr><td>Tunnel</td><td>' + r.tunnel_url + '</td></tr>';
  html += '</table>';
  document.getElementById('detail').innerHTML = html;
}

fetchRequests();
setInterval(fetchRequests, 2000);
</script>
</body>
</html>`
