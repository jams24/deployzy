"use client";

// Overview tab: the project's at-a-glance home. A stat strip (visitors,
// pageviews, live CPU and memory with sparklines), the 24h traffic chart next
// to this month's usage, the deployment panel (what's live, what's new on the
// branch, roll back to any recent commit) and the latest deploy log lines.
// Deeper views live in their own tabs.

import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight, ArrowUpRight, Check, Cpu, Eye, GitBranch, GitCommitHorizontal, Loader2,
  MemoryStick, MousePointerClick, Rocket, Upload, Wifi,
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { useProject } from "@/components/project/project-context";
import {
  API, fmtGB, fmtNum, headers, timeAgo,
  type Bandwidth, type Commit, type DeployLog, type MetricSample, type SiteOverview,
} from "@/components/project/project-shared";

const GREEN = "#34D399";
const CYAN = "#22D3EE";

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-[var(--dz-hairline)] bg-popover px-3 py-2 text-[12.5px] shadow-xl">
      <p className="mb-1 text-muted-foreground">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="capitalize text-muted-foreground">{p.name}</span>
          <span className="ml-auto pl-3 font-semibold tabular-nums">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

// Tiny trend line for the stat strip. Flat data still draws a calm baseline.
function Sparkline({ values, color = GREEN, className }: { values: number[]; color?: string; className?: string }) {
  const id = `spark-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  if (values.length < 2) return <div className={cn("h-7", className)} />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 26 - ((v - min) / span) * 22]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className={cn("h-7 w-full overflow-visible", className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${line} L100,28 L0,28 Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function Stat({ icon: Icon, label, value, unit, extra, children }: {
  icon: typeof Eye; label: string; value: string; unit?: string; extra?: ReactNode; children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col bg-card p-4 sm:p-5">
      <p className="flex items-center gap-1.5 text-[13.5px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-2.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
        <span className="text-[28px] font-semibold leading-none tracking-[-0.035em] tabular-nums">{value}</span>
        {unit && <span className="text-[13.5px] tabular-nums text-muted-foreground">{unit}</span>}
        {extra}
      </p>
      {children && <div className="mt-auto pt-3">{children}</div>}
    </div>
  );
}

const LOG_TONE: Record<string, string> = {
  error: "text-red-400",
  build: "text-amber-300/90",
  deploy: "text-brand",
};

export default function ProjectOverviewPage() {
  const { project: p, deploying, deploy } = useProject();
  const [site, setSite] = useState<SiteOverview | null>(null);
  const [metrics, setMetrics] = useState<MetricSample[]>([]);
  const [bandwidth, setBandwidth] = useState<Bandwidth | null>(null);
  const [logs, setLogs] = useState<DeployLog[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [selectedCommit, setSelectedCommit] = useState("");

  const load = useCallback(() => {
    fetch(`${API}/api/v1/projects/${p.id}/analytics?range=24h`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setSite(d)).catch(() => {});
    fetch(`${API}/api/v1/projects/${p.id}/metrics?range=1h`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMetrics(Array.isArray(d.samples) ? d.samples : [])).catch(() => {});
    fetch(`${API}/api/v1/projects/${p.id}/bandwidth`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setBandwidth(d)).catch(() => {});
    fetch(`${API}/api/v1/projects/${p.id}/logs`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : null)).then((d) => Array.isArray(d) && setLogs(d)).catch(() => {});
    if (p.github_repo) {
      const branch = p.github_branch || p.branch || "main";
      fetch(`${API}/api/v1/github/commits?repo=${encodeURIComponent(p.github_repo)}&branch=${encodeURIComponent(branch)}`, { headers: headers() })
        .then((r) => (r.ok ? r.json() : null)).then((d) => Array.isArray(d) && setCommits(d)).catch(() => {});
    }
  }, [p.id, p.github_repo, p.github_branch, p.branch]);

  useEffect(() => { load(); }, [load]);

  const branch = p.github_branch || p.branch || "main";
  const latest = metrics.length ? metrics[metrics.length - 1] : null;
  const memLimit = latest?.memory_limit_mb || p.memory_mb || 0;
  const memPct = latest && memLimit > 0 ? Math.min(100, (latest.memory_mb / memLimit) * 100) : 0;
  const ts = (site?.timeseries || []).map((t) => ({
    ...t,
    label: new Date(t.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  }));
  const hasTraffic = ts.some((t) => t.pageviews > 0 || t.visitors > 0);
  const recentLogs = [...logs].slice(0, 10).reverse(); // API is newest-first; render oldest→newest

  const currentIdx = p.commit_sha ? commits.findIndex((c) => c.sha === p.commit_sha) : -1;
  const current = currentIdx >= 0 ? commits[currentIdx] : null;
  const behindBy = commits.length > 0 && p.commit_sha && p.commit_sha !== commits[0].sha
    ? (currentIdx > 0 ? currentIdx : null)
    : 0;
  const isBehind = behindBy !== 0;
  const selected = commits.find((c) => c.sha === selectedCommit);

  const deployCommit = (sha: string) => { deploy({ commitSha: sha }); setSelectedCommit(""); };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Stat strip */}
      <section className="surface overflow-hidden rounded-[20px]">
        <div className="grid grid-cols-2 gap-px bg-[var(--dz-hairline)] lg:grid-cols-4">
          <Stat
            icon={Eye}
            label="Visitors · 24h"
            value={fmtNum(site?.overview?.visitors || 0)}
            extra={site?.realtime?.visitors ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2 py-0.5 text-[12.5px] font-medium text-[var(--dz-green-strong)] dark:text-brand">
                <span className="live-dot" aria-hidden />{site.realtime.visitors} live
              </span>
            ) : undefined}
          >
            <Sparkline values={ts.map((t) => t.visitors)} />
          </Stat>
          <Stat icon={MousePointerClick} label="Pageviews · 24h" value={fmtNum(site?.overview?.pageviews || 0)}>
            <Sparkline values={ts.map((t) => t.pageviews)} color={CYAN} />
          </Stat>
          <Stat icon={Cpu} label="CPU · last hour" value={latest ? latest.cpu_pct.toFixed(1) : "—"} unit={latest ? "%" : undefined}>
            <Sparkline values={metrics.map((m) => m.cpu_pct)} color={CYAN} />
          </Stat>
          <Stat
            icon={MemoryStick}
            label="Memory"
            value={latest ? String(latest.memory_mb) : "—"}
            unit={latest ? (memLimit ? `of ${memLimit} MB` : "MB") : undefined}
          >
            {latest && memLimit > 0 ? (
              <div className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]">
                <div
                  className={cn("h-full rounded-full transition-[width] duration-700", memPct >= 90 ? "bg-red-500" : memPct >= 75 ? "bg-amber-500" : "bg-gradient-to-r from-brand to-brand-cyan")}
                  style={{ width: `${Math.max(memPct, 3)}%` }}
                />
              </div>
            ) : (
              <Sparkline values={metrics.map((m) => m.memory_mb)} />
            )}
          </Stat>
        </div>
      </section>

      {/* Traffic + usage */}
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-3">
        <section className="surface overflow-hidden rounded-[20px] lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-4 sm:px-5 sm:pt-5">
            <div className="min-w-0">
              <p className="text-[14.5px] font-semibold tracking-tight">Traffic</p>
              <p className="text-[13px] text-muted-foreground">Last 24 hours</p>
            </div>
            <div className="flex items-center gap-4 text-[13px] text-muted-foreground">
              <span className="hidden items-center gap-1.5 min-[420px]:flex"><span className="h-2 w-2 rounded-full" style={{ background: GREEN }} />Visitors</span>
              <span className="hidden items-center gap-1.5 min-[420px]:flex"><span className="h-2 w-2 rounded-full" style={{ background: CYAN }} />Pageviews</span>
              <Link href={`/projects/${p.id}/analytics`} className="inline-flex items-center gap-1 font-medium text-foreground/80 transition-colors hover:text-foreground">
                Analytics <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
          <div className="relative h-56 px-2 pb-3 pt-4 sm:px-3">
            {!hasTraffic ? (
              <div className="relative flex h-full flex-col items-center justify-center px-4 text-center">
                <div aria-hidden className="absolute inset-x-3 inset-y-4 flex flex-col justify-between">
                  {[0, 1, 2, 3].map((i) => <div key={i} className="border-t border-dashed border-[var(--dz-hairline)]" />)}
                </div>
                <span className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-background shadow-sm ring-1 ring-[var(--dz-hairline)]">
                  <Eye className="h-4 w-4 text-muted-foreground" />
                </span>
                <p className="relative mt-3 text-[14.5px] font-semibold">No visits in the last 24 hours</p>
                <p className="relative mt-1 max-w-xs text-[13.5px] text-muted-foreground">Share your link and visits show up here within a minute.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={ts} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="ov-pv" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CYAN} stopOpacity={0.22} />
                      <stop offset="100%" stopColor={CYAN} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="ov-vs" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={GREEN} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={GREEN} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 4" stroke="currentColor" className="text-foreground/[0.08]" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="currentColor" className="text-muted-foreground" tickLine={false} axisLine={false} minTickGap={40} />
                  <YAxis tick={{ fontSize: 12 }} stroke="currentColor" className="text-muted-foreground" tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: "currentColor", strokeOpacity: 0.15 }} />
                  <Area type="monotone" dataKey="pageviews" stroke={CYAN} strokeWidth={1.75} fill="url(#ov-pv)" name="pageviews" />
                  <Area type="monotone" dataKey="visitors" stroke={GREEN} strokeWidth={1.75} fill="url(#ov-vs)" name="visitors" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* This month */}
        <section className="surface flex flex-col rounded-[20px] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[14.5px] font-semibold tracking-tight">This month</p>
            <Link href="/billing" className="inline-flex items-center gap-1 text-[13px] font-medium text-foreground/80 transition-colors hover:text-foreground">
              Limits <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {bandwidth ? (() => {
            const bw = bandwidth;
            const capped = bw.limit_gb > 0;
            const pct = Math.min(bw.pct, 100);
            const hot = bw.exceeded || bw.pct >= 90;
            const warm = !hot && bw.pct >= 75;
            return (
              <>
                <div className="mt-4">
                  <p className="flex items-center gap-1.5 text-[13.5px] text-muted-foreground"><Wifi className="h-3.5 w-3.5" /> Bandwidth, this project</p>
                  <p className="mt-1.5 text-[28px] font-semibold leading-none tracking-[-0.035em] tabular-nums">{fmtGB(bw.project_gb)}</p>
                </div>
                <div className="mt-5 rounded-2xl bg-foreground/[0.035] p-3.5">
                  <div className="flex items-baseline justify-between gap-2 text-[13.5px]">
                    <span className="text-muted-foreground">All projects</span>
                    <span className={cn("font-medium tabular-nums", hot ? "text-red-600 dark:text-red-400" : warm ? "text-amber-600 dark:text-amber-400" : "")}>
                      {fmtGB(bw.account_gb)}{capped && <span className="font-normal text-muted-foreground"> of {bw.limit_gb} GB</span>}
                    </span>
                  </div>
                  {capped ? (
                    <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]">
                      <div className={cn("h-full rounded-full transition-[width] duration-700", hot ? "bg-red-500" : warm ? "bg-amber-500" : "bg-gradient-to-r from-brand to-brand-cyan")} style={{ width: `${Math.max(pct, 2)}%` }} />
                    </div>
                  ) : (
                    <p className="mt-1.5 text-[12.5px] text-muted-foreground">No bandwidth cap on your plan</p>
                  )}
                </div>
                {bw.exceeded ? (
                  <p className="mt-3 text-[13px] leading-snug text-red-600 dark:text-red-400">Limit reached. Traffic is throttled until the month resets or you upgrade.</p>
                ) : warm || hot ? (
                  <p className="mt-3 text-[13px] leading-snug text-amber-700 dark:text-amber-400">Getting close to this month&apos;s limit.</p>
                ) : null}
                <dl className="mt-auto grid grid-cols-2 gap-3 border-t border-[var(--dz-hairline)] pt-4 text-[13.5px]">
                  <div>
                    <dt className="text-muted-foreground">Memory</dt>
                    <dd className="mt-0.5 font-medium tabular-nums">{memLimit ? `${memLimit} MB` : "Default"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">CPU</dt>
                    <dd className="mt-0.5 font-medium tabular-nums">{p.cpus ? `${p.cpus} vCPU` : "Plan default"}</dd>
                  </div>
                </dl>
              </>
            );
          })() : (
            <div className="mt-4 animate-pulse space-y-3">
              <div className="h-3 w-32 rounded-full bg-muted" />
              <div className="h-7 w-24 rounded-lg bg-muted" />
              <div className="h-16 rounded-2xl bg-muted" />
            </div>
          )}
        </section>
      </div>

      {/* Deployment */}
      <section className="surface overflow-hidden rounded-[20px]">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          {/* What's live */}
          <div className="flex flex-col p-4 sm:p-5 lg:border-r lg:border-[var(--dz-hairline)]">
            <p className="text-[14.5px] font-semibold tracking-tight">Live deployment</p>
            <div className="mt-4 rounded-2xl border border-[var(--dz-hairline)] p-4">
              {p.commit_sha ? (
                <>
                  <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground/[0.05] px-2 py-0.5 font-mono text-[12.5px] text-foreground">
                      <GitCommitHorizontal className="h-3.5 w-3.5" />{p.commit_sha.slice(0, 7)}
                    </span>
                    <span className="inline-flex items-center gap-1"><GitBranch className="h-3.5 w-3.5" />{branch}</span>
                  </p>
                  <p className="mt-3 line-clamp-2 text-[15px] font-medium leading-snug">{current?.message || "Commit details unavailable"}</p>
                  <p className="mt-1.5 text-[13px] text-muted-foreground">
                    {current?.author ? `${current.author} · ` : ""}deployed {timeAgo(p.last_deploy_at)}
                  </p>
                </>
              ) : (
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.05] text-muted-foreground">
                    {p.deploy_source === "upload" ? <Upload className="h-4 w-4" /> : <Rocket className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium">{p.deploy_source === "upload" ? "Deployed from a folder upload" : "No commit pinned yet"}</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{p.last_deploy_at ? `Deployed ${timeAgo(p.last_deploy_at)}` : "Not deployed yet"}</p>
                  </div>
                </div>
              )}
            </div>

            {commits.length > 0 && p.commit_sha && (
              isBehind ? (
                <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-3.5 sm:flex-row sm:items-center">
                  <p className="min-w-0 flex-1 text-[13.5px] leading-snug text-amber-800 dark:text-amber-300">
                    {behindBy ? `${behindBy} newer commit${behindBy === 1 ? "" : "s"}` : "Newer commits"} on <span className="font-medium">{branch}</span> not deployed yet.
                  </p>
                  <button type="button" disabled={deploying} onClick={() => deployCommit(commits[0].sha)} className="pill pill-ink pill-sm shrink-0 disabled:opacity-60">
                    {deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                    Deploy {commits[0].sha.slice(0, 7)}
                  </button>
                </div>
              ) : (
                <p className="mt-3 flex items-center gap-2 text-[13.5px] text-muted-foreground">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand/15 text-[var(--dz-green-strong)] dark:text-brand"><Check className="h-3 w-3" /></span>
                  Up to date with {branch}
                </p>
              )
            )}
          </div>

          {/* Recent commits / rollback */}
          <div className="flex min-w-0 flex-col border-t border-[var(--dz-hairline)] lg:border-t-0">
            <div className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
              <p className="text-[14.5px] font-semibold tracking-tight">Recent commits</p>
              {p.github_repo && (
                <a href={`https://github.com/${p.github_repo}/commits/${branch}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-foreground/80 transition-colors hover:text-foreground">
                  GitHub <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
            {commits.length === 0 ? (
              <p className="px-4 pb-5 pt-3 text-[13.5px] text-muted-foreground sm:px-5">
                {p.github_repo ? "Loading commits…" : "Connect a GitHub repo to roll back to any recent commit."}
              </p>
            ) : (
              <>
                <p className="px-4 pt-0.5 text-[13px] text-muted-foreground sm:px-5">Pick a commit to roll back or forward to it.</p>
                <ul role="radiogroup" aria-label="Commits" className="mt-2.5 max-h-[300px] overflow-y-auto px-2 pb-2 sm:px-3">
                  {commits.slice(0, 12).map((c, i) => {
                    const isCurrent = p.commit_sha === c.sha;
                    const on = selectedCommit === c.sha;
                    return (
                      <li key={c.sha}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={on}
                          disabled={isCurrent}
                          onClick={() => setSelectedCommit(on ? "" : c.sha)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors",
                            on ? "bg-brand/[0.08] ring-1 ring-brand/40" : "hover:bg-foreground/[0.04]",
                            isCurrent && "cursor-default hover:bg-transparent",
                          )}
                        >
                          <span className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                            on ? "border-brand bg-brand" : isCurrent ? "border-transparent" : "border-foreground/25",
                          )}>
                            {on && <span className="h-1.5 w-1.5 rounded-full bg-[oklch(0.16_0.02_165)]" />}
                            {isCurrent && <span className="live-dot bg-brand" aria-hidden />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-medium">{c.message}</span>
                            <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                              <code className="font-mono">{c.sha.slice(0, 7)}</code>
                              <span aria-hidden>·</span>
                              <span className="truncate">{c.author}</span>
                              {c.date && <><span aria-hidden className="hidden sm:inline">·</span><span className="hidden whitespace-nowrap sm:inline">{timeAgo(c.date)}</span></>}
                            </span>
                          </span>
                          {isCurrent ? (
                            <span className="shrink-0 rounded-full bg-brand/15 px-2 py-0.5 text-[12px] font-medium text-[var(--dz-green-strong)] dark:text-brand">Live</span>
                          ) : i === 0 ? (
                            <span className="shrink-0 rounded-full bg-brand-cyan/15 px-2 py-0.5 text-[12px] font-medium text-cyan-700 dark:text-brand-cyan">Latest</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {selected && (
                  <div className="flex flex-col gap-2 border-t border-[var(--dz-hairline)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5" style={{ animation: "dz-fade .2s ease both" }}>
                    <p className="min-w-0 truncate text-[13.5px] text-muted-foreground">
                      Deploy <code className="font-mono text-foreground">{selected.sha.slice(0, 7)}</code> to {p.subdomain}.deployzy.app?
                    </p>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => setSelectedCommit("")} className="pill pill-line pill-sm flex-1 sm:flex-none">Cancel</button>
                      <button type="button" disabled={deploying} onClick={() => deployCommit(selected.sha)} className="pill pill-launch pill-sm flex-1 disabled:opacity-60 sm:flex-none">
                        {deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} Deploy
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {/* Recent deploy logs */}
      <section className="dark overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#0b0c10] text-white">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-3 sm:px-5">
          <p className="flex items-center gap-2.5 text-[14px] font-medium">
            <span className="flex gap-1.5" aria-hidden>
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
            </span>
            Latest deploy
          </p>
          <Link href={`/projects/${p.id}/logs`} className="inline-flex items-center gap-1 text-[13px] font-medium text-white/60 transition-colors hover:text-white">
            All logs <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {recentLogs.length > 0 ? (
          <ol className="space-y-2 px-4 py-3.5 sm:space-y-1 font-mono text-[12.5px] leading-relaxed sm:px-5">
            {recentLogs.map((l, i) => (
              <li key={i} className="flex flex-col sm:flex-row sm:gap-3">
                {/* Phones: timestamp on its own line so the message gets the full width. */}
                <span className="shrink-0 select-none text-[11.5px] tabular-nums text-white/30 sm:text-[12.5px]">
                  {new Date(l.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <span className={cn("min-w-0 [overflow-wrap:anywhere]", LOG_TONE[l.level] ?? "text-white/80")}>{l.message}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="px-4 py-5 font-mono text-[12.5px] text-white/40 sm:px-5">No deploy logs yet.</p>
        )}
      </section>
    </div>
  );
}
