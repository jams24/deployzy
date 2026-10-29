"use client";

// Deploy history console: each deploy is its own collapsible card with its
// outcome, commit, duration and output; runtime events (sleep, wake, crash,
// auto-restart, stop) sit between them on the timeline.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Check, ChevronRight, Copy, GitCommit, Loader2, Moon, Power,
  RotateCcw, Sun, XCircle, Zap,
} from "lucide-react";
import type { DeployLog } from "./project-shared";
import {
  fmtDuration, fmtWhen, groupDeployLogs,
  type DeployGroup, type EventItem, type EventTone,
} from "./deploy-log-groups";

const OUTCOME: Record<DeployGroup["outcome"], { label: string; cls: string; icon: React.ReactNode }> = {
  succeeded: { label: "Succeeded", cls: "text-[#3fb950] border-[#3fb950]/30 bg-[#3fb950]/10", icon: <Check className="h-3 w-3" /> },
  failed: { label: "Failed", cls: "text-[#f85149] border-[#f85149]/30 bg-[#f85149]/10", icon: <XCircle className="h-3 w-3" /> },
  building: { label: "Building", cls: "text-[#d29922] border-[#d29922]/30 bg-[#d29922]/10", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  interrupted: { label: "Interrupted", cls: "text-[#8b949e] border-white/10 bg-white/[0.04]", icon: <AlertTriangle className="h-3 w-3" /> },
};

const EVENT: Record<EventTone, { cls: string; icon: React.ReactNode }> = {
  sleep: { cls: "text-[#8b949e]", icon: <Moon className="h-3 w-3" /> },
  wake: { cls: "text-[#58a6ff]", icon: <Sun className="h-3 w-3" /> },
  crash: { cls: "text-[#f85149]", icon: <Zap className="h-3 w-3" /> },
  restart: { cls: "text-[#d29922]", icon: <RotateCcw className="h-3 w-3" /> },
  stop: { cls: "text-[#8b949e]", icon: <Power className="h-3 w-3" /> },
  info: { cls: "text-[#8b949e]", icon: <ChevronRight className="h-3 w-3" /> },
};

function lineClass(l: DeployLog): string {
  if (l.level === "error") return "text-[#f85149]";
  if (l.level === "deploy") return "text-[#3fb950]";
  // BuildKit step output ("#11 32.4 …") is the bulk of a build — keep it quiet.
  if (/^#\d+/.test(l.message)) return "text-[#8b949e]";
  return "text-[#c9d1d9]";
}

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function DeployCard({ g, open, onToggle, errorsOnly }: {
  g: DeployGroup; open: boolean; onToggle: () => void; errorsOnly: boolean;
}) {
  const o = OUTCOME[g.outcome];
  const bodyRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const lines = errorsOnly ? g.lines.filter((l) => l.level === "error") : g.lines;

  // Follow the output while this deploy is still building.
  useEffect(() => {
    const el = bodyRef.current;
    if (el && open && g.outcome === "building") el.scrollTop = el.scrollHeight;
  }, [g.lines.length, open, g.outcome]);

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = g.lines.map((l) => `${new Date(l.created_at).toISOString()} [${l.level}] ${l.message}`).join("\n");
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className={`rounded-lg border ${g.current ? "border-[#3fb950]/30" : "border-white/[0.08]"} bg-[#0d1117]`}>
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.02] rounded-lg">
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-[#8b949e] transition-transform ${open ? "rotate-90" : ""}`} />
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${o.cls}`}>
          {o.icon}{o.label}
        </span>
        {g.current && (
          <span className="rounded-full border border-[#3fb950]/30 px-1.5 py-0.5 text-[10px] text-[#3fb950]">current</span>
        )}
        <span className="text-[11px] text-[#c9d1d9] truncate">
          {g.partial ? "Deploy (start not in history)" : "Deploy"} · {fmtWhen(g.startedAt)}
        </span>
        <span className="hidden sm:inline text-[10px] text-[#8b949e] shrink-0">
          {g.outcome === "building" ? "running for " : ""}{fmtDuration(g.startedAt, g.endedAt)}
        </span>
        {g.commit && (
          <span className="hidden md:inline-flex items-center gap-1 text-[10px] text-[#8b949e] font-mono shrink-0">
            <GitCommit className="h-3 w-3" />{g.commit}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 shrink-0">
          <span className="hidden sm:inline text-[10px] text-[#6e7681]">{g.lines.length} lines</span>
          <span
            role="button"
            tabIndex={0}
            onClick={copy}
            onKeyDown={(e) => { if (e.key === "Enter") copy(e as unknown as React.MouseEvent); }}
            title="Copy this deploy's logs"
            className="rounded p-1 text-[#8b949e] hover:text-[#c9d1d9] hover:bg-white/[0.06]"
          >
            {copied ? <Check className="h-3 w-3 text-[#3fb950]" /> : <Copy className="h-3 w-3" />}
          </span>
        </span>
      </button>
      {!open && g.failure && (
        <div className="px-9 pb-2 -mt-1 text-[11px] font-mono text-[#f85149]/90 truncate">{g.failure}</div>
      )}
      {open && (
        <div ref={bodyRef} className="border-t border-white/[0.06] max-h-[52vh] overflow-y-auto p-2 font-mono text-[11px] leading-relaxed">
          {lines.length === 0 ? (
            <div className="px-2 py-1 italic text-[#8b949e]">{errorsOnly ? "No errors in this deploy." : "No output."}</div>
          ) : lines.map((l, i) => (
            <div key={i} className="flex gap-3 px-2 py-px rounded hover:bg-white/[0.03]">
              <span className="text-[#58a6ff]/70 select-none shrink-0 tabular-nums">{clock(l.created_at)}</span>
              <span className={`whitespace-pre-wrap break-words min-w-0 ${lineClass(l)}`}>{l.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({ e }: { e: EventItem }) {
  const [open, setOpen] = useState(e.tone === "crash");
  const t = EVENT[e.tone];
  return (
    <div className="pl-3">
      <div className="border-l border-white/[0.08] pl-3 py-1">
        <button
          onClick={() => e.detail && setOpen((v) => !v)}
          className={`flex items-start gap-2 text-left text-[11px] ${t.cls} ${e.detail ? "cursor-pointer" : "cursor-default"}`}
        >
          <span className="mt-0.5 shrink-0">{t.icon}</span>
          <span className="text-[#6e7681] shrink-0 tabular-nums">{fmtWhen(e.at)}</span>
          <span className="min-w-0">{e.title}</span>
          {e.detail && <ChevronRight className={`mt-0.5 h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />}
        </button>
        {open && e.detail && (
          <pre className="mt-1.5 ml-5 max-h-[40vh] overflow-auto rounded-md border border-white/[0.06] bg-black/30 p-2 text-[11px] leading-relaxed text-[#c9d1d9] whitespace-pre-wrap break-words">
            {e.detail}
          </pre>
        )}
      </div>
    </div>
  );
}

