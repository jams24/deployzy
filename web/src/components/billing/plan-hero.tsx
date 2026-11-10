"use client";

import { ArrowRight, CalendarClock, Crown, Rocket, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { useNow } from "./use-now";
import type { BillingStatus, PlanCardData, UsageResponse } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Plan hero: the dark brand card at the top of Billing. It answers three
// questions at a glance: what plan am I on, what does it give me, and when does
// it renew. The right side holds the price and the billing-cycle progress, or
// the upgrade call on Free. Admin accounts get a plain "Unlimited" card with no
// fake numbers.
// ─────────────────────────────────────────────────────────────────────────────

const PLAN_META: Record<string, { icon: typeof Zap; glow: string }> = {
  free:  { icon: Sparkles, glow: "bg-white/[0.06]" },
  hobby: { icon: Rocket,   glow: "bg-brand/25" },
  pro:   { icon: Zap,      glow: "bg-brand-cyan/25" },
  team:  { icon: Crown,    glow: "bg-violet-500/25" },
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
  const look = isAdmin ? { icon: ShieldCheck, glow: "bg-brand/25" } : (PLAN_META[currentPlan] ?? PLAN_META.free);
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
    <section className="dark grain relative isolate overflow-hidden rounded-[24px] bg-[#0b0c10] text-white">
      <div aria-hidden className={`pointer-events-none absolute -right-20 -top-28 h-72 w-80 rounded-full blur-[90px] ${look.glow}`} />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 left-6 h-56 w-72 rounded-full bg-brand-cyan/[0.08] blur-[90px]" />
      <div aria-hidden className="mask-fade-b pointer-events-none absolute inset-0 text-white/[0.04]"><div className="bg-grid absolute inset-0" /></div>

      <div className="relative flex flex-col gap-6 p-5 sm:p-7 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
        {/* Identity */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="eyebrow">Current plan</p>
            <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-2.5 text-[12.5px] font-medium text-white/80">
              <span className="live-dot" aria-hidden />
              {isAdmin ? "Admin" : isPremium ? "Active" : "Free forever"}
            </span>
          </div>

          <div className="mt-4 flex items-center gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] sm:h-14 sm:w-14">
              <Icon className="h-5 w-5 text-brand sm:h-6 sm:w-6" />
            </span>
            <h2 className="text-[clamp(2rem,5vw,2.9rem)] font-semibold leading-none tracking-[-0.045em]">
              {planName}
              {!isAdmin && <span className="accent-serif ml-2 text-white/55">plan</span>}
            </h2>
          </div>

          <p className="mt-4 max-w-xl text-[14.5px] leading-relaxed text-white/60">{subtitle}</p>

          {chips.length > 0 && (
            <ul className="mt-5 flex flex-wrap gap-2">
              {chips.map((c) => (
                <li key={c} className="inline-flex h-8 items-center rounded-full border border-white/10 bg-white/[0.04] px-3 text-[13.5px] tabular-nums text-white/75">
                  {c}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Admin: nothing is billed, but the plans are one click away. */}
        {isAdmin && (
          <div className="w-full shrink-0 rounded-[20px] border border-white/10 bg-white/[0.04] p-4 sm:p-5 lg:w-[300px]">
            <p className="eyebrow">Billing</p>
            <p className="mt-2 text-[34px] font-semibold leading-none tracking-[-0.04em] tabular-nums">
              $0<span className="ml-1 text-[14.5px] font-normal tracking-normal text-white/50">/mo</span>
            </p>
            <p className="mt-3 text-[13.5px] leading-snug text-white/55">Admin accounts are never charged. Usage below is shown for reference.</p>
            <button type="button" onClick={onManagePlan} className="pill pill-sm mt-4 w-full border border-white/15 bg-white/[0.06] text-white hover:bg-white/[0.11]">
              See the plans <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Price, cycle and action */}
        {!isAdmin && (
          <div className="w-full shrink-0 rounded-[20px] border border-white/10 bg-white/[0.04] p-4 sm:p-5 lg:w-[300px]">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="eyebrow">{isPremium ? "Monthly" : "Price"}</p>
                <p className="mt-2 text-[34px] font-semibold leading-none tracking-[-0.04em] tabular-nums">
                  {isPremium ? (meta?.price ?? `$${activeSub?.amount ?? ""}`) : "$0"}
                  <span className="ml-1 text-[14.5px] font-normal tracking-normal text-white/50">/mo</span>
                </p>
              </div>
              {isPremium && daysLeft !== null && (
                <p className="text-right text-[13.5px] leading-tight text-white/60">
                  <span className="block text-[20px] font-semibold tabular-nums text-white">{daysLeft}</span>
                  day{daysLeft === 1 ? "" : "s"} left
                </p>
              )}
            </div>

            {isPremium ? (
              <div className="mt-4">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand to-brand-cyan transition-[width] duration-1000 ease-out"
                    style={{ width: `${Math.max(elapsedPct, 3)}%` }}
                  />
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-[13.5px] text-white/55">
                  <CalendarClock className="h-3.5 w-3.5" />
                  {end ? `Renews ${fmtLongDate(end)}` : "Renews monthly"}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-[13.5px] leading-snug text-white/55">No card on file. Upgrade any time for more projects, memory and bandwidth.</p>
            )}

            <button
              type="button"
              onClick={onManagePlan}
              className={`pill pill-sm mt-4 w-full ${isPremium ? "border border-white/15 bg-white/[0.06] text-white hover:bg-white/[0.11]" : "pill-launch"}`}
            >
              {isPremium ? "Change plan" : "Upgrade plan"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

export function PlanHeroSkeleton() {
  return (
    <section className="dark relative overflow-hidden rounded-[24px] bg-[#0b0c10] p-5 sm:p-7">
      <div className="flex animate-pulse flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex-1 space-y-4">
          <div className="h-3 w-28 rounded-full bg-white/10" />
          <div className="flex items-center gap-3.5">
            <div className="h-14 w-14 rounded-2xl bg-white/10" />
            <div className="h-10 w-48 rounded-lg bg-white/10" />
          </div>
          <div className="h-3.5 w-72 max-w-full rounded-full bg-white/10" />
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-8 w-28 rounded-full bg-white/10" />)}
          </div>
        </div>
        <div className="h-[170px] w-full rounded-[20px] bg-white/[0.06] lg:w-[300px]" />
      </div>
    </section>
  );
}
