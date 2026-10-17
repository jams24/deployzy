"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Users, AlertTriangle, HardDrive, Radio, RefreshCw, Rocket, ArrowUpRight, Globe2, FileText, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashMotion, KpiCard } from "@/components/admin/dash-kit";
import { fmtBytes } from "@/components/admin/pager";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";
const RANGES = [
  { key: "24h", label: "24h", prev: "previous 24 hours" },
  { key: "7d", label: "7 days", prev: "previous 7 days" },
  { key: "30d", label: "30 days", prev: "previous 30 days" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

interface Totals { requests: number; visitors: number; bot_hits: number; errors: number; bytes: number }
interface Data {
  range: RangeKey;
  totals: Totals; previous: Totals;
  series: { ts: string; requests: number; visitors: number; errors: number }[];
  projects: { id: string; name: string; subdomain: string; requests: number; visitors: number; errors: number; bytes: number }[];
  top: { country: { key: string; count: number }[]; path: { key: string; count: number }[]; referrer: { key: string; count: number }[] };
  tunnels: { sessions: number; requests: number; bytes: number; live: number };
  bandwidth_month_bytes: number; bandwidth_cap_gb: number; project_count: number;
}

const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
function flag(cc: string) {
  if (!cc || cc.length !== 2) return "🌐";
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

// ── Traffic chart: requests (area) + visitors (line), hover for details ──
function TrafficChart({ data, range }: { data: Data["series"]; range: RangeKey }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const W = 720, H = 220, padT = 12, padB = 6;
  const max = Math.max(1, ...data.map((d) => d.requests));
  const x = (i: number) => (i / Math.max(1, data.length - 1)) * W;
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const line = (k: "requests" | "visitors") => data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(" ");
  const fmtTick = (ts: string) => {
    const d = new Date(ts);
    return range === "24h" ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
  };
  const empty = data.every((d) => d.requests === 0);
  const h = hover !== null ? data[hover] : null;
  return (
    <div className="ov-rise rounded-2xl border border-border/60 bg-card p-4 sm:p-5" style={{ animationDelay: "240ms" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold">Traffic to your apps</p>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-emerald-500/60" /> requests</span>
          <span className="flex items-center gap-1"><span className="h-0.5 w-3 rounded bg-sky-500" /> visitors</span>
        </div>
      </div>
      <div className="relative mt-4">
        {empty ? (
          <div className="flex h-[220px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-center">
            <p className="text-sm font-medium">No traffic in this window</p>
            <p className="max-w-xs text-xs text-muted-foreground">Requests to your deployed apps show up here within a minute.</p>
          </div>
        ) : (
          <>
            <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[220px] w-full"
              onMouseMove={(e) => {
                const r = ref.current?.getBoundingClientRect(); if (!r) return;
                setHover(Math.max(0, Math.min(data.length - 1, Math.round(((e.clientX - r.left) / r.width) * (data.length - 1)))));
              }}
              onMouseLeave={() => setHover(null)} role="img" aria-label="Requests and visitors over time">
              <defs>
                <linearGradient id="acct-area" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0, 0.5, 1].map((f) => <line key={f} x1="0" x2={W} y1={y(max * f)} y2={y(max * f)} className="stroke-border" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />)}
              <g key={range}>
                <path d={`${line("requests")} L${W},${H - padB} L0,${H - padB} Z`} fill="url(#acct-area)" className="ov-fade" />
                <path d={line("requests")} fill="none" stroke="#10b981" strokeWidth="2" pathLength={1} className="ov-draw" vectorEffect="non-scaling-stroke" />
                <path d={line("visitors")} fill="none" stroke="#0ea5e9" strokeWidth="1.75" pathLength={1} className="ov-draw" vectorEffect="non-scaling-stroke" />
              </g>
              {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} className="stroke-foreground/30" vectorEffect="non-scaling-stroke" />}
            </svg>
            <div className="pointer-events-none absolute left-1 top-0 flex h-[214px] flex-col justify-between text-[10px] tabular-nums text-muted-foreground/80">
              <span>{max.toLocaleString()}</span><span>{Math.round(max / 2).toLocaleString()}</span><span>0</span>
            </div>
            {h && hover !== null && (
              <div className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-[11px] shadow-md"
                style={{ left: `${Math.min(88, Math.max(12, (hover / Math.max(1, data.length - 1)) * 100))}%` }}>
                <p className="font-medium">{fmtTick(h.ts)}</p>
                <p className="tabular-nums text-emerald-600 dark:text-emerald-400">{h.requests.toLocaleString()} requests</p>
                <p className="tabular-nums text-sky-600 dark:text-sky-400">{h.visitors.toLocaleString()} visitors</p>
                {h.errors > 0 && <p className="tabular-nums text-red-600 dark:text-red-400">{h.errors.toLocaleString()} errors</p>}
              </div>
            )}
            <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-muted-foreground">
              <span>{fmtTick(data[0].ts)}</span><span>{fmtTick(data[Math.floor(data.length / 2)].ts)}</span><span>Now</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TopList({ title, icon: Icon, rows, render, delay }: {
  title: string; icon: React.ComponentType<{ className?: string }>; rows: { key: string; count: number }[];
  render: (k: string) => React.ReactNode; delay: number;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="ov-rise rounded-2xl border border-border/60 bg-card p-4 sm:p-5" style={{ animationDelay: `${delay}ms` }}>
      <p className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4 text-muted-foreground" />{title}</p>
      {rows.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No data yet</p> : (
        <div className="mt-3 space-y-1">
          {rows.map((r, i) => (
            <div key={r.key + i} className="relative flex items-center justify-between gap-2 overflow-hidden rounded-md px-2 py-1.5 text-xs">
              <div className="ov-grow absolute inset-y-0 left-0 rounded-md bg-foreground/[0.06]" style={{ width: `${(r.count / max) * 100}%`, animationDelay: `${delay + 60 + i * 40}ms` }} />
              <span className="relative min-w-0 truncate">{render(r.key)}</span>
              <span className="relative shrink-0 tabular-nums text-muted-foreground">{r.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<RangeKey>("7d");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (r: RangeKey) => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/analytics/account?range=${r}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("sm_token")}` },
      });
      if (res.ok) { setData(await res.json()); setError(""); }
      else setError(`Couldn't load analytics (HTTP ${res.status})`);
    } catch { setError("Couldn't load analytics (network error)"); }
    setLoading(false);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => load(range), 0);
    return () => clearTimeout(t);
  }, [range, load]);

  const rangeMeta = RANGES.find((r) => r.key === range)!;
  const d = data;
  const capBytes = (d?.bandwidth_cap_gb ?? 0) * 1024 ** 3;
  const bwPct = capBytes > 0 && d ? Math.min(100, pct(d.bandwidth_month_bytes, capBytes)) : 0;
  const activeApps = useMemo(() => (d ? d.projects.filter((p) => p.requests > 0) : []), [d]);
  const maxApp = Math.max(1, ...(d?.projects.map((p) => p.requests) ?? [0]));

  return (
    <div className="@container animate-fade-in-up space-y-5">
      <DashMotion />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Account</p>
          <h1 className="mt-1 text-[22px] font-bold tracking-[-0.02em] sm:text-[26px]">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">Traffic to your deployed apps and tunnels, and your bandwidth this month.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center rounded-lg border border-border/60 bg-card/60 p-0.5 dark:bg-[#0c0d0f]/40">
            {RANGES.map((r) => (
              <button key={r.key} onClick={() => setRange(r.key)}
                className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors ${range === r.key ? "bg-accent text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                {r.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => load(range)} className="h-8 w-8 rounded-lg p-0" title="Refresh" aria-label="Refresh">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {error && !d && <div className="rounded-2xl border border-red-500/30 bg-red-500/5 px-4 py-6 text-center text-sm text-red-600 dark:text-red-400">{error}</div>}

      {!d ? (
        !error && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[150px] animate-pulse rounded-2xl bg-muted/50" />)}
          </div>
        )
      ) : d.project_count === 0 && d.tunnels.sessions === 0 ? (
        <div className="ov-rise flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-14 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-border/60 bg-card"><Activity className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /></div>
          <p className="font-semibold">Nothing to measure yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">Deploy an app or open a tunnel and its traffic, visitors and bandwidth will appear here.</p>
          <Link href="/new" className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-medium text-background hover:opacity-90"><Rocket className="h-4 w-4" /> Deploy your first app</Link>
        </div>
      ) : (
        <>
          <div className={`grid grid-cols-1 gap-3 transition-opacity @md:grid-cols-2 @4xl:grid-cols-4 ${loading ? "opacity-70" : ""}`}>
            <KpiCard icon={Activity} label="Requests" value={d.totals.requests} color="#10b981" delay={0}
              cur={d.totals.requests} prev={d.previous.requests} span={range === "24h" ? 1 : range === "7d" ? 7 : 30}
              series={d.series.map((s) => s.requests)} sub={<>vs {rangeMeta.prev} · bots excluded</>} />
            <KpiCard icon={Users} label="Visitors" value={d.totals.visitors} color="#0ea5e9" delay={40}
              cur={d.totals.visitors} prev={d.previous.visitors} span={range === "24h" ? 1 : range === "7d" ? 7 : 30}
              series={d.series.map((s) => s.visitors)} sub={<>unique per day, cookieless</>} />
            <KpiCard icon={AlertTriangle} label="Error rate" value={Math.round(pct(d.totals.errors, d.totals.requests) * 10)} format={(n) => `${(n / 10).toFixed(1)}%`}
              color={pct(d.totals.errors, d.totals.requests) > 5 ? "#ef4444" : "#f59e0b"} delay={80}
              series={d.series.map((s) => s.errors)} sub={<>{d.totals.errors.toLocaleString()} responses ≥ 400</>} />
            <KpiCard icon={HardDrive} label="Bandwidth" period="month" value={d.bandwidth_month_bytes} format={fmtBytes} color="#8b5cf6" delay={120}
              sub={capBytes > 0 ? (
                <span className="flex items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="ov-grow block h-full rounded-full" style={{ width: `${bwPct}%`, background: bwPct > 85 ? "#ef4444" : "#8b5cf6" }} /></span>
                  <span className="shrink-0 tabular-nums">{bwPct.toFixed(0)}% of {d.bandwidth_cap_gb} GB</span>
                </span>
              ) : <>no monthly cap on your plan</>} />
          </div>

          <div className="grid gap-4 @5xl:grid-cols-3">
            <div className="min-w-0 @5xl:col-span-2"><TrafficChart data={d.series} range={range} /></div>
            <div className="ov-rise rounded-2xl border border-border/60 bg-card p-4 sm:p-5" style={{ animationDelay: "300ms" }}>
              <p className="flex items-center gap-2 text-sm font-semibold"><Radio className="h-4 w-4 text-sky-500" />Tunnels</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {[
                  ["Sessions", d.tunnels.sessions.toLocaleString()],
                  ["Live now", d.tunnels.live.toLocaleString()],
                  ["Requests", d.tunnels.requests.toLocaleString()],
                  ["Transferred", fmtBytes(d.tunnels.bytes)],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-muted/40 px-3 py-2.5">
                    <p className="text-[10px] text-muted-foreground">{k}</p>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums">{v}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">Sessions started in the selected window. Tunnel usage is tracked from 16 Oct 2026.</p>
              <Link href="/tunnels" className="mt-3 inline-flex items-center gap-1 text-xs font-medium hover:underline">Manage tunnels <ArrowUpRight className="h-3 w-3" /></Link>
            </div>
          </div>

          <div className="ov-rise rounded-2xl border border-border/60 bg-card p-4 sm:p-5" style={{ animationDelay: "360ms" }}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Your apps</p>
              <span className="text-[11px] text-muted-foreground">{activeApps.length} of {d.projects.length} with traffic</span>
            </div>
            {d.projects.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No apps yet.</p> : (
              <div className="mt-3 divide-y divide-border/50">
                {d.projects.slice(0, 12).map((p, i) => (
                  <Link key={p.id} href={`/projects/${p.id}/analytics`} className="group flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium group-hover:underline">{p.name}</span>
                        <span className="shrink-0 text-xs tabular-nums">{p.requests.toLocaleString()} <span className="text-muted-foreground">req</span></span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="ov-grow h-full rounded-full bg-emerald-500/70" style={{ width: `${(p.requests / maxApp) * 100}%`, animationDelay: `${420 + i * 30}ms` }} />
                        </div>
                        <span className="hidden w-24 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground sm:inline">{p.visitors.toLocaleString()} visitors</span>
                        <span className={`hidden w-16 shrink-0 text-right text-[10px] tabular-nums sm:inline ${pct(p.errors, p.requests) > 5 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>{pct(p.errors, p.requests).toFixed(1)}% err</span>
                        <span className="w-16 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">{fmtBytes(p.bytes)}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-4 @3xl:grid-cols-3">
            <TopList title="Countries" icon={Globe2} rows={d.top.country} delay={420} render={(k) => <>{flag(k)}&nbsp; {k || "Unknown"}</>} />
            <TopList title="Top pages" icon={FileText} rows={d.top.path} delay={480} render={(k) => <span className="font-mono">{k || "/"}</span>} />
            <TopList title="Referrers" icon={Link2} rows={d.top.referrer} delay={540} render={(k) => k || "Direct / none"} />
          </div>
        </>
      )}
    </div>
  );
}
