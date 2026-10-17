"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Search, Trash2, Pause, Play, Copy, Check, Radio, Waypoints, ArrowRight, Clock, X } from "lucide-react";
import { api, type CapturedRequest, type Tunnel } from "@/lib/api";
import { DashMotion } from "@/components/admin/dash-kit";
import { fmtBytes, timeAgo } from "@/components/admin/pager";

// ─────────────────────────────────────────────────────────────────────────────
// Traffic Inspector — live HTTP requests through the user's tunnels. History
// comes from GET …/requests, new requests stream over an authenticated
// WebSocket (auto-reconnects). Sensitive headers are masked until revealed.
// ─────────────────────────────────────────────────────────────────────────────

const METHOD_COLOR: Record<string, string> = {
  GET: "text-sky-600 dark:text-sky-400", POST: "text-emerald-600 dark:text-emerald-400",
  PUT: "text-amber-600 dark:text-amber-400", PATCH: "text-amber-600 dark:text-amber-400",
  DELETE: "text-red-600 dark:text-red-400", OPTIONS: "text-muted-foreground", HEAD: "text-muted-foreground",
};
const SENSITIVE = /^(authorization|cookie|set-cookie|x-api-key|proxy-authorization|x-auth-token)$/i;

function statusTone(code: number) {
  if (code >= 500) return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30";
  if (code >= 400) return "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30";
  if (code >= 300) return "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30";
  return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
}

function decodeBody(b64?: string): { text: string; json: boolean } | null {
  if (!b64) return null;
  try {
    const bin = atob(b64);
    const text = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    try { return { text: JSON.stringify(JSON.parse(text), null, 2), json: true }; } catch { return { text, json: false }; }
  } catch { return null; }
}

function toCurl(r: CapturedRequest, host: string) {
  const parts = [`curl -X ${r.method} '${host}${r.path}${r.query ? `?${r.query}` : ""}'`];
  for (const [k, v] of Object.entries(r.request_headers || {})) {
    if (/^(host|content-length|connection|accept-encoding)$/i.test(k)) continue;
    parts.push(`-H '${k}: ${String(v).replace(/'/g, "'\\''")}'`);
  }
  const body = decodeBody(r.request_body);
  if (body) parts.push(`--data-raw '${body.text.replace(/'/g, "'\\''")}'`);
  return parts.join(" \\\n  ");
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); })}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 px-2 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
      {done ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}{label}
    </button>
  );
}

function Headers({ h, reveal }: { h: Record<string, string>; reveal: boolean }) {
  const entries = Object.entries(h || {}).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return <p className="text-xs text-muted-foreground">None</p>;
  return (
    <div className="divide-y divide-border/40 rounded-lg border border-border/50">
      {entries.map(([k, v]) => {
        const hidden = !reveal && SENSITIVE.test(k);
        return (
          <div key={k} className="grid grid-cols-[minmax(0,10rem)_1fr] gap-3 px-3 py-1.5 font-mono text-[11.5px]">
            <span className="truncate text-muted-foreground" title={k}>{k}</span>
            <span className={`break-all ${hidden ? "select-none text-muted-foreground/60" : ""}`}>{hidden ? "•••••••• (hidden)" : v}</span>
          </div>
        );
      })}
    </div>
  );
}

function Body({ b64, size }: { b64?: string; size: number }) {
  const body = decodeBody(b64);
  if (!body) return <p className="text-xs text-muted-foreground">{size > 0 ? `${fmtBytes(size)} (not captured)` : "Empty"}</p>;
  return (
    <div className="relative">
      <pre className="max-h-80 overflow-auto rounded-lg border border-border/50 bg-muted/30 p-3 font-mono text-[11.5px] leading-relaxed">{body.text}</pre>
      {size > 10 * 1024 && <p className="mt-1 text-[10px] text-muted-foreground">Showing the first 10 KB of {fmtBytes(size)}.</p>}
    </div>
  );
}

