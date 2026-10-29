"use client";

// Logs tab — one console, two sources: Deploy logs (build/deploy output from
// the DB, polled) and Live container logs (stdout/stderr over WebSocket).
// The interactive shell (Terminal) also lives here since it's log-adjacent.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ScrollText, Terminal, TerminalSquare } from "lucide-react";
import { TerminalModal } from "@/components/terminal-modal";
import { useProject } from "@/components/project/project-context";
import { API, headers, type DeployLog, type LiveLog } from "@/components/project/project-shared";
import { DeployLogConsole } from "@/components/project/deploy-log-console";

type Mode = "deploy" | "live";

export default function ProjectLogsPage() {
  const { project: p } = useProject();
  // A crashed or sleeping project still has its (stopped) container, and
  // `docker logs` on it shows the output from right before it stopped.
  const hasContainer = !!p.container_id && (p.status === "running" || p.status === "crashed");
  const [mode, setMode] = useState<Mode>("deploy");
  const [terminalOpen, setTerminalOpen] = useState(false);

  // ── Deploy logs (polled) ──
  const [logs, setLogs] = useState<DeployLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);

  // Enough history to show several whole deploys (each is ~30–60 lines).
  const loadLogs = useCallback(async () => {
    const res = await fetch(`${API}/api/v1/projects/${p.id}/logs?limit=1500`, { headers: headers() });
    if (res.ok) setLogs(await res.json());
    setLoadingLogs(false);
  }, [p.id]);

  // Deferred so the mount effect doesn't synchronously trigger a setState.
  useEffect(() => {
    const t = setTimeout(() => loadLogs(), 0);
    return () => clearTimeout(t);
  }, [loadLogs]);

  // Base poll (5s)…
  useEffect(() => {
    const t = setInterval(loadLogs, 5000);
    return () => clearInterval(t);
  }, [loadLogs]);
  // …and faster (2s) while a build is streaming.
  useEffect(() => {
    if (p.status !== "building") return;
    const t = setInterval(loadLogs, 2000);
    return () => clearInterval(t);
  }, [p.status, loadLogs]);

  // ── Live container logs (WebSocket) ──
  const [liveLogs, setLiveLogs] = useState<LiveLog[]>([]);
  const [liveOn, setLiveOn] = useState(false);
  // "ended" = the stream closed after connecting; "failed" = it never connected.
  const [liveEnded, setLiveEnded] = useState<"" | "ended" | "failed">("");
  const [liveAutoscroll, setLiveAutoscroll] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const liveScrollRef = useRef<HTMLDivElement | null>(null);

  const startLive = useCallback(() => {
    if (wsRef.current) return;
    const token = localStorage.getItem("sm_token");
    if (!token) return;
    const base = (API || "").replace(/^http/, "ws");
    const ws = new WebSocket(`${base}/api/v1/ws/projects/${p.id}/logs?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;
    setLiveLogs([]);
    setLiveOn(true);
    setLiveEnded("");
    let connected = false;
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "status") connected = true;
        if (msg.line !== undefined) {
          connected = true;
          setLiveLogs((prev) => {
            const next = prev.length >= 500 ? prev.slice(-499) : prev;
            return [...next, { t: msg.t, line: msg.line }];
          });
        }
      } catch {}
    };
    // docker logs -f returns once a stopped container's output is printed.
    ws.onclose = () => { setLiveOn(false); setLiveEnded(connected ? "ended" : "failed"); wsRef.current = null; };
    ws.onerror = () => { setLiveOn(false); };
  }, [p.id]);

  const stopLive = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setLiveOn(false);
  }, []);

  // Switching into the live tab starts the stream; leaving (or unmounting) stops
  // it. Deferred — startLive sets state synchronously, which a mount/update
  // effect must not do directly.
  useEffect(() => {
    const t = setTimeout(() => {
      if (mode === "live" && hasContainer) startLive();
      if (mode !== "live") stopLive();
    }, 0);
    return () => clearTimeout(t);
  }, [mode, hasContainer, startLive, stopLive]);
  useEffect(() => () => { wsRef.current?.close(); }, []);

  useEffect(() => {
    if (!liveAutoscroll) return;
    const el = liveScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [liveLogs, liveAutoscroll]);

  const running = p.status === "running";

  return (
    <div className="space-y-3">
      {terminalOpen && (
        <TerminalModal projectId={p.id} projectName={p.name} onClose={() => setTerminalOpen(false)} />
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center rounded-lg border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-0.5">
          {(["deploy", "live"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex items-center gap-1.5 h-7 px-3 rounded-md text-xs transition-colors ${
                mode === m ? "bg-accent text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "deploy" ? <ScrollText className="h-3 w-3" /> : <Terminal className="h-3 w-3" />}
              {m === "deploy" ? "Deploy logs" : "Live container logs"}
              {m === "live" && liveOn && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />}
            </button>
          ))}
        </div>
        {running && (
          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={() => setTerminalOpen(true)}>
            <TerminalSquare className="h-3.5 w-3.5" /> Open Terminal
          </Button>
        )}
      </div>

      {/* Deploy history */}
      {mode === "deploy" && <DeployLogConsole logs={logs} status={p.status} loading={loadingLogs} />}

      {/* Live container logs console */}
      {mode === "live" && (
        <div className="rounded-xl border border-white/[0.08] bg-[#0d1117] overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-white/[0.08] bg-[#161b22] text-[10px] text-muted-foreground font-mono">
            <div className="flex items-center gap-2 min-w-0">
              <Terminal className="h-3 w-3 shrink-0 text-[#58a6ff]" /> <span className="shrink-0 text-[#c9d1d9]">Live Container Logs</span>
              {liveOn && <span className="flex items-center gap-1 text-[#3fb950] shrink-0"><span className="h-1.5 w-1.5 rounded-full bg-[#3fb950] animate-pulse" /> streaming</span>}
              <span className="text-[#6e7681] shrink-0">• {liveLogs.length} lines</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {liveOn ? (
                <Button variant="ghost" size="sm" className="h-5 px-2 text-[10px] text-muted-foreground hover:text-[#c9d1d9]" onClick={stopLive} title="Stop streaming (keeps buffer)">Pause</Button>
              ) : (
                <Button variant="ghost" size="sm" className="h-5 px-2 text-[10px] text-muted-foreground hover:text-[#c9d1d9]" onClick={startLive} disabled={!hasContainer} title="Resume streaming">Resume</Button>
              )}
              <Button variant="ghost" size="sm" className="h-5 px-2 text-[10px] text-muted-foreground hover:text-[#c9d1d9]" onClick={() => setLiveLogs([])} title="Clear buffer">Clear</Button>
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground select-none cursor-pointer" title="Auto-scroll to bottom on new output">
                <input type="checkbox" checked={liveAutoscroll} onChange={(e) => setLiveAutoscroll(e.target.checked)} className="accent-emerald-500 h-3 w-3" />
                auto
              </label>
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-muted-foreground hover:text-[#c9d1d9]" onClick={() => {
                const el = liveScrollRef.current;
                if (el) el.scrollTop = el.scrollHeight;
              }} title="Jump to bottom">
                <ChevronDown className="h-3 w-3" />
              </Button>
            </div>
          </div>
          {hasContainer ? (
            <div
              ref={liveScrollRef}
              className="p-2 font-mono text-[11px] space-y-0.5 h-[58vh] overflow-y-auto"
              onScroll={(e) => {
                const el = e.currentTarget;
                const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
                if (liveAutoscroll !== atBottom) setLiveAutoscroll(atBottom);
              }}
            >
              {liveLogs.map((l, i) => (
                <div key={i} className="flex gap-3 px-2 py-0.5 text-[#e6edf3] hover:bg-white/[0.03] rounded">
                  <span className="text-[#58a6ff] select-none shrink-0 tabular-nums">{l.t ? new Date(l.t).toLocaleTimeString() : ""}</span>
                  <span className="whitespace-pre-wrap break-words min-w-0">{l.line}</span>
                </div>
              ))}
              {liveEnded === "ended" && !liveOn && liveLogs.length > 0 && (
                <div className="px-2 py-1.5 text-[#d29922] italic">
                  {running
                    ? "Stream ended. If the app is asleep, the lines above are its most recent output — it wakes on the next visit. Click Resume to reconnect."
                    : "The container is stopped. The lines above are its output from right before it stopped."}
                </div>
              )}
              {liveLogs.length === 0 && liveOn && (
                <div className="px-2 py-1 text-muted-foreground italic">Waiting for output…</div>
              )}
              {liveLogs.length === 0 && !liveOn && (
                <div className="px-2 py-1 text-muted-foreground italic">
                  {liveEnded === "failed" ? "Couldn't open the log stream. Click Resume to try again."
                    : liveEnded === "ended" ? "This container hasn't written any output."
                    : "Stream paused. Click Resume to start again."}
                </div>
              )}
            </div>
          ) : (
            <div className="p-8 text-center text-[11px] text-muted-foreground font-mono italic">
              No container yet — deploy the project to see its output here.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
