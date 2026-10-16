"use client";

import { useState } from "react";
import { ArrowUpRight, Bitcoin, CreditCard, Loader2, X } from "lucide-react";
import { API, authHeaders, type CreditsResp } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Add-funds modal — preset/custom amount + card-or-crypto method. The hosted
// invoice opens in a new tab; the balance refreshes on the next 20s poll.
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border/70 bg-background shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 pb-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Add funds</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Prepaid balance for AI &amp; email usage · never expires</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5">
          <div className="grid grid-cols-4 gap-2">
            {presets.map((p) => {
              const active = custom === "" && amount === p;
              return (
                <button
                  key={p}
                  onClick={() => { setAmount(p); setCustom(""); }}
                  className={`rounded-lg border py-2 text-sm font-semibold transition-colors ${active ? "border-foreground bg-foreground text-background" : "border-border/70 hover:border-foreground/40"}`}
                >
                  ${p}
                </button>
              );
            })}
          </div>

          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Custom amount</div>
            <div className="flex items-center rounded-lg border border-input bg-background px-3 focus-within:border-foreground/40">
              <span className="text-sm text-muted-foreground">$</span>
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                placeholder={String(amount)}
                className="w-full bg-transparent px-2 py-2.5 text-sm outline-none tabular-nums"
              />
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Payment method</div>
            <div className="grid grid-cols-2 gap-2">
              {methods.card && (
                <button
                  onClick={() => setMethod("card")}
                  className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm transition-colors ${method === "card" ? "border-foreground bg-muted/50 font-medium" : "border-border/70 text-muted-foreground hover:border-foreground/40"}`}
                >
                  <CreditCard className="h-4 w-4" /> Card
                </button>
              )}
              {methods.crypto && (
                <button
                  onClick={() => setMethod("crypto")}
                  className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm transition-colors ${method === "crypto" ? "border-foreground bg-muted/50 font-medium" : "border-border/70 text-muted-foreground hover:border-foreground/40"} ${!methods.card ? "col-span-2" : ""}`}
                >
                  <Bitcoin className="h-4 w-4" /> Crypto (USDT)
                </button>
              )}
            </div>
          </div>

          <div className="border-t border-border/60 pt-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total</span>
              <span className="font-semibold tabular-nums">${(Math.round(amt * 100) / 100).toFixed(2)}</span>
            </div>
          </div>
          {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 p-5 pt-4">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            Cancel
          </button>
          <button
            onClick={buy}
            disabled={busy || !valid}
            className="flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Continue <ArrowUpRight className="h-3.5 w-3.5" /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
