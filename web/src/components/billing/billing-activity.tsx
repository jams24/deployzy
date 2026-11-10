"use client";

import { useState, type ReactNode } from "react";
import {
  ArrowDownLeft, CheckCircle2, ChevronLeft, ChevronRight, Clock, Gift,
  MailCheck, MessageSquare, Pencil, Receipt, SlidersHorizontal, Undo2,
  Wand2, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDate, fmtInt, reasonLabel, timeAgo, usd, type LedgerRow, type Subscription } from "./types";
import { useNow } from "./use-now";

// ─────────────────────────────────────────────────────────────────────────────
// Activity tab: subscription invoices (dead crypto invoices hidden by default)
// and the metered AI/email ledger. Both paginate in place.
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
  paid:    { cls: "bg-brand/10 text-[var(--dz-green-strong)] dark:text-brand", icon: CheckCircle2 },
  pending: { cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400",          icon: Clock },
  dead:    { cls: "bg-foreground/[0.05] text-muted-foreground",                  icon: XCircle },
};

function StatusPill({ tone, label }: { tone: Tone; label: string }) {
  const { cls, icon: Icon } = TONE_STYLE[tone];
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[12.5px] font-medium", cls)}>
      <Icon className="h-3 w-3" /> {label}
    </span>
  );
}

function Pager({ page, pages, total, pageSize, onPage }: { page: number; pages: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  const btn = "flex h-8 w-8 items-center justify-center rounded-full border border-[var(--dz-hairline)] transition-colors hover:border-foreground/30 hover:text-foreground disabled:pointer-events-none disabled:opacity-40";
  return (
    <div className="flex items-center justify-between border-t border-[var(--dz-hairline)] px-4 py-3 text-[13.5px] text-muted-foreground sm:px-5">
      <span className="tabular-nums">{page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}</span>
      <div className="flex items-center gap-1.5">
        <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Previous page" className={btn}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[3rem] text-center tabular-nums">{page + 1} / {pages}</span>
        <button type="button" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} aria-label="Next page" className={btn}>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function EmptyNote({ icon: Icon, title, children }: { icon: typeof Receipt; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-foreground/[0.05]">
        <Icon className="h-4.5 w-4.5 text-muted-foreground" />
      </span>
      <p className="mt-3 text-[14.5px] font-semibold">{title}</p>
      <p className="mt-1 max-w-xs text-[13.5px] leading-snug text-muted-foreground">{children}</p>
    </div>
  );
}

function Header({ title, meta, action }: { title: string; meta?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-[53px] flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-[var(--dz-hairline)] px-4 py-2.5 sm:px-5">
      <p className="text-[14.5px] font-semibold tracking-tight">{title}</p>
      <div className="flex items-center gap-3 text-[13.5px] text-muted-foreground">
        {meta}
        {action}
      </div>
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
  const deadCount = all.length - all.filter((x) => x.d.tone !== "dead").length;
  const rows = hideDead ? all.filter((x) => x.d.tone !== "dead") : all;
  const pageSize = 6;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const slice = rows.slice(cur * pageSize, cur * pageSize + pageSize);

  return (
    <section className="surface overflow-hidden rounded-[20px]">
      <Header
        title="Invoices"
        meta={history.length > 0 ? <span className="tabular-nums">{paidCount} paid</span> : undefined}
        action={deadCount > 0 ? (
          <button
            type="button"
            onClick={() => { setHideDead((v) => !v); setPage(0); }}
            className="rounded-full border border-[var(--dz-hairline)] px-2.5 py-1 text-[12.5px] font-medium transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            {hideDead ? `Show ${deadCount} expired` : "Hide expired"}
          </button>
        ) : undefined}
      />

      {rows.length === 0 ? (
        <EmptyNote icon={Receipt} title={history.length === 0 ? "No payments yet" : "Nothing paid or pending"}>
          {history.length === 0
            ? "Receipts for your subscription land here after your first upgrade."
            : "Only expired or cancelled checkouts so far."}
        </EmptyNote>
      ) : (
        <ul className="divide-y divide-[var(--dz-hairline)]">
          {slice.map(({ s, d }) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.05] text-muted-foreground">
                <Receipt className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium"><span className="capitalize">{s.plan}</span> plan</p>
                <p className="text-[12.5px] tabular-nums text-muted-foreground">{fmtDate(s.created_at)}</p>
              </div>
              <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
                <span className="text-[14px] font-semibold tabular-nums">${s.amount} <span className="font-normal text-muted-foreground">{s.currency}</span></span>
                <StatusPill tone={d.tone} label={d.label} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager page={cur} pages={pages} total={rows.length} pageSize={pageSize} onPage={setPage} />
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
    <section className="surface overflow-hidden rounded-[20px]">
      <Header title="AI & email activity" meta={ledger.length > 0 ? <span className="tabular-nums">{ledger.length} events</span> : undefined} />

      {ledger.length === 0 ? (
        <EmptyNote icon={Wand2} title="No activity yet">
          AI builder runs, agent chats, email verifications and top-ups appear here.
        </EmptyNote>
      ) : (
        <ul className="divide-y divide-[var(--dz-hairline)]">
          {slice.map((row, i) => {
            const isGrant = row.delta >= 0;
            const Icon = REASON_ICON[row.reason] ?? SlidersHorizontal;
            const tokens = row.tokens_in + row.tokens_out;
            return (
              <li key={i} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <span className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                  isGrant ? "bg-brand/10 text-[var(--dz-green-strong)] dark:text-brand" : "bg-foreground/[0.05] text-muted-foreground",
                )}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">{reasonLabel[row.reason] || row.reason}</p>
                  <p className="truncate text-[12.5px] text-muted-foreground">
                    {[row.model || (row.reason === "topup" ? "Payment" : ""), tokens > 0 ? `${fmtInt(tokens)} tokens` : "", timeAgo(row.created_at, now)].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className={cn("shrink-0 text-[14px] font-semibold tabular-nums", isGrant && "text-[var(--dz-green-strong)] dark:text-brand")}>
                  {isGrant ? "+" : "−"}{usd(Math.abs(row.delta))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Pager page={cur} pages={pages} total={ledger.length} pageSize={pageSize} onPage={setPage} />
    </section>
  );
}
