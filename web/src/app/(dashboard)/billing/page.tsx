"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle, Crown, ExternalLink, Gauge, Loader2, PartyPopper,
  Receipt, Rocket, X,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/dashboard/kit";
import { DashMotion } from "@/components/admin/dash-kit";
import { fetchPlanCards } from "@/lib/plans";
import {
  API, authHeaders, type BillingStatus, type CreditsResp,
  type PlanCardData, type UsageResponse,
} from "@/components/billing/types";
import { PlanHero, PlanHeroSkeleton } from "@/components/billing/plan-hero";
import { UsageMeters } from "@/components/billing/usage-meters";
import { CreditsOverview, CreditsOverviewSkeleton } from "@/components/billing/credits-overview";
import { Invoices, CreditsLedger } from "@/components/billing/billing-activity";
import { PlansGrid } from "@/components/billing/plans-grid";

// ─────────────────────────────────────────────────────────────────────────────
// Billing — tabbed into three focused views:
//   Overview  → current plan hero, plan-limit meters, AI balance & spend
//   Plans     → payment method + tier comparison + upgrade CTAs
//   Activity  → subscription invoices + metered AI/email ledger
// Data flows are unchanged from the previous single-scroll page.
// ─────────────────────────────────────────────────────────────────────────────

type TabId = "overview" | "plans" | "activity";

const TABS: { id: TabId; label: string; icon: typeof Gauge }[] = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "plans", label: "Plans", icon: Crown },
  { id: "activity", label: "Activity", icon: Receipt },
];

// Static fallback for first paint / when /api/v1/plans is briefly unreachable.
// Live cards replace this (admin limit edits reflect without a redeploy).
const FALLBACK_PLAN_CARDS: PlanCardData[] = [
  {
    id: "free", name: "Free", price: "$0",
    tagline: "For hobby projects and learning",
    features: [
      "5 reserved subdomains, 5 active tunnels",
      "3 projects, 1 PostgreSQL database (1 GB storage)",
      "1 BYOC server, 1 custom domain",
      "512 MB RAM / 0.25 vCPU per project",
      "50 GB bandwidth, 120 build min / mo",
      "7-day analytics, 3-day deploy logs",
    ],
  },
  {
    id: "hobby", name: "Hobby", price: "$5",
    tagline: "Perfect for indie hackers and side projects",
    features: [
      "All Free features, plus:",
      "5 projects, 3 databases (Postgres, Redis, Mongo, MySQL)",
      "5 GB database storage · migrate existing databases",
      "8 subdomains, 8 tunnels, 2 BYOC servers",
      "2 custom domains, 2 PR previews, 2 cron jobs",
      "1 GB RAM / 0.5 vCPU per project",
      "150 GB bandwidth, 300 build min / mo",
      "TCP/TLS tunnels, private repos, live logs",
      "Health checks, release cmds, Telegram alerts",
      "30-day analytics, 7-day deploy logs",
    ],
  },
  {
    id: "pro", name: "Pro", price: "$12",
    tagline: "Built for production-ready applications",
    features: [
      "10 reserved subdomains, 15 active tunnels",
      "10 projects, 5 databases, 5 BYOC servers",
      "10 GB database storage · migrate existing databases",
      "5 custom domains, 10 standalone services",
      "5 scheduled jobs, 5 active PR previews",
      "1 GB RAM / 1 vCPU per project (configurable)",
      "500 GB bandwidth, 600 build min / mo",
      "Live container logs, release commands, health checks",
      "Private GitHub repos, TCP tunnels, Telegram alerts",
      "90-day analytics, 7-day backups, 14-day deploy logs",
    ],
  },
  {
    id: "team", name: "Team", price: "$35",
    tagline: "For small teams shipping in production",
    features: [
      "Everything in Pro, plus:",
      "50 subdomains / tunnels / projects, 20 databases",
      "50 GB database storage · migrate existing databases",
      "15 BYOC servers, 25 custom domains + services",
      "25 scheduled jobs, 25 active PR previews",
      "Up to 8 GB RAM / 4 vCPU per project",
      "1 TB bandwidth, 1800 build min / mo",
      "30-day backups, 1-year analytics, 30-day deploy logs",
      "Multi-user collaboration (min 2 seats)",
      "Priority support",
    ],
  },
];

