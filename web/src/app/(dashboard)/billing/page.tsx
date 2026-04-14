"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Crown, ExternalLink, Loader2, Zap } from "lucide-react";

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
  usage: Record<string, number>;
}

export default function BillingPage() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

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

  async function checkout() {
    setCheckoutLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/billing/checkout`, {
        method: "POST",
        headers: headers(),
      });
      if (res.ok) {
        const data = await res.json();
        // Open InventPay invoice page
        // Redirect to payment page
        window.location.href = data.invoice_url;
      } else {
        const err = await res.json();
        alert(err.error || "Failed to create checkout");
      }
    } catch {}
    setCheckoutLoading(false);
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
  }, []);

  const activeSub = status?.active_subscription;
  const isPremium = activeSub && activeSub.status === "active";
  const daysLeft = activeSub?.period_end
    ? Math.max(0, Math.ceil((new Date(activeSub.period_end).getTime() - Date.now()) / 86400000))
    : 0;

  const freeFeatures = [
    "10 active tunnels",
    "HTTP, TCP & TLS tunnels",
    "Reserved subdomains",
    "Custom domains",
    "Request inspection & replay",
    "Analytics dashboard",
    "100 req/s rate limit",
  ];

  const premiumFeatures = [
    "Everything in Free, plus:",
    "Wildcard domains",
    "OAuth at edge (Google, GitHub)",
    "500 req/s rate limit",
    "Team management & roles",
    "Webhook verification",
    "Traffic policies",
    "Priority support & SLA",
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold">Billing</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage your subscription and payment history.
      </p>

      {/* Usage vs caps */}
      {usage && (() => {
        const fmt = (n: number) => n < 0 ? "∞" : String(n);
        const pct = (used: number, max: number) => max <= 0 ? 0 : Math.min(100, Math.round((used / max) * 100));
        const rows: { label: string; used: number; max: number }[] = [
          { label: "Projects", used: usage.usage.projects ?? 0, max: usage.limits.max_projects },
          { label: "Project databases", used: usage.usage.databases ?? 0, max: usage.limits.max_databases },
          { label: "Standalone services", used: usage.usage.services ?? 0, max: usage.limits.max_services },
          { label: "Subdomains", used: 0, max: usage.limits.max_subdomains },
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
                {usage.is_admin && <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Unlimited</Badge>}
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
                        <div className={`h-full ${isUnl ? "bg-yellow-500/40 w-full" : barColor}`} style={{ width: isUnl ? "100%" : `${p}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
                <div className="rounded bg-[#09090b] px-2 py-1.5">
                  <div className="text-muted-foreground">Memory cap</div>
                  <div className="font-mono">{usage.limits.max_memory_mb < 0 ? "∞" : `${usage.limits.max_memory_mb} MB`}</div>
                </div>
                <div className="rounded bg-[#09090b] px-2 py-1.5">
                  <div className="text-muted-foreground">CPU cap</div>
                  <div className="font-mono">{usage.limits.max_cpus < 0 ? "∞" : `${usage.limits.max_cpus} vCPU`}</div>
                </div>
                <div className="rounded bg-[#09090b] px-2 py-1.5">
                  <div className="text-muted-foreground">Bandwidth/mo</div>
                  <div className="font-mono">{usage.limits.max_bandwidth_gb < 0 ? "∞" : `${usage.limits.max_bandwidth_gb} GB`}</div>
                </div>
                <div className="rounded bg-[#09090b] px-2 py-1.5">
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
                  <Badge key={String(label)} variant="outline" className={`text-[10px] ${on ? "text-emerald-500 border-emerald-500/20" : "text-zinc-600"}`}>
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
                {isPremium ? (
                  <Badge className="gap-1 bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
                    <Crown className="h-3 w-3" />
                    Premium
                  </Badge>
                ) : (
                  <Badge variant="outline">Free</Badge>
                )}
              </div>
              {isPremium ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Your Premium subscription is active. {daysLeft} days remaining.
                  {activeSub?.period_end && (
                    <span className="block mt-0.5">
                      Expires {new Date(activeSub.period_end).toLocaleDateString()}
                    </span>
                  )}
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  You&apos;re on the Free plan. Upgrade to Premium for advanced features.
                </p>
              )}
            </div>
            {!isPremium && (
              <Button
                onClick={checkout}
                disabled={checkoutLoading}
                className="gap-2 shrink-0"
              >
                {checkoutLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                Upgrade to Premium — $10/mo
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Plan Comparison */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className={!isPremium ? "border-primary/30" : ""}>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              Free
              {!isPremium && <Badge variant="outline" className="text-[10px]">Current</Badge>}
            </CardTitle>
            <p className="text-2xl font-bold">$0</p>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {freeFeatures.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm">
                  <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
                  <span className="text-muted-foreground">{f}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className={isPremium ? "border-yellow-500/30" : ""}>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Crown className="h-4 w-4 text-yellow-500" />
                Premium
              </span>
              {isPremium && <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20 text-[10px]">Current</Badge>}
            </CardTitle>
            <p className="text-2xl font-bold">$10<span className="text-sm font-normal text-muted-foreground">/month</span></p>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {premiumFeatures.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm">
                  <Check className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
                  <span className="text-muted-foreground">{f}</span>
                </li>
              ))}
            </ul>
            {!isPremium && (
              <Button onClick={checkout} disabled={checkoutLoading} className="mt-6 w-full gap-2">
                {checkoutLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                Pay with Crypto
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Payment info */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Payment Method</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10 text-orange-500 text-xs font-bold">
              ₿
            </div>
            <div>
              <p className="text-sm font-medium">Cryptocurrency via InventPay</p>
              <p className="text-xs text-muted-foreground">
                Pay with BTC, ETH, USDT, SOL, LTC and more. Powered by{" "}
                <a href="https://inventpay.io" target="_blank" rel="noopener" className="text-primary hover:underline">
                  InventPay <ExternalLink className="inline h-2.5 w-2.5" />
                </a>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

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
                        s.status === "pending" ? "text-yellow-500 border-yellow-500/20" :
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