export function DeployLogConsole({ logs, status, loading }: { logs: DeployLog[]; status: string; loading: boolean }) {
  const entries = useMemo(() => groupDeployLogs(logs, status), [logs, status]);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [hideEvents, setHideEvents] = useState(false);
  // Explicit open/closed choices by key; otherwise the newest deploy is open.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const newestKey = entries.find((e) => e.kind === "deploy")?.key;

  const deploys = entries.filter((e) => e.kind === "deploy").length;
  const shown = hideEvents ? entries.filter((e) => e.kind === "deploy") : entries;

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#0b0e13] overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/[0.08] bg-[#161b22] px-3 py-1.5 text-[10px] font-mono text-[#8b949e]">
        <span className="text-[#c9d1d9]">Deploy history</span>
        <span>{deploys} deploy{deploys === 1 ? "" : "s"}</span>
        {status === "building" && (
          <span className="flex items-center gap-1 text-[#d29922]"><Loader2 className="h-3 w-3 animate-spin" /> building…</span>
        )}
        <span className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} className="accent-[#f85149] h-3 w-3" />
            errors only
          </label>
          <label className="flex items-center gap-1 cursor-pointer select-none">
            <input type="checkbox" checked={hideEvents} onChange={(e) => setHideEvents(e.target.checked)} className="accent-emerald-500 h-3 w-3" />
            hide events
          </label>
          <span className="hidden sm:inline">kept 14 days</span>
        </span>
      </div>
      <div className="h-[62vh] overflow-y-auto p-2 space-y-1.5">
        {shown.length === 0 ? (
          <div className="p-2 text-[11px] font-mono italic text-[#8b949e]">
            {loading ? "Loading logs…" : "No deploy logs yet. Logs are kept for 14 days — redeploy to generate fresh logs."}
          </div>
        ) : shown.map((e) =>
          e.kind === "event" ? <EventRow key={e.key} e={e} /> : (
            <DeployCard
              key={e.key}
              g={e}
              errorsOnly={errorsOnly}
              open={toggled[e.key] ?? (e.key === newestKey || e.outcome === "building")}
              onToggle={() => setToggled((t) => ({ ...t, [e.key]: !(t[e.key] ?? (e.key === newestKey || e.outcome === "building")) }))}
            />
          ),
        )}
      </div>
    </div>
  );
}
