"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Users, Rocket, Activity, Radio, Globe, HardDrive, AlertTriangle, Flag, Server,
  ArrowUpRight, ArrowDownRight, Minus, UserPlus, CheckCircle2, Loader2,
} from "lucide-react";
import { fmtBytes, timeAgo } from "@/components/admin/pager";

// ── Data ──────────────────────────────────────────────────────────────────
interface Overview {
  series: {
    days: string[]; signups: number[]; deploys_started: number[]; deploys_ok: number[];
    tunnel_sessions: number[]; app_visitors: number[];
  };
  users_total: number; users_paid: number; users_suspended: number; signups_today: number;
  projects_total: number; projects_by_status: Record<string, number>; stacks: Record<string, number>;
  deploys_today: number; deploys_ok_today: number;
  databases: number; tunnels_live: number; bandwidth_month_bytes: number;
  open_abuse: number; servers_active: number; servers_total: number;
  activity: { kind: "signup" | "deploy"; title: string; detail: string; at: string }[];
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
// Current half vs previous half of the 28-day window.
function halves(a: number[]) {
  const h = Math.floor(a.length / 2);
  return { prev: sum(a.slice(0, h)), cur: sum(a.slice(h)), recent: a.slice(h) };
}

// ── Motion helpers ────────────────────────────────────────────────────────
const RM_QUERY = "(prefers-reduced-motion: reduce)";
function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(RM_QUERY); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia(RM_QUERY).matches,
    () => false,
  );
}

// Eases from the previously shown value to the new one (not from 0 on every
// 30s refresh, which would look jittery).
function CountUp({ value, format }: { value: number; format?: (n: number) => string }) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (reduced) { from.current = value; return; }
    const start = performance.now(), a = from.current, dur = 900;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setShown(a + (value - a) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  const n = Math.round(reduced ? value : shown);
  return <>{format ? format(n) : n.toLocaleString()}</>;
}

function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (prev === 0 && cur === 0) return <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground"><Minus className="h-3 w-3" />flat</span>;
  if (prev === 0) return <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"><ArrowUpRight className="h-3 w-3" />new</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  const up = pct >= 0;
  return (
    <span title={`${cur.toLocaleString()} vs ${prev.toLocaleString()} in the previous 14 days`}
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${
        up ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400"}`}>
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(pct)}%
    </span>
  );
}

// Sparkline that draws itself in (pathLength=1 + dash animation).
function Sparkline({ data, color }: { data: number[]; color: string }) {
  const id = useId().replace(/:/g, "");
  const w = 120, h = 36;
  const max = Math.max(1, ...data);
  const pts = data.map((v, i) => [(i / Math.max(1, data.length - 1)) * w, h - 3 - (v / max) * (h - 6)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full overflow-visible" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#g${id})`} className="ov-fade" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round"
        pathLength={1} className="ov-draw" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function KpiCard({
  icon: Icon, label, period, value, format, sub, series, color, cur, prev, delay, onClick,
}: {
  icon: React.ComponentType<{ className?: string }>; label: string; period?: string; value: number; format?: (n: number) => string;
  sub: React.ReactNode; series?: number[]; color: string; cur?: number; prev?: number; delay: number; onClick?: () => void;
}) {
  return (
    <button onClick={onClick} disabled={!onClick}
      className="ov-rise group relative overflow-hidden rounded-2xl border border-border/60 bg-card p-4 text-left transition-all duration-300 enabled:hover:-translate-y-0.5 enabled:hover:border-border enabled:hover:shadow-lg enabled:hover:shadow-black/[0.04] disabled:cursor-default"
      style={{ animationDelay: `${delay}ms` }}>
      <div className="absolute inset-x-0 top-0 h-px opacity-60" style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }} />
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: `${color}1a`, color }}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <span className="truncate">{label}</span>
          {period && <span className="shrink-0 rounded bg-muted px-1 py-px text-[9px] font-medium uppercase tracking-wide">{period}</span>}
        </span>
        {cur !== undefined && prev !== undefined && <span className="shrink-0"><Delta cur={cur} prev={prev} /></span>}
      </div>
      <div className="mt-3 truncate text-[28px] font-semibold leading-none tracking-tight tabular-nums">
        <CountUp value={value} format={format} />
      </div>
      <div className="mt-1.5 min-h-[16px] truncate text-[11px] text-muted-foreground">{sub}</div>
      {series && <div className="mt-2 -mx-1"><Sparkline data={series} color={color} /></div>}
    </button>
  );
}

