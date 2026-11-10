"use client";

import { useState } from "react";
import { Gauge, MailCheck, Plus, TrendingUp, Wallet, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AddFundsModal } from "./add-funds-modal";
import { useNow } from "./use-now";
import { fmtInt, usd, type CreditsResp, type UsageDay } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Credits overview: the pay-as-you-go balance, rolling spend, the included
// allowance for the month, a 30-day daily-spend chart and the split by
// product. Honest empty states for unmetered and brand-new accounts.
// ─────────────────────────────────────────────────────────────────────────────

const PRODUCT_META: Record<string, { icon: typeof Wand2; chip: string }> = {
  ai_builder:   { icon: Wand2,     chip: "bg-brand" },
  email_verify: { icon: MailCheck, chip: "bg-brand-cyan" },
  other:        { icon: Gauge,     chip: "bg-zinc-400" },
};
const FALLBACK_CHIPS = ["bg-amber-500", "bg-violet-500", "bg-rose-500"];

function Stat({ label, value, sub, live }: { label: string; value: string; sub?: string; live?: boolean }) {
  return (
    <div className="min-w-0 bg-card p-3.5 sm:p-4">
      <p className="truncate text-[13px] text-muted-foreground">{label}</p>
      <p className={cn("mt-1.5 text-[19px] font-semibold leading-none tracking-tight tabular-nums transition-colors", live && "text-[var(--dz-green-strong)] dark:text-brand")}>{value}</p>
      {sub && <p className="mt-1.5 truncate text-[12.5px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function CreditsOverview({ data, pulse }: { data: CreditsResp; pulse: boolean }) {
  const [buyOpen, setBuyOpen] = useState(false);

  const st = data.status;
  const unlimited = data.unlimited || st.unlimited || !data.enabled;
  const methods = data.methods || { crypto: true, card: false };
  const canTopUp = !unlimited && (methods.crypto || methods.card);
  const usage = data.usage;
  const freeUsedPct = st.free_allotment > 0 ? Math.min(100, (st.free_used / st.free_allotment) * 100) : 0;

  const days = usage?.days ?? 30;
  const now = useNow();
  const trend: UsageDay[] = (() => {
    if (now === null) return [];
    const map = new Map((usage?.daily ?? []).map((d) => [d.day, d.credits]));
    const out: UsageDay[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now - i * 86400000).toISOString().slice(0, 10);
      out.push({ day: d, credits: map.get(d) ?? 0 });
    }
    return out;
  })();
  const trendMax = Math.max(0.001, ...trend.map((d) => d.credits));
  const windowTotal = usage?.spent_window ?? 0;

  const products = (usage?.products ?? []).slice().sort((a, b) => b.credits - a.credits);
  const productTotal = Math.max(0.001, products.reduce((s, p) => s + p.credits, 0));

  const dayLabel = (iso: string) => iso ? new Date(iso + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";

  const note = unlimited
    ? (st.unlimited && data.enabled ? "Unlimited on your account, so nothing is deducted." : "Metering is switched off right now, so usage is free.")
    : "One balance pays for the AI builder, the agent and the email verifier.";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 pt-3">
        <p className="eyebrow">AI &amp; email</p>
        {!unlimited && (
          <span className={cn("flex items-center gap-1.5 text-[13.5px] transition-colors", pulse ? "text-[var(--dz-green-strong)] dark:text-brand" : "text-muted-foreground")}>
            <span className={cn("live-dot", !pulse && "opacity-70")} aria-hidden /> Updates live
          </span>
        )}
      </div>

      {/* Balance + rolling totals */}
      <section className="surface overflow-hidden rounded-[20px]">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
          <div className="flex items-start gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand/10 text-[var(--dz-green-strong)] dark:text-brand">
              <Wallet className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[13.5px] text-muted-foreground">{unlimited ? "Balance" : "Available balance"}</p>
              <p className="mt-1 text-[34px] font-semibold leading-none tracking-[-0.04em] tabular-nums">
                {unlimited ? "Unlimited" : usd(st.available)}
              </p>
              <p className="mt-2 max-w-sm text-[13.5px] leading-snug text-muted-foreground">{note}</p>
            </div>
          </div>
          {canTopUp && (
            <button type="button" onClick={() => setBuyOpen(true)} className="pill pill-ink pill-sm w-full sm:w-auto">
              <Plus className="h-4 w-4" /> Add funds
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-px border-t border-[var(--dz-hairline)] bg-[var(--dz-hairline)] sm:grid-cols-4">
          <Stat label="Spent today" value={usd(usage?.spent_today ?? 0)} live={pulse} />
          <Stat label="This month" value={usd(usage?.spent_month ?? 0)} />
          <Stat
            label="Included / month"
            value={st.free_allotment < 0 ? "No cap" : usd(st.free_remaining)}
            sub={st.free_allotment < 0 ? "unlimited" : `left of ${usd(st.free_allotment)}`}
          />
          <Stat label="Added funds" value={unlimited ? "n/a" : usd(st.wallet)} sub={unlimited ? undefined : "never expires"} />
        </div>

        {!unlimited && st.free_allotment > 0 && (
          <div className="border-t border-[var(--dz-hairline)] px-4 py-3.5 sm:px-5">
            <div className="mb-2 flex items-center justify-between gap-3 text-[13.5px] text-muted-foreground">
              <span>Included usage this month</span>
              <span className="tabular-nums">{usd(st.free_used)} of {usd(st.free_allotment)}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.07]">
              <div className="h-full rounded-full bg-gradient-to-r from-brand to-brand-cyan transition-all duration-700" style={{ width: `${freeUsedPct}%` }} />
            </div>
          </div>
        )}
      </section>

      {/* Chart + product split */}
      <div className="grid gap-3 lg:grid-cols-5">
        <section className="surface overflow-hidden rounded-[20px] lg:col-span-3">
          <div className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
            <p className="flex items-center gap-2 text-[14.5px] font-semibold tracking-tight">
              <TrendingUp className="h-4 w-4 text-muted-foreground" /> Daily spend
            </p>
            <span className="text-[13.5px] tabular-nums text-muted-foreground">{usd(windowTotal)} in {days} days</span>
          </div>
          <div className="relative p-4 sm:p-5">
            <div className="flex h-28 items-end gap-[3px]">
              {trend.map((d, i) => {
                const h = d.credits > 0 ? Math.max(5, (d.credits / trendMax) * 100) : 0;
                const isToday = i === trend.length - 1;
                return (
                  <div key={d.day} className="group relative flex h-full flex-1 items-end">
                    <div
                      className={cn(
                        "w-full rounded-t-[3px] transition-all duration-500",
                        d.credits > 0
                          ? isToday ? "bg-brand" : "bg-brand/40 group-hover:bg-brand/70"
                          : "bg-foreground/[0.06]",
                      )}
                      style={{ height: d.credits > 0 ? `${h}%` : "3px" }}
                    />
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[12.5px] font-medium text-background tabular-nums shadow-md group-hover:block">
                      {dayLabel(d.day)} · {usd(d.credits)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between text-[12.5px] tabular-nums text-muted-foreground/80">
              <span>{dayLabel(trend[0]?.day ?? "")}</span>
              <span className="hidden min-[420px]:inline">{dayLabel(trend[Math.floor(trend.length / 2)]?.day ?? "")}</span>
              <span>Today</span>
            </div>
            {windowTotal === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
                <p className="rounded-full border border-[var(--dz-hairline)] bg-background/85 px-3.5 py-1.5 text-center text-[13.5px] text-muted-foreground backdrop-blur-sm">
                  No spend in the last {days} days
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="surface overflow-hidden rounded-[20px] lg:col-span-2">
          <div className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
            <p className="text-[14.5px] font-semibold tracking-tight">By product</p>
            <span className="text-[13.5px] text-muted-foreground">{days} days</span>
          </div>
          <div className="p-4 sm:p-5">
            {products.length === 0 ? (
              <div className="flex h-[132px] flex-col items-center justify-center text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-foreground/[0.05]">
                  <Gauge className="h-4 w-4 text-muted-foreground" />
                </span>
                <p className="mt-3 max-w-[16rem] text-[13.5px] leading-snug text-muted-foreground">No AI or email usage yet. Builds, agent chats and verifications show up here.</p>
              </div>
            ) : (
              <>
                <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full">
                  {products.map((p, i) => {
                    const chip = PRODUCT_META[p.product]?.chip ?? FALLBACK_CHIPS[i % FALLBACK_CHIPS.length];
                    return <div key={p.product} className={cn(chip, "h-full transition-all duration-500")} style={{ width: `${(p.credits / productTotal) * 100}%` }} />;
                  })}
                </div>
                <ul className="mt-4 space-y-3">
                  {products.map((p, i) => {
                    const meta = PRODUCT_META[p.product] ?? PRODUCT_META.other;
                    const Icon = meta.icon;
                    const chip = PRODUCT_META[p.product]?.chip ?? FALLBACK_CHIPS[i % FALLBACK_CHIPS.length];
                    const pct = Math.round((p.credits / productTotal) * 100);
                    return (
                      <li key={p.product} className="flex items-center gap-2.5">
                        <span className={cn("h-2 w-2 shrink-0 rounded-full", chip)} />
                        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium">{p.label}</span>
                          <span className="block text-[12.5px] tabular-nums text-muted-foreground">{fmtInt(p.count)} call{p.count === 1 ? "" : "s"} · {pct}%</span>
                        </span>
                        <span className="text-[14px] font-semibold tabular-nums">{usd(p.credits)}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </section>
      </div>

      {buyOpen && <AddFundsModal data={data} onClose={() => setBuyOpen(false)} />}
    </div>
  );
}

export function CreditsOverviewSkeleton() {
  return (
    <section className="surface animate-pulse overflow-hidden rounded-[20px] p-5">
      <div className="flex items-start gap-3.5">
        <div className="h-11 w-11 rounded-2xl bg-muted" />
        <div className="flex-1 space-y-2.5">
          <div className="h-3 w-28 rounded-full bg-muted" />
          <div className="h-8 w-40 rounded-lg bg-muted" />
          <div className="h-3 w-64 max-w-full rounded-full bg-muted" />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 rounded-xl bg-muted" />)}
      </div>
    </section>
  );
}
