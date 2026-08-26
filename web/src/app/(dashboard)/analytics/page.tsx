"use client";

import { useEffect, useState } from "react";
import { WebsiteAnalytics } from "@/components/website-analytics";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  BarChart3,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ─────────────────────────────────────────────────────────────────────────────
// Analytics — request metrics for tunnels/traffic. Data flow unchanged;
// presentation rebuilt with the Deployzy 2.0 card language (both themes).
// ─────────────────────────────────────────────────────────────────────────────

interface Analytics {
  total_requests: number;
  success_count: number;
  error_count: number;
  avg_duration_ms: number;
  total_bytes_in: number;
  total_bytes_out: number;
  method_breakdown: Record<string, number>;
  status_breakdown: Record<string, number>;
  top_paths: { path: string; count: number }[];
  timeline: { time: string; total: number; success: number; error: number }[];
}

const periods = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "30d", hours: 720 },
];

const methodColors: Record<string, string> = {
  GET: "bg-sky-500",
  POST: "bg-emerald-500",
  PUT: "bg-amber-500",
  PATCH: "bg-orange-500",
  DELETE: "bg-red-500",
  HEAD: "bg-violet-500",
  OPTIONS: "bg-zinc-400",
};

const statusColors: Record<string, string> = {
  "2xx": "bg-emerald-500",
  "3xx": "bg-sky-500",
  "4xx": "bg-amber-500",
  "5xx": "bg-red-500",
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(24);

  async function load(hours: number) {
    setLoading(true);
    try {
      const token = localStorage.getItem("sm_token");
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081"}/api/v1/analytics?hours=${hours}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) setData(await res.json());
    } catch {}
    setLoading(false);
  }

  useEffect(() => {
    load(period);
  }, [period]);

  const successRate =
    data && data.total_requests > 0
      ? ((data.success_count / data.total_requests) * 100).toFixed(1)
      : "0";

  const maxTimeline = data?.timeline
    ? Math.max(...data.timeline.map((t) => t.total), 1)
    : 1;

  return (
    <div className="animate-fade-in-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Account</p>
          <h1 className="mt-1 text-[22px] sm:text-[26px] font-bold tracking-[-0.02em]">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Request metrics and traffic insights.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center rounded-lg border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-0.5">
            {periods.map((p) => (
              <button
                key={p.hours}
                onClick={() => setPeriod(p.hours)}
                className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                  period === p.hours
                    ? "bg-accent text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => load(period)} className="h-8 w-8 p-0 rounded-lg" title="Refresh">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* First-party website traffic (deployzy.com) — self-hides for non-admins */}
      <WebsiteAnalytics />

      {loading && !data ? (
        <div className="mt-12 text-center text-sm text-muted-foreground animate-pulse">Loading analytics…</div>
      ) : !data || data.total_requests === 0 ? (
        <div className="relative mt-8 rounded-2xl border border-dashed border-border overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute -top-20 left-1/2 h-40 w-[380px] -translate-x-1/2 rounded-full bg-emerald-500/[0.07] blur-[80px] dark:bg-emerald-400/[0.08]" />
          <div className="relative flex flex-col items-center py-16 px-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/70 bg-card">
              <BarChart3 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h3 className="mt-4 font-semibold">No data yet</h3>
            <p className="mt-2 text-sm text-muted-foreground text-center max-w-sm">
              Send some requests through your tunnels to see analytics.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Stat Cards */}
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Total Requests"
              value={data.total_requests.toLocaleString()}
              icon={<Activity className="h-3.5 w-3.5" />}
              delay={0}
            />
            <StatCard
              title="Success Rate"
              value={`${successRate}%`}
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              sub={`${data.success_count.toLocaleString()} ok · ${data.error_count.toLocaleString()} errors`}
              delay={60}
            />
            <StatCard
              title="Avg Duration"
              value={`${data.avg_duration_ms.toFixed(1)}ms`}
              icon={<Clock className="h-3.5 w-3.5" />}
              delay={120}
            />
            <StatCard
              title="Bandwidth"
              value={formatBytes(data.total_bytes_in + data.total_bytes_out)}
              icon={<ArrowUpRight className="h-3.5 w-3.5" />}
              sub={`${formatBytes(data.total_bytes_in)} in · ${formatBytes(data.total_bytes_out)} out`}
              delay={180}
            />
          </div>

          {/* Timeline Chart */}
          {data.timeline && data.timeline.length > 0 && (
            <div className="mt-6 rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 overflow-hidden">
              <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Request Timeline</p>
                <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" /> Success
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-red-500" /> Error
                  </span>
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-end gap-1 h-40">
                  {data.timeline.map((point, i) => (
                    <div
                      key={i}
                      className="flex-1 flex flex-col items-center gap-0.5 group"
                      title={`${point.time}: ${point.total} requests (${point.success} ok, ${point.error} errors)`}
                    >
                      <div className="w-full flex flex-col-reverse" style={{ height: "100%" }}>
                        <div
                          className="w-full bg-emerald-500/70 rounded-t-sm transition-all group-hover:bg-emerald-500"
                          style={{
                            height: `${(point.success / maxTimeline) * 100}%`,
                            minHeight: point.success > 0 ? "2px" : "0",
                          }}
                        />
                        <div
                          className="w-full bg-red-500/70 rounded-t-sm transition-all group-hover:bg-red-500"
                          style={{
                            height: `${(point.error / maxTimeline) * 100}%`,
                            minHeight: point.error > 0 ? "2px" : "0",
                          }}
                        />
                      </div>
                      <span className="text-[9px] text-muted-foreground">
                        {i % Math.max(1, Math.floor(data.timeline.length / 8)) === 0
                          ? point.time
                          : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Breakdowns */}
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            {/* Method breakdown */}
            <BreakdownCard title="Methods">
              {Object.entries(data.method_breakdown)
                .sort(([, a], [, b]) => b - a)
                .map(([method, count]) => (
                  <div key={method} className="flex items-center gap-3">
                    <Badge
                      variant="outline"
                      className="w-16 justify-center font-mono text-[10px] shrink-0"
                    >
                      {method}
                    </Badge>
                    <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${methodColors[method] || "bg-zinc-400"}`}
                        style={{
                          width: `${(count / data.total_requests) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="text-[11px] text-muted-foreground w-12 text-right tabular-nums">
                      {count}
                    </span>
                  </div>
                ))}
            </BreakdownCard>

            {/* Status breakdown */}
            <BreakdownCard title="Status Codes">
              {Object.entries(data.status_breakdown)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([status, count]) => (
                  <div key={status} className="flex items-center gap-3">
                    <Badge
                      variant="outline"
                      className="w-12 justify-center font-mono text-[10px] shrink-0"
                    >
                      {status}
                    </Badge>
                    <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${statusColors[status] || "bg-zinc-400"}`}
                        style={{
                          width: `${(count / data.total_requests) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="text-[11px] text-muted-foreground w-12 text-right tabular-nums">
                      {count}
                    </span>
                  </div>
                ))}
            </BreakdownCard>

            {/* Top paths */}
            <BreakdownCard title="Top Paths">
              {data.top_paths && data.top_paths.length > 0 ? (
                <div className="space-y-1.5">
                  {data.top_paths.map((p, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2"
                    >
                      <span className="font-mono text-[11px] truncate flex-1 text-foreground/80">
                        {p.path}
                      </span>
                      <span className="text-[11px] text-muted-foreground ml-2 tabular-nums">
                        {p.count}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No path data</p>
              )}
            </BreakdownCard>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  sub,
  delay = 0,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  sub?: string;
  delay?: number;
}) {
  return (
    <div
      className="animate-fade-in-up group rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 px-4 py-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[0_12px_32px_-16px_rgba(0,0,0,0.2)] dark:hover:shadow-[0_12px_32px_-16px_rgba(0,0,0,0.6)]"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground transition-colors duration-300 group-hover:border-emerald-500/40 group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
          {icon}
        </span>
      </div>
      <p className="text-[26px] font-bold tracking-tight leading-none tabular-nums">{value}</p>
      <p className="mt-1.5 text-[11px] text-muted-foreground truncate">
        {title}
        {sub && <span className="text-muted-foreground/50"> · {sub}</span>}
      </p>
    </div>
  );
}

function BreakdownCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">{title}</p>
      </div>
      <div className="p-4 space-y-2.5">{children}</div>
    </div>
  );
}