// ── Main activity chart ───────────────────────────────────────────────────
const METRICS = [
  { key: "deploys", label: "Deploys", color: "#8b5cf6" },
  { key: "signups", label: "Signups", color: "#10b981" },
  { key: "tunnels", label: "Tunnel sessions", color: "#0ea5e9" },
  { key: "traffic", label: "App visitors", color: "#f59e0b" },
] as const;
type MetricKey = (typeof METRICS)[number]["key"];

function ActivityChart({ o }: { o: Overview }) {
  const [metric, setMetric] = useState<MetricKey>("deploys");
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const m = METRICS.find((x) => x.key === metric)!;
  const s = o.series;
  const data = metric === "deploys" ? s.deploys_started : metric === "signups" ? s.signups : metric === "tunnels" ? s.tunnel_sessions : s.app_visitors;
  const secondary = metric === "deploys" ? s.deploys_ok : null; // succeeded overlay

  const W = 720, H = 200, padL = 4, padR = 4, padT = 12, padB = 22;
  const max = Math.max(1, ...data);
  const niceMax = (() => { const p = Math.pow(10, Math.floor(Math.log10(max))); return Math.ceil(max / p) * p; })();
  const x = (i: number) => padL + (i / Math.max(1, data.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / niceMax) * (H - padT - padB);
  const path = (arr: number[]) => arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const id = useId().replace(/:/g, "");

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const rel = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((rel - padL) / (W - padL - padR)) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };
  const total = sum(data);
  const fmtDay = (d: string) => new Date(d + "T00:00:00").toLocaleDateString([], { month: "short", day: "numeric" });

  return (
    <div className="ov-rise rounded-2xl border border-border/60 bg-card p-4 sm:p-5" style={{ animationDelay: "240ms" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Platform activity</p>
          <p className="text-xs text-muted-foreground"><span className="tabular-nums font-medium text-foreground">{total.toLocaleString()}</span> {m.label.toLowerCase()} in the last 28 days</p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg bg-muted/50 p-0.5">
          {METRICS.map((mm) => (
            <button key={mm.key} onClick={() => { setMetric(mm.key); setHover(null); }}
              className={`relative whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
                metric === mm.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: mm.color }} />{mm.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative mt-4">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="h-[200px] w-full" preserveAspectRatio="none"
          onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={`${m.label} per day`}>
          <defs>
            <linearGradient id={`a${id}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={m.color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={m.color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((f) => (
            <line key={f} x1={padL} x2={W - padR} y1={y(niceMax * f)} y2={y(niceMax * f)} className="stroke-border" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
          ))}
          <g key={metric}>
            <path d={`${path(data)} L${x(data.length - 1)},${H - padB} L${x(0)},${H - padB} Z`} fill={`url(#a${id})`} className="ov-fade" />
            <path d={path(data)} fill="none" stroke={m.color} strokeWidth="2" strokeLinejoin="round" pathLength={1} className="ov-draw" vectorEffect="non-scaling-stroke" />
            {secondary && (
              <path d={path(secondary)} fill="none" stroke="#10b981" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.9" vectorEffect="non-scaling-stroke" className="ov-fade" />
            )}
          </g>
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} className="stroke-foreground/30" vectorEffect="non-scaling-stroke" />
            </g>
          )}
        </svg>
        {/* y-axis labels */}
        <div className="pointer-events-none absolute left-1 top-0 flex h-[178px] flex-col justify-between py-1 text-[10px] tabular-nums text-muted-foreground/80">
          <span>{niceMax.toLocaleString()}</span><span>{(niceMax / 2).toLocaleString()}</span><span>0</span>
        </div>
        {hover !== null && (
          <span className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background"
            style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(data[hover]) / H) * 200}px`, background: m.color }} />
        )}
        {hover !== null && (
          <div className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-[11px] shadow-md"
            style={{ left: `${(x(hover) / W) * 100}%` }}>
            <p className="font-medium">{fmtDay(s.days[hover])}</p>
            <p className="tabular-nums" style={{ color: m.color }}>{data[hover].toLocaleString()} {m.label.toLowerCase()}</p>
            {secondary && <p className="tabular-nums text-emerald-600 dark:text-emerald-400">{secondary[hover].toLocaleString()} succeeded</p>}
          </div>
        )}
        <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
          <span>{fmtDay(s.days[0])}</span><span>{fmtDay(s.days[Math.floor(s.days.length / 2)])}</span><span>Today</span>
        </div>
      </div>
      {secondary && (
        <p className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="inline-block h-0 w-4 border-t-2 border-dashed border-emerald-500" /> succeeded
        </p>
      )}
    </div>
  );
}

// ── Health ring ───────────────────────────────────────────────────────────
const STATUS_META: { key: string; label: string; color: string }[] = [
  { key: "running", label: "Running", color: "#10b981" },
  { key: "sleeping", label: "Sleeping", color: "#6366f1" },
  { key: "building", label: "Building", color: "#0ea5e9" },
  { key: "crashed", label: "Crashed", color: "#f97316" },
  { key: "failed", label: "Failed", color: "#ef4444" },
  { key: "stopped", label: "Stopped", color: "#a1a1aa" },
  { key: "created", label: "Not deployed", color: "#d4d4d8" },
];

function HealthRing({ o, onNavigate }: { o: Overview; onNavigate?: (tab: string) => void }) {
  const total = Math.max(1, o.projects_total);
  const R = 52, C = 2 * Math.PI * R;
  const counted = STATUS_META.map((s) => ({ ...s, n: o.projects_by_status[s.key] || 0 })).filter((s) => s.n > 0);
  const segs = counted.map((s, i) => ({
    ...s,
    len: (s.n / total) * C,
    offset: counted.slice(0, i).reduce((a, p) => a + (p.n / total) * C, 0),
  }));
  const online = (o.projects_by_status.running || 0) + (o.projects_by_status.sleeping || 0);
  const ok14 = sum(o.series.deploys_ok.slice(14)), started14 = sum(o.series.deploys_started.slice(14));
  const rate = started14 ? Math.round((ok14 / started14) * 100) : null;
  return (
    <div className="ov-rise rounded-2xl border border-border/60 bg-card p-4 sm:p-5" style={{ animationDelay: "300ms" }}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">App health</p>
        <button onClick={() => onNavigate?.("projects")} className="text-[11px] text-muted-foreground hover:text-foreground">View apps →</button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-5">
        <div className="relative mx-auto h-32 w-32 shrink-0 sm:mx-0">
          <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
            <circle cx="64" cy="64" r={R} fill="none" className="stroke-muted" strokeWidth="12" />
            {segs.map((s) => (
              <circle key={s.key} cx="64" cy="64" r={R} fill="none" stroke={s.color} strokeWidth="12"
                strokeDasharray={`${Math.max(0, s.len - 2)} ${C}`} strokeDashoffset={-s.offset} className="ov-ring" />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-semibold tabular-nums"><CountUp value={online} /></span>
            <span className="text-[10px] text-muted-foreground">online of {o.projects_total}</span>
          </div>
        </div>
        <div className="min-w-[9rem] flex-1 space-y-1">
          {segs.map((s) => (
            <div key={s.key} className="flex items-center gap-2 text-xs">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className="flex-1 truncate whitespace-nowrap text-muted-foreground">{s.label}</span>
              <span className="tabular-nums font-medium">{s.n}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-muted/40 px-3 py-2">
          <p className="truncate text-[10px] text-muted-foreground">Deploy success (14d)</p>
          <p className="mt-0.5 truncate font-semibold tabular-nums">{rate === null ? "—" : `${rate}%`} <span className="font-normal text-muted-foreground">{ok14}/{started14}</span></p>
        </div>
        <div className="rounded-lg bg-muted/40 px-3 py-2">
          <p className="truncate text-[10px] text-muted-foreground">Databases</p>
          <p className="mt-0.5 font-semibold tabular-nums">{o.databases}</p>
        </div>
      </div>
    </div>
  );
}

const STACK_COLORS = ["#10b981", "#8b5cf6", "#f59e0b", "#0ea5e9", "#ec4899", "#14b8a6", "#a1a1aa"];

function Stacks({ o }: { o: Overview }) {
  const entries = Object.entries(o.stacks).sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 6);
  const rest = entries.slice(6).reduce((n, [, v]) => n + v, 0);
  if (rest) top.push(["other", rest]);
  const max = Math.max(1, ...top.map(([, v]) => v));
  const total = Math.max(1, sum(top.map(([, v]) => v)));
  return (
    <div className="ov-rise rounded-2xl border border-border/60 bg-card p-4 sm:p-5" style={{ animationDelay: "360ms" }}>
      <p className="text-sm font-semibold">Stacks</p>
      <div className="mt-3 space-y-2.5">
        {top.map(([k, v], i) => (
          <div key={k}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="capitalize">{k}</span>
              <span className="tabular-nums text-muted-foreground">{v} · {Math.round((v / total) * 100)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="ov-grow h-full rounded-full" style={{ width: `${(v / max) * 100}%`, background: STACK_COLORS[i % STACK_COLORS.length], animationDelay: `${400 + i * 60}ms` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityFeed({ o }: { o: Overview }) {
  return (
    <div className="ov-rise rounded-2xl border border-border/60 bg-card p-4 sm:p-5" style={{ animationDelay: "420ms" }}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Recent activity</p>
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60 motion-reduce:hidden" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" /></span>
          live
        </span>
      </div>
      {o.activity.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">Nothing yet.</p>
      ) : (
        <ol className="mt-3 space-y-0.5">
          {o.activity.map((a, i) => (
            <li key={a.kind + a.at + a.title} className="ov-rise flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/40" style={{ animationDelay: `${460 + i * 40}ms` }}>
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${a.kind === "signup" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-violet-500/10 text-violet-600 dark:text-violet-400"}`}>
                {a.kind === "signup" ? <UserPlus className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs">
                  {a.kind === "signup" ? <>New signup <span className="font-medium">{a.title}</span></> : <>Deployed <span className="font-medium">{a.title}</span></>}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">{a.kind === "signup" ? `${a.detail} plan` : a.detail}</p>
              </div>
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{timeAgo(a.at)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────
export function OverviewDashboard({
  apiBase, headers, refreshKey, onNavigate,
}: {
  apiBase: string; headers: () => Record<string, string>; refreshKey?: number; onNavigate?: (tab: string) => void;
}) {
  const [o, setO] = useState<Overview | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/v1/admin/overview`, { headers: headers() });
      if (!res.ok) { setErr(`Couldn't load overview (HTTP ${res.status})`); return; }
      setO(await res.json()); setErr("");
    } catch { setErr("Couldn't load overview (network error)"); }
  }, [apiBase, headers]);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => { if (alive) load(); }, 0);
    return () => { alive = false; clearTimeout(t); };
  }, [load, refreshKey]);

  const k = useMemo(() => {
    if (!o) return null;
    const s = o.series;
    return {
      signups: halves(s.signups), deploys: halves(s.deploys_started), tunnels: halves(s.tunnel_sessions), traffic: halves(s.app_visitors),
    };
  }, [o]);

  if (err && !o) return <div className="rounded-2xl border border-red-500/30 bg-red-500/5 px-4 py-6 text-center text-sm text-red-600 dark:text-red-400">{err}</div>;
  if (!o || !k) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[150px] animate-pulse rounded-2xl bg-muted/50" />)}
        <div className="col-span-full flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      </div>
    );
  }

  const crashed = (o.projects_by_status.crashed || 0) + (o.projects_by_status.failed || 0);
  const serversDown = o.servers_total - o.servers_active;
  const alerts = [
    o.open_abuse > 0 && { icon: Flag, text: `${o.open_abuse} open abuse report${o.open_abuse === 1 ? "" : "s"}`, tab: "abuse", tone: "red" },
    crashed > 0 && { icon: AlertTriangle, text: `${crashed} app${crashed === 1 ? "" : "s"} crashed or failed`, tab: "projects", tone: "amber" },
    serversDown > 0 && { icon: Server, text: `${serversDown} server${serversDown === 1 ? "" : "s"} offline`, tab: "infra", tone: "zinc" },
  ].filter(Boolean) as { icon: typeof Flag; text: string; tab: string; tone: string }[];

  return (
    <div className="@container space-y-4">
      <style>{`
        @keyframes ov-rise { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
        @keyframes ov-draw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
        @keyframes ov-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes ov-grow { from { transform: scaleX(0) } to { transform: scaleX(1) } }
        @keyframes ov-ring { from { opacity: 0 } to { opacity: 1 } }
        .ov-rise { animation: ov-rise .5s cubic-bezier(.2,.7,.2,1) both }
        .ov-draw { stroke-dasharray: 1; animation: ov-draw 1.1s cubic-bezier(.4,0,.2,1) .15s both }
        .ov-fade { animation: ov-fade .9s ease .3s both }
        .ov-grow { transform-origin: left; animation: ov-grow .8s cubic-bezier(.2,.7,.2,1) both }
        .ov-ring { animation: ov-ring .8s ease .2s both; transition: stroke-dasharray .6s ease }
        @media (prefers-reduced-motion: reduce) { .ov-rise, .ov-draw, .ov-fade, .ov-grow, .ov-ring { animation: none !important } }
      `}</style>

      {alerts.length > 0 && (
        <div className="ov-rise flex flex-wrap gap-2">
          {alerts.map((a) => (
            <button key={a.tab + a.text} onClick={() => onNavigate?.(a.tab)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                a.tone === "red" ? "border-red-500/30 bg-red-500/5 text-red-600 hover:bg-red-500/10 dark:text-red-400"
                : a.tone === "amber" ? "border-amber-500/30 bg-amber-500/5 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"}`}>
              <a.icon className="h-3.5 w-3.5" />{a.text}<span className="opacity-60">→</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 @md:grid-cols-2 @3xl:grid-cols-3 @7xl:grid-cols-6">
        <KpiCard icon={Users} label="Users" value={o.users_total} color="#10b981" delay={0}
          cur={k.signups.cur} prev={k.signups.prev} series={k.signups.recent}
          sub={<><span className="text-foreground">+{k.signups.cur}</span> in 14d · {o.users_paid} paid</>}
          onClick={() => onNavigate?.("users")} />
        <KpiCard icon={Rocket} label="Deploys" period="14d" value={k.deploys.cur} color="#8b5cf6" delay={40}
          cur={k.deploys.cur} prev={k.deploys.prev} series={k.deploys.recent}
          sub={<>today: {o.deploys_ok_today}/{o.deploys_today} succeeded</>} onClick={() => onNavigate?.("projects")} />
        <KpiCard icon={Activity} label="Apps online" value={(o.projects_by_status.running || 0) + (o.projects_by_status.sleeping || 0)} color="#14b8a6" delay={80}
          sub={<>{o.projects_by_status.sleeping || 0} asleep · {o.projects_total} total</>} onClick={() => onNavigate?.("projects")} />
        <KpiCard icon={Radio} label="Tunnel sessions" period="14d" value={k.tunnels.cur} color="#0ea5e9" delay={120}
          cur={k.tunnels.cur} prev={k.tunnels.prev} series={k.tunnels.recent}
          sub={<><span className="text-foreground">{o.tunnels_live}</span> live now</>} onClick={() => onNavigate?.("sessions")} />
        <KpiCard icon={Globe} label="App visitors" period="14d" value={k.traffic.cur} color="#f59e0b" delay={160}
          cur={k.traffic.cur} prev={k.traffic.prev} series={k.traffic.recent}
          sub={<>daily uniques, all apps</>} />
        <KpiCard icon={HardDrive} label="Bandwidth" period="month" value={o.bandwidth_month_bytes} format={fmtBytes} color="#ec4899" delay={200}
          sub={<>{o.servers_active}/{o.servers_total} platform servers up</>} onClick={() => onNavigate?.("infra")} />
      </div>

      <div className="grid gap-4 @5xl:grid-cols-3">
        <div className="min-w-0 @5xl:col-span-2"><ActivityChart o={o} /></div>
        <HealthRing o={o} onNavigate={onNavigate} />
      </div>
      <div className="grid gap-4 @3xl:grid-cols-2">
        <ActivityFeed o={o} />
        <Stacks o={o} />
      </div>
    </div>
  );
}
