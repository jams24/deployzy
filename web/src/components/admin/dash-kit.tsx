"use client";

// Shared building blocks for admin dashboards (Overview, Email Validator…):
// count-up numbers, self-drawing sparklines, period deltas, KPI cards, and
// the motion keyframes. All motion is disabled under prefers-reduced-motion.

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

export const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
// Current half vs previous half of the 28-day window.
export function halves(a: number[]) {
  const h = Math.floor(a.length / 2);
  return { prev: sum(a.slice(0, h)), cur: sum(a.slice(h)), recent: a.slice(h) };
}

// ── Motion helpers ────────────────────────────────────────────────────────
const RM_QUERY = "(prefers-reduced-motion: reduce)";
export function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(RM_QUERY); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia(RM_QUERY).matches,
    () => false,
  );
}

// Eases from the previously shown value to the new one (not from 0 on every
// 30s refresh, which would look jittery).
export function CountUp({ value, format }: { value: number; format?: (n: number) => string }) {
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

export function Delta({ cur, prev, span = 14 }: { cur: number; prev: number; span?: number }) {
  if (prev === 0 && cur === 0) return <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground"><Minus className="h-3 w-3" />flat</span>;
  if (prev === 0) return <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"><ArrowUpRight className="h-3 w-3" />new</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  const up = pct >= 0;
  return (
    <span title={`${cur.toLocaleString()} vs ${prev.toLocaleString()} in the previous ${span === 1 ? "day" : `${span} days`}`}
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${
        up ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400"}`}>
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(pct)}%
    </span>
  );
}

// Sparkline that draws itself in (pathLength=1 + dash animation).
export function Sparkline({ data, color }: { data: number[]; color: string }) {
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

export function KpiCard({
  icon: Icon, label, period, value, format, sub, series, color, cur, prev, span, delay, onClick,
}: {
  icon: React.ComponentType<{ className?: string }>; label: string; period?: string; value: number; format?: (n: number) => string;
  sub: React.ReactNode; series?: number[]; color: string; cur?: number; prev?: number; span?: number; delay: number; onClick?: () => void;
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
        {cur !== undefined && prev !== undefined && <span className="shrink-0"><Delta cur={cur} prev={prev} span={span} /></span>}
      </div>
      <div className="mt-3 truncate text-[28px] font-semibold leading-none tracking-tight tabular-nums">
        <CountUp value={value} format={format} />
      </div>
      <div className="mt-1.5 min-h-[16px] truncate text-[11px] text-muted-foreground">{sub}</div>
      {series && <div className="mt-2 -mx-1"><Sparkline data={series} color={color} /></div>}
    </button>
  );
}


// Keyframes used by the dashboards: ov-rise (staggered entrance), ov-draw
// (stroke drawing, needs pathLength=1), ov-fade, ov-grow (bars), ov-ring.
export function DashMotion() {
  return <style>{`
        @keyframes ov-rise { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
        @keyframes ov-draw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
        @keyframes ov-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes ov-grow { from { transform: scaleX(0) } to { transform: scaleX(1) } }
        @keyframes ov-grow-y { from { transform: scaleY(0) } to { transform: scaleY(1) } }
        @keyframes ov-ring { from { opacity: 0 } to { opacity: 1 } }
        .ov-rise { animation: ov-rise .5s cubic-bezier(.2,.7,.2,1) both }
        .ov-draw { stroke-dasharray: 1; animation: ov-draw 1.1s cubic-bezier(.4,0,.2,1) .15s both }
        .ov-fade { animation: ov-fade .9s ease .3s both }
        .ov-grow { transform-origin: left; animation: ov-grow .8s cubic-bezier(.2,.7,.2,1) both }
        .ov-grow-y { transform-origin: bottom; animation: ov-grow-y .7s cubic-bezier(.2,.7,.2,1) both }
        .ov-ring { animation: ov-ring .8s ease .2s both; transition: stroke-dasharray .6s ease }
        @media (prefers-reduced-motion: reduce) { .ov-rise, .ov-draw, .ov-fade, .ov-grow, .ov-grow-y, .ov-ring { animation: none !important } }
      `}</style>;
}
