"use client";

import { Bitcoin, Check, CreditCard, Crown, Loader2, Rocket, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PlanCardData } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Plans tab — compact payment-method segmented control driving all upgrade
// buttons, then the four-tier comparison. Pro is the visual anchor; the
// current plan is ringed and its button becomes a disabled state.
// ─────────────────────────────────────────────────────────────────────────────

const TIER_ORDER = ["free", "hobby", "pro", "team"];

const PLAN_ICON: Record<string, { icon: typeof Zap; tile: string }> = {
  free:  { icon: Sparkles, tile: "border-zinc-500/20 bg-zinc-500/10 text-zinc-500 dark:text-zinc-400" },
  hobby: { icon: Rocket,   tile: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  pro:   { icon: Zap,      tile: "border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  team:  { icon: Crown,    tile: "border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-400" },
};

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
  return (
    <div className="space-y-5">
      {/* Payment method — one compact control drives every upgrade button */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="inline-flex items-center gap-1 rounded-xl border border-border/60 bg-card/60 p-1 dark:bg-[#0c0d0f]/40">
          <button
            onClick={() => onPayMethod("card")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all ${
              payMethod === "card" ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <CreditCard className="h-3.5 w-3.5" /> Card
          </button>
          <button
            onClick={() => onPayMethod("crypto")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all ${
              payMethod === "crypto" ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Bitcoin className="h-3.5 w-3.5" /> Crypto
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {payMethod === "card"
            ? "Visa, Mastercard, Amex — processed by Polar."
            : "BTC, ETH, USDT, SOL, LTC — processed by InventPay."}
        </p>
      </div>

      {/* Tier cards */}
      <div className="grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {planCards.map((plan) => {
          // Admins get no CTAs: every tier is below "unlimited", and an
          // unknown plan id must never mark everything upgradable.
          const knownTier = TIER_ORDER.includes(currentPlan);
          const isCurrent = !isAdmin && currentPlan === plan.id;
          const canUpgrade = !isAdmin && knownTier && TIER_ORDER.indexOf(plan.id) > TIER_ORDER.indexOf(currentPlan);
          const isPopular = plan.id === "pro";
          const { icon: Icon, tile } = PLAN_ICON[plan.id] ?? PLAN_ICON.free;
          return (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-2xl border bg-card/60 p-5 transition-all dark:bg-[#0c0d0f]/40 ${
                isPopular
                  ? "border-primary/40 shadow-[0_0_36px_-12px] shadow-primary/25"
                  : isCurrent
                    ? "border-emerald-500/40"
                    : "border-border/60 hover:border-border"
              }`}
            >
              {isPopular && !isCurrent && (
                <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                  <span className="rounded-full bg-foreground px-2.5 py-0.5 text-[10px] font-semibold text-background shadow-sm">
                    Most popular
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl border ${tile}`}>
                  <Icon className="h-4 w-4" />
                </div>
                {isCurrent && (
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                    Current plan
                  </span>
                )}
              </div>

              <h3 className="mt-3 text-base font-semibold tracking-tight">{plan.name}</h3>
              <p className="mt-1.5">
                <span className="text-[28px] font-bold leading-none tracking-tight tabular-nums">{plan.price}</span>
                {plan.id !== "free" && (
                  <span className="text-xs text-muted-foreground">/mo{plan.id === "team" ? " per seat" : ""}</span>
                )}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{plan.tagline}</p>

              <ul className="mt-4 flex-1 space-y-2 border-t border-border/50 pt-4">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[12.5px] leading-snug">
                    <Check className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${isPopular || plan.id === "team" ? "text-emerald-500" : "text-zinc-400"}`} />
                    <span className="text-muted-foreground">{f}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-5 h-9">
                {canUpgrade ? (
                  <Button
                    onClick={() => onCheckout(plan.id as "hobby" | "pro" | "team")}
                    disabled={checkoutLoading}
                    variant={isPopular ? "default" : "outline"}
                    className="w-full gap-1.5 rounded-lg"
                  >
                    {checkoutLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                    Upgrade to {plan.name}
                  </Button>
                ) : isCurrent ? (
                  <Button variant="outline" disabled className="w-full rounded-lg">Your current plan</Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-center text-[11px] text-muted-foreground">
        Cancel anytime — projects keep running on the Free plan. Questions?{" "}
        <a href="mailto:support@deployzy.com" className="underline underline-offset-2 hover:text-foreground">support@deployzy.com</a>
      </p>
    </div>
  );
}