export default function BillingPage() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [livePlanCards, setLivePlanCards] = useState<PlanCardData[] | null>(null);
  const [loading, setLoading] = useState(true);

  // AI credits — polled so spend lands without a refresh.
  const [credits, setCredits] = useState<CreditsResp | null>(null);
  const [pulse, setPulse] = useState(false);
  const prevSpend = useRef<number | null>(null);

  // Checkout flow.
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [payMethod, setPayMethod] = useState<"card" | "crypto">("card");
  const [checkoutError, setCheckoutError] = useState("");
  // Post-checkout celebration. The provider redirects here immediately, but
  // the plan only flips once the webhook lands — so we poll rather than
  // claiming success we haven't confirmed.
  const [celebrate, setCelebrate] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmedPlan, setConfirmedPlan] = useState<string | null>(null);
  const [pendingTimedOut, setPendingTimedOut] = useState(false);
  const [pending, setPending] = useState<{
    plan: string; method: string; url: string;
    amount?: number; currency?: string; blocked: boolean;
  } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [tab, setTab] = useState<TabId>("overview");

  function changeTab(v: string | number) {
    const t = (v === "plans" || v === "activity" ? v : "overview") as TabId;
    setTab(t);
    const url = new URL(window.location.href);
    if (t === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", t);
    window.history.replaceState({}, "", url);
  }

  async function loadStatus() {
    try {
      const [sRes, uRes] = await Promise.all([
        fetch(`${API}/api/v1/billing/status`, { headers: authHeaders() }),
        fetch(`${API}/api/v1/users/me/limits`, { headers: authHeaders() }),
      ]);
      if (sRes.ok) setStatus(await sRes.json());
      if (uRes.ok) setUsage(await uRes.json());
    } catch {}
    setLoading(false);
  }

  const loadCredits = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/ai/credits?days=30`, { headers: authHeaders() });
      if (res.ok) {
        const d: CreditsResp = await res.json();
        const s = d.usage?.spent_today ?? 0;
        if (prevSpend.current !== null && s > prevSpend.current) {
          setPulse(true);
          setTimeout(() => setPulse(false), 1500);
        }
        prevSpend.current = s;
        setCredits(d);
      }
    } catch { /* ignore */ }
  }, []);

  // Open the provider's hosted page in a NEW TAB and keep this page waiting on
  // the webhook. Redirecting away meant the user lost their place, and for
  // crypto (InventPay can't redirect back) they never returned at all — the
  // upgrade appeared to do nothing until they refreshed manually.
  async function checkout(plan: "hobby" | "pro" | "team", method: "crypto" | "card" = payMethod) {
    setCheckoutLoading(true);
    setCheckoutError("");
    try {
      const res = await fetch(`${API}/api/v1/billing/checkout`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ plan, method }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCheckoutError(data.error || "Failed to create checkout");
        return;
      }

      // Popup blockers only allow this because it's inside the click handler's
      // async chain from a user gesture; if it's still blocked the modal shows
      // the link so the user can open it manually.
      // No "noopener" in the features string: with it, window.open always
      // returns null, so every checkout looked "blocked". Sever the opener by
      // hand instead, which keeps the same protection.
      const win = window.open(data.invoice_url, "_blank");
      if (win) {
        try { win.opener = null; } catch { /* cross-origin already */ }
      }
      setPending({
        plan,
        method,
        url: data.invoice_url,
        amount: data.amount,
        currency: data.currency,
        blocked: !win,
      });
      watchForActivation(plan);
    } catch (e) {
      setCheckoutError(e instanceof Error ? e.message : "Network error creating checkout");
    } finally {
      setCheckoutLoading(false);
    }
  }

  // Poll billing status until the provider's webhook flips the subscription
  // active. Card usually lands in seconds; crypto waits for confirmations, so
  // this runs long and the modal stays honest about what's happening.
  function watchForActivation(plan: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    const started = Date.now();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/v1/billing/status`, { headers: authHeaders() });
        if (res.ok) {
          const d: BillingStatus = await res.json();
          if (d.active_subscription?.status === "active") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setPending(null);
            setConfirmedPlan(d.active_subscription.plan || plan);
            setCelebrate(true);
            loadStatus();
            return;
          }
        }
      } catch {}
      // Stop nagging the API after 30 minutes; the email confirmation is the
      // backstop and the modal says so.
      if (Date.now() - started > 30 * 60 * 1000 && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setPendingTimedOut(true);
      }
    }, 4000);
  }

  useEffect(() => {
    // Deep-link: ?tab=plans|activity
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "plans" || t === "activity") setTab(t);

    loadStatus();
    loadCredits();
    const creditsPoll = setInterval(loadCredits, 20000);
    // Live plan cards from plan_limits (reflect admin edits without redeploy).
    fetchPlanCards().then((cards) => {
      if (cards) setLivePlanCards(cards.map((c) => ({ id: c.id, name: c.name, price: c.price, tagline: c.tagline, features: c.features })));
    });
    return () => {
      clearInterval(creditsPoll);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadCredits]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("status") !== "success") return;

    setCelebrate(true);
    setConfirming(true);
    // Clean the URL so a refresh doesn't replay the celebration.
    window.history.replaceState({}, "", "/billing");

    let cancelled = false;
    (async () => {
      // Webhooks usually land in a second or two; keep checking for ~90s
      // before falling back to "we'll email you when it clears".
      for (let i = 0; i < 30 && !cancelled; i++) {
        try {
          const res = await fetch(`${API}/api/v1/billing/status`, { headers: authHeaders() });
          if (res.ok) {
            const d: BillingStatus = await res.json();
            if (d.active_subscription?.status === "active") {
              if (cancelled) return;
              setConfirmedPlan(d.active_subscription.plan);
              setConfirming(false);
              loadStatus();
              return;
            }
          }
        } catch {}
        await new Promise(r => setTimeout(r, 3000));
      }
      if (!cancelled) setConfirming(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const activeSub = status?.active_subscription;
  const isPremium = activeSub && activeSub.status === "active";
  const currentPlan = usage?.plan || (isPremium ? "pro" : "free");
  const planCards = livePlanCards ?? FALLBACK_PLAN_CARDS;

  const planName = planCards.find((p) => p.id === currentPlan)?.name ?? (currentPlan ? currentPlan[0].toUpperCase() + currentPlan.slice(1) : "Free");

  const closePending = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setPending(null);
    setPendingTimedOut(false);
    loadStatus();
  };

  // ── Post-checkout celebration takes over the page until dismissed ──
  if (celebrate) {
    const confirmedName = confirmedPlan ? confirmedPlan[0].toUpperCase() + confirmedPlan.slice(1) : null;
    const l = usage?.limits;
    const tiles = l
      ? [
          { label: "Projects", value: l.max_projects < 0 ? "No cap" : String(l.max_projects) },
          { label: "Memory", value: l.max_memory_mb < 0 ? "No cap" : l.max_memory_mb >= 1024 ? `${+(l.max_memory_mb / 1024).toFixed(1)} GB` : `${l.max_memory_mb} MB` },
          { label: "Bandwidth", value: l.max_bandwidth_gb < 0 ? "No cap" : `${l.max_bandwidth_gb} GB` },
        ]
      : [];
    const back = () => { setCelebrate(false); loadStatus(); };
    return (
      <div className="relative flex min-h-[72vh] items-center justify-center py-10">
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-[14%] h-64 w-[min(560px,90vw)] -translate-x-1/2 rounded-full bg-brand/[0.12] blur-[100px]" />
        <div className="rise relative w-full max-w-md text-center">
          <span className={cn("mx-auto flex h-16 w-16 items-center justify-center rounded-[22px]", confirming ? "surface" : "bg-brand/15")}>
            {confirming
              ? <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
              : <PartyPopper className="h-7 w-7 text-[var(--dz-green-strong)] dark:text-brand" />}
          </span>

          {confirming ? (
            <>
              <p className="eyebrow mt-7">Checkout complete</p>
              <h1 className="mt-3 text-[clamp(1.8rem,5vw,2.4rem)] font-semibold leading-[1.08] tracking-[-0.04em]">Confirming your payment</h1>
              <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">
                This usually takes a few seconds. You can leave this page; we&apos;ll email you the moment it clears.
              </p>
            </>
          ) : confirmedName ? (
            <>
              <p className="eyebrow mt-7">Subscription active</p>
              <h1 className="mt-3 text-[clamp(1.9rem,5.4vw,2.6rem)] font-semibold leading-[1.06] tracking-[-0.045em]">
                Welcome to <span className="accent-serif text-launch">{confirmedName}</span>
              </h1>
              <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">
                The new limits apply right now, with nothing to redeploy. A receipt is on its way to your inbox.
              </p>
              {tiles.length > 0 && (
                <dl className="surface mt-7 grid grid-cols-3 divide-x divide-[var(--dz-hairline)] overflow-hidden rounded-[20px] text-left">
                  {tiles.map((t) => (
                    <div key={t.label} className="p-3.5">
                      <dt className="text-[12.5px] text-muted-foreground">{t.label}</dt>
                      <dd className="mt-1 text-[17px] font-semibold tracking-tight tabular-nums">{t.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:justify-center">
                <Link href="/new" className="pill pill-launch"><Rocket className="h-4 w-4" /> Deploy something</Link>
                <button type="button" onClick={back} className="pill pill-line">View billing</button>
              </div>
            </>
          ) : (
            <>
              <p className="eyebrow mt-7">Payment received</p>
              <h1 className="mt-3 text-[clamp(1.8rem,5vw,2.4rem)] font-semibold leading-[1.08] tracking-[-0.04em]">Almost there</h1>
              <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">
                We haven&apos;t seen the confirmation yet. Crypto payments can take a few minutes to settle. Your plan
                upgrades on its own once it lands, and we&apos;ll email you. Nothing else to do.
              </p>
              <button type="button" onClick={back} className="pill pill-line mt-7">Back to billing</button>
            </>
          )}

          <p className="mt-8 text-[13.5px] text-muted-foreground">
            Questions? <a href="mailto:support@deployzy.com" className="font-medium text-foreground hover:underline">support@deployzy.com</a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up">
      <DashMotion />

      {/* Payment-in-progress sheet. The provider's page is open in another tab;
          this stays put and waits for the webhook rather than navigating away.
          Portaled to <body> so the wrapper's entrance transform can't trap it. */}
      {pending && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:px-4"
          style={{ animation: "dz-fade .2s ease both" }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pay-title"
            className="w-full max-w-md rounded-t-[26px] border border-[var(--dz-hairline)] bg-background pb-[env(safe-area-inset-bottom)] shadow-2xl sm:rounded-[26px]"
            style={{ animation: "dz-pop .25s cubic-bezier(.2,.7,.2,1) both" }}
          >
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-foreground/15 sm:hidden" aria-hidden />
            <div className="p-5 sm:p-6">
              <div className="flex items-center gap-3.5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand/10">
                  <Loader2 className="h-5 w-5 animate-spin text-[var(--dz-green-strong)] dark:text-brand" />
                </span>
                <div className="min-w-0">
                  <p className="eyebrow">Waiting for payment</p>
                  <h2 id="pay-title" className="mt-1 text-[20px] font-semibold leading-tight tracking-[-0.03em]">
                    {pendingTimedOut ? "Still waiting on your payment" : pending.blocked ? "Open the payment page" : "Complete your payment"}
                  </h2>
                </div>
              </div>

              <p className="mt-4 text-[14px] leading-relaxed text-muted-foreground">
                {pendingTimedOut
                  ? "We haven't seen the confirmation yet. Your plan upgrades the moment it lands and we'll email you, so you can close this."
                  : pending.blocked
                    ? "Your browser blocked the payment window. Use the button below to open it."
                    : `We opened the ${pending.method === "card" ? "card checkout" : "crypto invoice"} in a new tab. Finish there and this page updates on its own.`}
              </p>

              <dl className="mt-4 divide-y divide-[var(--dz-hairline)] rounded-2xl border border-[var(--dz-hairline)] text-[14px]">
                <div className="flex items-center justify-between px-4 py-2.5">
                  <dt className="text-muted-foreground">Plan</dt>
                  <dd className="font-medium capitalize">{pending.plan}</dd>
                </div>
                {pending.amount !== undefined && (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <dt className="text-muted-foreground">Amount</dt>
                    <dd className="font-medium tabular-nums">{pending.amount} {pending.currency}</dd>
                  </div>
                )}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <dt className="text-muted-foreground">Method</dt>
                  <dd className="font-medium">{pending.method === "card" ? "Card" : "Crypto"}</dd>
                </div>
              </dl>

              {pending.method === "crypto" && !pendingTimedOut && (
                <p className="mt-3 text-[13px] text-muted-foreground">Crypto payments confirm on-chain, which can take a few minutes.</p>
              )}

              <div className="mt-5 flex flex-col gap-2">
                <a
                  href={pending.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn("pill pill-sm w-full", pending.blocked ? "pill-launch" : "pill-line")}
                >
                  <ExternalLink className="h-4 w-4" />
                  {pending.blocked ? "Open payment page" : "Reopen payment page"}
                </a>
                <button type="button" onClick={closePending} className="pill pill-sm w-full text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground">
                  {pendingTimedOut ? "Close" : "Cancel"}
                </button>
              </div>

              <p className="mt-3 text-center text-[12.5px] text-muted-foreground">
                Closing this won&apos;t cancel the payment. Your plan still upgrades once it clears.
              </p>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <PageHeader eyebrow="Account" title="Billing" description="Your plan, what you're using, and every payment, in one place." />

      {/* Grace period: the subscription lapsed but paid features stay on until
          access_ends. Renewing before then avoids the drop to Free. */}
      {status?.grace && (
        <div className="mt-5 flex flex-col gap-3 rounded-[20px] border border-amber-500/30 bg-amber-500/[0.06] p-4 sm:flex-row sm:items-center">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px] font-semibold text-amber-800 dark:text-amber-300">
              Your <span className="capitalize">{status.grace.plan}</span> subscription has expired
            </p>
            <p className="mt-0.5 text-[13.5px] leading-snug text-amber-700/90 dark:text-amber-400/80">
              Paid features stay on until{" "}
              <span className="font-semibold">{new Date(status.grace.access_ends).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>.
              Renew before then to stay on {status.grace.plan}. Your projects keep running either way.
            </p>
          </div>
          <button
            type="button"
            className="pill pill-ink pill-sm shrink-0 disabled:opacity-60"
            disabled={checkoutLoading}
            onClick={() => checkout(status.grace!.plan as "hobby" | "pro" | "team", payMethod)}
          >
            {checkoutLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Renew now"}
          </button>
        </div>
      )}

      {checkoutError && (
        <div role="alert" className="mt-5 flex items-start gap-3 rounded-[20px] border border-red-500/30 bg-red-500/[0.06] px-4 py-3.5 text-[14px] text-red-700 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{checkoutError}</span>
          <button type="button" onClick={() => setCheckoutError("")} className="-m-1 rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Section switch */}
      <div role="tablist" aria-label="Billing sections" className="mt-6 flex h-11 w-full items-center gap-0.5 rounded-full bg-foreground/[0.05] p-1 sm:inline-flex sm:w-auto">
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`billing-tab-${t.id}`}
              aria-selected={on}
              aria-controls={`billing-panel-${t.id}`}
              onClick={() => changeTab(t.id)}
              className={cn(
                "flex h-full flex-1 items-center justify-center gap-1.5 rounded-full px-4 text-[14px] font-medium transition-colors sm:flex-none sm:px-5",
                on ? "bg-background text-foreground shadow-sm dark:bg-white/[0.1]" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>

      <div
        key={tab}
        role="tabpanel"
        id={`billing-panel-${tab}`}
        aria-labelledby={`billing-tab-${tab}`}
        className="mt-5"
        style={{ animation: "dz-fade .25s ease both" }}
      >
        {tab === "overview" && (
          <div className="space-y-6">
            {loading ? (
              <>
                <PlanHeroSkeleton />
                <CreditsOverviewSkeleton />
              </>
            ) : (
              <>
                <PlanHero usage={usage} status={status} planCards={planCards} onManagePlan={() => changeTab("plans")} />
                {usage && <UsageMeters usage={usage} planName={planName} onUpgrade={() => changeTab("plans")} />}
                {credits ? <CreditsOverview data={credits} pulse={pulse} /> : <CreditsOverviewSkeleton />}
              </>
            )}
          </div>
        )}

        {tab === "plans" && (
          <PlansGrid
            planCards={planCards}
            currentPlan={currentPlan}
            isAdmin={usage?.is_admin ?? false}
            payMethod={payMethod}
            onPayMethod={setPayMethod}
            onCheckout={(plan) => checkout(plan, payMethod)}
            checkoutLoading={checkoutLoading}
          />
        )}

        {tab === "activity" && (
          <div className="grid items-start gap-3 xl:grid-cols-2">
            <Invoices history={status?.history ?? []} />
            {credits && <CreditsLedger ledger={credits.ledger} />}
          </div>
        )}
      </div>
    </div>
  );
}
