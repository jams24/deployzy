"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowsClockwiseIcon, ArrowUpRightIcon, HardDriveIcon, PulseIcon, RocketLaunchIcon, UsersThreeIcon, WarningIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { countryName, flag } from "@/lib/geo";
import { DashMotion, KpiCard } from "@/components/admin/dash-kit";
import { fmtBytes } from "@/components/admin/pager";
import { EmptyState, PageHeader } from "@/components/dashboard/kit";
import { SERIES_1, SERIES_2, Segmented } from "@/components/project/charts";

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

// ── Traffic chart: requests (area + line) and visitors (line) on one count
// axis. Series colours are the validated --dz-series-* pair; everything else
// is ink. Hover shows the bucket's values. ──
function TrafficChart({ data, range, totals }: { data: Data["series"]; range: RangeKey; totals: Totals }) {
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
  const empty = data.length === 0 || data.every((d) => d.requests === 0);
  const h = hover !== null ? data[hover] : null;
  const legend = [
    { label: "Requests", color: SERIES_1, value: totals.requests },
    { label: "Visitors", color: SERIES_2, value: totals.visitors },
  ];
  return (
    <div className="ov-rise surface rounded-[20px] p-4 sm:p-5" style={{ animationDelay: "240ms" }}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <p className="text-[14.5px] font-semibold tracking-tight">Traffic to your apps</p>
        <div className="flex items-center gap-5">
          {legend.map((l) => (
            <div key={l.label} className="text-[12.5px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: l.color }} />{l.label}</span>
              <span className="mt-0.5 block text-[15px] font-semibold tabular-nums text-foreground">{l.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="relative mt-4">
        {empty ? (
          <div className="relative h-[220px]">
            <div className="absolute inset-x-0 bottom-[6px] border-t border-[var(--dz-hairline)]" />
            <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
              <p className="text-[14px] font-medium">No traffic in this window</p>
              <p className="max-w-xs text-[13px] text-muted-foreground">Requests to your deployed apps show up here within a minute.</p>
            </div>
          </div>
        ) : (
          <>
            <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[220px] w-full"
              onMouseMove={(e) => {
                const r = ref.current?.getBoundingClientRect(); if (!r) return;
                setHover(Math.max(0, Math.min(data.length - 1, Math.round(((e.clientX - r.left) / r.width) * (data.length - 1)))));
              }}
              onMouseLeave={() => setHover(null)} role="img" aria-label={`Requests and visitors over the last ${range}`}>
              <defs>
                <linearGradient id="acct-area" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={SERIES_1} stopOpacity="0.14" />
                  <stop offset="100%" stopColor={SERIES_1} stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0.5, 1].map((f) => <line key={f} x1="0" x2={W} y1={y(max * f)} y2={y(max * f)} className="stroke-foreground/[0.06]" vectorEffect="non-scaling-stroke" />)}
              <line x1="0" x2={W} y1={H - padB} y2={H - padB} className="stroke-foreground/[0.14]" vectorEffect="non-scaling-stroke" />
              <g key={range}>
                <path d={`${line("requests")} L${W},${H - padB} L0,${H - padB} Z`} fill="url(#acct-area)" className="ov-fade" />
                <path d={line("requests")} fill="none" stroke={SERIES_1} strokeWidth="2" strokeLinejoin="round" pathLength={1} className="ov-draw" vectorEffect="non-scaling-stroke" />
                <path d={line("visitors")} fill="none" stroke={SERIES_2} strokeWidth="1.5" strokeLinejoin="round" pathLength={1} className="ov-draw" vectorEffect="non-scaling-stroke" />
              </g>
              {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} className="stroke-foreground/25" vectorEffect="non-scaling-stroke" />}
            </svg>
            {h && hover !== null && (
              <>
                {[{ v: h.requests, c: SERIES_1 }, { v: h.visitors, c: SERIES_2 }].map((m, i) => (
                  <span key={i} aria-hidden className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
                    style={{ left: `${(hover / Math.max(1, data.length - 1)) * 100}%`, top: `${(y(m.v) / H) * 220}px`, background: m.c }} />
                ))}
                <div className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-xl border border-[var(--dz-hairline)] bg-popover px-3 py-2 text-[12.5px] shadow-lg"
                  style={{ left: `${Math.min(88, Math.max(12, (hover / Math.max(1, data.length - 1)) * 100))}%` }}>
                  <p className="text-muted-foreground">{fmtTick(h.ts)}</p>
                  <p className="mt-1 flex items-center gap-2 tabular-nums"><span className="h-2 w-2 rounded-full" style={{ background: SERIES_1 }} /><span className="text-muted-foreground">Requests</span><span className="ml-auto pl-3 font-semibold">{h.requests.toLocaleString()}</span></p>
                  <p className="flex items-center gap-2 tabular-nums"><span className="h-2 w-2 rounded-full" style={{ background: SERIES_2 }} /><span className="text-muted-foreground">Visitors</span><span className="ml-auto pl-3 font-semibold">{h.visitors.toLocaleString()}</span></p>
                  {h.errors > 0 && <p className="flex items-center gap-2 tabular-nums"><WarningIcon className="h-3 w-3 text-red-500" /><span className="text-muted-foreground">Errors</span><span className="ml-auto pl-3 font-semibold">{h.errors.toLocaleString()}</span></p>}
                </div>
              </>
            )}
            <div className="pointer-events-none absolute left-1 top-0 flex h-[214px] flex-col justify-between text-[11.5px] tabular-nums text-muted-foreground/80">
              <span>{max.toLocaleString()}</span><span>{Math.round(max / 2).toLocaleString()}</span><span className="opacity-0">0</span>
            </div>
            <div className="mt-2 flex justify-between text-[12px] tabular-nums text-muted-foreground">
              <span>{fmtTick(data[0].ts)}</span><span>{fmtTick(data[Math.floor(data.length / 2)].ts)}</span><span>Now</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Ranked list: the count is the figure; a faint neutral bar behind each row
// shows its share at a glance without adding colour.
function TopList({ title, rows, render, delay }: {
  title: string; rows: { key: string; count: number }[];
  render: (k: string) => React.ReactNode; delay: number;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="ov-rise surface rounded-[20px] p-4 sm:p-5" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center justify-between text-[12.5px] text-muted-foreground">
        <p className="text-[14.5px] font-semibold tracking-tight text-foreground">{title}</p>
        {rows.length > 0 && <span>Requests</span>}
      </div>
      {rows.length === 0 ? <p className="mt-3 text-[13px] text-muted-foreground">Nothing recorded in this window.</p> : (
        <div className="mt-3 space-y-0.5">
          {rows.map((r, i) => (
            <div key={r.key + i} className="relative flex items-center justify-between gap-2 overflow-hidden rounded-md px-2.5 py-1.5 text-[13.5px]">
              <div className="ov-grow absolute inset-y-0 left-0 rounded-md bg-foreground/[0.05] dark:bg-white/[0.06]" style={{ width: `${(r.count / max) * 100}%`, animationDelay: `${delay + 60 + i * 40}ms` }} />
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
  const span = range === "24h" ? 1 : range === "7d" ? 7 : 30;
  const d = data;
  const capBytes = (d?.bandwidth_cap_gb ?? 0) * 1024 ** 3;
  const bwPct = capBytes > 0 && d ? Math.min(100, pct(d.bandwidth_month_bytes, capBytes)) : 0;
  const errRate = d ? pct(d.totals.errors, d.totals.requests) : 0;
  const prevErrRate = d ? pct(d.previous.errors, d.previous.requests) : 0;
  const activeApps = useMemo(() => (d ? d.projects.filter((p) => p.requests > 0) : []), [d]);
  const maxApp = Math.max(1, ...(d?.projects.map((p) => p.requests) ?? [0]));

  return (
    <div className="@container animate-fade-in-up space-y-5">
      <DashMotion />
      <PageHeader
        eyebrow="Account"
        title="Analytics"
        description="Traffic to your deployed apps and tunnels, and your bandwidth this month."
        actions={
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Segmented label="Time range" value={range} options={RANGES.map((r) => ({ id: r.key, label: r.label }))} onChange={setRange} className="flex-1 sm:flex-none" />
            <button type="button" onClick={() => load(range)} title="Refresh" aria-label="Refresh" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--dz-hairline)] text-muted-foreground transition-colors hover:text-foreground">
              <ArrowsClockwiseIcon className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </button>
          </div>
        }
      />

      {error && !d && <div className="rounded-[20px] border border-red-500/30 bg-red-500/[0.05] px-4 py-6 text-center text-[14px] text-red-600 dark:text-red-400">{error}</div>}

      {!d ? (
        !error && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[150px] animate-pulse rounded-[20px] bg-foreground/[0.05]" />)}
          </div>
        )
      ) : d.project_count === 0 && d.tunnels.sessions === 0 ? (
        <EmptyState
          icon={PulseIcon}
          title="Nothing to measure yet"
          description="Deploy an app or open a tunnel and its traffic, visitors and bandwidth show up here."
          action={<Link href="/new" className="pill pill-ink pill-sm"><RocketLaunchIcon className="h-4 w-4" /> Deploy your first app</Link>}
        />
      ) : (
        <>
          <div className={`grid grid-cols-1 gap-3 transition-opacity @md:grid-cols-2 @4xl:grid-cols-4 ${loading ? "opacity-70" : ""}`}>
            <KpiCard icon={PulseIcon} label="Requests" value={d.totals.requests} delay={0}
              cur={d.totals.requests} prev={d.previous.requests} span={span}
              series={d.series.map((s) => s.requests)} sub={<>vs {rangeMeta.prev} · bots excluded</>} />
            <KpiCard icon={UsersThreeIcon} label="Visitors" value={d.totals.visitors} delay={40}
              cur={d.totals.visitors} prev={d.previous.visitors} span={span}
              series={d.series.map((s) => s.visitors)} sub={<>unique per day, cookieless</>} />
            <KpiCard icon={WarningIcon} label="Error rate" value={Math.round(errRate * 10)} format={(n) => `${(n / 10).toFixed(1)}%`} delay={80}
              cur={Math.round(errRate * 10)} prev={Math.round(prevErrRate * 10)} span={span} upIsGood={false}
              series={d.series.map((s) => s.errors)}
              sub={errRate > 5
                ? <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400"><WarningIcon className="h-3.5 w-3.5" />High · {d.totals.errors.toLocaleString()} responses ≥ 400</span>
                : <>{d.totals.errors.toLocaleString()} responses ≥ 400</>} />
            <KpiCard icon={HardDriveIcon} label="Bandwidth" period="this month" value={d.bandwidth_month_bytes} format={fmtBytes} delay={120}
              sub={capBytes > 0
                ? (
                  <span className="flex items-center gap-2.5">
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/[0.08]">
                      <span className={cn("ov-grow block h-full rounded-full", bwPct > 90 ? "bg-red-500" : bwPct > 70 ? "bg-amber-500" : "bg-foreground/45")} style={{ width: `${Math.max(bwPct, 1)}%` }} />
                    </span>
                    <span className={cn("shrink-0 tabular-nums", bwPct > 90 ? "text-red-600 dark:text-red-400" : bwPct > 70 && "text-amber-700 dark:text-amber-400")}>
                      {bwPct > 70 && <WarningIcon className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />}{bwPct.toFixed(0)}% of {d.bandwidth_cap_gb} GB
                    </span>
                  </span>
                )
                : <>no monthly cap on your plan</>} />
          </div>

          <div className="grid gap-4 @5xl:grid-cols-3">
            <div className="min-w-0 @5xl:col-span-2"><TrafficChart data={d.series} range={range} totals={d.totals} /></div>
            <div className="ov-rise surface flex flex-col rounded-[20px] p-4 sm:p-5" style={{ animationDelay: "300ms" }}>
              <p className="text-[14.5px] font-semibold tracking-tight">Tunnels</p>
              <dl className="mt-3 divide-y divide-[var(--dz-hairline)]">
                {[
                  ["Sessions", d.tunnels.sessions.toLocaleString()],
                  ["Live now", d.tunnels.live.toLocaleString()],
                  ["Requests", d.tunnels.requests.toLocaleString()],
                  ["Transferred", fmtBytes(d.tunnels.bytes)],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3 py-2.5">
                    <dt className="text-[13.5px] text-muted-foreground">{k}</dt>
                    <dd className="text-[15px] font-semibold tracking-tight tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-[12.5px] text-muted-foreground">Sessions started in this window. Tracked since 16 Oct 2026.</p>
              <Link href="/tunnels" className="mt-auto inline-flex items-center gap-1 pt-3 text-[13px] font-medium text-foreground/80 hover:text-foreground">Manage tunnels <ArrowUpRightIcon className="h-3.5 w-3.5" /></Link>
            </div>
          </div>

          <div className="ov-rise surface rounded-[20px] p-4 sm:p-5" style={{ animationDelay: "360ms" }}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[14.5px] font-semibold tracking-tight">Your apps</p>
              <span className="text-[12.5px] text-muted-foreground">{activeApps.length} of {d.projects.length} with traffic</span>
            </div>
            {d.projects.length > 0 && (
              <div className="mt-3 flex items-center gap-3 text-[12px] text-muted-foreground">
                <span className="flex-1">App</span>
                <span className="w-24 text-right">Requests</span>
                <span className="hidden w-24 text-right sm:inline">Visitors</span>
                <span className="hidden w-20 text-right sm:inline">Errors</span>
                <span className="w-20 text-right">Data</span>
              </div>
            )}
            {d.projects.length === 0 ? <p className="mt-3 text-[13px] text-muted-foreground">No apps yet.</p> : (
              <div className="mt-1 divide-y divide-[var(--dz-hairline)]">
                {d.projects.slice(0, 12).map((p, i) => (
                  <Link key={p.id} href={`/projects/${p.id}/analytics`} className="group flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium group-hover:underline">{p.name}</span>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-foreground/[0.06]">
                        <div className="ov-grow h-full rounded-full bg-foreground/35" style={{ width: `${(p.requests / maxApp) * 100}%`, animationDelay: `${420 + i * 30}ms` }} />
                      </div>
                    </div>
                    <span className="w-24 shrink-0 text-right text-[13.5px] font-medium tabular-nums">{p.requests.toLocaleString()}</span>
                    <span className="hidden w-24 shrink-0 text-right text-[13px] tabular-nums text-muted-foreground sm:inline">{p.visitors.toLocaleString()}</span>
                    <span className={cn("hidden w-20 shrink-0 items-center justify-end gap-1 text-[13px] tabular-nums sm:inline-flex", pct(p.errors, p.requests) > 5 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                      {pct(p.errors, p.requests) > 5 && <WarningIcon className="h-3.5 w-3.5" />}{pct(p.errors, p.requests).toFixed(1)}%
                    </span>
                    <span className="w-20 shrink-0 text-right text-[13px] tabular-nums text-muted-foreground">{fmtBytes(p.bytes)}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-4 @3xl:grid-cols-3">
            <TopList title="Countries" rows={d.top.country} delay={420} render={(k) => <>{flag(k)}&nbsp; {countryName(k)}</>} />
            <TopList title="Top pages" rows={d.top.path} delay={480} render={(k) => <span className="font-mono text-[13px]">{k || "/"}</span>} />
            <TopList title="Referrers" rows={d.top.referrer} delay={540} render={(k) => k || "Direct / none"} />
          </div>
        </>
      )}
    </div>
  );
}
