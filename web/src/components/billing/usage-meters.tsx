"use client";

import {
  Boxes, CalendarClock, Check, Clock, Cpu, Database, FolderGit2, GitBranch, Globe,
  HardDrive, Hammer, Infinity as InfinityIcon, Link2, Lock, MemoryStick, Wifi,
} from "lucide-react";
import { DashMotion } from "@/components/admin/dash-kit";
import { cn } from "@/lib/utils";
import type { UsageResponse } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Plan usage, in three bands:
//   This month → metered consumption (bandwidth, build minutes, largest DB).
//   Resources  → every counted limit as a tile; a bar only when there is a
//                cap, a "Not on <plan>" lock when the plan allows zero.
//   Per project + features → the fixed caps and the on/off entitlements.
// Unlimited never draws an empty ring or bar: it says "No cap" and shows the
// real number.
// ─────────────────────────────────────────────────────────────────────────────

const fmtBytes = (b: number) => {
  if (b < 1024 ** 2) return `${Math.round(b / 1024)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(0)} MB`;
  return `${(b / 1024 ** 3).toFixed(b < 10 * 1024 ** 3 ? 2 : 1)} GB`;
};
const fmtMB = (mb: number) => (mb >= 1024 ? `${+(mb / 1024).toFixed(1)} GB` : `${mb} MB`);

type Level = "ok" | "warn" | "hot";
const level = (pct: number): Level => (pct >= 90 ? "hot" : pct >= 70 ? "warn" : "ok");
const BAR: Record<Level, string> = {
  ok: "bg-gradient-to-r from-brand to-brand-cyan",
  warn: "bg-amber-500",
  hot: "bg-red-500",
};
const PCT_TEXT: Record<Level, string> = {
  ok: "text-muted-foreground",
  warn: "text-amber-600 dark:text-amber-400",
  hot: "text-red-600 dark:text-red-400",
};

function NoCap({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-full bg-brand/10 px-2 text-[12.5px] font-medium text-[var(--dz-green-strong)] dark:text-brand", className)}>
      <InfinityIcon className="h-3.5 w-3.5" /> No cap
    </span>
  );
}

function Bar({ pct, used, delay }: { pct: number; used: number; delay: number }) {
  const lv = level(pct);
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]">
      <div
        className={cn("ov-grow h-full rounded-full", BAR[lv])}
        style={{ width: `${Math.max(pct, used > 0 ? 3 : 0)}%`, animationDelay: `${delay}ms` }}
      />
    </div>
  );
}

// One metered number for the month.
function MonthCard({ icon: Icon, label, value, cap, pct, unlimited, delay }: {
  icon: typeof Globe; label: string; value: string; cap: string; pct: number; unlimited: boolean; delay: number;
}) {
  const p = Math.min(100, Math.max(0, pct));
  const lv = level(p);
  return (
    <div className="ov-rise surface flex flex-col rounded-[20px] p-4 sm:p-5" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[13.5px] font-medium text-muted-foreground">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground/[0.05] text-foreground/70">
            <Icon className="h-3.5 w-3.5" />
          </span>
          {label}
        </p>
        {unlimited ? <NoCap /> : <span className={cn("text-[13.5px] font-semibold tabular-nums", PCT_TEXT[lv])}>{Math.round(p)}%</span>}
      </div>
      <p className="mt-4 text-[28px] font-semibold leading-none tracking-[-0.035em] tabular-nums">{value}</p>
      <div className="mt-auto pt-4">
        {unlimited ? (
          <p className="text-[13.5px] text-muted-foreground">Unlimited on your plan</p>
        ) : (
          <>
            <Bar pct={p} used={p > 0 ? 1 : 0} delay={delay + 120} />
            <p className="mt-2 text-[13.5px] tabular-nums text-muted-foreground">of {cap}</p>
          </>
        )}
      </div>
    </div>
  );
}

