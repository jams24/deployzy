"use client";

// Logs tab — one console, two sources: Deploy logs (build/deploy output from
// the DB, polled) and Live container logs (stdout/stderr over WebSocket).
// The interactive shell (Terminal) also lives here since it's log-adjacent.

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Pause, Play, ScrollText, Terminal, TerminalSquare } from "lucide-react";
import { TerminalModal } from "@/components/terminal-modal";
import { useProject } from "@/components/project/project-context";
import { API, headers, type DeployLog, type LiveLog } from "@/components/project/project-shared";
import { ConsoleDots, ConsoleToggle, DeployLogConsole } from "@/components/project/deploy-log-console";
import { Segmented } from "@/components/project/charts";

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
    <div className="space-y-4">
      {terminalOpen && (
        <TerminalModal projectId={p.id} projectName={p.name} onClose={() => setTerminalOpen(false)} />
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Log source"
          value={mode}
          onChange={setMode}
          className="w-full sm:w-auto"
          options={[
            { id: "deploy", label: <><ScrollText className="h-3.5 w-3.5" /> Deploys</> },
            { id: "live", label: <><Terminal className="h-3.5 w-3.5" /> Live output{liveOn && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />}</> },
          ]}
        />
        {running && (
          <button type="button" onClick={() => setTerminalOpen(true)} className="pill pill-line pill-sm w-full sm:w-auto">
            <TerminalSquare className="h-4 w-4" /> Open terminal
          </button>
        )}
      </div>

      {/* Deploy history */}
      {mode === "deploy" && <DeployLogConsole logs={logs} status={p.status} loading={loadingLogs} />}

      {/* Live container output */}
      {mode === "live" && (
        <section className="dark overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#0b0c10] text-white">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/[0.07] px-4 py-3 sm:px-5">
            <p className="flex items-center gap-2.5 text-[14px] font-medium">
              <ConsoleDots />
              Live output
              {liveOn ? (
                <span className="flex items-center gap-1.5 text-[13px] font-normal text-brand"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" /> Streaming</span>
              ) : (
                <span className="text-[13px] font-normal text-white/45">{liveLogs.length} lines</span>
              )}
            </p>
            <span className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
              {liveOn ? (
                <button type="button" onClick={stopLive} title="Stop streaming (keeps what's shown)" className="inline-flex h-7 items-center gap-1.5 rounded-full border border-white/10 px-2.5 text-[12.5px] font-medium text-white/70 transition-colors hover:border-white/20 hover:text-white">
                  <Pause className="h-3 w-3" /> Pause
                </button>
              ) : (
                <button type="button" onClick={startLive} disabled={!hasContainer} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-white/10 px-2.5 text-[12.5px] font-medium text-white/70 transition-colors hover:border-white/20 hover:text-white disabled:opacity-40">
                  <Play className="h-3 w-3" /> Resume
                </button>
              )}
              <ConsoleToggle on={liveAutoscroll} onClick={() => setLiveAutoscroll((v) => !v)}>Follow</ConsoleToggle>
              <button type="button" onClick={() => setLiveLogs([])} className="inline-flex h-7 items-center rounded-full px-2.5 text-[12.5px] font-medium text-white/55 transition-colors hover:text-white">
                Clear
              </button>
              <button
                type="button"
                aria-label="Jump to latest"
                title="Jump to latest"
                onClick={() => { const el = liveScrollRef.current; if (el) el.scrollTop = el.scrollHeight; setLiveAutoscroll(true); }}
                className="ml-auto flex h-7 w-7 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white sm:ml-0"
              >
                <ArrowDownToLine className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
          {hasContainer ? (
            <div
              ref={liveScrollRef}
              className="h-[62vh] overflow-y-auto px-3 py-3 font-mono text-[12.5px] leading-relaxed sm:px-4"
              onScroll={(e) => {
                const el = e.currentTarget;
                const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
                if (liveAutoscroll !== atBottom) setLiveAutoscroll(atBottom);
              }}
            >
              {liveLogs.map((l, i) => (
                <div key={i} className="flex gap-3 rounded px-1 py-px hover:bg-white/[0.03]">
                  <span className="hidden shrink-0 select-none tabular-nums text-white/25 sm:inline">{l.t ? new Date(l.t).toLocaleTimeString() : ""}</span>
                  <span className="min-w-0 whitespace-pre-wrap text-white/85 [overflow-wrap:anywhere]">{l.line}</span>
                </div>
              ))}
              {liveEnded === "ended" && !liveOn && liveLogs.length > 0 && (
                <p className="mt-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 font-sans text-[13px] text-amber-200/90">
                  {running
                    ? "Stream ended. If the app is asleep, the lines above are its latest output; it wakes on the next visit. Resume to reconnect."
                    : "The container is stopped. The lines above are its output from right before it stopped."}
                </p>
              )}
              {liveLogs.length === 0 && liveOn && (
                <p className="flex items-center gap-2 px-1 text-white/45"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" /> Waiting for output…</p>
              )}
              {liveLogs.length === 0 && !liveOn && (
                <p className="px-1 text-white/45">
                  {liveEnded === "failed" ? "Couldn't open the log stream. Resume to try again."
                    : liveEnded === "ended" ? "This container hasn't written any output."
                    : "Paused. Resume to start streaming again."}
                </p>
              )}
            </div>
          ) : (
            <div className="flex h-[40vh] flex-col items-center justify-center gap-2 px-6 text-center">
              <Terminal className="h-5 w-5 text-white/35" />
              <p className="text-[14px] font-medium">No container yet</p>
              <p className="max-w-xs text-[13px] text-white/50">Deploy the project and its output streams here.</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
