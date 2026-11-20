"use client";

import { ArrowRightIcon, CheckIcon, CrownIcon, LightningIcon, RocketLaunchIcon, ShieldCheckIcon, SparkleIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { PlanCardData } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Plans tab: the four tiers. Pro is the anchor card; the current plan is
// marked and its button goes quiet. "Upgrade to X" opens the checkout sheet,
// where the pay method is picked. Admin accounts see the tiers with no CTAs.
// ─────────────────────────────────────────────────────────────────────────────

const TIER_ORDER = ["free", "hobby", "pro", "team"];

const PLAN_ICON: Record<string, typeof LightningIcon> = { free: SparkleIcon, hobby: RocketLaunchIcon, pro: LightningIcon, team: CrownIcon };

export function PlansGrid({
  planCards,
  currentPlan,
  isAdmin,
  onCheckout,
}: {
  planCards: PlanCardData[];
  currentPlan: string;
  isAdmin: boolean;
  onCheckout: (plan: "hobby" | "pro" | "team") => void;
}) {

  return (
    <div className="space-y-5">
      {isAdmin && (
        <div className="flex items-start gap-3 rounded-[14px] bg-foreground/[0.035] px-4 py-3 sm:items-center dark:bg-white/[0.04]">
          <ShieldCheckIcon className="dz-ico dz-ico-on mt-0.5 h-[18px] w-[18px] shrink-0 sm:mt-0" />
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium">You&apos;re on an admin account</p>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">Every limit is already lifted. The plans below are what your users see.</p>
          </div>
        </div>
      )}

      <div className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {planCards.map((plan, idx) => {
          // Admins get no CTAs; an unknown plan id must never mark everything upgradable.
          const knownTier = TIER_ORDER.includes(currentPlan);
          const isCurrent = !isAdmin && currentPlan === plan.id;
          const canUpgrade = !isAdmin && knownTier && TIER_ORDER.indexOf(plan.id) > TIER_ORDER.indexOf(currentPlan);
          const isPopular = plan.id === "pro";
          const Icon = PLAN_ICON[plan.id] ?? SparkleIcon;
          const [lead, ...rest] = plan.features;
          const hasLead = !!lead && /plus:$|:$/.test(lead.trim());
          const features = hasLead ? rest : plan.features;

          return (
            <div
              key={plan.id}
              className={cn(
                "ov-rise surface relative flex flex-col rounded-[18px] p-5",
                isPopular && "border-brand/45 shadow-[0_0_0_1px_color-mix(in_oklch,var(--dz-green)_35%,transparent)]",
                isCurrent && !isPopular && "border-foreground/20",
              )}
              style={{ animationDelay: `${idx * 60}ms` }}
            >
              <div className="flex items-center justify-between gap-2">
                <span aria-hidden className={cn(
                  "dz-ico-tint flex h-9 w-9 items-center justify-center rounded-[11px]",
                  isPopular ? "bg-brand/[0.12] text-[var(--dz-green-strong)] dark:text-brand" : "bg-foreground/[0.05] text-foreground/70",
                )}>
                  <Icon weight="duotone" className="h-[18px] w-[18px]" />
                </span>
                {isCurrent ? (
                  <span className="inline-flex h-[22px] items-center gap-1 rounded-full bg-foreground/[0.06] px-2 text-[11.5px] font-medium text-foreground/75">
                    <CheckIcon weight="bold" className="h-3 w-3" /> Current
                  </span>
                ) : isPopular ? (
                  <span className="inline-flex h-[22px] items-center rounded-full bg-brand/[0.12] px-2 text-[11.5px] font-medium text-[var(--dz-green-strong)] dark:text-brand">Most popular</span>
                ) : null}
              </div>

              <p className="mt-4 text-[15px] font-semibold tracking-[-0.01em]">{plan.name}</p>
              <p className="mt-1.5 flex items-baseline gap-1">
                <span className="text-[26px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{plan.price}</span>
                <span className="text-[12.5px] text-muted-foreground">
                  {plan.id === "free" ? "forever" : plan.id === "team" ? "/seat/mo" : "/mo"}
                </span>
              </p>
              <p className="mt-2 text-[13px] leading-snug text-muted-foreground sm:min-h-[2.6em]">{plan.tagline}</p>

              {/* Lower tiers have no button; keep the row on desktop so the cards align, drop it on phones. */}
              <div className={cn("mt-4", isAdmin ? "hidden" : !canUpgrade && !isCurrent && "hidden sm:block")}>
                {canUpgrade ? (
                  <button
                    type="button"
                    onClick={() => onCheckout(plan.id as "hobby" | "pro" | "team")}
                    className={cn("pill pill-sm w-full", isPopular ? "pill-ink" : "pill-line")}
                  >
                    Upgrade to {plan.name} <ArrowRightIcon className="h-4 w-4" />
                  </button>
                ) : isCurrent ? (
                  <div className="pill pill-sm w-full cursor-default bg-foreground/[0.04] text-muted-foreground">
                    Your current plan
                  </div>
                ) : (
                  <div className="h-9" aria-hidden />
                )}
              </div>

              <div className="mt-4 border-t border-[var(--dz-hairline)] pt-4">
                {hasLead && <p className="mb-2.5 text-[13px] font-medium text-foreground/80">{lead}</p>}
                <ul className="space-y-2">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[13px] leading-snug">
                      <CheckIcon weight="bold" className="mt-[3px] h-3 w-3 shrink-0 text-[var(--dz-green-strong)] dark:text-brand" />
                      <span className="text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-center text-[12.5px] text-muted-foreground">
        Pay by card or crypto. Cancel any time; your projects keep running on Free. Questions?{" "}
        <a href="mailto:support@deployzy.com" className="font-medium text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground">support@deployzy.com</a>
      </p>
    </div>
  );
}
