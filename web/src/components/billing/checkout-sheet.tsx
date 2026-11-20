"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRightIcon, CheckIcon, CircleNotchIcon, CreditCardIcon, CurrencyBtcIcon, LockSimpleIcon, XIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { rememberPayMethod, rememberedPayMethod, type PaidPlan } from "@/lib/upgrade";
import { API, authHeaders, type PlanCardData } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Checkout sheet: everything needed to pay for one plan on one surface.
// Opened from an "Upgrade to X" button or a /billing?checkout=X link.
//
//   Card   → same-tab redirect to Polar; its success_url brings the user back
//            to /billing?status=success, which confirms the plan.
//   Crypto → InventPay can't redirect back, so the invoice opens in a new tab
//            (opened synchronously in the click so popup blockers allow it)
//            and the billing page waits for the webhook.
// ─────────────────────────────────────────────────────────────────────────────

export interface CryptoPending {
  plan: string;
  method: "crypto";
  url: string;
  amount?: number;
  currency?: string;
  blocked: boolean;
}

const METHODS = [
  { id: "card" as const, label: "Card", icon: CreditCardIcon, note: "Visa, Mastercard or Amex on Polar's secure checkout. You come straight back here." },
  { id: "crypto" as const, label: "Crypto", icon: CurrencyBtcIcon, note: "BTC, ETH, USDT, SOL or LTC via InventPay. The invoice opens in a new tab." },
];

export function CheckoutSheet({
  plan,
  renew = false,
  onClose,
  onCryptoStarted,
}: {
  plan: PlanCardData & { id: PaidPlan };
  renew?: boolean;
  onClose: () => void;
  onCryptoStarted: (p: CryptoPending) => void;
}) {
  const [method, setMethod] = useState<"card" | "crypto">(() => rememberedPayMethod());
  const [busy, setBusy] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !redirecting) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, redirecting]);

  const per = plan.id === "team" ? "/seat/mo" : "/mo";
  const [lead, ...rest] = plan.features;
  const highlights = (lead && /:$/.test(lead.trim()) ? rest : plan.features).slice(0, 3);

  const pay = async () => {
    setBusy(true);
    setErr("");
    rememberPayMethod(method);
    // Must happen inside the click, before any await, or the browser blocks it.
    const tab = method === "crypto" ? window.open("about:blank", "_blank") : null;
    try {
      const res = await fetch(`${API}/api/v1/billing/checkout`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ plan: plan.id, method }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.invoice_url) {
        tab?.close();
        setErr(data.error || "Couldn't start checkout. Please try again.");
        setBusy(false);
        return;
      }
      if (method === "card") {
        setRedirecting(true);
        window.location.assign(data.invoice_url);
        return;
      }
      if (tab) {
        try { tab.opener = null; } catch { /* already cross-origin */ }
        tab.location.href = data.invoice_url;
      }
      onCryptoStarted({ plan: plan.id, method: "crypto", url: data.invoice_url, amount: data.amount, currency: data.currency, blocked: !tab });
    } catch {
      tab?.close();
      setErr("Network error. Check your connection and try again.");
      setBusy(false);
    }
  };

  const methodBtn = (on: boolean) =>
    cn(
      "flex h-11 items-center justify-center gap-2 rounded-2xl border text-[14px] font-medium transition-colors",
      on ? "border-foreground/70 bg-foreground/[0.04] text-foreground" : "border-[var(--dz-hairline)] text-muted-foreground hover:border-foreground/25 hover:text-foreground",
    );

  // Portal to <body>: the page wrapper animates with a transform, which would
  // make `fixed` relative to it.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:px-4"
      style={{ animation: "dz-fade .2s ease both" }}
      onClick={() => { if (!redirecting) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-title"
        className="w-full max-w-md rounded-t-[26px] border border-[var(--dz-hairline)] bg-background pb-[env(safe-area-inset-bottom)] shadow-2xl sm:rounded-[26px]"
        style={{ animation: "dz-pop .25s cubic-bezier(.2,.7,.2,1) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-foreground/15 sm:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-3 p-5 pb-4 sm:p-6 sm:pb-4">
          <div>
            <p className="eyebrow">{renew ? "Renew subscription" : "Upgrade"}</p>
            <h2 id="checkout-title" className="mt-1.5 text-[22px] font-semibold tracking-[-0.03em]">{plan.name}</h2>
            <p className="mt-1 flex items-baseline gap-1">
              <span className="text-[15px] font-semibold tabular-nums">{plan.price}</span>
              <span className="text-[13px] text-muted-foreground">{per} · cancel any time</span>
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={redirecting} aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-40">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-5 sm:px-6">
          {highlights.length > 0 && (
            <ul className="space-y-2 border-y border-[var(--dz-hairline)] py-4">
              {highlights.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-[13.5px] leading-snug">
                  <CheckIcon weight="bold" className="mt-[3px] h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          )}

          <div>
            <p className="text-[13.5px] font-medium text-muted-foreground">Pay with</p>
            <div role="radiogroup" aria-label="Pay with" className="mt-2 grid grid-cols-2 gap-2">
              {METHODS.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={method === m.id}
                  onClick={() => { setMethod(m.id); setErr(""); }} className={methodBtn(method === m.id)}>
                  <m.icon className="h-4 w-4" /> {m.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground">{METHODS.find((m) => m.id === method)?.note}</p>
          </div>

          {err && <p role="alert" className="text-[13px] text-red-600 dark:text-red-400">{err}</p>}
        </div>

        <div className="p-5 pt-5 sm:p-6 sm:pt-5">
          <button type="button" onClick={pay} disabled={busy}
            className="pill pill-ink w-full disabled:opacity-70">
            {busy ? (
              <><CircleNotchIcon className="h-4 w-4 animate-spin" /> {redirecting ? "Taking you to checkout…" : "Starting checkout…"}</>
            ) : (
              <>Continue to payment · {plan.price}{per} <ArrowRightIcon className="h-4 w-4" /></>
            )}
          </button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground">
            <LockSimpleIcon className="h-3.5 w-3.5" /> Your new limits apply as soon as the payment clears.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
