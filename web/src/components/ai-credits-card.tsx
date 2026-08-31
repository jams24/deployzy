"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Loader2, Sparkles, CreditCard, Bitcoin, ArrowUpRight, X } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface Status {
  free_allotment: number; free_used: number; free_remaining: number;
  wallet: number; available: number; unlimited: boolean;
}
interface LedgerRow {
  delta: number; reason: string; source: string; project_id: string;
  model: string; tokens_in: number; tokens_out: number; created_at: string;
}
interface CreditsResp {
  enabled: boolean; unlimited: boolean; status: Status; ledger: LedgerRow[];
  methods?: { crypto: boolean; card: boolean };
  credits_per_dollar?: number; presets?: number[]; min_usd?: number; max_usd?: number;
}

const headers = () => {
  const token = typeof window !== "undefined" ? localStorage.getItem("sm_token") : "";
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
};

const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtInt = (n: number) => Math.round(n).toLocaleString();
const timeAgo = (iso: string) => {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
};
const reasonLabel: Record<string, string> = {
  build: "Build", edit: "Edit", agent: "Agent", topup: "Top-up",
  monthly_free: "Monthly credits", refund: "Refund", admin: "Adjustment",
};

export function AICreditsCard() {
  const [data, setData] = useState<CreditsResp | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/ai/credits`, { headers: headers() });
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!data) return null;

  const st = data.status;
  const metered = data.enabled && !data.unlimited;
  const methods = data.methods || { crypto: true, card: false };
  const canTopUp = methods.crypto || methods.card;
  const freeUsedPct = st.free_allotment > 0 ? Math.min(100, (st.free_used / st.free_allotment) * 100) : 0;

  return (
    <>
      <Card className="mt-6 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" /> AI Builder Credits
            </div>
            <div className="mt-2 flex items-end gap-2">
              <span className="text-[34px] leading-none font-bold tracking-tight tabular-nums">
                {st.unlimited || !metered ? "∞" : fmt(st.available)}
              </span>
              <span className="mb-0.5 text-sm text-muted-foreground">
                {st.unlimited || !metered ? "unlimited" : "credits available"}
              </span>
            </div>
            {!metered && (
              <p className="mt-1 text-xs text-muted-foreground">
                {data.unlimited && data.enabled ? "Unlimited on your plan." : "Metering is off — AI usage is currently free."}
              </p>
            )}
          </div>

          {metered && canTopUp && (
            <button onClick={() => setBuyOpen(true)}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border/70 bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:border-foreground/40 hover:bg-muted/50">
              <Sparkles className="h-3.5 w-3.5" /> Top up
            </button>
          )}
        </div>

        {/* Free-this-month meter */}
        {metered && st.free_allotment >= 0 && (
          <div className="mt-5 border-t border-border/60 pt-4 space-y-3">
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-muted-foreground">Free this month</span>
                <span className="tabular-nums text-muted-foreground">{fmt(st.free_remaining)} / {fmtInt(st.free_allotment)} left</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${100 - freeUsedPct}%` }} />
              </div>
            </div>
            {st.wallet > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Top-up wallet</span>
                <span className="tabular-nums font-medium">{fmt(st.wallet)} credits</span>
              </div>
            )}
          </div>
        )}

        {/* Recent activity */}
        {data.ledger.length > 0 && (
          <div className="mt-5 border-t border-border/60 pt-4">
            <div className="text-xs font-medium text-muted-foreground mb-2">Recent activity</div>
            <div className="space-y-0.5">
              {data.ledger.slice(0, 5).map((row, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium">{reasonLabel[row.reason] || row.reason}</span>
                    <span className="text-[11px] text-muted-foreground ml-2">
                      {row.model || "—"}{(row.tokens_in > 0 || row.tokens_out > 0) ? ` · ${fmtInt(row.tokens_in + row.tokens_out)} tok` : ""} · {timeAgo(row.created_at)}
                    </span>
                  </div>
                  <span className={`tabular-nums font-semibold ${row.delta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>
                    {row.delta >= 0 ? "+" : ""}{fmt(row.delta)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {buyOpen && (
        <BuyCreditsModal data={data} onClose={() => setBuyOpen(false)} />
      )}
    </>
  );
}

// ── Buy Credits modal ────────────────────────────────────────────────────────
function BuyCreditsModal({ data, onClose }: { data: CreditsResp; onClose: () => void }) {
  const rate = data.credits_per_dollar || 100;
  const presets = data.presets || [5, 10, 20, 50];
  const min = data.min_usd || 5;
  const max = data.max_usd || 1000;
  const methods = data.methods || { crypto: true, card: false };

  const [amount, setAmount] = useState<number>(presets[1] || 10);
  const [custom, setCustom] = useState("");
  const [method, setMethod] = useState<"card" | "crypto">(methods.card ? "card" : "crypto");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const usd = custom !== "" ? Number(custom) || 0 : amount;
  const credits = Math.round(usd * rate);
  const valid = usd >= min && usd <= max;

  const buy = async () => {
    if (!valid) { setErr(`Enter an amount between $${min} and $${max}.`); return; }
    setBusy(true); setErr("");
    try {
      const res = await fetch(`${API}/api/v1/ai/credits/topup`, {
        method: "POST", headers: headers(), body: JSON.stringify({ amount: usd, method }),
      });
      const d = await res.json();
      if (res.ok && d.invoice_url) { window.open(d.invoice_url, "_blank", "noopener"); onClose(); }
      else setErr(d.error || "Could not start checkout");
    } catch { setErr("Network error"); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border/70 bg-background shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 pb-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Buy credits</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{rate} credits per $1 · credits never expire</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="px-5 space-y-4">
          {/* Preset chips */}
          <div className="grid grid-cols-4 gap-2">
            {presets.map(p => {
              const active = custom === "" && amount === p;
              return (
                <button key={p} onClick={() => { setAmount(p); setCustom(""); }}
                  className={`rounded-lg border py-2 text-sm font-semibold transition-colors ${active ? "border-foreground bg-foreground text-background" : "border-border/70 hover:border-foreground/40"}`}>
                  ${p}
                </button>
              );
            })}
          </div>

          {/* Custom amount */}
          <div>
            <div className="flex items-center rounded-lg border border-input bg-background px-3 focus-within:border-foreground/40">
              <span className="text-sm text-muted-foreground">$</span>
              <input value={custom} onChange={e => setCustom(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal" placeholder={String(amount)}
                className="w-full bg-transparent px-2 py-2.5 text-sm outline-none tabular-nums" />
            </div>
            <div className="mt-1.5 text-sm tabular-nums text-muted-foreground">{fmtInt(credits)} credits</div>
          </div>

          {/* Payment method */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1.5">Payment method</div>
            <div className="grid grid-cols-2 gap-2">
              {methods.card && (
                <button onClick={() => setMethod("card")}
                  className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm transition-colors ${method === "card" ? "border-foreground bg-muted/50 font-medium" : "border-border/70 text-muted-foreground hover:border-foreground/40"}`}>
                  <CreditCard className="h-4 w-4" /> Card
                </button>
              )}
              {methods.crypto && (
                <button onClick={() => setMethod("crypto")}
                  className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm transition-colors ${method === "crypto" ? "border-foreground bg-muted/50 font-medium" : "border-border/70 text-muted-foreground hover:border-foreground/40"} ${!methods.card ? "col-span-2" : ""}`}>
                  <Bitcoin className="h-4 w-4" /> Crypto (USDT)
                </button>
              )}
            </div>
          </div>

          {/* Summary */}
          <div className="border-t border-border/60 pt-3 space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">AI credits</span>
              <span className="tabular-nums font-medium">{fmtInt(credits)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total</span>
              <span className="tabular-nums font-semibold">${fmt(usd)}</span>
            </div>
          </div>
          {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 p-5 pt-4">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          <button onClick={buy} disabled={busy || !valid}
            className="flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Continue <ArrowUpRight className="h-3.5 w-3.5" /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
