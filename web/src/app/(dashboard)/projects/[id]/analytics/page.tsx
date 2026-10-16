"use client";

// Analytics tab — privacy-first website analytics for this project: headline
// numbers, traffic-over-time chart and the top-lists (pages, referrers,
// countries, browsers, OS, devices).

import { useCallback, useEffect, useState } from "react";
import { BarChart3, Eye, MousePointerClick, Bot } from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useProject } from "@/components/project/project-context";
import {
  API, fmtNum, headers, type SiteOverview, type SiteTopRow,
} from "@/components/project/project-shared";

const RANGES = ["24h", "7d", "30d"] as const;
const TOP_FIELDS = [
  { field: "path", label: "Top pages" },
  { field: "referrer", label: "Top referrers" },
  { field: "country", label: "Top countries" },
  { field: "browser", label: "Browsers" },
  { field: "os", label: "Operating systems" },
  { field: "device", label: "Devices" },
] as const;

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

export default function ProjectAnalyticsPage() {
  const { project: p } = useProject();
  const [data, setData] = useState<SiteOverview | null>(null);
  const [range, setRange] = useState<string>("24h");
  const [top, setTop] = useState<Record<string, SiteTopRow[]>>({});

  const load = useCallback(async (r: string) => {
    try {
      const fields = TOP_FIELDS.map((f) => f.field);
      const [oRes, ...topReses] = await Promise.all([
        fetch(`${API}/api/v1/projects/${p.id}/analytics?range=${r}`, { headers: headers() }),
        ...fields.map((f) =>
          fetch(`${API}/api/v1/projects/${p.id}/analytics/top?field=${f}&range=${r}`, { headers: headers() }),
        ),
      ]);
      if (oRes.ok) {
        setData(await oRes.json());
        setRange(r);
      }
      const topByField: Record<string, SiteTopRow[]> = {};
      for (let i = 0; i < topReses.length; i++) {
        if (topReses[i].ok) {
          const rows = await topReses[i].json();
          topByField[fields[i]] = Array.isArray(rows) ? rows : [];
        }
      }
      setTop(topByField);
    } catch {}
  }, [p.id]);

  // Deferred so the mount effect doesn't synchronously trigger a setState.
  useEffect(() => {
    const t = setTimeout(() => load("24h"), 0);
    return () => clearTimeout(t);
  }, [load]);

  // Refresh every 30s — the realtime counter should feel live.
  useEffect(() => {
    const t = setInterval(() => load(range), 30000);
    return () => clearInterval(t);
  }, [load, range]);

  const ts = (data?.timeseries || []).map((t) => ({
    ...t,
    label: new Date(t.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  }));

  return (
    <div className="space-y-4">
      {/* Header row: live badge + range picker */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <BarChart3 className="h-3.5 w-3.5" />
          {data?.realtime?.visitors ? (
            <span className="flex items-center gap-1 text-emerald-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {data.realtime.visitors} visitor{data.realtime.visitors === 1 ? "" : "s"} right now
            </span>
          ) : (
            <span>Cookieless, privacy-first analytics</span>
          )}
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button key={r} onClick={() => load(r)} className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${range === r ? "border-foreground/30 bg-accent text-foreground" : "border-border/60 text-muted-foreground hover:text-foreground"}`}>{r}</button>
          ))}
        </div>
      </div>

      {/* Headline metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-4">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <MousePointerClick className="h-3 w-3" /> Pageviews
          </div>
          <div className="mt-1.5 text-xl font-semibold font-mono">{fmtNum(data?.overview?.pageviews || 0)}</div>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-4">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <Eye className="h-3 w-3" /> Unique visitors
          </div>
          <div className="mt-1.5 text-xl font-semibold font-mono text-emerald-500">{fmtNum(data?.overview?.visitors || 0)}</div>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-4">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <Bot className="h-3 w-3" /> Bots filtered
          </div>
          <div className="mt-1.5 text-xl font-semibold font-mono text-muted-foreground">{fmtNum(data?.overview?.bots || 0)}</div>
        </div>
      </div>

      {/* Traffic over time */}
      <div className="rounded-xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium">Traffic over time</span>
          <span className="text-[10px] text-muted-foreground">pageviews · visitors</span>
        </div>
        <div className="mt-3 h-56">
          {ts.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No traffic recorded in this range yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={ts} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                <defs>
                  <linearGradient id="apv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#60a5fa" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="avs" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border/40" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="pageviews" stroke="#60a5fa" strokeWidth={1.5} fill="url(#apv)" />
                <Area type="monotone" dataKey="visitors" stroke="#10b981" strokeWidth={1.5} fill="url(#avs)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Top lists */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {TOP_FIELDS.map(({ field, label }) => {
          const rows = top[field] || [];
          const maxC = rows.length ? Math.max(...rows.map((r) => r.count)) : 1;
          return (
            <div key={field} className="rounded-xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 px-3 py-2.5 space-y-1">
              <div className="text-[10px] text-muted-foreground">{label}</div>
              {rows.length === 0 && <div className="text-[10px] text-muted-foreground py-1">No data yet</div>}
              {rows.slice(0, 6).map((row) => (
                <div key={row.key} className="relative text-[11px] py-0.5">
                  <div className="absolute inset-y-0 left-0 bg-emerald-500/20 rounded" style={{ width: `${(row.count / maxC) * 100}%` }} />
                  <div className="relative flex justify-between items-baseline px-1.5 font-mono">
                    <span className="truncate pr-2 text-foreground">{row.key || "(direct)"}</span>
                    <span className="text-zinc-500 tabular-nums">{row.count}</span>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground">Cookieless, privacy-first. Visitor IDs rotate daily and can&apos;t be linked across days. Asset requests (CSS/JS/images) are excluded from pageview counts.</p>

      {/* Optional JS snippet for SPA route changes + custom events */}
      <details className="text-[10px] text-zinc-500">
        <summary className="cursor-pointer hover:text-foreground py-1">Track SPA routes &amp; custom events (optional JS snippet)</summary>
        <div className="mt-1 space-y-2 pl-2 border-l border-border">
          <p>Server-side capture covers every HTTP request automatically. For client-side routing (SPAs) and custom events, add this tag to your site:</p>
          <code className="block rounded bg-black px-2 py-1.5 font-mono text-[10px] text-muted-foreground break-all">
            &lt;script defer src=&quot;/__sm/analytics.js&quot;&gt;&lt;/script&gt;
          </code>
          <p>Then call <code className="text-emerald-400">window.sm.track(&quot;signup&quot;, {"{ plan: \"pro\" }"})</code> for custom events.</p>
        </div>
      </details>
    </div>
  );
}
