"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, Bitcoin, CreditCard, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { API, authHeaders, type CreditsResp } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Add-funds sheet: preset or custom amount, card or crypto. It docks to the
// bottom on phones and centres on larger screens. The hosted invoice opens in
// a new tab; the balance refreshes on the next 20s poll.
// ─────────────────────────────────────────────────────────────────────────────

export function AddFundsModal({ data, onClose }: { data: CreditsResp; onClose: () => void }) {
  const presets = data.presets || [5, 10, 20, 50];
  const min = data.min_usd || 5;
  const max = data.max_usd || 1000;
  const methods = data.methods || { crypto: true, card: false };

  const [amount, setAmount] = useState<number>(presets[1] || 10);
  const [custom, setCustom] = useState("");
  const [method, setMethod] = useState<"card" | "crypto">(methods.card ? "card" : "crypto");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const amt = custom !== "" ? Number(custom) || 0 : amount;
  const valid = amt >= min && amt <= max;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const buy = async () => {
    if (!valid) { setErr(`Enter an amount between $${min} and $${max}.`); return; }
    setBusy(true); setErr("");
    try {
      const res = await fetch(`${API}/api/v1/ai/credits/topup`, {
        method: "POST", headers: authHeaders(), body: JSON.stringify({ amount: amt, method }),
      });
      const d = await res.json();
      if (res.ok && d.invoice_url) { window.open(d.invoice_url, "_blank", "noopener"); onClose(); }
      else setErr(d.error || "Could not start checkout");
    } catch { setErr("Network error"); }
    setBusy(false);
  };

  const methodBtn = (on: boolean) =>
    cn(
      "flex h-11 items-center justify-center gap-2 rounded-2xl border text-[14px] font-medium transition-colors",
      on ? "border-brand/60 bg-brand/[0.08] text-foreground" : "border-[var(--dz-hairline)] text-muted-foreground hover:border-foreground/25 hover:text-foreground",
    );

  // Portal to <body>: the page wrapper animates with a transform, which would
  // make `fixed` relative to it and strand the sheet off-screen.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:px-4"
      style={{ animation: "dz-fade .2s ease both" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-funds-title"
        className="w-full max-w-md rounded-t-[26px] border border-[var(--dz-hairline)] bg-background pb-[env(safe-area-inset-bottom)] shadow-2xl sm:rounded-[26px]"
        style={{ animation: "dz-pop .25s cubic-bezier(.2,.7,.2,1) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-foreground/15 sm:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-3 p-5 pb-4 sm:p-6 sm:pb-4">
          <div>
            <p className="eyebrow">Prepaid balance</p>
            <h2 id="add-funds-title" className="mt-1.5 text-[22px] font-semibold tracking-[-0.03em]">Add funds</h2>
            <p className="mt-1 text-[13.5px] text-muted-foreground">For AI and email usage. Funds never expire.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-5 sm:px-6">
          <div className="grid grid-cols-4 gap-2">
            {presets.map((p) => {
              const active = custom === "" && amount === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => { setAmount(p); setCustom(""); setErr(""); }}
                  className={cn(
                    "h-11 rounded-2xl border text-[15px] font-semibold tabular-nums transition-colors",
                    active ? "border-foreground bg-foreground text-background" : "border-[var(--dz-hairline)] hover:border-foreground/30",
                  )}
                >
                  ${p}
                </button>
              );
            })}
          </div>

          <label className="block">
            <span className="text-[13.5px] font-medium text-muted-foreground">Custom amount</span>
            <span className="mt-2 flex h-11 items-center rounded-2xl border border-[var(--dz-hairline)] px-3.5 transition-colors focus-within:border-brand/60 focus-within:ring-4 focus-within:ring-brand/10">
              <span className="text-[15px] text-muted-foreground">$</span>
              <input
                value={custom}
                onChange={(e) => { setCustom(e.target.value.replace(/[^0-9.]/g, "")); setErr(""); }}
                inputMode="decimal"
                placeholder={String(amount)}
                aria-label="Custom amount in dollars"
                className="h-full w-full border-0 px-2 text-[15px] tabular-nums outline-none"
                style={{ background: "transparent" }}
              />
              <span className="shrink-0 text-[12.5px] text-muted-foreground">${min} to ${max.toLocaleString()}</span>
            </span>
          </label>

          <div>
            <p className="text-[13.5px] font-medium text-muted-foreground">Pay with</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {methods.card && (
                <button type="button" onClick={() => setMethod("card")} className={methodBtn(method === "card")}>
                  <CreditCard className="h-4 w-4" /> Card
                </button>
              )}
              {methods.crypto && (
                <button type="button" onClick={() => setMethod("crypto")} className={cn(methodBtn(method === "crypto"), !methods.card && "col-span-2")}>
                  <Bitcoin className="h-4 w-4" /> Crypto (USDT)
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-[var(--dz-hairline)] pt-4">
            <span className="text-[14px] text-muted-foreground">Total</span>
            <span className="text-[22px] font-semibold tracking-tight tabular-nums">${(Math.round(amt * 100) / 100).toFixed(2)}</span>
          </div>
          {err && <p className="text-[13.5px] text-red-600 dark:text-red-400">{err}</p>}
        </div>

        <div className="flex flex-col-reverse gap-2 p-5 pt-5 sm:flex-row sm:justify-end sm:p-6 sm:pt-5">
          <button type="button" onClick={onClose} className="pill pill-line pill-sm">Cancel</button>
          <button type="button" onClick={buy} disabled={busy || !valid} className="pill pill-launch pill-sm disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Continue to payment <ArrowUpRight className="h-4 w-4" /></>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
