"use client";

import {
  Boxes, Check, Clock, Cpu, Database, FolderGit2, GitBranch, Globe,
  HardDrive, Hammer, Link2, MemoryStick, Wifi, X,
} from "lucide-react";
import type { UsageResponse } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Plan usage — every metered limit as an icon row with a threshold-colored
// bar, plus the fixed caps (RAM/CPU/bandwidth/builds) and capability flags.
// Bars turn amber ≥70% and red ≥90% so limits are felt before they're hit.
// ─────────────────────────────────────────────────────────────────────────────

const fmt = (n: number) => (n < 0 ? "∞" : String(n));

function Meter({ icon: Icon, label, used, max }: { icon: typeof Globe; label: string; used: number; max: number }) {
  const unl = max < 0;
  const pct = unl ? 0 : Math.min(100, Math.round((used / Math.max(1, max)) * 100));
  const bar = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted/40">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13px] font-medium">{label}</span>
          <span className={`text-[11px] tabular-nums ${pct >= 90 ? "font-semibold text-red-500" : "text-muted-foreground"}`}>
            {used} / {fmt(max)}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border/60">
          <div
            className={`h-full rounded-full transition-all duration-700 ${unl ? "w-full bg-emerald-500/30" : bar}`}
            style={{ width: unl ? "100%" : `${Math.max(pct, used > 0 ? 3 : 0)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export function UsageMeters({ usage }: { usage: UsageResponse }) {
  const l = usage.limits;
  const u = usage.usage;

  const meters = [
    { icon: FolderGit2, label: "Projects", used: u.projects ?? 0, max: l.max_projects },
    { icon: Database, label: "Databases", used: u.databases ?? 0, max: l.max_databases },
    { icon: Boxes, label: "Services", used: u.services ?? 0, max: l.max_services },
    { icon: Globe, label: "Subdomains", used: u.subdomains ?? 0, max: l.max_subdomains },
    { icon: Link2, label: "Custom domains", used: u.custom_domains ?? 0, max: l.max_custom_domains },
    { icon: Clock, label: "Cron jobs", used: u.crons ?? 0, max: l.max_crons },
    { icon: HardDrive, label: "BYOC servers", used: u.byoc_servers ?? 0, max: l.max_byoc_servers },
    { icon: GitBranch, label: "PR previews", used: u.preview_deploys ?? 0, max: l.max_preview_deploys },
  ];

  const caps = [
    {
      icon: MemoryStick, label: "Memory / project",
      value: l.max_memory_mb < 0 ? "∞" : l.max_memory_mb >= 1024 ? `${+(l.max_memory_mb / 1024).toFixed(1)} GB` : `${l.max_memory_mb} MB`,
    },
    { icon: Cpu, label: "CPU / project", value: l.max_cpus < 0 ? "∞" : `${l.max_cpus} vCPU` },
    { icon: Wifi, label: "Bandwidth / mo", value: l.max_bandwidth_gb < 0 ? "∞" : `${l.max_bandwidth_gb} GB` },
    { icon: Hammer, label: "Build min / mo", value: l.max_build_minutes_monthly < 0 ? "∞" : String(l.max_build_minutes_monthly) },
  ];

  const flags: [string, boolean][] = [
    ["Previews", l.allow_previews],
    ["Release cmds", l.allow_release_cmd],
    ["Health checks", l.allow_health_checks],
    ["Private repos", l.allow_private_repos],
    ["TCP tunnels", l.allow_tcp_tunnels],
    ["Live logs", l.allow_live_logs],
  ];

  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Plan usage</p>
        {usage.is_admin && (
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
            Unlimited
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-x-4 gap-y-1 p-3 sm:grid-cols-2">
        {meters.map((m) => <Meter key={m.label} {...m} />)}
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-border/60 p-3 sm:grid-cols-4">
        {caps.map((c) => (
          <div key={c.label} className="flex items-center gap-2.5 rounded-xl border border-border/50 px-3 py-2.5">
            <c.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="truncate text-[10px] text-muted-foreground">{c.label}</div>
              <div className="text-[13px] font-semibold tabular-nums">{c.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5 border-t border-border/60 px-4 py-3">
        {flags.map(([label, on]) => (
          <span
            key={label}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
              on
                ? "border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-600 dark:text-emerald-400"
                : "border-border/50 text-muted-foreground/70"
            }`}
          >
            {on ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
            {label}
          </span>
        ))}
      </div>
    </section>
  );
}
