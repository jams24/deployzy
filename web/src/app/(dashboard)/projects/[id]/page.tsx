"use client";

// Overview tab — the project's at-a-glance home: headline stats, traffic
// chart, current deployment (with rollback), bandwidth usage and the most
// recent deploy log lines. Deeper views live in their own tabs.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity, ArrowRight, Cpu, Eye, GitBranch, Loader2, MemoryStick,
  MousePointerClick, Rocket, ScrollText,
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useProject } from "@/components/project/project-context";
import {
  API, fmtGB, fmtNum, headers, timeAgo,
  type Bandwidth, type Commit, type DeployLog, type MetricSample, type SiteOverview,
} from "@/components/project/project-shared";

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-[#0d1117] px-3 py-2 text-[11px] font-mono shadow-xl">
      <div className="text-muted-foreground mb-1">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-[#e6edf3]">{p.name}: {p.value}</span>
        </div>
      ))}
    </div>
  );
}

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

  const latest = metrics.length ? metrics[metrics.length - 1] : null;
  const ts = (site?.timeseries || []).map((t) => ({
    ...t,
    label: new Date(t.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  }));
  const recentLogs = [...logs].slice(0, 8).reverse(); // API is newest-first; render oldest→newest
  const behindLatest = commits.length > 0 && p.commit_sha && p.commit_sha !== commits[0].sha;

  return (
    <div className="space-y-4">
      {/* Headline stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-4">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <MousePointerClick className="h-3 w-3" /> Pageviews · 24h
          </div>
          <div className="mt-1.5 text-xl font-semibold font-mono">{fmtNum(site?.overview?.pageviews || 0)}</div>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-4">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <Eye className="h-3 w-3" /> Visitors · 24h
          </div>
          <div className="mt-1.5 text-xl font-semibold font-mono text-emerald-500">{fmtNum(site?.overview?.visitors || 0)}
            {site?.realtime?.visitors ? (
              <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-normal text-emerald-500 align-middle">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />{site.realtime.visitors} live
              </span>
            ) : null}
          </div>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-4">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <Cpu className="h-3 w-3" /> CPU
          </div>
          <div className="mt-1.5 text-xl font-semibold font-mono">{latest ? `${latest.cpu_pct.toFixed(1)}%` : "—"}</div>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-4">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <MemoryStick className="h-3 w-3" /> Memory
          </div>
          <div className="mt-1.5 text-xl font-semibold font-mono">
            {latest ? `${latest.memory_mb}` : "—"}
            {latest?.memory_limit_mb ? <span className="text-xs text-muted-foreground font-normal"> / {latest.memory_limit_mb} MB</span> : latest ? <span className="text-xs text-muted-foreground font-normal"> MB</span> : null}
          </div>
        </div>
      </div>

      {/* Traffic */}
      <div className="rounded-xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">Traffic — last 24 hours</span>
          </div>
          <Link href={`/projects/${p.id}/analytics`} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
            Full analytics <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="mt-3 h-48">
          {ts.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No traffic recorded yet — visits will appear here automatically.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={ts} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                <defs>
                  <linearGradient id="pv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#60a5fa" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="vs" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border/40" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="pageviews" stroke="#60a5fa" strokeWidth={1.5} fill="url(#pv)" name="pageviews" />
                <Area type="monotone" dataKey="visitors" stroke="#10b981" strokeWidth={1.5} fill="url(#vs)" name="visitors" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Current deployment + rollback */}
        <div className="rounded-xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Rocket className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">Current deployment</span>
            </div>
            {behindLatest && (
              <Badge variant="outline" className="text-[9px] text-amber-600 dark:text-amber-400 border-amber-500/40" title={`Latest on ${p.github_branch || p.branch || "main"} is ${commits[0].sha.slice(0, 7)}`}>
                behind {p.github_branch || p.branch || "main"}
              </Badge>
            )}
          </div>
          <div className="rounded-lg bg-muted px-3 py-2.5 text-xs space-y-1">
            {p.commit_sha ? (
              <div className="flex items-center gap-2">
                <GitBranch className="h-3 w-3 text-muted-foreground shrink-0" />
                <code className="font-mono text-emerald-500">{p.commit_sha.slice(0, 7)}</code>
                <span className="text-muted-foreground">on {p.github_branch || p.branch || "main"}</span>
              </div>
            ) : (
              <div className="text-muted-foreground">
                {p.deploy_source === "upload" ? "Deployed from a folder upload" : "No commit pinned yet"}
              </div>
            )}
            <div className="text-[11px] text-muted-foreground">Last deployed {timeAgo(p.last_deploy_at)}</div>
          </div>

          {commits.length > 0 && (
            <>
              {behindLatest && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-[11px] text-amber-600 dark:text-amber-400/90">
                  Currently deployed <code className="font-mono">{p.commit_sha?.slice(0, 7)}</code> is behind — latest on {p.github_branch || p.branch || "main"} is <code className="font-mono">{commits[0].sha.slice(0, 7)}</code>.
                </div>
              )}
              <div className="space-y-1 max-h-52 overflow-y-auto">
                {commits.map((c, i) => (
                  <label key={c.sha} className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs cursor-pointer hover:bg-accent/60 transition-colors ${selectedCommit === c.sha ? "bg-accent" : ""}`}>
                    <input type="radio" name="commit" checked={selectedCommit === c.sha} onChange={() => setSelectedCommit(c.sha)} className="accent-emerald-500" />
                    <code className="text-[10px] text-emerald-500">{c.sha.slice(0, 7)}</code>
                    <span className="flex-1 truncate">{c.message}</span>
                    <span className="text-[10px] text-muted-foreground hidden md:inline">{c.author}</span>
                    {i === 0 && <Badge variant="outline" className="text-[9px] text-sky-500 border-sky-500/30">latest</Badge>}
                    {p.commit_sha === c.sha && <Badge variant="outline" className="text-[9px] text-emerald-600 dark:text-emerald-400 border-emerald-500/40">current</Badge>}
                  </label>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={deploying || !commits[0] || p.commit_sha === commits[0].sha}
                  title={p.commit_sha === commits[0]?.sha ? "Already on latest" : `Deploy ${commits[0]?.sha.slice(0, 7)}`}
                  onClick={() => { deploy({ commitSha: commits[0].sha }); setSelectedCommit(""); }}
                >
                  {deploying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                  Deploy latest {commits[0] ? `(${commits[0].sha.slice(0, 7)})` : ""}
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!selectedCommit || deploying} onClick={() => { deploy({ commitSha: selectedCommit }); setSelectedCommit(""); }}>
                  {deploying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                  Deploy selected
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Bandwidth */}
        <div className="rounded-xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <svg className="h-3.5 w-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" /></svg>
            <span className="text-xs font-medium">Bandwidth</span>
            <span className="text-[10px] text-muted-foreground">(this month)</span>
          </div>
          {bandwidth ? (() => {
            const bw = bandwidth;
            const limitUnlimited = bw.limit_gb < 0;
            const pct = Math.min(bw.pct, 100);
            const barColor = bw.exceeded ? "bg-red-500" : bw.pct >= 80 ? "bg-yellow-500" : "bg-emerald-500";
            return (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-muted px-3 py-2">
                    <div className="text-[10px] text-muted-foreground">This project</div>
                    <div className="text-base font-semibold font-mono">{fmtGB(bw.project_gb)}</div>
                  </div>
                  <div className="rounded-lg bg-muted px-3 py-2">
                    <div className="text-[10px] text-muted-foreground">Account total</div>
                    <div className={`text-base font-semibold font-mono ${bw.exceeded ? "text-red-500" : bw.pct >= 80 ? "text-yellow-500" : ""}`}>{fmtGB(bw.account_gb)}</div>
                  </div>
                </div>
                {!limitUnlimited ? (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>{fmtGB(bw.account_gb)} used of {bw.limit_gb} GB</span>
                      <span className={bw.exceeded ? "text-red-400 font-medium" : bw.pct >= 80 ? "text-yellow-400 font-medium" : ""}>{bw.pct.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                    </div>
                    {bw.exceeded && <p className="text-[10px] text-red-400">⚠ Bandwidth limit reached — upgrade your plan to restore full traffic.</p>}
                    {!bw.exceeded && bw.pct >= 80 && <p className="text-[10px] text-yellow-400">⚠ Approaching monthly bandwidth limit.</p>}
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground">Unlimited bandwidth on your plan.</p>
                )}
              </>
            );
          })() : (
            <p className="text-[11px] text-muted-foreground">Loading…</p>
          )}
        </div>
      </div>

      {/* Recent deploy logs */}
      <div className="rounded-xl border border-white/[0.08] bg-[#0d1117] overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#161b22] px-3 py-1.5">
          <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
            <ScrollText className="h-3 w-3 text-[#58a6ff]" /> <span className="text-[#c9d1d9]">Recent deploy logs</span>
          </div>
          <Link href={`/projects/${p.id}/logs`} className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-[#c9d1d9] transition-colors">
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {recentLogs.length > 0 ? (
          <div className="p-2 font-mono text-[11px] space-y-0.5">
            {recentLogs.map((l, i) => (
              <div key={i} className={`px-2 py-0.5 rounded ${
                l.level === "error" ? "text-[#f85149]" :
                l.level === "build" ? "text-[#d29922]" :
                l.level === "deploy" ? "text-[#3fb950]" : "text-[#e6edf3]"
              }`}>
                <span className="text-[#58a6ff] select-none">{new Date(l.created_at).toLocaleTimeString()}</span>{" "}
                {l.message}
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 text-[11px] text-muted-foreground font-mono italic">No deploy logs yet.</div>
        )}
      </div>
    </div>
  );
}