// One counted resource. max < 0 = unlimited, max = 0 = not on this plan.
function ResourceTile({ icon: Icon, label, used, max, planName, quiet, i }: {
  icon: typeof Globe; label: string; used: number; max: number; planName: string; quiet: boolean; i: number;
}) {
  const unl = max < 0;
  const locked = max === 0 && used === 0;
  const pct = unl || max <= 0 ? 0 : Math.min(100, Math.round((used / max) * 100));
  const lv = level(pct);
  return (
    <div className="flex flex-col gap-3 bg-card p-4">
      <p className={cn("flex items-center gap-1.5 text-[13.5px] font-medium", locked ? "text-muted-foreground/70" : "text-muted-foreground")}>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </p>
      {locked ? (
        <p className="mt-auto flex items-center gap-1.5 text-[13.5px] text-muted-foreground/80">
          <Lock className="h-3.5 w-3.5" /> Not on {planName}
        </p>
      ) : (
        <>
          <p className="flex items-baseline gap-1.5">
            <span className={cn("text-[24px] font-semibold leading-none tracking-[-0.03em] tabular-nums", lv === "hot" && !unl && "text-red-600 dark:text-red-400")}>
              {used.toLocaleString()}
            </span>
            <span className="text-[13.5px] tabular-nums text-muted-foreground">{unl ? "used" : `of ${max.toLocaleString()}`}</span>
          </p>
          {/* When the whole account is uncapped the section header says so once;
              repeating the badge on every tile is just noise. */}
          {!(unl && quiet) && (
            <div className="mt-auto">
              {unl ? <NoCap className="h-5 px-1.5 text-[12px]" /> : <Bar pct={pct} used={used} delay={160 + i * 40} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function UsageMeters({ usage, planName = "Free", onUpgrade }: { usage: UsageResponse; planName?: string; onUpgrade?: () => void }) {
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
  const buildUsed = build?.minutes_used ?? 0;
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

  const nearCap = meters.filter((m) => m.max > 0 && m.used / m.max >= 0.9).length;

  const caps = [
    { icon: MemoryStick, label: "Memory", value: l.max_memory_mb < 0 || unlimitedAll ? "No cap" : fmtMB(l.max_memory_mb) },
    { icon: Cpu, label: "CPU", value: l.max_cpus < 0 || unlimitedAll ? "No cap" : `${l.max_cpus} vCPU` },
    { icon: Database, label: "Database size", value: dbUnl ? "No cap" : fmtMB(dbCap) },
    { icon: Hammer, label: "Build memory", value: l.max_build_memory_mb < 0 || unlimitedAll ? "No cap" : fmtMB(l.max_build_memory_mb) },
  ];

  const flags: [string, boolean][] = [
    ["PR previews", l.allow_previews], ["Release commands", l.allow_release_cmd], ["Health checks", l.allow_health_checks],
    ["Private repos", l.allow_private_repos], ["TCP tunnels", l.allow_tcp_tunnels], ["Live logs", l.allow_live_logs],
    ["Telegram alerts", l.allow_telegram], ["Redis, Mongo, MySQL", l.allow_advanced_databases],
  ];

  return (
    <section className="space-y-6">
      <DashMotion />

      {/* This month */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="eyebrow">This month</p>
          <span className="flex items-center gap-1.5 text-[13.5px] text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" />Resets {resets}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <MonthCard icon={Wifi} label="Bandwidth" value={fmtBytes(bwBytes)} cap={`${bwCapGB} GB`} unlimited={bwUnl}
            pct={bwUnl ? 0 : (bwBytes / (bwCapGB * 1024 ** 3)) * 100} delay={0} />
          <MonthCard icon={Hammer} label="Build minutes" value={`${buildUsed.toLocaleString()} min`} cap={`${buildCap.toLocaleString()} min`} unlimited={buildUnl}
            pct={buildUnl ? 0 : (buildUsed / Math.max(1, buildCap)) * 100} delay={60} />
          <MonthCard icon={Database} label="Largest database" value={fmtMB(dbMB)} cap={dbUnl ? "" : fmtMB(dbCap)} unlimited={dbUnl}
            pct={dbUnl ? 0 : (dbMB / Math.max(1, dbCap)) * 100} delay={120} />
        </div>
      </div>

      {/* Resources */}
      <div className="ov-rise" style={{ animationDelay: "160ms" }}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="eyebrow">Resources</p>
          {unlimitedAll ? (
            <NoCap />
          ) : nearCap > 0 ? (
            <span className="flex items-center gap-2.5 text-[13.5px]">
              <span className="font-medium text-red-600 dark:text-red-400">{nearCap} at or near the limit</span>
              {onUpgrade && (
                <button type="button" onClick={onUpgrade} className="rounded-full bg-foreground px-2.5 py-1 text-[12.5px] font-medium text-background transition-opacity hover:opacity-85">
                  Upgrade
                </button>
              )}
            </span>
          ) : null}
        </div>
        <div className="surface overflow-hidden rounded-[20px]">
          <div className="grid grid-cols-2 gap-px bg-[var(--dz-hairline)] lg:grid-cols-4">
            {meters.map((m, i) => <ResourceTile key={m.label} {...m} planName={planName} quiet={unlimitedAll} i={i} />)}
          </div>
        </div>
      </div>

      {/* Per project + features */}
      <div className="ov-rise grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]" style={{ animationDelay: "220ms" }}>
        <div className="surface rounded-[20px] p-4 sm:p-5">
          <p className="eyebrow">Per project</p>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
            {caps.map((c) => (
              <div key={c.label} className="min-w-0">
                <dt className="flex items-center gap-1.5 text-[13.5px] text-muted-foreground"><c.icon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{c.label}</span></dt>
                <dd className="mt-1 text-[17px] font-semibold tracking-tight tabular-nums">{c.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="surface rounded-[20px] p-4 sm:p-5">
          <p className="eyebrow">Included features</p>
          <ul className="mt-4 grid grid-cols-1 gap-x-4 gap-y-2.5 min-[420px]:grid-cols-2">
            {flags.map(([label, on]) => {
              const yes = on || unlimitedAll;
              return (
                <li key={label} className={cn("flex items-center gap-2 text-[13.5px]", yes ? "text-foreground" : "text-muted-foreground/70")}>
                  <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full", yes ? "bg-brand/15 text-[var(--dz-green-strong)] dark:text-brand" : "bg-foreground/[0.05]")}>
                    {yes ? <Check className="h-3 w-3" /> : <Lock className="h-2.5 w-2.5" />}
                  </span>
                  <span className="truncate">{label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
