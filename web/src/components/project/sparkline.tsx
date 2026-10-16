"use client";

// Sparkline renders a tiny inline SVG line chart for stat cards (the big charts
// on Metrics/Analytics/Overview use recharts — this is only for mini previews).
export function Sparkline({ values, color, height = 32 }: { values: number[]; color: string; height?: number }) {
  if (!values.length) return <div style={{ height }} className="w-full rounded bg-muted" />;
  const w = 160;
  const max = Math.max(...values, 0.0001);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 0.0001);
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * (height - 2) - 1).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} />
    </svg>
  );
}
