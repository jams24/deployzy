// Turns the flat deploy_logs stream into what actually happened: one entry per
// deploy (its build + start output and outcome) and standalone runtime events
// between deploys (slept, woke, crashed, auto-restarted, stopped).

import type { DeployLog } from "./project-shared";

export type DeployOutcome = "succeeded" | "failed" | "building" | "interrupted";
export type EventTone = "sleep" | "wake" | "crash" | "restart" | "stop" | "info";

export interface DeployGroup {
  kind: "deploy";
  key: string;
  startedAt: string;
  endedAt: string;
  lines: DeployLog[];
  outcome: DeployOutcome;
  /** True when the oldest deploy's start fell outside the fetched window. */
  partial: boolean;
  commit?: string;
  url?: string;
  /** Short reason for a failed deploy (first error line, trimmed). */
  failure?: string;
  /** The most recent successful deploy — what's serving now (if running). */
  current?: boolean;
}

export interface EventItem {
  kind: "event";
  key: string;
  at: string;
  tone: EventTone;
  title: string;
  /** Extra lines (e.g. exit details + last output for a crash). */
  detail?: string;
}

export type LogEntry = DeployGroup | EventItem;

const START = /^Starting deployment/;
// Runtime messages written outside a deploy. Older rows predate the "event"
// level, so match their text too.
const RUNTIME = [
  /^App stopped and is offline/,
  /^Container crashed and exhausted/,
  /^Container was stopped from outside/,
  /^Project stopped/,
  /^Asleep — /,
  /^Woke up for/,
];

function isRuntime(l: DeployLog): boolean {
  return l.level === "event" || RUNTIME.some((r) => r.test(l.message));
}

function toEvent(l: DeployLog): EventItem {
  const [first, ...rest] = l.message.split("\n");
  const m = l.message;
  const tone: EventTone =
    /^Asleep/.test(m) ? "sleep" :
    /^Woke/.test(m) ? "wake" :
    /^(App stopped and is offline|Container crashed)/.test(m) ? "crash" :
    /^Container was stopped from outside/.test(m) ? "restart" :
    /^Project stopped/.test(m) ? "stop" : "info";
  return { kind: "event", key: `e${l.created_at}`, at: l.created_at, tone, title: first, detail: rest.join("\n").trim() || undefined };
}

function finish(g: DeployGroup) {
  g.endedAt = g.lines[g.lines.length - 1]?.created_at ?? g.startedAt;
  for (const l of g.lines) {
    const c = l.message.match(/^Checking out commit ([0-9a-f]{6,40})/);
    if (c) g.commit = c[1].slice(0, 7);
    const u = l.message.match(/^Deployed at (https:\/\/\S+)/);
    if (u) g.url = u[1];
  }
  if (g.url) {
    g.outcome = "succeeded";
    return;
  }
  const err = g.lines.find((l) => l.level === "error" || /^Build failed/.test(l.message));
  if (err) {
    g.outcome = "failed";
    g.failure = err.message.split("\n")[0].slice(0, 160);
  }
}

/** logs: newest-first, as the API returns them. */
export function groupDeployLogs(logs: DeployLog[], projectStatus: string): LogEntry[] {
  const asc = [...logs].reverse();
  const out: LogEntry[] = [];
  let cur: DeployGroup | null = null;

  asc.forEach((l) => {
    if (isRuntime(l)) {
      out.push(toEvent(l));
      return;
    }
    if (START.test(l.message) || !cur) {
      if (cur) finish(cur);
      cur = {
        kind: "deploy", key: `d${l.created_at}`, startedAt: l.created_at, endedAt: l.created_at,
        lines: [], outcome: "interrupted", partial: !START.test(l.message),
      };
      out.push(cur);
    }
    cur.lines.push(l);
  });
  if (cur) finish(cur);

  // Only the newest deploy can still be running.
  const deploys = out.filter((e): e is DeployGroup => e.kind === "deploy");
  const newest = deploys[deploys.length - 1];
  if (newest && newest.outcome === "interrupted" && projectStatus === "building") newest.outcome = "building";
  const live = [...deploys].reverse().find((d) => d.outcome === "succeeded");
  if (live && projectStatus === "running") live.current = true;

  return out.reverse(); // newest first for display
}

export function fmtDuration(fromIso: string, toIso: string): string {
  const s = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `Today ${time}` : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}
