"use client";

import { ArrowRight, Crown, Rocket, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNow } from "./use-now";
import type { BillingStatus, PlanCardData, UsageResponse } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Plan hero — the "what am I on and when does it renew" glanceable. Plan icon
// tile + status + key entitlements on the left; billing-cycle ring + CTA on
// the right. Purely presentational; all data comes from the page.
// ─────────────────────────────────────────────────────────────────────────────

const PLAN_STYLE: Record<string, {
  icon: typeof Zap;
  tile: string;
  glow: string;
  badge: string;
}> = {
  free:  { icon: Sparkles, tile: "border-zinc-500/20 bg-zinc-500/10 text-zinc-500 dark:text-zinc-400",        glow: "bg-zinc-500/[0.07]",    badge: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400" },
  hobby: { icon: Rocket,   tile: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", glow: "bg-emerald-500/[0.08]", badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  pro:   { icon: Zap,      tile: "border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-400",            glow: "bg-sky-500/[0.08]",     badge: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  team:  { icon: Crown,    tile: "border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-400", glow: "bg-violet-500/[0.08]",  badge: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400" },
};
const ADMIN_STYLE = { icon: Crown, tile: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", glow: "bg-emerald-500/[0.08]", badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" };

function CycleRing({ pct, label, sub }: { pct: number; label: string; sub: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-[72px] w-[72px] shrink-0">
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="5" className="stroke-border/60" />
        <circle
          cx="32" cy="32" r={r} fill="none" strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, pct)))}
          className="stroke-emerald-500 transition-[stroke-dashoffset] duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-base font-bold tabular-nums leading-none">{label}</span>
        <span className="mt-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{sub}</span>
      </div>
    </div>
  );
}

export function PlanHero({
  usage,
  status,
  planCards,
  onManagePlan,
}: {
  usage: UsageResponse | null;
  status: BillingStatus | null;
  planCards: PlanCardData[];
  onManagePlan: () => void;
}) {
  const isAdmin = usage?.is_admin ?? false;
  const activeSub = status?.active_subscription;
  const isPremium = !!activeSub && activeSub.status === "active";
  const currentPlan = usage?.plan || (isPremium ? activeSub!.plan : "free") || "free";
  const now = useNow();

  const style = isAdmin ? ADMIN_STYLE : (PLAN_STYLE[currentPlan] ?? PLAN_STYLE.free);
  const meta = planCards.find((p) => p.id === currentPlan);
  const Icon = style.icon;
  const planName = isAdmin ? "Admin" : (meta?.name ?? "Free");

  // Billing-cycle progress for the ring (known only after mount).
  const start = activeSub?.period_start ? new Date(activeSub.period_start).getTime() : 0;
  const end = activeSub?.period_end ? new Date(activeSub.period_end).getTime() : 0;
  const cycleDays = start && end ? Math.max(1, Math.round((end - start) / 86400000)) : 30;
  const daysLeft = end && now !== null ? Math.max(0, Math.ceil((end - now) / 86400000)) : null;
  const elapsedPct = end && daysLeft !== null ? Math.min(1, Math.max(0, 1 - daysLeft / cycleDays)) : 0;

  // Headline entitlements pulled live from plan_limits.
  const chips: string[] = (() => {
    if (!usage) return [];
    const l = usage.limits;
    const n = (v: number) => (v < 0 ? "∞" : String(v));
    return [
      `${n(l.max_projects)} projects`,
      `${n(l.max_databases)} databases`,
      l.max_memory_mb < 0 ? "∞ RAM" : l.max_memory_mb >= 1024 ? `${+(l.max_memory_mb / 1024).toFixed(1)} GB RAM` : `${l.max_memory_mb} MB RAM`,
      l.max_bandwidth_gb < 0 ? "∞ bandwidth" : `${l.max_bandwidth_gb} GB bandwidth`,
    ];
  })();

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40">
      {/* Decorative glow tinted to the plan accent */}
      <div aria-hidden className={`pointer-events-none absolute -top-24 -right-16 h-56 w-72 rounded-full blur-[90px] ${style.glow}`} />

      <div className="relative flex flex-col gap-6 p-5 sm:p-6 lg:flex-row lg:items-center">
        {/* Left: identity */}
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${style.tile}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight">{planName}</h2>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.badge}`}>
                {isAdmin ? "Unlimited" : isPremium ? "Active" : "Free plan"}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {isAdmin
                ? "All platform limits are bypassed for your account."
                : isPremium
                  ? `${meta?.price}/mo · renews ${new Date(end).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
                  : (meta?.tagline ?? "For hobby projects and learning")}
            </p>
            {chips.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {chips.map((c) => (
                  <span key={c} className="rounded-md border border-border/50 bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground tabular-nums">
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: cycle ring + CTA */}
        <div className="flex items-center gap-5 lg:flex-col lg:items-end lg:gap-3">
          {isPremium && !isAdmin ? (
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-2xl font-bold tabular-nums tracking-tight">{meta?.price}<span className="text-sm font-normal text-muted-foreground">/mo</span></div>
                <div className="text-[11px] text-muted-foreground">
                  {daysLeft === null ? "—" : `renews in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}
                </div>
              </div>
              <CycleRing pct={elapsedPct} label={daysLeft === null ? "–" : String(daysLeft)} sub={`of ${cycleDays}d`} />
            </div>
          ) : (
            <div className="text-right">
              <div className="text-2xl font-bold tabular-nums tracking-tight">{isAdmin ? "∞" : "$0"}</div>
              <div className="text-[11px] text-muted-foreground">{isAdmin ? "all limits bypassed" : "forever · no card required"}</div>
            </div>
          )}
          {!isAdmin && (
            <Button onClick={onManagePlan} variant={isPremium ? "outline" : "default"} size="sm" className="gap-1.5 rounded-lg">
              {isPremium ? "Change plan" : "Upgrade plan"}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

export function PlanHeroSkeleton() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-5 sm:p-6">
      <div className="flex items-start gap-4 animate-pulse">
        <div className="h-12 w-12 rounded-2xl bg-muted" />
        <div className="flex-1 space-y-2.5">
          <div className="h-5 w-40 rounded-md bg-muted" />
          <div className="h-3.5 w-64 max-w-full rounded-md bg-muted" />
          <div className="flex gap-1.5 pt-1">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-5 w-20 rounded-md bg-muted" />)}
          </div>
        </div>
        <div className="hidden sm:block h-[72px] w-[72px] rounded-full bg-muted" />
      </div>
    </section>
  );
}
