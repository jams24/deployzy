"use client";

// Metrics tab — resource usage over time: a stat strip (CPU, memory, network
// since start), CPU and memory charts, network traffic per interval, and the
// month's bandwidth. Samples are scraped every 30s.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Activity, ArrowDown, ArrowRight, ArrowUp, Cpu, MemoryStick, Network, RefreshCw, Wifi } from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/dashboard/kit";
import { useProject } from "@/components/project/project-context";
import {
  CYAN, ChartTooltip, GREEN, Segmented, Sparkline, StatCell, axisProps, gridProps, tickLabel,
} from "@/components/project/charts";
import {
  API, fmtBytes, fmtGB, headers,
  type Bandwidth, type MetricSample,
} from "@/components/project/project-shared";

const RANGES = [
  { id: "1h", label: "1h" },
  { id: "6h", label: "6h" },
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
] as const;
type Range = (typeof RANGES)[number]["id"];

// Idle apps sit at a few hundredths of a percent; show enough digits to see it.
function pct(v: number) {
  if (v === 0) return "0";
  if (v < 0.1) return v.toFixed(2);
  if (v < 10) return v.toFixed(1);
  return v.toFixed(0);
}

function ChartCard({ title, value, sub, legend, children }: {
  title: string; value: string; sub?: string; legend?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="surface overflow-hidden rounded-[20px]">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 px-4 pt-4 sm:px-5 sm:pt-5">
        <div className="min-w-0">
          <p className="text-[14.5px] font-semibold tracking-tight">{title}</p>
          {sub && <p className="text-[13px] text-muted-foreground">{sub}</p>}
        </div>
        <div className="text-right">
          <p className="text-[20px] font-semibold leading-tight tracking-[-0.03em] tabular-nums">{value}</p>
          {legend}
        </div>
      </div>
      <div className="h-52 px-2 pb-3 pt-3 sm:px-3">{children}</div>
    </section>
  );
}

function Collecting() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
      <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
      <p className="mt-2 text-[13.5px] font-medium">Collecting samples</p>
      <p className="text-[12.5px] text-muted-foreground">The first points show up within a minute.</p>
    </div>
  );
}