function Detail({ r, host, onClose }: { r: CapturedRequest; host: string; onClose: () => void }) {
  const [tab, setTab] = useState<"request" | "response">("request");
  const [reveal, setReveal] = useState(false);
  const params = r.query ? [...new URLSearchParams(r.query).entries()] : [];
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 break-all font-mono text-sm">
            <span className={`font-semibold ${METHOD_COLOR[r.method] || ""}`}>{r.method}</span> {r.path}{r.query ? <span className="text-muted-foreground">?{r.query}</span> : null}
          </p>
          <button onClick={onClose} className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className={`rounded border px-1.5 py-0.5 font-mono font-medium ${statusTone(r.status_code)}`}>{r.status_code}</span>
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{r.duration_ms} ms</span>
          <span>↑ {fmtBytes(r.request_size)} · ↓ {fmtBytes(r.response_size)}</span>
          <span>{new Date(r.timestamp).toLocaleTimeString()}</span>
          {r.remote_addr && <span className="font-mono">{r.remote_addr}</span>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <CopyBtn text={toCurl(r, host)} label="Copy as cURL" />
          <button onClick={() => setReveal((v) => !v)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 px-2 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
            {reveal ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}{reveal ? "Hide secrets" : "Show secrets"}
          </button>
        </div>
      </div>
      <div className="flex gap-1 border-b border-border/60 px-4">
        {(["request", "response"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-2 py-2 text-xs font-medium capitalize transition-colors ${tab === t ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{t}</button>
        ))}
      </div>
      <div className="flex-1 space-y-4 overflow-auto p-4">
        {tab === "request" ? (
          <>
            {params.length > 0 && (
              <section><p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Query</p>
                <Headers h={Object.fromEntries(params)} reveal /></section>
            )}
            <section><p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Headers</p><Headers h={r.request_headers} reveal={reveal} /></section>
            <section><p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Body</p><Body b64={r.request_body} size={r.request_size} /></section>
          </>
        ) : (
          <>
            <section><p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Headers</p><Headers h={r.response_headers} reveal={reveal} /></section>
            <section><p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Body</p><Body b64={r.response_body} size={r.response_size} /></section>
          </>
        )}
      </div>
    </div>
  );
}

const STATUS_FILTERS = [
  { k: "all", label: "All" }, { k: "2", label: "2xx" }, { k: "3", label: "3xx" }, { k: "4", label: "4xx" }, { k: "5", label: "5xx" },
] as const;

export default function InspectorPage() {
  const [tunnels, setTunnels] = useState<Tunnel[] | null>(null);
  const [sel, setSel] = useState("");
  const [reqs, setReqs] = useState<CapturedRequest[]>([]);
  const [selected, setSelected] = useState<CapturedRequest | null>(null);
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]["k"]>("all");
  const [paused, setPaused] = useState(false);
  const [live, setLive] = useState<"connecting" | "live" | "down">("connecting");
  const pausedRef = useRef(false);
  const queued = useRef<CapturedRequest[]>([]);
  pausedRef.current = paused;

  // Tunnel list (refreshes every 10s); auto-select the only/first tunnel.
  const loadTunnels = useCallback(async () => {
    try {
      const all = (await api.listTunnels()).filter((t) => t.type !== "project" && t.protocol !== "tcp");
      setTunnels(all);
      setSel((cur) => (cur && all.some((t) => t.url === cur) ? cur : cur || all[0]?.url || ""));
    } catch { setTunnels((t) => t ?? []); }
  }, []);
  useEffect(() => {
    const first = setTimeout(loadTunnels, 0);
    const t = setInterval(loadTunnels, 10000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [loadTunnels]);

  // History + live stream for the selected tunnel; reconnect with backoff.
  useEffect(() => {
    if (!sel) return;
    let ws: WebSocket | null = null, closed = false, retry = 0, timer: ReturnType<typeof setTimeout> | undefined;
    api.listRequests(sel).then((r) => setReqs([...r].reverse())).catch(() => setReqs([]));
    const connect = () => {
      setLive("connecting");
      ws = new WebSocket(api.trafficSocketURL(sel));
      ws.onopen = () => { retry = 0; setLive("live"); };
      ws.onmessage = (e) => {
        try {
          const r: CapturedRequest = JSON.parse(e.data);
          if (pausedRef.current) { queued.current.unshift(r); return; }
          setReqs((prev) => [r, ...prev].slice(0, 500));
        } catch { /* ignore malformed frame */ }
      };
      ws.onclose = () => {
        if (closed) return;
        setLive("down");
        timer = setTimeout(connect, Math.min(15000, 1000 * 2 ** retry++));
      };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); ws?.close(); setSelected(null); setReqs([]); };
  }, [sel]);

  const resume = () => {
    setPaused(false);
    if (queued.current.length) { const q = queued.current; queued.current = []; setReqs((prev) => [...q, ...prev].slice(0, 500)); }
  };

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return reqs.filter((r) =>
      (status === "all" || String(r.status_code).startsWith(status)) &&
      (!f || r.path.toLowerCase().includes(f) || r.method.toLowerCase() === f || (r.query || "").toLowerCase().includes(f)));
  }, [reqs, filter, status]);

  const tunnel = tunnels?.find((t) => t.url === sel);
  const errorCount = reqs.filter((r) => r.status_code >= 400).length;

  return (
    <div className="animate-fade-in-up space-y-5">
      <DashMotion />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Network</p>
          <h1 className="mt-1 text-[22px] font-bold tracking-[-0.02em] sm:text-[26px]">Traffic Inspector</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every HTTP request through your tunnels, live: headers, bodies, status and timing.</p>
        </div>
        {sel && (
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
            live === "live" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : live === "connecting" ? "border-border bg-muted/40 text-muted-foreground" : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"}`}>
            <Radio className={`h-3 w-3 ${live === "live" && !paused ? "animate-pulse" : ""}`} />
            {paused ? "Paused" : live === "live" ? "Live" : live === "connecting" ? "Connecting…" : "Reconnecting…"}
          </span>
        )}
      </div>

      {tunnels === null ? (
        <div className="h-[420px] animate-pulse rounded-2xl bg-muted/50" />
      ) : tunnels.length === 0 ? (
        <div className="ov-rise flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-14 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/70 bg-card"><Waypoints className="h-5 w-5 text-sky-600 dark:text-sky-400" /></div>
          <h3 className="mt-4 font-semibold">No HTTP tunnels running</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">Start one and its requests stream in here. Inspection is on by default.</p>
          <div className="mt-5 flex items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-2.5">
            <code className="font-mono text-[13px]"><span className="text-emerald-500">$</span> deployzy http 3000</code>
            <CopyBtn text="deployzy http 3000" label="Copy" />
          </div>
        </div>
      ) : (
        <>
          {/* Tunnel picker */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {tunnels.map((t) => (
              <button key={t.url} onClick={() => setSel(t.url)}
                className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition-all ${
                  sel === t.url ? "border-foreground/30 bg-card shadow-sm" : "border-border/60 hover:border-foreground/20"}`}>
                <span className={`h-2 w-2 rounded-full ${t.inspect ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                <span className="min-w-0">
                  <span className="block max-w-[16rem] truncate font-mono text-xs">{t.url.replace(/^https?:\/\//, "")}</span>
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">{t.local_addr || "local"} <ArrowRight className="h-2.5 w-2.5" /> {t.inspect ? "inspecting" : "inspection off"}</span>
                </span>
              </button>
            ))}
          </div>

          {tunnel && tunnel.inspect === false && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
              This tunnel was started with inspection off, so its requests aren&apos;t captured. Restart it without <code className="font-mono">--inspect=false</code> to see traffic here.
            </div>
          )}

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[12rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by path, query or method (GET, POST…)"
                className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-foreground/30 focus:ring-4 focus:ring-emerald-500/10" />
            </div>
            <div className="flex rounded-lg border border-border/60 p-0.5">
              {STATUS_FILTERS.map((f) => (
                <button key={f.k} onClick={() => setStatus(f.k)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${status === f.k ? "bg-accent text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{f.label}</button>
              ))}
            </div>
            <button onClick={() => (paused ? resume() : setPaused(true))}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-xs font-medium hover:bg-accent">
              {paused ? <><Play className="h-3.5 w-3.5" /> Resume{queued.current.length ? ` (${queued.current.length})` : ""}</> : <><Pause className="h-3.5 w-3.5" /> Pause</>}
            </button>
            <button onClick={async () => { if (!sel) return; try { await api.clearRequests(sel); } catch { /* keep UI responsive */ } setReqs([]); setSelected(null); }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </button>
          </div>

          {/* List + detail */}
          <div className="grid overflow-hidden rounded-2xl border border-border/60 bg-card lg:h-[620px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <div className="flex min-h-0 flex-col border-border/60 lg:border-r">
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
                <span><span className="font-medium tabular-nums text-foreground">{shown.length}</span> of {reqs.length} requests</span>
                {errorCount > 0 && <button onClick={() => setStatus("4")} className="text-amber-700 hover:underline dark:text-amber-400">{errorCount} errors</button>}
              </div>
              {shown.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
                  <span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60 motion-reduce:hidden" /><span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" /></span>
                  <p className="text-sm font-medium">{reqs.length ? "No requests match these filters" : "Waiting for requests…"}</p>
                  {!reqs.length && tunnel && <p className="text-xs text-muted-foreground">Open <a href={tunnel.url} target="_blank" rel="noopener" className="font-mono underline">{tunnel.url.replace(/^https?:\/\//, "")}</a> to see the first one.</p>}
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-auto">
                  {shown.map((r) => (
                    <button key={r.id} onClick={() => setSelected(r)}
                      className={`ov-rise flex w-full items-center gap-3 border-b border-border/40 px-4 py-2 text-left transition-colors ${selected?.id === r.id ? "bg-accent" : "hover:bg-muted/40"}`}>
                      <span className={`w-14 shrink-0 font-mono text-[11px] font-semibold ${METHOD_COLOR[r.method] || ""}`}>{r.method}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">{r.path}{r.query ? <span className="text-muted-foreground">?{r.query}</span> : null}</span>
                      <span className={`shrink-0 rounded border px-1.5 font-mono text-[10px] font-medium ${statusTone(r.status_code)}`}>{r.status_code}</span>
                      <span className="hidden w-14 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground sm:inline">{r.duration_ms} ms</span>
                      <span className="hidden w-14 shrink-0 text-right text-[10px] text-muted-foreground md:inline">{timeAgo(r.timestamp)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className={`min-h-0 ${selected ? "fixed inset-0 z-50 bg-background lg:static lg:z-auto" : "hidden lg:block"}`}>
              {selected ? <Detail r={selected} host={tunnel?.url || ""} onClose={() => setSelected(null)} /> : (
                <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
                  <span className="flex flex-col items-center gap-2"><Eye className="h-5 w-5" />Select a request to see its headers, body and timing.</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
