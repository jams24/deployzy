"use client";

import { useState, type ReactNode } from "react";
import {
  ArrowDownLeft, CheckCircle2, ChevronLeft, ChevronRight, Clock, Gift,
  MailCheck, MessageSquare, Pencil, Receipt, SlidersHorizontal, Undo2,
  Wand2, XCircle,
} from "lucide-react";
import { fmtDate, fmtInt, reasonLabel, timeAgo, usd, type LedgerRow, type Subscription } from "./types";
import { useNow } from "./use-now";

// ─────────────────────────────────────────────────────────────────────────────
// Activity tab — two ledgers: subscription invoices (with dead-invoice
// filtering) and the metered AI/email activity feed. Both paginated in place.
// ─────────────────────────────────────────────────────────────────────────────

type Tone = "paid" | "pending" | "dead";

// Crypto invoices expire ~30 min after creation, so anything still "pending"
// after an hour is a dead invoice. `now` is null pre-mount → treated as fresh.
function derive(s: Subscription, now: number | null): { label: string; tone: Tone } {
  const st = (s.status || "").toLowerCase();
  if (st === "active" || st === "paid") return { label: "Paid", tone: "paid" };
  if (st === "pending") {
    const ageH = now === null ? 0 : (now - new Date(s.created_at).getTime()) / 3.6e6;
    return ageH > 1 ? { label: "Expired", tone: "dead" } : { label: "Pending", tone: "pending" };
  }
  if (st === "cancelled" || st === "canceled") return { label: "Cancelled", tone: "dead" };
  if (st === "failed") return { label: "Failed", tone: "dead" };
  if (st === "expired") return { label: "Expired", tone: "dead" };
  return { label: s.status, tone: "dead" };
}

const TONE_STYLE: Record<Tone, { cls: string; icon: typeof CheckCircle2 }> = {
  paid:    { cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", icon: CheckCircle2 },
  pending: { cls: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",         icon: Clock },
  dead:    { cls: "border-border/60 bg-muted text-muted-foreground",                                 icon: XCircle },
};

function StatusPill({ tone, label }: { tone: Tone; label: string }) {
  const { cls, icon: Icon } = TONE_STYLE[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      <Icon className="h-2.5 w-2.5" /> {label}
    </span>
  );
}

function Pager({ page, pages, total, pageSize, onPage }: { page: number; pages: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-1 pt-2.5 text-xs text-muted-foreground">
      <span className="tabular-nums">{page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}</span>
      <div className="flex items-center gap-1">
        <button
          disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Previous page"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 transition-colors hover:border-foreground/30 disabled:opacity-40"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="px-1 tabular-nums">{page + 1}/{pages}</span>
        <button
          disabled={page >= pages - 1} onClick={() => onPage(page + 1)} aria-label="Next page"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 transition-colors hover:border-foreground/30 disabled:opacity-40"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function EmptyNote({ icon: Icon, children }: { icon: typeof Receipt; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 bg-muted/40">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="mt-3 max-w-xs text-xs leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

const REASON_ICON: Record<string, typeof Wand2> = {
  build: Wand2, edit: Pencil, agent: MessageSquare,
  email_verify: MailCheck, email_verify_batch: MailCheck,
  topup: ArrowDownLeft, monthly_free: Gift, refund: Undo2, admin: SlidersHorizontal,
};

export function Invoices({ history }: { history: Subscription[] }) {
  const [page, setPage] = useState(0);
  const [hideDead, setHideDead] = useState(true);
  const now = useNow();

  const all = history.map((s) => ({ s, d: derive(s, now) }));
  const paidCount = all.filter((x) => x.d.tone === "paid").length;
  const rows = hideDead ? all.filter((x) => x.d.tone !== "dead") : all;
  const pageSize = 6;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const slice = rows.slice(cur * pageSize, cur * pageSize + pageSize);

  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
          <Receipt className="h-3.5 w-3.5" /> Invoices
        </p>
        {history.length > 0 && (
          <div className="flex items-center gap-3 text-[11px]">
            <span className="tabular-nums text-muted-foreground">{paidCount} paid · {history.length} total</span>
            <button
              onClick={() => { setHideDead((v) => !v); setPage(0); }}
              className="text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
            >
              {hideDead ? "Show expired" : "Hide expired"}
            </button>
          </div>
        )}
      </div>

      <div className="p-3">
        {rows.length === 0 ? (
          <EmptyNote icon={Receipt}>
            {history.length === 0
              ? "No payments yet — receipts for subscriptions land here."
              : `No ${hideDead ? "paid or pending" : ""} payments.`}
          </EmptyNote>
        ) : (
          <div className="divide-y divide-border/40">
            {slice.map(({ s, d }) => (
              <div key={s.id} className="flex items-center gap-3 px-2 py-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-muted-foreground">
                  <Receipt className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium capitalize">{s.plan} subscription</div>
                  <div className="text-[11px] tabular-nums text-muted-foreground">{fmtDate(s.created_at)}</div>
                </div>
                <span className="text-[13px] font-semibold tabular-nums">${s.amount} {s.currency}</span>
                <StatusPill tone={d.tone} label={d.label} />
              </div>
            ))}
          </div>
        )}
        <Pager page={cur} pages={pages} total={rows.length} pageSize={pageSize} onPage={setPage} />
      </div>
    </section>
  );
}

export function CreditsLedger({ ledger }: { ledger: LedgerRow[] }) {
  const [page, setPage] = useState(0);
  const now = useNow(60000); // tick so "xm ago" stays honest on an open page
  const pageSize = 8;
  const pages = Math.max(1, Math.ceil(ledger.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const slice = ledger.slice(cur * pageSize, cur * pageSize + pageSize);

  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
          <Wand2 className="h-3.5 w-3.5" /> AI usage activity
        </p>
        {ledger.length > 0 && <span className="text-[11px] tabular-nums text-muted-foreground">{ledger.length} events</span>}
      </div>

      <div className="p-3">
        {ledger.length === 0 ? (
          <EmptyNote icon={Wand2}>
            Nothing yet — AI builder runs, agent chats, email verifications and top-ups will appear here.
          </EmptyNote>
        ) : (
          <div className="divide-y divide-border/40">
            {slice.map((row, i) => {
              const isGrant = row.delta >= 0;
              const Icon = REASON_ICON[row.reason] ?? SlidersHorizontal;
              return (
                <div key={i} className="flex items-center gap-3 px-2 py-2.5">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${isGrant ? "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-600 dark:text-emerald-400" : "border-border/60 bg-muted/40 text-muted-foreground"}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{reasonLabel[row.reason] || row.reason}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {row.model || (isGrant ? "payment" : "—")}
                      {(row.tokens_in > 0 || row.tokens_out > 0) ? ` · ${fmtInt(row.tokens_in + row.tokens_out)} tokens` : ""} · {timeAgo(row.created_at, now)}
                    </div>
                  </div>
                  <span className={`text-[13px] font-semibold tabular-nums ${isGrant ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>
                    {isGrant ? "+" : "−"}{usd(Math.abs(row.delta))}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <Pager page={cur} pages={pages} total={ledger.length} pageSize={pageSize} onPage={setPage} />
      </div>
    </section>
  );
}
