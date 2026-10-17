"use client";

import {
  Boxes, Check, Clock, Cpu, Database, FolderGit2, GitBranch, Globe,
  HardDrive, Hammer, Link2, MemoryStick, Wifi, X, CalendarClock,
} from "lucide-react";
import { DashMotion } from "@/components/admin/dash-kit";
import type { UsageResponse } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Plan usage. "This month" shows consumption against the metered caps
// (bandwidth, build minutes, largest database) as rings; then every counted
// limit as a bar (amber ≥70%, red ≥90%), the per-project caps, and feature
// flags. Unlimited plans show real usage, not a full bar.
// ─────────────────────────────────────────────────────────────────────────────

const fmt = (n: number) => (n < 0 ? "∞" : n.toLocaleString());
const fmtBytes = (b: number) => {
  if (b < 1024 ** 2) return `${Math.round(b / 1024)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(0)} MB`;
  return `${(b / 1024 ** 3).toFixed(b < 10 * 1024 ** 3 ? 2 : 1)} GB`;
};
const fmtMB = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);
const tone = (pct: number) => (pct >= 90 ? "#ef4444" : pct >= 70 ? "#f59e0b" : "#10b981");

function Ring({ icon: Icon, label, value, cap, pct, unlimited, delay }: {
  icon: typeof Globe; label: string; value: string; cap: string; pct: number; unlimited: boolean; delay: number;
}) {
  const R = 30, C = 2 * Math.PI * R;
  const p = unlimited ? 0 : Math.min(100, pct);
  return (
    <div className="ov-rise flex items-center gap-4 rounded-2xl border border-border/60 bg-card/60 p-4 dark:bg-[#0c0d0f]/40" style={{ animationDelay: `${delay}ms` }}>
      <div className="relative h-[72px] w-[72px] shrink-0">
        <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90">
          <circle cx="36" cy="36" r={R} fill="none" className="stroke-muted" strokeWidth="7" />
          {!unlimited && (
            <circle cx="36" cy="36" r={R} fill="none" stroke={tone(p)} strokeWidth="7" strokeLinecap="round"
              strokeDasharray={`${(p / 100) * C} ${C}`} className="ov-ring" style={{ transition: "stroke-dasharray .8s ease" }} />
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          {unlimited ? <span className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">∞</span>
            : <span className="text-[13px] font-semibold tabular-nums">{Math.round(p)}%</span>}
        </div>
      </div>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</p>
        <p className="mt-0.5 text-xl font-semibold tabular-nums">{value}</p>
        <p className="text-[11px] text-muted-foreground">{unlimited ? "no limit on your plan" : `of ${cap}`}</p>
      </div>
    </div>
  );
}

function Meter({ icon: Icon, label, used, max, i }: { icon: typeof Globe; label: string; used: number; max: number; i: number }) {
  const unl = max < 0;
  const pct = unl ? 0 : Math.min(100, Math.round((used / Math.max(1, max)) * 100));
  return (
    <div className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted/40">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13px] font-medium">{label}</span>
          <span className={`text-[11px] tabular-nums ${pct >= 90 ? "font-semibold text-red-500" : "text-muted-foreground"}`}>
            {used.toLocaleString()} <span className="text-muted-foreground/70">/ {fmt(max)}</span>
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border/60">
          {!unl && (
            <div className="ov-grow h-full rounded-full" style={{ width: `${Math.max(pct, used > 0 ? 3 : 0)}%`, background: tone(pct), animationDelay: `${120 + i * 40}ms` }} />
          )}
        </div>
      </div>
    </div>
  );
}

export function UsageMeters({ usage }: { usage: UsageResponse }) {
  const l = usage.limits;
  const u = usage.usage;
  const unlimitedAll = usage.is_admin;
  const now = new Date();
  const resets = new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const bwBytes = usage.consumption?.bandwidth_bytes ?? 0;
  const bwCapGB = l.max_bandwidth_gb;
  const bwUnl = unlimitedAll || bwCapGB <= 0;
  const build = usage.build_usage;
  const buildCap = build?.minutes_limit ?? l.max_build_minutes_monthly;
  const buildUnl = unlimitedAll || buildCap < 0;
  const dbMB = usage.consumption?.largest_db_mb ?? 0;
  const dbCap = l.max_db_size_mb;
  const dbUnl = unlimitedAll || dbCap < 0;

  const meters = [
    { icon: FolderGit2, label: "Projects", used: u.projects ?? 0, max: l.max_projects },
    { icon: Database, label: "Databases", used: u.databases ?? 0, max: l.max_databases },
    { icon: Boxes, label: "Services", used: u.services ?? 0, max: l.max_services },
    { icon: Globe, label: "Subdomains", used: u.subdomains ?? 0, max: l.max_subdomains },
    { icon: Link2, label: "Custom domains", used: u.custom_domains ?? 0, max: l.max_custom_domains },
    { icon: Clock, label: "Cron jobs", used: u.crons ?? 0, max: l.max_crons },
    { icon: HardDrive, label: "BYOC servers", used: u.byoc_servers ?? 0, max: l.max_byoc_servers },
    { icon: GitBranch, label: "PR previews", used: u.preview_deploys ?? 0, max: l.max_preview_deploys },
  ].map((m) => (unlimitedAll ? { ...m, max: -1 } : m));

  const caps = [
    { icon: MemoryStick, label: "Memory / project", value: l.max_memory_mb < 0 || unlimitedAll ? "∞" : l.max_memory_mb >= 1024 ? `${+(l.max_memory_mb / 1024).toFixed(1)} GB` : `${l.max_memory_mb} MB` },
    { icon: Cpu, label: "CPU / project", value: l.max_cpus < 0 || unlimitedAll ? "∞" : `${l.max_cpus} vCPU` },
    { icon: Database, label: "Size per database", value: dbUnl ? "∞" : fmtMB(dbCap) },
    { icon: Hammer, label: "Build RAM", value: l.max_build_memory_mb < 0 || unlimitedAll ? "∞" : fmtMB(l.max_build_memory_mb) },
  ];

  const flags: [string, boolean][] = [
    ["Previews", l.allow_previews], ["Release cmds", l.allow_release_cmd], ["Health checks", l.allow_health_checks],
    ["Private repos", l.allow_private_repos], ["TCP tunnels", l.allow_tcp_tunnels], ["Live logs", l.allow_live_logs],
    ["Telegram", l.allow_telegram], ["Advanced DBs", l.allow_advanced_databases],
  ];

  return (
    <section className="space-y-3">
      <DashMotion />
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">This month</p>
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" />Resets {resets}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Ring icon={Wifi} label="Bandwidth" value={fmtBytes(bwBytes)} cap={`${bwCapGB} GB`} unlimited={bwUnl}
          pct={bwUnl ? 0 : (bwBytes / (bwCapGB * 1024 ** 3)) * 100} delay={0} />
        <Ring icon={Hammer} label="Build minutes" value={`${(build?.minutes_used ?? 0).toLocaleString()} min`} cap={`${buildCap.toLocaleString()} min`} unlimited={buildUnl}
          pct={buildUnl ? 0 : ((build?.minutes_used ?? 0) / Math.max(1, buildCap)) * 100} delay={60} />
        <Ring icon={Database} label="Largest database" value={fmtMB(dbMB)} cap={dbUnl ? "" : fmtMB(dbCap)} unlimited={dbUnl}
          pct={dbUnl ? 0 : (dbMB / Math.max(1, dbCap)) * 100} delay={120} />
      </div>

      <div className="ov-rise overflow-hidden rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40" style={{ animationDelay: "160ms" }}>
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Resources</p>
          {unlimitedAll && <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">Unlimited</span>}
        </div>
        <div className="grid grid-cols-1 gap-x-4 gap-y-1 p-3 sm:grid-cols-2">
          {meters.map((m, i) => <Meter key={m.label} {...m} i={i} />)}
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
            <span key={label} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
              on || unlimitedAll ? "border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-600 dark:text-emerald-400" : "border-border/50 text-muted-foreground/70"}`}>
              {on || unlimitedAll ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}{label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
