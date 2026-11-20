"use client";

// Admin → Payments: revenue, paying users, webhook health per provider, the
// billing event log, subscriptions, and Polar reconciliation (paid orders we
// never applied, failed webhook deliveries) with Apply / Redeliver actions.
// Backed by /api/v1/admin/payments/* (server/internal/api/admin_payments_handlers.go).

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle, ArrowRight, Check, CircleDollarSign, CreditCard, ExternalLink, Inbox, Loader2, Mail,
  RefreshCw, Repeat, Search, ShieldAlert, ShoppingCart, Users, Wallet, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DashMotion, KpiCard } from "@/components/admin/dash-kit";
import { FilterChip, Pager, timeAgo } from "@/components/admin/pager";
import { ChartTooltip, SERIES_2, SERIES_1, Segmented, axisProps, gridProps } from "@/components/project/charts";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";
const AMBER = "#FBBF24";

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let token = "";
  try { token = localStorage.getItem("sm_token") || ""; } catch {}
  const res = await fetch(`${API}/api/v1/admin/payments${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

// ── Types (mirror the Go structs) ───────────────────────────────────────────
type Health = {
  provider: "polar" | "inventpay"; configured: boolean; status: "ok" | "failing" | "warning" | "quiet" | "off";
  last_ok_at: string | null; last_rejected_at: string | null; rejected_24h: number; errors_24h: number; events_24h: number;
};
type Summary = {
  days: number; revenue: number; revenue_prev: number; revenue_card: number; revenue_crypto: number; revenue_credits: number;
  mrr: number; paying_users: number; in_grace: number; plan_mix: Record<string, number>;
  checkouts_started: number; checkouts_paid: number; pending_stale: number; credit_packs_paid: number;
  emails_sent: number; emails_failed: number; problem_events: number;
  daily: { day: string; card: number; crypto: number; credits: number }[];
  health: Health[];
};
type BillingEvent = {
  id: number; created_at: string; provider: string; event_type: string; outcome: string;
  user_id: string; user_email: string; payment_id: string; amount: number; currency: string; detail: string;
};
type Sub = {
  id: string; user_id: string; plan: string; status: string; payment_id: string; amount: number; currency: string;
  period_start: string | null; period_end: string | null; created_at: string; user_email: string; user_name: string; user_plan: string;
};
type Order = {
  id: string; created_at: string; status: string; billing_reason: string; product: string; email: string;
  user_id: string; amount: number; payment_id: string; local: string; needs_apply: boolean;
};
type FailedEvent = { event_id: string; type: string; created_at: string; attempts: number; last_code: number; last_attempt: string };
type PolarStatus = {
  configured: boolean; orders?: Order[]; failed_events?: FailedEvent[];
  endpoints?: { id: string; url: string; enabled: boolean }[]; errors?: string[];
};

// ── Small helpers ───────────────────────────────────────────────────────────
const usd = (n: number, cents = true) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
const money = (n: number, currency: string) =>
  !n ? "—" : currency && currency !== "USD" ? `${n.toFixed(2)} ${currency}` : usd(n);
const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "—";
const PROVIDER = {
  polar: { name: "Polar", kind: "Card payments", icon: CreditCard },
  inventpay: { name: "InventPay", kind: "Crypto payments", icon: Wallet },
} as const;

type Tone = "ok" | "warn" | "bad" | "idle" | "info";
const TONE: Record<Tone, string> = {
  ok: "border-brand/25 bg-brand/10 text-[var(--dz-green-strong)] dark:text-brand",
  warn: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  bad: "border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-400",
  idle: "border-[var(--dz-hairline)] bg-foreground/[0.04] text-muted-foreground",
  info: "border-brand-cyan/25 bg-brand-cyan/10 text-cyan-700 dark:text-brand-cyan",
};
const DOT: Record<Tone, string> = { ok: "bg-brand", warn: "bg-amber-500", bad: "bg-red-500", idle: "bg-zinc-400", info: "bg-brand-cyan" };

function outcomeTone(o: string): Tone {
  if (["activated", "credits", "sent", "active", "paid"].includes(o)) return "ok";
  if (["rejected", "error", "failed", "unknown", "missing"].includes(o)) return "bad";
  if (["pending", "grace"].includes(o)) return "warn";
  if (o === "received") return "info";
  return "idle";
}

function Pill({ children, tone, className }: { children: ReactNode; tone: Tone; className?: string }) {
  return (
    <span className={cn("inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border px-2 text-[12px] font-medium", TONE[tone], className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT[tone])} />{children}
    </span>
  );
}

function Card({ title, sub, action, children, className, pad = true }: {
  title: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={cn("ov-rise overflow-hidden rounded-[20px] surface", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--dz-hairline)] px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-[14.5px] font-semibold">{title}</h3>
          {sub && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{sub}</p>}
        </div>
        {action}
      </div>
      <div className={pad ? "p-4 sm:p-5" : ""}>{children}</div>
    </section>
  );
}

function Empty({ icon: Icon, children }: { icon: typeof Inbox; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-[13.5px] text-muted-foreground">
      <Icon className="h-5 w-5 opacity-60" />{children}
    </div>
  );
}

// ── Webhook health ──────────────────────────────────────────────────────────
function HealthCard({ h }: { h: Health }) {
  const p = PROVIDER[h.provider];
  const view = {
    ok: { tone: "ok" as Tone, label: "Healthy", text: `Last delivery accepted ${timeAgo(h.last_ok_at)}.` },
    failing: { tone: "bad" as Tone, label: "Failing", text: `The latest delivery was rejected ${timeAgo(h.last_rejected_at)} — payments are not activating.` },
    warning: { tone: "warn" as Tone, label: "Needs a look", text: `${h.rejected_24h} rejected and ${h.errors_24h} errors in the last 24 h.` },
    quiet: { tone: "idle" as Tone, label: "No deliveries yet", text: "Nothing has arrived since monitoring started." },
    off: { tone: "idle" as Tone, label: "Not configured", text: "This provider isn't set up on the server." },
  }[h.status];
  return (
    <div className={cn("ov-rise relative overflow-hidden rounded-[20px] surface p-4 sm:p-5",
      h.status === "failing" && "border-red-500/40 bg-red-500/[0.04]")}>
      <div className="flex items-start gap-3">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border", TONE[view.tone])}>
          <p.icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[14.5px] font-semibold">{p.name}</p>
            <span className="text-[12.5px] text-muted-foreground">{p.kind}</span>
            <Pill tone={view.tone} className="ml-auto">{view.label}</Pill>
          </div>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{view.text}</p>
          {h.configured && (
            <p className="mt-2 text-[12.5px] tabular-nums text-muted-foreground">
              {h.events_24h} events · {h.rejected_24h} rejected · {h.errors_24h} errors <span className="opacity-70">(24 h)</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Revenue chart + plan mix ────────────────────────────────────────────────
function RevenueChart({ s }: { s: Summary }) {
  const data = s.daily.map((d) => ({
    ...d, label: new Date(d.day + "T00:00:00").toLocaleDateString([], { month: "short", day: "numeric" }),
  }));
  const legend = [
    { k: "Card", c: SERIES_1, v: s.revenue_card },
    { k: "Crypto", c: SERIES_2, v: s.revenue_crypto },
    { k: "AI credits", c: AMBER, v: s.revenue_credits },
  ];
  return (
    <Card className="lg:col-span-2" title="Revenue per day"
      sub={<><span className="font-medium tabular-nums text-foreground">{usd(s.revenue)}</span> in the last {s.days} days, net of tax</>}
      action={
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
          {legend.map((l) => (
            <span key={l.k} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: l.c }} />{l.k}
              <span className="tabular-nums text-foreground">{usd(l.v, false)}</span>
            </span>
          ))}
        </div>
      }>
      {s.revenue === 0 ? (
        <Empty icon={CircleDollarSign}>No payments in this window yet.</Empty>
      ) : (
        <div className="h-52 sm:h-60">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, left: -6, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} minTickGap={24} />
              <YAxis {...axisProps} width={48} allowDecimals={false} tickFormatter={(v: number) => `$${v}`} />
              <Tooltip cursor={{ fill: "currentColor", className: "text-foreground/[0.04]" }}
                content={<ChartTooltip format={(v) => usd(v)} />} />
              <Bar dataKey="card" name="card" stackId="r" fill={SERIES_1} radius={[0, 0, 0, 0]} />
              <Bar dataKey="crypto" name="crypto" stackId="r" fill={SERIES_2} />
              <Bar dataKey="credits" name="AI credits" stackId="r" fill={AMBER} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function PlanMix({ s }: { s: Summary }) {
  const plans = ["hobby", "pro", "team"].map((p) => ({ p, n: s.plan_mix[p] || 0 }));
  const others = Object.entries(s.plan_mix).filter(([p]) => !["hobby", "pro", "team"].includes(p));
  const all = [...plans, ...others.map(([p, n]) => ({ p, n }))];
  const max = Math.max(1, ...all.map((x) => x.n));
  return (
    <Card title="Paying users" sub={<>{s.paying_users} on a paid plan{s.in_grace > 0 && <> · <span className="text-amber-600 dark:text-amber-400">{s.in_grace} in grace</span></>}</>}>
      <div className="space-y-3.5">
        {all.map(({ p, n }, i) => (
          <div key={p}>
            <div className="flex items-baseline justify-between text-[13.5px]">
              <span className="capitalize">{p}</span>
              <span className="tabular-nums text-muted-foreground"><span className="font-semibold text-foreground">{n}</span> {n === 1 ? "user" : "users"}</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-foreground/[0.06]">
              <div className="ov-grow h-full rounded-full" style={{ width: `${(n / max) * 100}%`, background: i === 0 ? SERIES_1 : i === 1 ? SERIES_2 : AMBER, animationDelay: `${i * 80}ms` }} />
            </div>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-[var(--dz-hairline)] text-[12.5px]">
          <div className="bg-card px-3 py-2.5"><p className="text-muted-foreground">In grace</p><p className="mt-0.5 text-[15px] font-semibold tabular-nums">{s.in_grace}</p></div>
          <div className="bg-card px-3 py-2.5"><p className="text-muted-foreground">Credit packs</p><p className="mt-0.5 text-[15px] font-semibold tabular-nums">{s.credit_packs_paid}</p></div>
        </div>
      </div>
    </Card>
  );
}

// ── Polar reconciliation ────────────────────────────────────────────────────
function PolarPanel({ data, loading, onChanged }: { data: PolarStatus | null; loading: boolean; onChanged: () => void }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function apply(id: string) {
    setBusy(id); setNote(null);
    try {
      const r = await adminFetch<{ outcome: string; detail: string }>(`/polar/orders/${id}/apply`, { method: "POST" });
      setNote({ ok: r.outcome === "activated" || r.outcome === "credits" || r.outcome === "replay", text: `Order applied: ${r.outcome} · ${r.detail}` });
      setConfirm(null);
      onChanged();
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally { setBusy(null); }
  }
  async function redeliver(id: string) {
    setBusy(id); setNote(null);
    try {
      await adminFetch(`/polar/events/${id}/redeliver`, { method: "POST" });
      setNote({ ok: true, text: "Redelivery queued — Polar sends it within a few seconds. Refresh to see the result." });
      setTimeout(onChanged, 5000);
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally { setBusy(null); }
  }

  if (!data) return <Card title="Polar orders"><Empty icon={Loader2}>{loading ? "Asking Polar…" : "Could not reach Polar."}</Empty></Card>;
  if (!data.configured) return <Card title="Polar orders"><Empty icon={CreditCard}>Polar isn&apos;t configured on this server.</Empty></Card>;

  const orders = data.orders ?? [];
  const failed = data.failed_events ?? [];
  const missing = orders.filter((o) => o.needs_apply).length;
  const enabled = (data.endpoints ?? []).filter((e) => e.enabled);

  return (
    <div className="space-y-4">
      {note && (
        <div role="status" className={cn("flex items-start gap-2 rounded-2xl border px-4 py-3 text-[13.5px]", note.ok ? TONE.ok : TONE.bad)}>
          {note.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{note.text}</span>
          <button onClick={() => setNote(null)} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100"><X className="h-4 w-4" /></button>
        </div>
      )}
      {(data.errors?.length ?? 0) > 0 && (
        <div className={cn("rounded-2xl border px-4 py-3 text-[13px]", TONE.warn)}>
          Some Polar data couldn&apos;t load: {data.errors!.join(" · ")}
        </div>
      )}

      <Card pad={false} title="Polar orders"
        sub={missing > 0
          ? <span className="text-red-600 dark:text-red-400">{missing} paid {missing === 1 ? "order hasn't" : "orders haven't"} been applied here</span>
          : <>Every paid order matches an activation here{enabled.length > 0 && <> · {enabled.length} webhook endpoint{enabled.length === 1 ? "" : "s"} enabled</>}</>}
        action={<a href="https://polar.sh/dashboard" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground">Open Polar <ExternalLink className="h-3.5 w-3.5" /></a>}>
        {orders.length === 0 ? <Empty icon={ShoppingCart}>No Polar orders yet.</Empty> : (
          <ul className="divide-y divide-[var(--dz-hairline)]">
            {orders.map((o) => (
              <li key={o.id} className={cn("px-4 py-3 sm:px-5", o.needs_apply && "bg-red-500/[0.04]")}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
                    <p className="truncate text-[13.5px] font-medium">{o.email || "Unknown customer"}</p>
                    <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                      {o.product || "Product"} · {o.billing_reason === "subscription_cycle" ? "renewal" : o.billing_reason === "subscription_create" ? "new subscription" : o.billing_reason.replace(/_/g, " ")} · {timeAgo(o.created_at)}
                    </p>
                  </div>
                  <span className="text-[13.5px] font-semibold tabular-nums">{usd(o.amount)}</span>
                  <span className="flex items-center gap-1.5">
                    <Pill tone={outcomeTone(o.status)}>Polar: {o.status}</Pill>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden />
                    <Pill tone={outcomeTone(o.local)}>Here: {o.local}</Pill>
                  </span>
                  {o.needs_apply && confirm !== o.id && (
                    <button onClick={() => setConfirm(o.id)} className="pill pill-sm pill-ink">Apply</button>
                  )}
                </div>
                {confirm === o.id && (
                  <div className="mt-3 flex flex-col gap-2 rounded-xl border border-[var(--dz-hairline)] bg-foreground/[0.03] p-3 sm:flex-row sm:items-center">
                    <p className="flex-1 text-[13px] text-muted-foreground">
                      Polar is asked again first. If it&apos;s paid, the plan activates and the customer gets the confirmation email.
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => setConfirm(null)} className="pill pill-sm pill-line">Cancel</button>
                      <button onClick={() => apply(o.id)} disabled={busy === o.id} className="pill pill-sm pill-launch">
                        {busy === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Apply order
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card pad={false} title="Failed webhook deliveries"
        sub={failed.length ? "Events whose latest attempt failed. Redelivering re-sends them freshly signed." : "Every recent delivery succeeded."}>
        {failed.length === 0 ? <Empty icon={Check}>Nothing to redeliver.</Empty> : (
          <ul className="divide-y divide-[var(--dz-hairline)]">
            {failed.map((f) => (
              <li key={f.event_id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[13px]">{f.type}</p>
                  <p className="mt-0.5 text-[12.5px] text-muted-foreground tabular-nums">
                    {f.attempts} {f.attempts === 1 ? "attempt" : "attempts"} · last {timeAgo(f.last_attempt)}
                  </p>
                </div>
                <Pill tone="bad">HTTP {f.last_code || "—"}</Pill>
                <button onClick={() => redeliver(f.event_id)} disabled={busy === f.event_id} className="pill pill-sm pill-line">
                  {busy === f.event_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Repeat className="h-3.5 w-3.5" />} Redeliver
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ── Event log ───────────────────────────────────────────────────────────────
const EVENT_FILTERS = [
  { id: "", label: "All" }, { id: "problems", label: "Problems" }, { id: "activations", label: "Activations" },
  { id: "emails", label: "Emails" }, { id: "polar", label: "Polar" }, { id: "inventpay", label: "InventPay" },
] as const;

function EventLog({ problems, refreshKey }: { problems: number; refreshKey: number }) {
  const [filter, setFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [res, setRes] = useState<{ key: string; items: BillingEvent[]; total: number; err?: string } | null>(null);
  const key = `${filter}|${page}|${size}|${refreshKey}`;

  useEffect(() => {
    let alive = true;
    adminFetch<{ items: BillingEvent[]; total: number }>(`/events?filter=${filter}&limit=${size}&offset=${(page - 1) * size}`)
      .then((d) => alive && setRes({ key, items: d.items, total: d.total }))
      .catch((e: Error) => alive && setRes({ key, items: [], total: 0, err: e.message }));
    return () => { alive = false; };
  }, [filter, page, size, key]);

  const loading = res?.key !== key;
  return (
    <Card pad={false} title="Billing events" sub="Every webhook, activation and billing email, newest first."
      action={
        <div className="-mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1 pb-0.5">
          {EVENT_FILTERS.map((f) => (
            <FilterChip key={f.id} active={filter === f.id} onClick={() => { setFilter(f.id); setPage(1); }}
              tone={f.id === "problems" ? "danger" : undefined} count={f.id === "problems" ? problems : undefined}>{f.label}</FilterChip>
          ))}
        </div>
      }>
      {res?.err ? <Empty icon={AlertTriangle}>{res.err}</Empty>
        : !res ? <Empty icon={Loader2}>Loading…</Empty>
        : res.items.length === 0 ? <Empty icon={Inbox}>{filter === "problems" ? "No problems recorded." : "No billing events yet — they appear as webhooks arrive."}</Empty>
        : (
          <ul className={cn("divide-y divide-[var(--dz-hairline)]", loading && "opacity-60")}>
            {res.items.map((e) => (
              <li key={e.id} className="grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,230px)_1fr_auto] sm:px-5">
                <div className="order-1 flex min-w-0 items-center gap-2 sm:order-none">
                  <span className="rounded-md border border-[var(--dz-hairline)] px-1.5 py-px text-[11.5px] font-medium capitalize text-muted-foreground">{e.provider}</span>
                  <span className="min-w-0 truncate font-mono text-[12.5px]" title={e.event_type}>{e.event_type}</span>
                </div>
                <div className="order-3 col-span-2 min-w-0 sm:order-none sm:col-span-1">
                  <p className="truncate text-[13.5px]">{e.user_email || <span className="text-muted-foreground">No user attached</span>}</p>
                  {e.detail && <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{e.detail}</p>}
                </div>
                <div className="order-2 flex flex-col items-end gap-1 sm:order-none">
                  <Pill tone={outcomeTone(e.outcome)}>{e.outcome}</Pill>
                  <span className="text-[12px] tabular-nums text-muted-foreground" title={new Date(e.created_at).toLocaleString()}>
                    {e.amount > 0 && <>{money(e.amount, e.currency)} · </>}{timeAgo(e.created_at)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      {res && res.total > 0 && (
        <div className="border-t border-[var(--dz-hairline)] px-4 py-3 sm:px-5">
          <Pager total={res.total} page={page} pageSize={size} loading={loading} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} />
        </div>
      )}
    </Card>
  );
}

// ── Subscriptions ───────────────────────────────────────────────────────────
const SUB_FILTERS = [
  { id: "", label: "All" }, { id: "active", label: "Active" }, { id: "pending", label: "Pending" },
  { id: "grace", label: "Grace" }, { id: "expired", label: "Expired" },
] as const;

function Subscriptions({ refreshKey }: { refreshKey: number }) {
  const [status, setStatus] = useState<string>("active");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [res, setRes] = useState<{ key: string; items: Sub[]; total: number; err?: string } | null>(null);
  const key = `${status}|${query}|${page}|${size}|${refreshKey}`;

  useEffect(() => {
    const t = setTimeout(() => { setQuery(q.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let alive = true;
    adminFetch<{ items: Sub[]; total: number }>(`/subscriptions?status=${status}&q=${encodeURIComponent(query)}&limit=${size}&offset=${(page - 1) * size}`)
      .then((d) => alive && setRes({ key, items: d.items, total: d.total }))
      .catch((e: Error) => alive && setRes({ key, items: [], total: 0, err: e.message }));
    return () => { alive = false; };
  }, [status, query, page, size, key]);

  const loading = res?.key !== key;
  return (
    <Card pad={false} title="Subscriptions" sub="Checkouts and plan periods. Pending means the checkout was started but never paid."
      action={
        <label className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Email or payment id" aria-label="Search subscriptions"
            className="h-9 w-full rounded-full border border-[var(--dz-hairline)] bg-transparent pl-8 pr-3 text-[13.5px] outline-none focus:border-brand/50" style={{ background: "transparent" }} />
        </label>
      }>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto border-b border-[var(--dz-hairline)] px-5 py-3">
        {SUB_FILTERS.map((f) => (
          <FilterChip key={f.id} active={status === f.id} onClick={() => { setStatus(f.id); setPage(1); }}>{f.label}</FilterChip>
        ))}
      </div>
      {res?.err ? <Empty icon={AlertTriangle}>{res.err}</Empty>
        : !res ? <Empty icon={Loader2}>Loading…</Empty>
        : res.items.length === 0 ? <Empty icon={Users}>No subscriptions here.</Empty>
        : (
          <ul className={cn("divide-y divide-[var(--dz-hairline)]", loading && "opacity-60")}>
            {res.items.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="truncate text-[13.5px] font-medium">{s.user_email || "Deleted user"}</p>
                  <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                    <span className="capitalize">{s.plan}</span> · {s.currency === "USD" ? "Card" : "Crypto"} · started {shortDate(s.created_at)}
                    {s.period_end && <> · {s.status === "active" ? "renews" : "ended"} {shortDate(s.period_end)}</>}
                  </p>
                </div>
                <span className="text-[13.5px] font-semibold tabular-nums">{money(s.amount, s.currency)}</span>
                <Pill tone={outcomeTone(s.status)} className="capitalize">{s.status}</Pill>
              </li>
            ))}
          </ul>
        )}
      {res && res.total > 0 && (
        <div className="border-t border-[var(--dz-hairline)] px-4 py-3 sm:px-5">
          <Pager total={res.total} page={page} pageSize={size} loading={loading} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} />
        </div>
      )}
    </Card>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
type View = "polar" | "events" | "subs";
type Range = "7" | "30" | "90";

export function PaymentsDashboard() {
  const [range, setRange] = useState<Range>("30");
  const [view, setView] = useState<View>("polar");
  const [tick, setTick] = useState(0);
  const [summary, setSummary] = useState<{ key: string; s: Summary | null; err?: string } | null>(null);
  const [polar, setPolar] = useState<{ key: number; d: PolarStatus | null } | null>(null);
  const sumKey = `${range}|${tick}`;

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    adminFetch<Summary>(`/summary?days=${range}`)
      .then((s) => alive && setSummary({ key: sumKey, s }))
      .catch((e: Error) => alive && setSummary({ key: sumKey, s: null, err: e.message }));
    return () => { alive = false; };
  }, [range, sumKey]);

  useEffect(() => {
    if (view !== "polar") return;
    let alive = true;
    adminFetch<PolarStatus>("/polar")
      .then((d) => alive && setPolar({ key: tick, d }))
      .catch(() => alive && setPolar({ key: tick, d: null }));
    return () => { alive = false; };
  }, [view, tick]);

  // Quiet auto-refresh while the console is open.
  useEffect(() => {
    const t = setInterval(refresh, 60000);
    return () => clearInterval(t);
  }, [refresh]);

  const s = summary?.s ?? null;
  const loading = summary?.key !== sumKey || (view === "polar" && polar?.key !== tick);
  const failing = s?.health.filter((h) => h.status === "failing") ?? [];
  const missing = polar?.d?.orders?.filter((o) => o.needs_apply).length ?? 0;
  const failedDeliveries = polar?.d?.failed_events?.length ?? 0;
  const conv = s && s.checkouts_started > 0 ? Math.round((s.checkouts_paid / s.checkouts_started) * 100) : 0;
  const views = useMemo(() => [
    { id: "polar" as View, label: <>Polar{(missing + failedDeliveries) > 0 && <span className="ml-1.5 rounded-full bg-red-500 px-1.5 text-[11px] text-white">{missing + failedDeliveries}</span>}</> },
    { id: "events" as View, label: "Event log" },
    { id: "subs" as View, label: "Subscriptions" },
  ], [missing, failedDeliveries]);

  return (
    <div className="space-y-4">
      <DashMotion />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight">Payments</h2>
          <p className="text-[13.5px] text-muted-foreground">Revenue, webhook health and every billing event, card and crypto.</p>
        </div>
        <div className="flex items-center gap-2">
          <Segmented label="Range" value={range} onChange={setRange}
            options={[{ id: "7", label: "7 days" }, { id: "30", label: "30 days" }, { id: "90", label: "90 days" }]} />
          <button onClick={refresh} aria-label="Refresh" title="Refresh"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--dz-hairline)] text-muted-foreground hover:text-foreground">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {summary?.err && (
        <div className={cn("rounded-2xl border px-4 py-3 text-[13.5px]", TONE.bad)}>Couldn&apos;t load payments: {summary.err}</div>
      )}

      {failing.length > 0 && (
        <div role="alert" className="ov-rise flex items-start gap-3 rounded-[20px] border border-red-500/40 bg-red-500/[0.06] px-4 py-3.5 sm:px-5">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
          <div className="text-[13.5px]">
            <p className="font-semibold text-red-600 dark:text-red-400">
              {failing.map((h) => PROVIDER[h.provider].name).join(" and ")} webhooks are failing
            </p>
            <p className="mt-0.5 text-muted-foreground">
              Payments go through but plans don&apos;t activate and no confirmation email is sent. Paid Polar orders are
              re-checked every 15 minutes and applied automatically; check the webhook secret on the server.
            </p>
          </div>
        </div>
      )}

      {s && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {s.health.map((h) => <HealthCard key={h.provider} h={h} />)}
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard icon={CircleDollarSign} label="Revenue" value={Math.round(s.revenue)} format={(n) => usd(n, false)}
              sub={`${usd(s.revenue_prev, false)} the ${s.days} days before`} color={SERIES_1} delay={0} />
            <KpiCard icon={Repeat} label="MRR" value={Math.round(s.mrr)} format={(n) => usd(n, false)}
              sub={`${s.paying_users} paying ${s.paying_users === 1 ? "user" : "users"}`} color={SERIES_2} delay={60} />
            <KpiCard icon={ShoppingCart} label="Conversion" value={conv} format={(n) => `${n}%`}
              sub={`${s.checkouts_paid} of ${s.checkouts_started} paid${s.pending_stale ? ` · ${s.pending_stale} unpaid` : ""}`} color={AMBER} delay={120} />
            <KpiCard icon={s.problem_events > 0 || s.emails_failed > 0 ? AlertTriangle : Mail} label="Problems"
              value={s.problem_events} sub={`${s.emails_sent} ${s.emails_sent === 1 ? "email" : "emails"} sent · ${s.emails_failed} failed`}
              color={s.problem_events > 0 || s.emails_failed > 0 ? "#EF4444" : SERIES_1} delay={180}
              onClick={s.problem_events > 0 ? () => setView("events") : undefined} />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <RevenueChart s={s} />
            <PlanMix s={s} />
          </div>
        </>
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        <Segmented label="Payments view" value={view} onChange={setView} options={views} />
      </div>

      {view === "polar" && <PolarPanel data={polar?.d ?? null} loading={polar?.key !== tick} onChanged={refresh} />}
      {view === "events" && <EventLog problems={s?.problem_events ?? 0} refreshKey={tick} />}
      {view === "subs" && <Subscriptions refreshKey={tick} />}
    </div>
  );
}