export default function ProjectMetricsPage() {
  const { project: p } = useProject();
  const [samples, setSamples] = useState<MetricSample[]>([]);
  const [range, setRange] = useState<Range>("1h");
  const [loaded, setLoaded] = useState(false);
  const [bandwidth, setBandwidth] = useState<Bandwidth | null>(null);

  const load = useCallback(async (r: Range) => {
    try {
      const res = await fetch(`${API}/api/v1/projects/${p.id}/metrics?range=${r}`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setSamples(Array.isArray(data.samples) ? data.samples : []);
        setRange(r);
      }
    } catch {}
    setLoaded(true);
  }, [p.id]);

  const loadBandwidth = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/projects/${p.id}/bandwidth`, { headers: headers() });
      if (res.ok) setBandwidth(await res.json());
    } catch {}
  }, [p.id]);

  // Deferred so the mount effect doesn't synchronously trigger a setState.
  useEffect(() => {
    const t = setTimeout(() => { load("1h"); loadBandwidth(); }, 0);
    return () => clearTimeout(t);
  }, [load, loadBandwidth]);

  // Refresh at 30s (matches the scraper cadence).
  useEffect(() => {
    const t = setInterval(() => load(range), 30000);
    return () => clearInterval(t);
  }, [load, range]);

  if (p.status !== "running") {
    return (
      <EmptyState
        icon={Activity}
        title="Metrics appear while the project runs"
        description={<>It&apos;s <span className="font-medium text-foreground">{p.status}</span> right now. Start or redeploy it to see CPU, memory and network usage.</>}
      />
    );
  }

  const latest = samples.length ? samples[samples.length - 1] : null;
  const memLimit = latest?.memory_limit_mb || p.memory_mb || 0;
  const memPct = latest && memLimit > 0 ? Math.min(100, (latest.memory_mb / memLimit) * 100) : 0;
  const peakCpu = samples.length ? Math.max(...samples.map((s) => s.cpu_pct)) : 0;
  const peakMem = samples.length ? Math.max(...samples.map((s) => s.memory_mb)) : 0;

  // Network counters are totals since the container started; chart the
  // difference between samples. A restart resets the counter, so clamp at 0.
  const data = samples.map((s, i) => {
    const prev = samples[i - 1];
    return {
      ...s,
      label: tickLabel(s.ts, range),
      rx_kb: prev ? Math.max(0, (s.net_rx_bytes - prev.net_rx_bytes) / 1024) : 0,
      tx_kb: prev ? Math.max(0, (s.net_tx_bytes - prev.net_tx_bytes) / 1024) : 0,
    };
  }).slice(1);
  const chartData = data.length ? data : [];
  const fmtKB = (kb: number) => (kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(kb < 10 ? 1 : 0)} kB`);

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[13.5px] text-muted-foreground">
          <span className="relative inline-flex h-2 w-2"><span className="live-dot bg-brand" aria-hidden /></span>
          Live · updates every 30 seconds
        </p>
        <Segmented label="Time range" value={range} options={RANGES} onChange={(r) => load(r)} className="w-full sm:w-auto" />
      </div>

      {/* Stat strip */}
      <section className="surface overflow-hidden rounded-[20px]">
        <div className="grid grid-cols-2 gap-px bg-[var(--dz-hairline)] lg:grid-cols-4">
          <StatCell icon={Cpu} label="CPU" value={latest ? pct(latest.cpu_pct) : "—"} unit={latest ? `% · peak ${pct(peakCpu)}%` : undefined}>
            <Sparkline values={samples.map((s) => s.cpu_pct)} />
          </StatCell>
          <StatCell icon={MemoryStick} label="Memory" value={latest ? String(latest.memory_mb) : "—"} unit={latest ? (memLimit ? `of ${memLimit} MB` : "MB") : undefined}>
            {latest && memLimit > 0 ? (
              <div className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]">
                <div
                  className={cn("h-full rounded-full transition-[width] duration-700", memPct >= 90 ? "bg-red-500" : memPct >= 75 ? "bg-amber-500" : "bg-gradient-to-r from-brand to-brand-cyan")}
                  style={{ width: `${Math.max(memPct, 3)}%` }}
                />
              </div>
            ) : <Sparkline values={samples.map((s) => s.memory_mb)} color={CYAN} />}
          </StatCell>
          <StatCell icon={ArrowDown} label="Received since start" value={latest ? fmtBytes(latest.net_rx_bytes) : "—"}>
            <Sparkline values={data.map((d) => d.rx_kb)} />
          </StatCell>
          <StatCell icon={ArrowUp} label="Sent since start" value={latest ? fmtBytes(latest.net_tx_bytes) : "—"}>
            <Sparkline values={data.map((d) => d.tx_kb)} color={CYAN} />
          </StatCell>
        </div>
      </section>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
        <ChartCard title="CPU" sub={`Peak ${pct(peakCpu)}% in this range`} value={latest ? `${pct(latest.cpu_pct)}%` : "—"}>
          {!loaded || samples.length === 0 ? <Collecting /> : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={samples.map((s) => ({ ...s, label: tickLabel(s.ts, range) }))} margin={{ top: 4, right: 8, bottom: 0, left: -6 }}>
                <defs>
                  <linearGradient id="m-cpu" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={GREEN} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={GREEN} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} minTickGap={40} />
                <YAxis {...axisProps} width={56} tickCount={4} tickFormatter={(v: number) => (v === 0 ? "0%" : v < 1 ? `${Number(v.toPrecision(2))}%` : `${pct(v)}%`)} />
                <Tooltip content={<ChartTooltip format={(v) => `${pct(v)}%`} />} cursor={{ stroke: "currentColor", strokeOpacity: 0.15 }} />
                <Area type="monotone" dataKey="cpu_pct" name="CPU" stroke={GREEN} strokeWidth={1.75} fill="url(#m-cpu)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Memory" sub={memLimit ? `Limit ${memLimit} MB · peak ${peakMem} MB` : `Peak ${peakMem} MB`} value={latest ? `${latest.memory_mb} MB` : "—"}>
          {!loaded || samples.length === 0 ? <Collecting /> : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={samples.map((s) => ({ ...s, label: tickLabel(s.ts, range) }))} margin={{ top: 4, right: 8, bottom: 0, left: -14 }}>
                <defs>
                  <linearGradient id="m-mem" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CYAN} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={CYAN} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} minTickGap={40} />
                <YAxis {...axisProps} width={48} domain={[0, memLimit ? Math.max(memLimit, peakMem) : "auto"]} />
                <Tooltip content={<ChartTooltip format={(v) => `${v} MB`} />} cursor={{ stroke: "currentColor", strokeOpacity: 0.15 }} />
                <Area type="monotone" dataKey="memory_mb" name="Memory" stroke={CYAN} strokeWidth={1.75} fill="url(#m-mem)" />
                {memLimit ? (
                  <ReferenceLine y={memLimit} stroke="#f87171" strokeDasharray="4 4" label={{ value: "limit", fill: "#f87171", fontSize: 12, position: "insideTopRight" }} />
                ) : null}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Network"
          sub="Traffic between samples"
          value={data.length ? fmtKB(data[data.length - 1].rx_kb + data[data.length - 1].tx_kb) : "—"}
          legend={
            <p className="mt-0.5 flex items-center justify-end gap-3 text-[12.5px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: GREEN }} />In</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: CYAN }} />Out</span>
            </p>
          }
        >
          {!loaded || chartData.length === 0 ? <Collecting /> : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -14 }}>
                <defs>
                  <linearGradient id="m-rx" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={GREEN} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={GREEN} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} minTickGap={40} />
                <YAxis {...axisProps} width={48} tickFormatter={(v: number) => (v === 0 ? "0" : v >= 1024 ? `${(v / 1024).toFixed(0)}M` : `${v.toFixed(0)}k`)} />
                <Tooltip content={<ChartTooltip format={(v) => fmtKB(v)} />} cursor={{ stroke: "currentColor", strokeOpacity: 0.15 }} />
                <Area type="monotone" dataKey="rx_kb" name="In" stroke={GREEN} strokeWidth={1.75} fill="url(#m-rx)" />
                <Area type="monotone" dataKey="tx_kb" name="Out" stroke={CYAN} strokeWidth={1.75} fill="none" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Bandwidth this month */}
        <section className="surface flex flex-col rounded-[20px] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[14.5px] font-semibold tracking-tight">Bandwidth</p>
              <p className="text-[13px] text-muted-foreground">This month</p>
            </div>
            <button type="button" onClick={loadBandwidth} aria-label="Refresh bandwidth" className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          {bandwidth ? (() => {
            const bw = bandwidth;
            const capped = bw.limit_gb > 0;
            const pct = Math.min(bw.pct, 100);
            const hot = bw.exceeded || bw.pct >= 90;
            const warm = !hot && bw.pct >= 75;
            const share = bw.account_gb > 0 ? Math.min(100, (bw.project_gb / bw.account_gb) * 100) : 0;
            return (
              <>
                <div className="mt-4">
                  <p className="flex items-center gap-1.5 text-[13.5px] text-muted-foreground"><Wifi className="h-3.5 w-3.5" /> This project</p>
                  <p className="mt-1.5 text-[28px] font-semibold leading-none tracking-[-0.035em] tabular-nums">{fmtGB(bw.project_gb)}</p>
                  {bw.account_gb > 0 && <p className="mt-1.5 text-[13px] text-muted-foreground tabular-nums">{share.toFixed(0)}% of your account&apos;s traffic</p>}
                </div>
                <div className="mt-auto pt-5">
                  <div className="rounded-2xl bg-foreground/[0.035] p-3.5">
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
                    <p className="mt-3 text-[13px] text-red-600 dark:text-red-400">Limit reached. <Link href="/billing" className="font-medium underline-offset-2 hover:underline">Upgrade</Link> to restore full traffic.</p>
                  ) : capped && bw.pct >= 80 ? (
                    <p className="mt-3 text-[13px] text-amber-700 dark:text-amber-400">Close to this month&apos;s limit.</p>
                  ) : (
                    <Link href="/billing" className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-foreground/80 transition-colors hover:text-foreground">
                      Plan limits <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              </>
            );
          })() : (
            <div className="mt-4 space-y-3" aria-hidden>
              <div className="h-4 w-24 animate-pulse rounded bg-foreground/[0.06]" />
              <div className="h-8 w-32 animate-pulse rounded bg-foreground/[0.06]" />
              <div className="h-16 animate-pulse rounded-2xl bg-foreground/[0.04]" />
            </div>
          )}
        </section>
      </div>

      <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
        <Network className="h-3.5 w-3.5" /> {samples.length ? `${samples.length} samples in this range.` : "No samples yet."} 100% CPU is one full core.
      </p>
    </div>
  );
}
