"use client";

// Analytics tab — privacy-first website analytics for this project: a stat
// strip, the traffic chart and the top lists (pages, referrers, countries,
// browsers, OS, devices), plus the optional client snippet.

import { useCallback, useEffect, useState } from "react";
import {
  AppWindow, Bot, Check, ChevronDown, Copy, Eye, FileText, Globe, Link2, Monitor,
  MousePointerClick, Smartphone, Repeat2, type LucideIcon,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import { useProject } from "@/components/project/project-context";
import {
  CYAN, ChartTooltip, GREEN, Segmented, Sparkline, StatCell, axisProps, gridProps, tickLabel,
} from "@/components/project/charts";
import { API, fmtNum, headers, type SiteOverview, type SiteTopRow } from "@/components/project/project-shared";

const RANGES = [
  { id: "24h", label: "24 hours" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
] as const;
type Range = (typeof RANGES)[number]["id"];

const TOP_FIELDS: { field: string; label: string; icon: LucideIcon; mono?: boolean }[] = [
  { field: "path", label: "Pages", icon: FileText, mono: true },
  { field: "referrer", label: "Referrers", icon: Link2 },
  { field: "country", label: "Countries", icon: Globe },
  { field: "browser", label: "Browsers", icon: AppWindow },
  { field: "os", label: "Operating systems", icon: Monitor },
  { field: "device", label: "Devices", icon: Smartphone },
];

function flag(cc: string) {
  if (!cc || cc.length !== 2) return "🌐";
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}
let regionNames: Intl.DisplayNames | null = null;
function countryName(cc: string) {
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(cc.toUpperCase()) || cc;
  } catch { return cc; }
}
const OS_LABEL: Record<string, string> = { windows: "Windows", macos: "macOS", linux: "Linux", ios: "iOS", android: "Android" };
function labelFor(field: string, key: string) {
  if (!key) return field === "referrer" ? "Direct / none" : "Unknown";
  if (field === "country") return key.length === 2 ? `${flag(key)}  ${countryName(key)}` : key;
  if (field === "os") return OS_LABEL[key] ?? key[0].toUpperCase() + key.slice(1);
  if (field === "browser" || field === "device") return key[0].toUpperCase() + key.slice(1);
  return key;
}

function TopList({ label, icon: Icon, field, mono, rows, loaded }: {
  label: string; icon: LucideIcon; field: string; mono?: boolean; rows: SiteTopRow[]; loaded: boolean;
}) {
  const [all, setAll] = useState(false);
  const max = rows.length ? Math.max(...rows.map((r) => r.count)) : 1;
  const total = rows.reduce((a, r) => a + r.count, 0);
  const shown = all ? rows : rows.slice(0, 6);
  return (
    <section className="surface flex flex-col rounded-[20px] p-4 sm:p-5">
      <p className="flex items-center gap-2 text-[14.5px] font-semibold tracking-tight"><Icon className="h-4 w-4 text-muted-foreground" /> {label}</p>
      {rows.length === 0 ? (
        <p className="mt-3 flex flex-1 items-center justify-center rounded-2xl border border-dashed border-[var(--dz-hairline)] px-4 py-6 text-center text-[13px] text-muted-foreground">
          {loaded ? "Nothing recorded in this range." : "Loading…"}
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {shown.map((row) => (
            <li key={row.key} className="relative overflow-hidden rounded-lg">
              <div className="absolute inset-y-0 left-0 rounded-lg bg-brand/[0.13] dark:bg-brand/[0.16]" style={{ width: `${Math.max((row.count / max) * 100, 2)}%` }} aria-hidden />
              <div className="relative flex items-center justify-between gap-3 px-2.5 py-1.5 text-[13.5px]">
                <span className={cn("min-w-0 truncate", mono && "font-mono text-[13px]", !row.key && "text-muted-foreground")} title={row.key || undefined}>{labelFor(field, row.key)}</span>
                <span className="shrink-0 tabular-nums">
                  {row.count.toLocaleString()}
                  <span className="ml-1.5 hidden text-[12px] text-muted-foreground min-[380px]:inline">{total ? Math.round((row.count / total) * 100) : 0}%</span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 6 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 inline-flex items-center gap-1 self-start text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">
          {all ? "Show less" : `Show all ${rows.length}`} <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", all && "rotate-180")} />
        </button>
      )}
    </section>
  );
}

const SNIPPET = '<script defer src="/__sm/analytics.js"></script>';

export default function ProjectAnalyticsPage() {
  const { project: p } = useProject();
  const [data, setData] = useState<SiteOverview | null>(null);
  const [range, setRange] = useState<Range>("24h");
  const [top, setTop] = useState<Record<string, SiteTopRow[]>>({});
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (r: Range) => {
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
    setLoaded(true);
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

  const ts = (data?.timeseries || []).map((t) => ({ ...t, label: tickLabel(t.ts, range) }));
  const hasTraffic = ts.some((t) => t.pageviews > 0 || t.visitors > 0);
  const pv = data?.overview?.pageviews || 0;
  const vis = data?.overview?.visitors || 0;
  const bots = data?.overview?.bots || 0;
  const live = data?.realtime?.visitors || 0;
  const rangeLabel = RANGES.find((r) => r.id === range)?.label.toLowerCase();

  const copySnippet = () => {
    navigator.clipboard?.writeText(SNIPPET).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }).catch(() => {});
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {live > 0 ? (
          <p className="inline-flex items-center gap-2 rounded-full bg-brand/10 px-3 py-1 text-[13.5px] font-medium text-[var(--dz-green-strong)] dark:text-brand">
            <span className="relative inline-flex h-2 w-2"><span className="live-dot bg-brand" aria-hidden /></span>
            {live} visitor{live === 1 ? "" : "s"} right now
          </p>
        ) : (
          <p className="text-[13.5px] text-muted-foreground">Cookieless analytics, collected at the edge.</p>
        )}
        <Segmented label="Time range" value={range} options={RANGES} onChange={(r) => load(r)} className="w-full sm:w-auto" />
      </div>

      {/* Stat strip */}
      <section className="surface overflow-hidden rounded-[20px]">
        <div className="grid grid-cols-2 gap-px bg-[var(--dz-hairline)] lg:grid-cols-4">
          <StatCell icon={Eye} label="Unique visitors" value={fmtNum(vis)}>
            <Sparkline values={ts.map((t) => t.visitors)} />
          </StatCell>
          <StatCell icon={MousePointerClick} label="Pageviews" value={fmtNum(pv)}>
            <Sparkline values={ts.map((t) => t.pageviews)} color={CYAN} />
          </StatCell>
          <StatCell icon={Repeat2} label="Views per visitor" value={vis ? (pv / vis).toFixed(1) : "—"}>
            <p className="text-[12.5px] text-muted-foreground">How deep people read</p>
          </StatCell>
          <StatCell icon={Bot} label="Bots filtered" value={fmtNum(bots)}>
            <p className="text-[12.5px] text-muted-foreground">{pv + bots > 0 ? `${Math.round((bots / (pv + bots)) * 100)}% of all hits` : "Not counted above"}</p>
          </StatCell>
        </div>
      </section>

      {/* Traffic */}
      <section className="surface overflow-hidden rounded-[20px]">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-4 sm:px-5 sm:pt-5">
          <div className="min-w-0">
            <p className="text-[14.5px] font-semibold tracking-tight">Traffic</p>
            <p className="text-[13px] text-muted-foreground">Last {rangeLabel}</p>
          </div>
          <div className="flex items-center gap-4 text-[13px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: GREEN }} />Visitors</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: CYAN }} />Pageviews</span>
          </div>
        </div>
        <div className="relative h-64 px-2 pb-3 pt-4 sm:px-3">
          {!hasTraffic ? (
            <div className="relative flex h-full flex-col items-center justify-center px-4 text-center">
              <div aria-hidden className="absolute inset-x-3 inset-y-4 flex flex-col justify-between">
                {[0, 1, 2, 3].map((i) => <div key={i} className="border-t border-dashed border-[var(--dz-hairline)]" />)}
              </div>
              <span className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-background shadow-sm ring-1 ring-[var(--dz-hairline)]">
                <Eye className="h-4 w-4 text-muted-foreground" />
              </span>
              <p className="relative mt-3 text-[14.5px] font-semibold">{loaded ? `No visits in the last ${rangeLabel}` : "Loading…"}</p>
              {loaded && <p className="relative mt-1 max-w-xs text-[13.5px] text-muted-foreground">Visits to {p.subdomain}.deployzy.app and your domains show up here within a minute.</p>}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={ts} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <defs>
                  <linearGradient id="an-pv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CYAN} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={CYAN} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="an-vs" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={GREEN} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={GREEN} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} minTickGap={40} />
                <YAxis {...axisProps} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: "currentColor", strokeOpacity: 0.15 }} />
                <Area type="monotone" dataKey="pageviews" stroke={CYAN} strokeWidth={1.75} fill="url(#an-pv)" name="pageviews" />
                <Area type="monotone" dataKey="visitors" stroke={GREEN} strokeWidth={1.75} fill="url(#an-vs)" name="visitors" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* Top lists — one quiet note instead of six empty cards before the first visit */}
      {loaded && TOP_FIELDS.every((f) => !(top[f.field] || []).length) ? (
        <p className="rounded-[20px] border border-dashed border-[var(--dz-hairline)] px-4 py-5 text-center text-[13.5px] text-muted-foreground">
          Top pages, referrers, countries, browsers and devices appear here after the first visits.
        </p>
      ) : (
        <div className="grid gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3">
          {TOP_FIELDS.map((f) => (
            <TopList key={f.field} {...f} rows={top[f.field] || []} loaded={loaded} />
          ))}
        </div>
      )}

      {/* Privacy + snippet */}
      <section className="surface rounded-[20px]">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 sm:px-5 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">
              <span className="block text-[14.5px] font-semibold tracking-tight">Track client-side routes and events</span>
              <span className="block text-[13px] text-muted-foreground">Optional. Server-side capture already counts every page load.</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-3 border-t border-[var(--dz-hairline)] px-4 py-4 text-[13.5px] sm:px-5">
            <p className="text-muted-foreground">Single-page apps that change routes without a full load can add this tag:</p>
            <div className="dark flex items-center gap-2 rounded-xl bg-[#0b0c10] py-2 pl-3.5 pr-2 text-white">
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12.5px] text-white/85">{SNIPPET}</code>
              <button type="button" onClick={copySnippet} aria-label="Copy snippet" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white">
                {copied ? <Check className="h-3.5 w-3.5 text-brand" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
            <p className="text-muted-foreground">
              Then send custom events with <code className="rounded bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[12.5px] text-foreground">window.sm.track(&quot;signup&quot;, {"{ plan: \"pro\" }"})</code>.
            </p>
          </div>
        </details>
      </section>

      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        No cookies. Visitor IDs rotate daily and can&apos;t be linked across days. Requests for CSS, JS and images aren&apos;t counted as pageviews.
      </p>
    </div>
  );
}
