"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, CreditCard, Crown, ExternalLink, Loader2, PartyPopper, Zap } from "lucide-react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface Subscription {
  id: string;
  plan: string;
  status: string;
  amount: number;
  currency: string;
  period_start: string | null;
  period_end: string | null;
  created_at: string;
}

interface BillingStatus {
  active_subscription: Subscription | null;
  history: Subscription[];
}

interface PlanLimits {
  plan: string;
  max_subdomains: number; max_tunnels: number;
  max_projects: number; max_databases: number; max_services: number;
  max_custom_domains: number; max_crons: number; max_byoc_servers: number;
  max_preview_deploys: number;
  max_memory_mb: number; max_cpus: number;
  max_bandwidth_gb: number; max_build_minutes_monthly: number;
  allow_previews: boolean; allow_release_cmd: boolean; allow_health_checks: boolean;
  allow_private_repos: boolean; allow_tcp_tunnels: boolean; allow_live_logs: boolean;
}
interface UsageResponse {
  plan: string;
  is_admin: boolean;
  limits: PlanLimits;
  usage: Record<string, number>; // projects, databases, services, custom_domains, crons, byoc_servers, subdomains, preview_deploys
}

export default function BillingPage() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [payMethod, setPayMethod] = useState<"card" | "crypto">("card");
  // Post-checkout celebration. The provider redirects here immediately, but
  // the plan only flips once the webhook lands — so we poll rather than
  // claiming success we haven't confirmed.
  const [celebrate, setCelebrate] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmedPlan, setConfirmedPlan] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState("");
  const [pendingTimedOut, setPendingTimedOut] = useState(false);
  const [pending, setPending] = useState<{
    plan: string; method: string; url: string;
    amount?: number; currency?: string; blocked: boolean;
  } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const headers = () => {
    const token = localStorage.getItem("sm_token");
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };

  async function loadStatus() {
    try {
      const [sRes, uRes] = await Promise.all([
        fetch(`${API}/api/v1/billing/status`, { headers: headers() }),
        fetch(`${API}/api/v1/users/me/limits`, { headers: headers() }),
      ]);
      if (sRes.ok) setStatus(await sRes.json());
      if (uRes.ok) setUsage(await uRes.json());
    } catch {}
    setLoading(false);
  }

  // Open the provider's hosted page in a NEW TAB and keep this page waiting on
  // the webhook. Redirecting away meant the user lost their place, and for
  // crypto (InventPay can't redirect back) they never returned at all — the
  // upgrade appeared to do nothing until they refreshed manually.
  async function checkout(plan: "hobby" | "pro" | "team" = "pro", method: "crypto" | "card" = "crypto") {
    setCheckoutLoading(true);
    setCheckoutError("");
    try {
      const res = await fetch(`${API}/api/v1/billing/checkout`, {
        method: "POST",
        headers: headers(),
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
        const res = await fetch(`${API}/api/v1/billing/status`, { headers: headers() });
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

  async function pollPayment(paymentId: string) {
    const maxAttempts = 60; // 10 minutes
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 10000)); // 10s intervals
      try {
        const res = await fetch(`${API}/api/v1/billing/check?payment_id=${paymentId}`, {
          headers: headers(),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.status === "COMPLETED") {
            loadStatus();
            return;
          }
        }
      } catch {}
    }
  }

  useEffect(() => {
    loadStatus();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

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
          const res = await fetch(`${API}/api/v1/billing/status`, { headers: headers() });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeSub = status?.active_subscription;
  const isPremium = activeSub && activeSub.status === "active";
  const daysLeft = activeSub?.period_end
    ? Math.max(0, Math.ceil((new Date(activeSub.period_end).getTime() - Date.now()) / 86400000))
    : 0;

  // Plan catalog — mirrors plan_limits table; update both together when changing limits.
  type PlanCard = {
    id: string;
    name: string;
    price: string;
    accent: string;
    tagline: string;
    features: string[];
  };
  const planCards: PlanCard[] = [
    {
      id: "free",
      name: "Free",
      price: "$0",
      accent: "border-[#30363d]/40",
      tagline: "For hobby projects and learning",
      features: [
        "5 reserved subdomains, 5 active tunnels",
        "3 projects, 1 PostgreSQL database",
        "1 BYOC server, 1 custom domain",
        "512 MB RAM / 0.25 vCPU per project",
        "50 GB bandwidth, 120 build min / mo",
        "7-day analytics, 3-day deploy logs",
      ],
    },
    {
      id: "hobby",
      name: "Hobby",
      price: "$5",
      accent: "border-emerald-500/30",
      tagline: "Perfect for indie hackers and side projects",
      features: [
        "All Free features, plus:",
        "5 projects, 3 databases (Postgres, Redis, Mongo, MySQL)",
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
      id: "pro",
      name: "Pro",
      price: "$12",
      accent: "border-primary/30",
      tagline: "Built for production-ready applications",
      features: [
        "10 reserved subdomains, 15 active tunnels",
        "10 projects, 5 databases, 5 BYOC servers",
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
      id: "team",
      name: "Team",
      price: "$35",
      accent: "border-emerald-500/30",
      tagline: "For small teams shipping in production",
      features: [
        "Everything in Pro, plus:",
        "50 subdomains / tunnels / projects, 20 databases",
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
  const currentPlan = usage?.plan || (isPremium ? "pro" : "free");

  // Post-checkout celebration takes over the page until dismissed.
  if (celebrate) {
    const planName = confirmedPlan ? confirmedPlan[0].toUpperCase() + confirmedPlan.slice(1) : null;
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="flex justify-center mb-6">
            <div className={`flex h-16 w-16 items-center justify-center rounded-full ${
              confirming ? "bg-muted" : "bg-emerald-500/15"
            }`}>
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
              <h1 className="text-3xl font-bold tracking-tight">
                Welcome to {planName}! 🎉
              </h1>
              <p className="mt-3 text-sm text-muted-foreground">
                Your subscription is active and the new limits apply right now —
                nothing to redeploy. A receipt is on its way to your inbox.
              </p>

              {usage && (
                <div className="mt-6 grid grid-cols-3 gap-2 text-left">
                  <div className="rounded-lg border border-border/60 px-3 py-2">
                    <div className="text-[10px] text-muted-foreground">Projects</div>
                    <div className="text-sm font-mono">{usage.limits.max_projects < 0 ? "∞" : usage.limits.max_projects}</div>
                  </div>
                  <div className="rounded-lg border border-border/60 px-3 py-2">
                    <div className="text-[10px] text-muted-foreground">Memory</div>
                    <div className="text-sm font-mono">{usage.limits.max_memory_mb} MB</div>
                  </div>
                  <div className="rounded-lg border border-border/60 px-3 py-2">
                    <div className="text-[10px] text-muted-foreground">Bandwidth</div>
                    <div className="text-sm font-mono">{usage.limits.max_bandwidth_gb} GB</div>
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
    <div>
      {/* Payment-in-progress modal. The provider's page is open in another tab;
          this stays put and waits for the webhook rather than navigating away. */}
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm px-4">
          <Card className="w-full max-w-md">
            <CardContent className="pt-6 text-center">
              <div className="flex justify-center mb-4">
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

              <div className="mt-4 rounded-lg border border-border/60 px-3 py-2 text-left text-xs">
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
            </CardContent>
          </Card>
        </div>
      )}

      <h1 className="text-xl sm:text-2xl font-bold">Billing</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage your subscription and payment history.
      </p>

      {checkoutError && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <span className="flex-1">{checkoutError}</span>
          <button onClick={() => setCheckoutError("")} className="text-xs text-muted-foreground hover:text-foreground">Dismiss</button>
        </div>
      )}

      {/* Usage vs caps */}
      {usage && (() => {
        const fmt = (n: number) => n < 0 ? "∞" : String(n);
        const pct = (used: number, max: number) => max <= 0 ? 0 : Math.min(100, Math.round((used / max) * 100));
        const rows: { label: string; used: number; max: number }[] = [
          { label: "Projects", used: usage.usage.projects ?? 0, max: usage.limits.max_projects },
          { label: "Project databases", used: usage.usage.databases ?? 0, max: usage.limits.max_databases },
          { label: "Standalone services", used: usage.usage.services ?? 0, max: usage.limits.max_services },
          { label: "Subdomains", used: usage.usage.subdomains ?? 0, max: usage.limits.max_subdomains },
          { label: "Custom domains", used: usage.usage.custom_domains ?? 0, max: usage.limits.max_custom_domains },
          { label: "Scheduled jobs", used: usage.usage.crons ?? 0, max: usage.limits.max_crons },
          { label: "BYOC servers", used: usage.usage.byoc_servers ?? 0, max: usage.limits.max_byoc_servers },
          { label: "Active PR previews", used: usage.usage.preview_deploys ?? 0, max: usage.limits.max_preview_deploys },
        ];
        return (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Usage on the {usage.is_admin ? "Admin (unlimited)" : usage.plan} plan</span>
                {usage.is_admin && <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/40">Unlimited</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {rows.map((r) => {
                  const isUnl = r.max < 0;
                  const p = isUnl ? 0 : pct(r.used, r.max);
                  const barColor = p >= 90 ? "bg-red-500" : p >= 70 ? "bg-amber-500" : "bg-emerald-500";
                  return (
                    <div key={r.label} className="space-y-1">
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="text-muted-foreground">{r.label}</span>
                        <span className="font-mono">{r.used} / {fmt(r.max)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                        <div className={`h-full ${isUnl ? "bg-emerald-500/40 w-full" : barColor}`} style={{ width: isUnl ? "100%" : `${p}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
                <div className="rounded bg-muted px-2 py-1.5">
                  <div className="text-muted-foreground">Memory cap</div>
                  <div className="font-mono">{usage.limits.max_memory_mb < 0 ? "∞" : `${usage.limits.max_memory_mb} MB`}</div>
                </div>
                <div className="rounded bg-muted px-2 py-1.5">
                  <div className="text-muted-foreground">CPU cap</div>
                  <div className="font-mono">{usage.limits.max_cpus < 0 ? "∞" : `${usage.limits.max_cpus} vCPU`}</div>
                </div>
                <div className="rounded bg-muted px-2 py-1.5">
                  <div className="text-muted-foreground">Bandwidth/mo</div>
                  <div className="font-mono">{usage.limits.max_bandwidth_gb < 0 ? "∞" : `${usage.limits.max_bandwidth_gb} GB`}</div>
                </div>
                <div className="rounded bg-muted px-2 py-1.5">
                  <div className="text-muted-foreground">Build min/mo</div>
                  <div className="font-mono">{usage.limits.max_build_minutes_monthly < 0 ? "∞" : usage.limits.max_build_minutes_monthly}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {[
                  ["Previews", usage.limits.allow_previews],
                  ["Release cmds", usage.limits.allow_release_cmd],
                  ["Health checks", usage.limits.allow_health_checks],
                  ["Private repos", usage.limits.allow_private_repos],
                  ["TCP tunnels", usage.limits.allow_tcp_tunnels],
                  ["Live logs", usage.limits.allow_live_logs],
                ].map(([label, on]) => (
                  <Badge key={String(label)} variant="outline" className={`text-[10px] ${on ? "text-emerald-500 border-emerald-500/50" : "text-muted-foreground"}`}>
                    {on ? "✓" : "✗"} {label}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Current Plan */}
      <Card className="mt-6">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                {usage?.is_admin ? (
                  <Badge className="gap-1 bg-emerald-500/15 text-emerald-500 border-emerald-500/40">
                    <Crown className="h-3 w-3" />
                    Admin (Unlimited)
                  </Badge>
                ) : currentPlan === "team" ? (
                  <Badge className="gap-1 bg-emerald-500/15 text-emerald-500 border-emerald-500/40">
                    <Crown className="h-3 w-3" />
                    Team
                  </Badge>
                ) : currentPlan === "pro" ? (
                  <Badge className="gap-1 bg-emerald-500/20 text-emerald-500 border-emerald-500/50">
                    <Zap className="h-3 w-3" />
                    Pro
                  </Badge>
                ) : (
                  <Badge variant="outline">Free</Badge>
                )}
              </div>
              {usage?.is_admin ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  You&apos;re an admin — all platform limits are bypassed for your account.
                </p>
              ) : isPremium ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Your subscription is active. {daysLeft} days remaining.
                  {activeSub?.period_end && (
                    <span className="block mt-0.5">
                      Expires {new Date(activeSub.period_end).toLocaleDateString()}
                    </span>
                  )}
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  You&apos;re on the Free plan. Upgrade for higher limits and advanced features.
                </p>
              )}
            </div>
            {!isPremium && !usage?.is_admin && (
              <Button
                onClick={() => checkout("pro", payMethod)}
                disabled={checkoutLoading}
                className="gap-2 shrink-0"
              >
                {checkoutLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                Upgrade to Pro — $12/mo
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Payment method selector — drives the Upgrade buttons below */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Payment Method</CardTitle>
          <p className="text-xs text-muted-foreground">Choose how you want to pay before upgrading.</p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setPayMethod("card")}
              className={`flex items-center gap-3 rounded-lg border p-4 text-left transition-colors ${
                payMethod === "card"
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border/60 hover:border-border hover:bg-muted/40"
              }`}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-blue-500">
                <CreditCard className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium flex items-center gap-2">
                  Credit / debit card
                  {payMethod === "card" && <Check className="h-3.5 w-3.5 text-primary" />}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  Visa, Mastercard, Amex — via{" "}
                  <a href="https://polar.sh" target="_blank" rel="noopener" className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                    Polar <ExternalLink className="inline h-2.5 w-2.5" />
                  </a>
                </p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setPayMethod("crypto")}
              className={`flex items-center gap-3 rounded-lg border p-4 text-left transition-colors ${
                payMethod === "crypto"
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border/60 hover:border-border hover:bg-muted/40"
              }`}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-500/15 text-orange-500 font-bold">
                ₿
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium flex items-center gap-2">
                  Cryptocurrency
                  {payMethod === "crypto" && <Check className="h-3.5 w-3.5 text-primary" />}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  BTC, ETH, USDT, SOL, LTC — via{" "}
                  <a href="https://inventpay.io" target="_blank" rel="noopener" className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                    InventPay <ExternalLink className="inline h-2.5 w-2.5" />
                  </a>
                </p>
              </div>
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Plan Comparison — three real tiers */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4 items-stretch">
        {planCards.map((plan) => {
          const isCurrent = currentPlan === plan.id;
          const tierOrder = ["free", "hobby", "pro", "team"];
          const canUpgradeToThis = tierOrder.indexOf(plan.id) > tierOrder.indexOf(currentPlan);
          const isPro = plan.id === "pro";
          return (
            <Card
              key={plan.id}
              className={`relative flex flex-col ${
                isPro
                  ? "border-primary/50 shadow-[0_0_24px_-8px] shadow-primary/20"
                  : isCurrent
                  ? plan.accent
                  : ""
              }`}
            >
              {isPro && !isCurrent && (
                <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                  <Badge className="text-[10px] px-2.5 shadow-sm">Most popular</Badge>
                </div>
              )}
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    {plan.id === "team" && <Crown className="h-4 w-4 text-emerald-500" />}
                    {plan.name}
                  </span>
                  {isCurrent && <Badge className={`text-[10px] ${plan.id === "team" ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/40" : ""}`} variant={plan.id === "team" ? "default" : "outline"}>Current plan</Badge>}
                </CardTitle>
                <p className="text-3xl font-bold tracking-tight">
                  {plan.price}
                  {plan.id !== "free" && <span className="text-sm font-normal text-muted-foreground">/mo{plan.id === "team" && " per seat"}</span>}
                </p>
                <p className="text-xs text-muted-foreground">{plan.tagline}</p>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <ul className="space-y-2.5 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-[13px] leading-snug">
                      <Check className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${plan.id === "team" || isPro ? "text-emerald-500" : "text-zinc-500"}`} />
                      <span className="text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-6 h-10">
                  {canUpgradeToThis ? (
                    <Button
                      onClick={() => checkout(plan.id as "hobby" | "pro" | "team", payMethod)}
                      disabled={checkoutLoading}
                      className="w-full gap-2"
                      variant={isPro ? "default" : "outline"}
                    >
                      {checkoutLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                      Upgrade to {plan.name}
                    </Button>
                  ) : isCurrent ? (
                    <Button variant="outline" disabled className="w-full">
                      Your current plan
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* History */}
      {status?.history && status.history.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Payment History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {status.history.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg border border-border/50 p-3 text-sm">
                  <div>
                    <span className="font-medium capitalize">{s.plan}</span>
                    <span className="ml-2 text-muted-foreground">
                      ${s.amount} {s.currency}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        s.status === "active" ? "text-green-500 border-green-500/20" :
                        s.status === "pending" ? "text-yellow-500 border-yellow-500/50" :
                        "text-muted-foreground"
                      }`}
                    >
                      {s.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(s.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
