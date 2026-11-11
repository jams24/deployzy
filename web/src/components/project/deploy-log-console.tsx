"use client";

// Deploy history console: each deploy is its own collapsible card with its
// outcome, commit, duration and output; runtime events (sleep, wake, crash,
// auto-restart, stop) sit between them on the timeline.

import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  AlertTriangle, Check, ChevronRight, Copy, GitCommit, Loader2, Moon, Power,
  RotateCcw, Sun, XCircle, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeployLog } from "./project-shared";
import {
  fmtDuration, fmtWhen, groupDeployLogs,
  type DeployGroup, type EventItem, type EventTone,
} from "./deploy-log-groups";

const OUTCOME: Record<DeployGroup["outcome"], { label: string; cls: string; icon: ReactNode }> = {
  succeeded: { label: "Succeeded", cls: "text-brand border-brand/30 bg-brand/10", icon: <Check className="h-3 w-3" /> },
  failed: { label: "Failed", cls: "text-red-400 border-red-400/30 bg-red-400/10", icon: <XCircle className="h-3 w-3" /> },
  building: { label: "Building", cls: "text-amber-300 border-amber-300/30 bg-amber-300/10", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  interrupted: { label: "Interrupted", cls: "text-white/55 border-white/10 bg-white/[0.04]", icon: <AlertTriangle className="h-3 w-3" /> },
};

const EVENT: Record<EventTone, { cls: string; icon: ReactNode }> = {
  sleep: { cls: "text-white/50", icon: <Moon className="h-3.5 w-3.5" /> },
  wake: { cls: "text-brand-cyan", icon: <Sun className="h-3.5 w-3.5" /> },
  crash: { cls: "text-red-400", icon: <Zap className="h-3.5 w-3.5" /> },
  restart: { cls: "text-amber-300", icon: <RotateCcw className="h-3.5 w-3.5" /> },
  stop: { cls: "text-white/50", icon: <Power className="h-3.5 w-3.5" /> },
  info: { cls: "text-white/50", icon: <ChevronRight className="h-3.5 w-3.5" /> },
};

function lineClass(l: DeployLog): string {
  if (l.level === "error") return "text-red-400";
  if (l.level === "deploy") return "text-brand";
  // BuildKit step output ("#11 32.4 …") is the bulk of a build — keep it quiet.
  if (/^#\d+/.test(l.message)) return "text-white/45";
  return "text-white/80";
}

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Small on/off chip used for the console filters.
export function ConsoleToggle({ on, onClick, children, tone = "brand" }: { on: boolean; onClick: () => void; children: ReactNode; tone?: "brand" | "red" }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] font-medium transition-colors",
        on
          ? tone === "red" ? "border-red-400/40 bg-red-400/10 text-red-300" : "border-brand/40 bg-brand/10 text-brand"
          : "border-white/10 text-white/55 hover:border-white/20 hover:text-white/85",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", on ? (tone === "red" ? "bg-red-400" : "bg-brand") : "bg-white/25")} />
      {children}
    </button>
  );
}

