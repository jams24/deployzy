"use client";

import { useState } from "react";
import { Circle, Gauge, MailCheck, Plus, TrendingUp, Wallet, Wand2 } from "lucide-react";
import { AddFundsModal } from "./add-funds-modal";
import { useNow } from "./use-now";
import { fmtInt, usd, type CreditsResp, type UsageDay } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Credits overview — pay-as-you-go balance hero, rolling spend stats, the
// included-this-month meter, the 30-day daily-spend chart and the per-product
// split. Renders honest empty states for unmetered / fresh accounts.
// ─────────────────────────────────────────────────────────────────────────────

const PRODUCT_META: Record<string, { icon: typeof Wand2; chip: string; text: string }> = {
  ai_builder:   { icon: Wand2,     chip: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  email_verify: { icon: MailCheck, chip: "bg-sky-500",     text: "text-sky-600 dark:text-sky-400" },
  other:        { icon: Gauge,     chip: "bg-zinc-400",    text: "text-zinc-500" },
};
const FALLBACK_CHIPS = ["bg-amber-500", "bg-violet-500", "bg-rose-500"];

function Stat({ label, value, sub, live }: { label: string; value: string; sub?: string; live?: boolean }) {
  return (
    <div className="rounded-xl border border-border/50 px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums tracking-tight ${live ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
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

  return (
    <>
      {/* ── Balance + rolling totals ── */}
      <section className="overflow-hidden rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
            <Wallet className="h-3.5 w-3.5" /> AI &amp; email balance
          </p>
          <div className="flex items-center gap-2">
            {!unlimited && (
              <span className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${pulse ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" : "border-border/60 text-muted-foreground"}`}>
                <Circle className={`h-1.5 w-1.5 fill-current ${pulse ? "animate-ping" : ""}`} /> Live
              </span>
            )}
            {canTopUp && (
              <button
                onClick={() => setBuyOpen(true)}
                className="flex items-center gap-1 rounded-lg bg-foreground px-2.5 py-1.5 text-[11px] font-semibold text-background transition-opacity hover:opacity-85"
              >
                <Plus className="h-3 w-3" /> Add funds
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)] lg:items-center">
          <div>
            <div className="flex items-end gap-2">
              <span className="text-[40px] font-bold leading-none tracking-tight tabular-nums">
                {unlimited ? "∞" : usd(st.available)}
              </span>
              <span className="mb-1 text-sm text-muted-foreground">{unlimited ? "unlimited" : "available"}</span>
            </div>
            <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
              Pay-as-you-go for the AI builder, agent and email verifier — billed to one balance.
              {unlimited && (st.unlimited && data.enabled ? " Unlimited on your plan." : " Metering is currently off — usage is free.")}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Spent today" value={usd(usage?.spent_today ?? 0)} live={pulse} />
            <Stat label="This month" value={usd(usage?.spent_month ?? 0)} />
            <Stat
              label="Included / mo"
              value={st.free_allotment < 0 ? "∞" : usd(st.free_remaining)}
              sub={st.free_allotment < 0 ? "unlimited" : `of ${usd(st.free_allotment)} left`}
            />
            <Stat label="Added funds" value={unlimited ? "∞" : usd(st.wallet)} sub={unlimited ? undefined : "never expires"} />
          </div>
        </div>

        {!unlimited && st.free_allotment >= 0 && st.free_allotment > 0 && (
          <div className="border-t border-border/60 px-4 py-3.5 sm:px-5">
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Included usage this month</span>
              <span className="tabular-nums">{usd(st.free_used)} / {usd(st.free_allotment)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700" style={{ width: `${freeUsedPct}%` }} />
            </div>
          </div>
        )}
      </section>

      {/* ── Chart + product split ── */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* Daily spend */}
        <section className="overflow-hidden rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 lg:col-span-3">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
              <TrendingUp className="h-3.5 w-3.5" /> Daily spend
            </p>
            <span className="text-[11px] tabular-nums text-muted-foreground">{usd(windowTotal)} in {days}d</span>
          </div>
          <div className="relative p-4 sm:p-5">
            <div className="flex h-28 items-end gap-[3px]">
              {trend.map((d, i) => {
                const h = d.credits > 0 ? Math.max(5, (d.credits / trendMax) * 100) : 0;
                const isToday = i === trend.length - 1;
                return (
                  <div key={d.day} className="group relative flex h-full flex-1 items-end">
                    <div
                      className={`w-full rounded-t-sm transition-all duration-500 ${
                        d.credits > 0
                          ? isToday
                            ? "bg-emerald-500"
                            : "bg-emerald-500/35 group-hover:bg-emerald-500/60"
                          : "bg-muted/70"
                      }`}
                      style={{ height: d.credits > 0 ? `${h}%` : "3px" }}
                    />
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[10px] font-medium text-background tabular-nums shadow-md group-hover:block">
                      {dayLabel(d.day)} · {usd(d.credits)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between text-[10px] tabular-nums text-muted-foreground/70">
              <span>{dayLabel(trend[0]?.day ?? "")}</span>
              <span>{dayLabel(trend[Math.floor(trend.length / 2)]?.day ?? "")}</span>
              <span>Today</span>
            </div>
            {windowTotal === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <p className="rounded-full border border-border/60 bg-background/80 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur-sm">
                  No spend in this window — every day shows up here
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Usage by product */}
        <section className="overflow-hidden rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 lg:col-span-2">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Usage by product</p>
            <span className="text-[11px] text-muted-foreground">{days}d</span>
          </div>
          <div className="p-4 sm:p-5">
            {products.length === 0 ? (
              <div className="flex h-[132px] flex-col items-center justify-center text-center">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-muted/40">
                  <Gauge className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="mt-2.5 text-xs text-muted-foreground">No AI or email usage recorded yet.</p>
              </div>
            ) : (
              <>
                {/* Stacked split bar */}
                <div className="flex h-2.5 w-full overflow-hidden rounded-full">
                  {products.map((p, i) => {
                    const meta = PRODUCT_META[p.product] ?? PRODUCT_META.other;
                    const chip = PRODUCT_META[p.product] ? meta.chip : FALLBACK_CHIPS[i % FALLBACK_CHIPS.length];
                    return (
                      <div
                        key={p.product}
                        className={`${chip} h-full first:rounded-l-full last:rounded-r-full transition-all duration-500`}
                        style={{ width: `${(p.credits / productTotal) * 100}%` }}
                      />
                    );
                  })}
                </div>
                <div className="mt-4 space-y-2.5">
                  {products.map((p, i) => {
                    const meta = PRODUCT_META[p.product] ?? PRODUCT_META.other;
                    const Icon = meta.icon;
                    const chip = PRODUCT_META[p.product] ? meta.chip : FALLBACK_CHIPS[i % FALLBACK_CHIPS.length];
                    const pct = Math.round((p.credits / productTotal) * 100);
                    return (
                      <div key={p.product} className="flex items-center gap-2.5">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${chip}`} />
                        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{p.label}</span>
                        <span className="text-[11px] tabular-nums text-muted-foreground">{fmtInt(p.count)} calls</span>
                        <span className="w-14 text-right text-[13px] font-semibold tabular-nums">{usd(p.credits)}</span>
                        <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      {buyOpen && <AddFundsModal data={data} onClose={() => setBuyOpen(false)} />}
    </>
  );
}

export function CreditsOverviewSkeleton() {
  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-5 animate-pulse">
      <div className="h-3 w-36 rounded bg-muted" />
      <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_2fr]">
        <div className="space-y-2">
          <div className="h-10 w-32 rounded-md bg-muted" />
          <div className="h-3 w-56 max-w-full rounded bg-muted" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 rounded-xl bg-muted" />)}
        </div>
      </div>
    </section>
  );
}
