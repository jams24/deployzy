"use client";

import { useId, type ComponentType, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Shared chart bits for the project Overview / Metrics / Analytics tabs.

export const GREEN = "#34D399";
export const CYAN = "#22D3EE";

export function ChartTooltip({ active, payload, label, format }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
  format?: (v: number, name: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-[var(--dz-hairline)] bg-popover px-3 py-2 text-[12.5px] shadow-xl">
      <p className="mb-1 text-muted-foreground">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="capitalize text-muted-foreground">{p.name}</span>
          <span className="ml-auto pl-3 font-semibold tabular-nums">{format ? format(p.value, p.name) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

// Tiny trend line for stat strips. Flat data still draws a calm baseline.
export function Sparkline({ values, color = GREEN, className }: { values: number[]; color?: string; className?: string }) {
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

// Segmented control for time ranges (and other small mode switches).
export function Segmented<T extends string>({ value, options, onChange, label, className }: {
  value: T;
  options: readonly { id: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("flex h-9 items-center gap-0.5 rounded-full bg-foreground/[0.05] p-0.5", className)}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.id)}
            className={cn(
              "flex h-full flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] font-medium transition-colors",
              on ? "bg-background text-foreground shadow-sm dark:bg-white/[0.1]" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// One cell of a stat strip (a gap-px grid on a hairline background).
export function StatCell({ icon: Icon, label, value, unit, extra, children }: {
  icon: ComponentType<{ className?: string }>; label: string; value: string; unit?: string; extra?: ReactNode; children?: ReactNode;
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

// Axis/grid props shared by every chart so they look the same.
export const gridProps = { strokeDasharray: "3 4", stroke: "currentColor", className: "text-foreground/[0.08]", vertical: false } as const;
export const axisProps = { tick: { fontSize: 12 }, stroke: "currentColor", className: "text-muted-foreground", tickLine: false, axisLine: false } as const;

// Short time label for a chart point; day-level ranges show the date.
export function tickLabel(iso: string, range: string) {
  const d = new Date(iso);
  if (range === "7d" || range === "30d") {
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + (range === "7d" ? ` ${d.toLocaleTimeString([], { hour: "2-digit" })}` : "");
  }
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