export function ConsoleDots() {
  return (
    <span className="flex gap-1.5" aria-hidden>
      <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
      <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
      <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
    </span>
  );
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

  const copy = (e: MouseEvent) => {
    e.stopPropagation();
    const text = g.lines.map((l) => `${new Date(l.created_at).toISOString()} [${l.level}] ${l.message}`).join("\n");
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className={cn("rounded-2xl border bg-white/[0.02]", g.current ? "border-brand/25" : "border-white/[0.07]")}>
      <div className="flex items-center gap-1 pr-2">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.02] sm:px-4">
          <ChevronRight className={cn("h-4 w-4 shrink-0 text-white/40 transition-transform", open && "rotate-90")} />
          <span className={cn("inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full border px-2 text-[12px] font-medium", o.cls)}>
            {o.icon}{o.label}
          </span>
          {g.current && (
            <span className="hidden h-[22px] shrink-0 items-center rounded-full border border-brand/30 px-2 text-[12px] text-brand min-[420px]:inline-flex">Live</span>
          )}
          <span className="min-w-0 truncate text-[13.5px] text-white/85">
            {fmtWhen(g.startedAt)}{g.partial ? " · partial" : ""}
          </span>
          <span className="hidden shrink-0 text-[12.5px] tabular-nums text-white/45 sm:inline">
            {g.outcome === "building" ? "running " : ""}{fmtDuration(g.startedAt, g.endedAt)}
          </span>
          {g.commit && (
            <span className="hidden shrink-0 items-center gap-1 font-mono text-[12px] text-white/45 md:inline-flex">
              <GitCommit className="h-3.5 w-3.5" />{g.commit}
            </span>
          )}
          <span className="ml-auto hidden shrink-0 text-[12.5px] tabular-nums text-white/35 sm:inline">{g.lines.length} lines</span>
        </button>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy this deploy's logs"
          title="Copy this deploy's logs"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-brand" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      {!open && g.failure && (
        <p className="-mt-1 truncate px-4 pb-2.5 pl-[2.6rem] font-mono text-[12.5px] text-red-400/90 sm:pl-[2.85rem]">{g.failure}</p>
      )}
      {open && (
        <div ref={bodyRef} className="max-h-[52vh] overflow-y-auto border-t border-white/[0.06] px-3 py-2.5 font-mono text-[12.5px] leading-relaxed sm:px-4">
          {lines.length === 0 ? (
            <p className="italic text-white/45">{errorsOnly ? "No errors in this deploy." : "No output."}</p>
          ) : lines.map((l, i) => (
            <div key={i} className="flex gap-3 rounded px-1 py-px hover:bg-white/[0.03]">
              <span className="hidden shrink-0 select-none tabular-nums text-white/25 sm:inline">{clock(l.created_at)}</span>
              <span className={cn("min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]", lineClass(l))}>{l.message.replace(/^\n+|\n+$/g, "")}</span>
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
    <div className="pl-4 sm:pl-5">
      <div className="border-l border-white/[0.08] py-1.5 pl-3.5">
        <button
          type="button"
          onClick={() => e.detail && setOpen((v) => !v)}
          aria-expanded={e.detail ? open : undefined}
          className={cn("flex items-start gap-2 text-left text-[13px]", t.cls, e.detail ? "cursor-pointer" : "cursor-default")}
        >
          <span className="mt-0.5 shrink-0">{t.icon}</span>
          <span className="shrink-0 tabular-nums text-white/35">{fmtWhen(e.at)}</span>
          <span className="min-w-0">{e.title}</span>
          {e.detail && <ChevronRight className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-90")} />}
        </button>
        {open && e.detail && (
          <pre className="mt-2 max-h-[40vh] overflow-auto whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-black/30 p-3 font-mono text-[12.5px] leading-relaxed text-white/80 [overflow-wrap:anywhere]">
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
    <section className="dark overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#0b0c10] text-white">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/[0.07] px-4 py-3 sm:px-5">
        <p className="flex items-center gap-2.5 text-[14px] font-medium">
          <ConsoleDots />
          Deploy history
          <span className="text-[13px] font-normal text-white/45">{deploys} deploy{deploys === 1 ? "" : "s"}</span>
        </p>
        {status === "building" && (
          <span className="flex items-center gap-1.5 text-[13px] text-amber-300"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Building</span>
        )}
        <span className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <ConsoleToggle on={errorsOnly} onClick={() => setErrorsOnly((v) => !v)} tone="red">Errors only</ConsoleToggle>
          <ConsoleToggle on={hideEvents} onClick={() => setHideEvents((v) => !v)}>Hide events</ConsoleToggle>
          <span className="ml-auto hidden text-[12.5px] text-white/35 sm:ml-1 md:inline">Kept 14 days</span>
        </span>
      </div>
      <div className="h-[62vh] space-y-2 overflow-y-auto p-2.5 sm:p-3">
        {shown.length === 0 ? (
          <p className="p-2 font-mono text-[12.5px] text-white/45">
            {loading ? "Loading logs…" : "No deploy logs yet. Logs are kept for 14 days; redeploy to generate fresh ones."}
          </p>
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
    </section>
  );
}
