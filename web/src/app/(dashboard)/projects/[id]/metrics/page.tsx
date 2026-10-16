"use client";

// Metrics tab — resource usage over time (CPU / Memory / Network) rendered as
// proper charts, plus the monthly bandwidth usage card.

import { useCallback, useEffect, useState } from "react";
import { Activity, Cpu, MemoryStick, Network } from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useProject } from "@/components/project/project-context";
import {
  API, fmtBytes, fmtGB, headers,
  type Bandwidth, type MetricSample,
} from "@/components/project/project-shared";

const RANGES = ["1h", "6h", "24h", "7d"] as const;

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-[#0d1117] px-3 py-2 text-[11px] font-mono shadow-xl">
      <div className="text-muted-foreground mb-1">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-[#e6edf3]">{p.name}: {typeof p.value === "number" ? p.value.toLocaleString() : p.value}</span>
        </div>
      ))}
    </div>
  );
}

function ChartCard({ title, icon: Icon, current, children }: {
  title: string; icon: React.ComponentType<{ className?: string }>; current: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">{title}</span>
        </div>
        <span className="text-xs font-mono text-muted-foreground">{current}</span>
      </div>
      <div className="mt-3 h-44">{children}</div>
    </div>
  );
}

export default function ProjectMetricsPage() {
  const { project: p } = useProject();
  const [samples, setSamples] = useState<MetricSample[]>([]);
  const [range, setRange] = useState<string>("1h");
  const [bandwidth, setBandwidth] = useState<Bandwidth | null>(null);

  const load = useCallback(async (r: string) => {
    try {
      const res = await fetch(`${API}/api/v1/projects/${p.id}/metrics?range=${r}`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setSamples(Array.isArray(data.samples) ? data.samples : []);
        setRange(r);
      }
    } catch {}
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

  const latest = samples.length ? samples[samples.length - 1] : null;
  const data = samples.map((s) => ({
    ...s,
    label: new Date(s.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    rx_mb: +(s.net_rx_bytes / 1048576).toFixed(2),
    tx_mb: +(s.net_tx_bytes / 1048576).toFixed(2),
  }));

  if (p.status !== "running") {
    return (
      <div className="rounded-2xl border border-dashed border-border p-12 text-center">
        <Activity className="mx-auto h-6 w-6 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">Metrics are collected while the project is running.</p>
        <p className="mt-1 text-xs text-muted-foreground">Current status: <span className="font-medium text-foreground">{p.status}</span></p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Range picker */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {samples.length === 0 ? "Collecting samples…" : `${samples.length} samples`}
        </span>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button key={r} onClick={() => load(r)} className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${range === r ? "border-foreground/30 bg-accent text-foreground" : "border-border/60 text-muted-foreground hover:text-foreground"}`}>{r}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* CPU */}
        <ChartCard title="CPU" icon={Cpu} current={latest ? `${latest.cpu_pct.toFixed(1)}%` : "—"}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="cpu" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border/40" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" tickLine={false} axisLine={false} minTickGap={40} />
              <YAxis tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" tickLine={false} axisLine={false} unit="%" />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="cpu_pct" name="cpu %" stroke="#10b981" strokeWidth={1.5} fill="url(#cpu)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Memory */}
        <ChartCard title="Memory" icon={MemoryStick} current={latest ? `${latest.memory_mb} / ${latest.memory_limit_mb} MB` : "—"}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="mem" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#60a5fa" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border/40" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" tickLine={false} axisLine={false} minTickGap={40} />
              <YAxis tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" tickLine={false} axisLine={false} unit=" MB" />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="memory_mb" name="memory MB" stroke="#60a5fa" strokeWidth={1.5} fill="url(#mem)" />
              {latest?.memory_limit_mb ? (
                <ReferenceLine y={latest.memory_limit_mb} stroke="#f87171" strokeDasharray="4 4" label={{ value: "limit", fill: "#f87171", fontSize: 9, position: "insideTopRight" }} />
              ) : null}
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Network */}
        <ChartCard title="Network" icon={Network} current={latest ? `↓ ${fmtBytes(latest.net_rx_bytes)} · ↑ ${fmtBytes(latest.net_tx_bytes)}` : "—"}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border/40" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" tickLine={false} axisLine={false} minTickGap={40} />
              <YAxis tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" tickLine={false} axisLine={false} unit=" MB" />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="rx_mb" name="in MB" stroke="#fbbf24" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="tx_mb" name="out MB" stroke="#fb923c" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Bandwidth */}
        <div className="rounded-xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="h-3.5 w-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" /></svg>
              <span className="text-xs font-medium">Bandwidth</span>
              <span className="text-[10px] text-muted-foreground">(this month)</span>
            </div>
            <button onClick={loadBandwidth} className="text-[10px] text-muted-foreground hover:text-foreground">refresh</button>
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
    </div>
  );
}
