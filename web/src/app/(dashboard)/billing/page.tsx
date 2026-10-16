"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle, Crown, ExternalLink, Gauge, Loader2, PartyPopper,
  Receipt, X, Zap,
} from "lucide-react";
import Link from "next/link";
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
      const win = window.open(data.invoice_url, "_blank", "noopener,noreferrer");
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

  // ── Post-checkout celebration takes over the page until dismissed ──
  if (celebrate) {
    const planName = confirmedPlan ? confirmedPlan[0].toUpperCase() + confirmedPlan.slice(1) : null;
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="mb-6 flex justify-center">
            <div className={`flex h-16 w-16 items-center justify-center rounded-full ${confirming ? "bg-muted" : "bg-emerald-500/15"}`}>
              {confirming
                ? <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                : <PartyPopper className="h-8 w-8 text-emerald-500" />}
            </div>
          </div>

          {confirming ? (
            <>
              <h1 className="text-2xl font-bold">Confirming your payment…</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                This usually takes a few seconds. You can leave this page — we&apos;ll email
                you the moment it clears.
              </p>
            </>
          ) : planName ? (
            <>
              <h1 className="text-3xl font-bold tracking-tight">Welcome to {planName}! 🎉</h1>
              <p className="mt-3 text-sm text-muted-foreground">
                Your subscription is active and the new limits apply right now —
                nothing to redeploy. A receipt is on its way to your inbox.
              </p>

              {usage && (
                <div className="mt-6 grid grid-cols-3 gap-2 text-left">
                  <div className="rounded-xl border border-border/60 px-3 py-2">
                    <div className="text-[10px] text-muted-foreground">Projects</div>
                    <div className="font-mono text-sm">{usage.limits.max_projects < 0 ? "∞" : usage.limits.max_projects}</div>
                  </div>
                  <div className="rounded-xl border border-border/60 px-3 py-2">
                    <div className="text-[10px] text-muted-foreground">Memory</div>
                    <div className="font-mono text-sm">{usage.limits.max_memory_mb} MB</div>
                  </div>
                  <div className="rounded-xl border border-border/60 px-3 py-2">
                    <div className="text-[10px] text-muted-foreground">Bandwidth</div>
                    <div className="font-mono text-sm">{usage.limits.max_bandwidth_gb} GB</div>
                  </div>
                </div>
              )}

              <div className="mt-7 flex flex-col gap-2">
                <Button className="w-full gap-2" nativeButton={false} render={<Link href="/new" />}>
                  <Zap className="h-4 w-4" /> Deploy something
                </Button>
                <Button variant="outline" className="w-full" onClick={() => { setCelebrate(false); loadStatus(); }}>
                  View billing details
                </Button>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold">Payment received</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                We haven&apos;t seen the confirmation yet — crypto payments can take a few
                minutes to settle. Your plan upgrades automatically once it lands, and
                we&apos;ll email you. Nothing else to do.
              </p>
              <Button variant="outline" className="mt-6 w-full" onClick={() => { setCelebrate(false); loadStatus(); }}>
                Back to billing
              </Button>
            </>
          )}

          <p className="mt-6 text-xs text-muted-foreground">
            Questions? <a href="mailto:support@deployzy.com" className="hover:underline">support@deployzy.com</a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up">
      {/* Payment-in-progress modal. The provider's page is open in another tab;
          this stays put and waits for the webhook rather than navigating away. */}
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border/70 bg-background shadow-2xl">
            <div className="p-6 text-center">
              <div className="mb-4 flex justify-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                  <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
                </div>
              </div>

              <h2 className="text-lg font-semibold">
                {pendingTimedOut ? "Still waiting on your payment" : "Complete your payment"}
              </h2>

              {pendingTimedOut ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  We haven&apos;t seen the confirmation yet. Your plan upgrades automatically
                  the moment it lands and we&apos;ll email you — you can safely close this.
                </p>
              ) : pending.blocked ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Your browser blocked the payment window. Use the link below to open it.
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  We opened the {pending.method === "card" ? "card checkout" : "crypto invoice"} in a
                  new tab. Finish there and this page updates on its own — no need to refresh.
                </p>
              )}

              <div className="mt-4 rounded-xl border border-border/60 px-3.5 py-2.5 text-left text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Plan</span>
                  <span className="font-medium capitalize">{pending.plan}</span>
                </div>
                {pending.amount !== undefined && (
                  <div className="mt-1 flex justify-between">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-medium">{pending.amount} {pending.currency}</span>
                  </div>
                )}
                <div className="mt-1 flex justify-between">
                  <span className="text-muted-foreground">Method</span>
                  <span className="font-medium">{pending.method === "card" ? "Card" : "Crypto"}</span>
                </div>
              </div>

              {pending.method === "crypto" && !pendingTimedOut && (
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Crypto payments confirm on-chain — this can take a few minutes.
                </p>
              )}

              <div className="mt-5 flex flex-col gap-2">
                <Button
                  variant={pending.blocked ? "default" : "outline"}
                  className="w-full gap-2"
                  nativeButton={false}
                  render={<a href={pending.url} target="_blank" rel="noopener noreferrer" />}
                >
                  <ExternalLink className="h-4 w-4" />
                  {pending.blocked ? "Open payment page" : "Reopen payment page"}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full text-muted-foreground"
                  onClick={() => {
                    if (pollRef.current) clearInterval(pollRef.current);
                    pollRef.current = null;
                    setPending(null);
                    setPendingTimedOut(false);
                    loadStatus();
                  }}
                >
                  {pendingTimedOut ? "Close" : "Cancel"}
                </Button>
              </div>

              <p className="mt-4 text-[10px] text-muted-foreground">
                Closing this won&apos;t cancel the payment — your plan still upgrades once it clears.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Account</p>
        <h1 className="mt-1 text-[22px] font-bold tracking-[-0.02em] sm:text-[26px]">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your plan, usage and payments — all in one place.
        </p>
      </div>

      {/* Grace-period banner: subscription lapsed but paid features are still on
          until access_ends. Renewing before then avoids the drop to Free. */}
      {status?.grace && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="flex-1 text-sm">
            <p className="font-semibold text-amber-700 dark:text-amber-300">
              Your <span className="capitalize">{status.grace.plan}</span> subscription has expired
            </p>
            <p className="mt-0.5 text-amber-600/90 dark:text-amber-400/80">
              Features stay active during a grace period. Renew before{" "}
              <span className="font-semibold">{new Date(status.grace.access_ends).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>{" "}
              to avoid moving to Free — your projects keep running either way.
            </p>
          </div>
          <Button
            size="sm"
            className="shrink-0 rounded-lg"
            disabled={checkoutLoading}
            onClick={() => checkout(status.grace!.plan as "hobby" | "pro" | "team", payMethod)}
          >
            {checkoutLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Renew now"}
          </Button>
        </div>
      )}

      {checkoutError && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/[0.06] px-4 py-3.5 text-sm text-red-600 dark:text-red-400">
          <span className="flex-1">{checkoutError}</span>
          <button onClick={() => setCheckoutError("")} className="rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground" aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={changeTab} className="mt-6">
        <TabsList>
          <TabsTrigger value="overview" className="gap-1.5 px-3 text-xs">
            <Gauge className="h-3.5 w-3.5" /> Overview
          </TabsTrigger>
          <TabsTrigger value="plans" className="gap-1.5 px-3 text-xs">
            <Crown className="h-3.5 w-3.5" /> Plans
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-1.5 px-3 text-xs">
            <Receipt className="h-3.5 w-3.5" /> Activity
          </TabsTrigger>
        </TabsList>

        {/* ── Overview ── */}
        <TabsContent value="overview" className="mt-5 space-y-4">
          {loading ? (
            <>
              <PlanHeroSkeleton />
              <CreditsOverviewSkeleton />
            </>
          ) : (
            <>
              <PlanHero
                usage={usage}
                status={status}
                planCards={planCards}
                onManagePlan={() => changeTab("plans")}
              />
              {usage && <UsageMeters usage={usage} />}
              {credits
                ? <CreditsOverview data={credits} pulse={pulse} />
                : <CreditsOverviewSkeleton />}
            </>
          )}
        </TabsContent>

        {/* ── Plans ── */}
        <TabsContent value="plans" className="mt-5">
          <PlansGrid
            planCards={planCards}
            currentPlan={currentPlan}
            isAdmin={usage?.is_admin ?? false}
            payMethod={payMethod}
            onPayMethod={setPayMethod}
            onCheckout={(plan) => checkout(plan, payMethod)}
            checkoutLoading={checkoutLoading}
          />
        </TabsContent>

        {/* ── Activity ── */}
        <TabsContent value="activity" className="mt-5 space-y-4">
          <Invoices history={status?.history ?? []} />
          {credits && <CreditsLedger ledger={credits.ledger} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
