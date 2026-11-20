"use client";

import { ArrowRightIcon, CalendarCheckIcon, CrownIcon, LightningIcon, RocketLaunchIcon, ShieldCheckIcon, SparkleIcon } from "@phosphor-icons/react";
import { useNow } from "./use-now";
import type { BillingStatus, PlanCardData, UsageResponse } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Plan hero: the plan card at the top of Billing. It answers three
// questions at a glance: what plan am I on, what does it give me, and when does
// it renew. The right side holds the price and the billing-cycle progress, or
// the upgrade call on Free. Admin accounts get a plain "Unlimited" card with no
// fake numbers.
// ─────────────────────────────────────────────────────────────────────────────

const PLAN_META: Record<string, { icon: typeof LightningIcon }> = {
  free:  { icon: SparkleIcon },
  hobby: { icon: RocketLaunchIcon },
  pro:   { icon: LightningIcon },
  team:  { icon: CrownIcon },
};

const fmtLongDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

const memLabel = (mb: number) => (mb >= 1024 ? `${+(mb / 1024).toFixed(1)} GB` : `${mb} MB`);

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

  const meta = planCards.find((p) => p.id === currentPlan);
  const look = isAdmin ? { icon: ShieldCheckIcon } : (PLAN_META[currentPlan] ?? PLAN_META.free);
  const Icon = look.icon;
  const planName = isAdmin ? "Unlimited" : (meta?.name ?? "Free");

  // Billing-cycle progress (only known after mount, so SSR and first paint agree).
  const start = activeSub?.period_start ? new Date(activeSub.period_start).getTime() : 0;
  const end = activeSub?.period_end ? new Date(activeSub.period_end).getTime() : 0;
  const cycleDays = start && end ? Math.max(1, Math.round((end - start) / 86400000)) : 30;
  const daysLeft = end && now !== null ? Math.max(0, Math.ceil((end - now) / 86400000)) : null;
  const elapsedPct = end && daysLeft !== null ? Math.min(100, Math.max(0, (1 - daysLeft / cycleDays) * 100)) : 0;

  // Headline entitlements, read live from plan_limits.
  const chips: string[] = (() => {
    if (!usage) return [];
    if (isAdmin) return ["Unlimited projects", "Unlimited databases", "No memory cap", "No bandwidth cap"];
    const l = usage.limits;
    const n = (v: number, one: string, many: string) => (v < 0 ? `Unlimited ${many}` : `${v} ${v === 1 ? one : many}`);
    return [
      n(l.max_projects, "project", "projects"),
      n(l.max_databases, "database", "databases"),
      l.max_memory_mb < 0 ? "No memory cap" : `${memLabel(l.max_memory_mb)} RAM`,
      l.max_bandwidth_gb < 0 ? "No bandwidth cap" : `${l.max_bandwidth_gb} GB bandwidth`,
    ];
  })();

  const subtitle = isAdmin
    ? "Admin account. Every plan limit is lifted, so nothing here is metered against you."
    : isPremium
      ? (meta?.tagline ?? "Thanks for supporting Deployzy.")
      : (meta?.tagline ?? "For hobby projects and learning");

  return (
    <section className="surface overflow-hidden rounded-[18px]">
      <div className="flex flex-col lg:flex-row">
        {/* Identity */}
        <div className="min-w-0 flex-1 p-5 sm:p-6">
          <div className="flex items-center gap-3.5">
            <span aria-hidden className="dz-ico-tint flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-brand/[0.12] text-[var(--dz-green-strong)] dark:text-brand">
              <Icon weight="duotone" className="h-[22px] w-[22px]" />
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] text-muted-foreground">Current plan</p>
              <h2 className="flex flex-wrap items-center gap-2 text-[22px] font-semibold leading-tight tracking-[-0.022em]">
                {planName}
                <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full border border-[var(--dz-hairline)] px-2 text-[11.5px] font-medium tracking-normal text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
                  {isAdmin ? "Admin" : isPremium ? "Active" : "Free forever"}
                </span>
              </h2>
            </div>
          </div>

          <p className="mt-3.5 max-w-xl text-[13.5px] leading-relaxed text-muted-foreground">{subtitle}</p>

          {chips.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <li key={c} className="inline-flex h-7 items-center rounded-full bg-foreground/[0.045] px-2.5 text-[12.5px] tabular-nums text-foreground/75 dark:bg-white/[0.06]">
                  {c}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Price, cycle and action */}
        <div className="flex w-full shrink-0 flex-col border-t border-[var(--dz-hairline)] bg-foreground/[0.018] p-5 sm:p-6 lg:w-[290px] lg:border-l lg:border-t-0 dark:bg-white/[0.02]">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[12.5px] text-muted-foreground">{isAdmin ? "Billing" : isPremium ? "Monthly" : "Price"}</p>
              <p className="mt-1 text-[28px] font-semibold leading-none tracking-[-0.03em] tabular-nums">
                {isAdmin ? "$0" : isPremium ? (meta?.price ?? `$${activeSub?.amount ?? ""}`) : "$0"}
                <span className="ml-1 text-[13px] font-normal tracking-normal text-muted-foreground">/mo</span>
              </p>
            </div>
            {!isAdmin && isPremium && daysLeft !== null && (
              <p className="text-right text-[12.5px] leading-tight text-muted-foreground">
                <span className="block text-[17px] font-semibold tabular-nums text-foreground">{daysLeft}</span>
                day{daysLeft === 1 ? "" : "s"} left
              </p>
            )}
          </div>

          {isAdmin ? (
            <p className="mt-3 text-[12.5px] leading-snug text-muted-foreground">Admin accounts are never charged. Usage below is for reference.</p>
          ) : isPremium ? (
            <div className="mt-4">
              <div className="h-1 overflow-hidden rounded-full bg-foreground/[0.07]">
                <div className="h-full rounded-full bg-brand transition-[width] duration-1000 ease-out" style={{ width: `${Math.max(elapsedPct, 3)}%` }} />
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                <CalendarCheckIcon className="h-3.5 w-3.5" />
                {end ? `Renews ${fmtLongDate(end)}` : "Renews monthly"}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-[12.5px] leading-snug text-muted-foreground">No card on file. Upgrade any time for more projects, memory and bandwidth.</p>
          )}

          <div aria-hidden className="min-h-4 flex-1" />
          <button
            type="button"
            onClick={onManagePlan}
            className={`pill pill-sm w-full ${!isAdmin && !isPremium ? "pill-ink" : "pill-line"}`}
          >
            {isAdmin ? "See the plans" : isPremium ? "Change plan" : "Upgrade plan"}
            <ArrowRightIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}

export function PlanHeroSkeleton() {
  return (
    <section className="surface overflow-hidden rounded-[18px]">
      <div className="flex animate-pulse flex-col lg:flex-row">
        <div className="flex-1 space-y-4 p-5 sm:p-6">
          <div className="flex items-center gap-3.5">
            <div className="h-11 w-11 rounded-[13px] bg-foreground/[0.06]" />
            <div className="space-y-2"><div className="h-3 w-20 rounded-full bg-foreground/[0.06]" /><div className="h-5 w-36 rounded-md bg-foreground/[0.06]" /></div>
          </div>
          <div className="h-3 w-72 max-w-full rounded-full bg-foreground/[0.06]" />
          <div className="flex flex-wrap gap-1.5">{[0, 1, 2, 3].map((i) => <div key={i} className="h-7 w-24 rounded-full bg-foreground/[0.06]" />)}</div>
        </div>
        <div className="h-[150px] w-full border-t border-[var(--dz-hairline)] lg:w-[290px] lg:border-l lg:border-t-0" />
      </div>
    </section>
  );
}
