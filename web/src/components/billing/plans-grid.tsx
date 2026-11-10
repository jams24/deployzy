"use client";

import { ArrowRight, Bitcoin, Check, CreditCard, Crown, Loader2, Rocket, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanCardData } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Plans tab: one pay-with switch drives every upgrade button, then the four
// tiers. Pro is the anchor card; the current plan is marked and its button
// goes quiet. Admin accounts see the tiers for reference with no CTAs.
// ─────────────────────────────────────────────────────────────────────────────

const TIER_ORDER = ["free", "hobby", "pro", "team"];

const PLAN_ICON: Record<string, typeof Zap> = { free: Sparkles, hobby: Rocket, pro: Zap, team: Crown };

export function PlansGrid({
  planCards,
  currentPlan,
  isAdmin,
  payMethod,
  onPayMethod,
  onCheckout,
  checkoutLoading,
}: {
  planCards: PlanCardData[];
  currentPlan: string;
  isAdmin: boolean;
  payMethod: "card" | "crypto";
  onPayMethod: (m: "card" | "crypto") => void;
  onCheckout: (plan: "hobby" | "pro" | "team") => void;
  checkoutLoading: boolean;
}) {
  const methods = [
    { id: "card" as const, label: "Card", icon: CreditCard, hint: "Visa, Mastercard and Amex, processed by Polar." },
    { id: "crypto" as const, label: "Crypto", icon: Bitcoin, hint: "BTC, ETH, USDT, SOL or LTC, processed by InventPay." },
  ];
  const activeHint = methods.find((m) => m.id === payMethod)?.hint;

  return (
    <div className="space-y-5">
      {isAdmin ? (
        <div className="surface flex items-start gap-3 rounded-[20px] p-4 sm:items-center sm:p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand/10 text-[var(--dz-green-strong)] dark:text-brand">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[14.5px] font-semibold">You&apos;re on an admin account</p>
            <p className="mt-0.5 text-[13.5px] text-muted-foreground">Every limit is already lifted. The plans below are what your users see.</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-4">
          <div role="radiogroup" aria-label="Pay with" className="flex h-10 w-full items-center gap-0.5 rounded-full bg-foreground/[0.05] p-1 sm:w-auto">
            {methods.map((m) => {
              const on = payMethod === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onPayMethod(m.id)}
                  className={cn(
                    "flex h-full flex-1 items-center justify-center gap-1.5 rounded-full px-4 text-[14px] font-medium transition-colors sm:flex-none",
                    on ? "bg-background text-foreground shadow-sm dark:bg-white/[0.1]" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <m.icon className="h-4 w-4" /> {m.label}
                </button>
              );
            })}
          </div>
          <p className="text-[13.5px] text-muted-foreground">{activeHint}</p>
        </div>
      )}

      <div className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {planCards.map((plan, idx) => {
          // Admins get no CTAs; an unknown plan id must never mark everything upgradable.
          const knownTier = TIER_ORDER.includes(currentPlan);
          const isCurrent = !isAdmin && currentPlan === plan.id;
          const canUpgrade = !isAdmin && knownTier && TIER_ORDER.indexOf(plan.id) > TIER_ORDER.indexOf(currentPlan);
          const isPopular = plan.id === "pro";
          const Icon = PLAN_ICON[plan.id] ?? Sparkles;
          const [lead, ...rest] = plan.features;
          const hasLead = !!lead && /plus:$|:$/.test(lead.trim());
          const features = hasLead ? rest : plan.features;

          return (
            <div
              key={plan.id}
              className={cn(
                "ov-rise relative flex flex-col rounded-[22px] p-5 sm:p-6",
                isPopular
                  ? "dark grain isolate overflow-hidden bg-[#0b0c10] text-white shadow-[0_24px_60px_-28px_color-mix(in_oklch,var(--dz-green)_55%,transparent)]"
                  : "surface",
                isCurrent && !isPopular && "ring-2 ring-brand/50",
              )}
              style={{ animationDelay: `${idx * 60}ms` }}
            >
              {isPopular && (
                <>
                  <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-48 w-56 rounded-full bg-brand/25 blur-[70px]" />
                  <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-10 h-44 w-52 rounded-full bg-brand-cyan/10 blur-[70px]" />
                </>
              )}

              <div className="relative flex items-center justify-between gap-2">
                <span className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-2xl",
                  isPopular ? "border border-white/10 bg-white/[0.06] text-brand" : "bg-foreground/[0.05] text-foreground/75",
                )}>
                  <Icon className="h-4.5 w-4.5" />
                </span>
                {isCurrent ? (
                  <span className="inline-flex h-6 items-center gap-1 rounded-full bg-brand/15 px-2.5 text-[12.5px] font-medium text-[var(--dz-green-strong)] dark:text-brand">
                    <Check className="h-3 w-3" /> Current
                  </span>
                ) : isPopular ? (
                  <span className="inline-flex h-6 items-center rounded-full bg-brand px-2.5 text-[12.5px] font-semibold text-[oklch(0.16_0.02_165)]">Most popular</span>
                ) : null}
              </div>

              <p className="relative mt-5 text-[17px] font-semibold tracking-tight">{plan.name}</p>
              <p className="relative mt-2 flex items-baseline gap-1">
                <span className="text-[38px] font-semibold leading-none tracking-[-0.045em] tabular-nums">{plan.price}</span>
                <span className={cn("text-[13.5px]", isPopular ? "text-white/55" : "text-muted-foreground")}>
                  {plan.id === "free" ? "forever" : plan.id === "team" ? "/seat/mo" : "/mo"}
                </span>
              </p>
              <p className={cn("relative mt-2 text-[13.5px] leading-snug sm:min-h-[2.6em]", isPopular ? "text-white/60" : "text-muted-foreground")}>{plan.tagline}</p>

              {/* Lower tiers have no button; keep the row on desktop so the cards align, drop it on phones. */}
              <div className={cn("relative mt-5", !canUpgrade && !isCurrent && "hidden sm:block")}>
                {canUpgrade ? (
                  <button
                    type="button"
                    onClick={() => onCheckout(plan.id as "hobby" | "pro" | "team")}
                    disabled={checkoutLoading}
                    className={cn("pill pill-sm w-full disabled:opacity-60", isPopular ? "pill-launch" : "pill-ink")}
                  >
                    {checkoutLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Upgrade to {plan.name} <ArrowRight className="h-4 w-4" /></>}
                  </button>
                ) : isCurrent ? (
                  <div className={cn("pill pill-sm w-full cursor-default border", isPopular ? "border-white/15 text-white/70" : "border-[var(--dz-hairline)] text-muted-foreground")}>
                    Your current plan
                  </div>
                ) : (
                  <div className="h-9" aria-hidden />
                )}
              </div>

              <div className={cn("relative mt-5 border-t pt-5", isPopular ? "border-white/10" : "border-[var(--dz-hairline)]")}>
                {hasLead && <p className={cn("mb-3 text-[13.5px] font-medium", isPopular ? "text-white/80" : "text-foreground/80")}>{lead}</p>}
                <ul className="space-y-2.5">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-[13.5px] leading-snug">
                      <span className={cn(
                        "mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                        isPopular ? "bg-brand/20 text-brand" : "bg-brand/10 text-[var(--dz-green-strong)] dark:text-brand",
                      )}>
                        <Check className="h-2.5 w-2.5" />
                      </span>
                      <span className={isPopular ? "text-white/70" : "text-muted-foreground"}>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-center text-[13.5px] text-muted-foreground">
        Cancel any time. Your projects keep running on Free. Questions?{" "}
        <a href="mailto:support@deployzy.com" className="font-medium text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground">support@deployzy.com</a>
      </p>
    </div>
  );
}
