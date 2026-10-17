"use client";

import { useMemo, useState } from "react";
import {
  MailCheck, CalendarDays, Users, ShieldCheck, Trash2, ServerOff, AtSign, Layers, Radar, Coins,
} from "lucide-react";
import { timeAgo } from "@/components/admin/pager";
import { CountUp, DashMotion, KpiCard, halves, sum } from "@/components/admin/dash-kit";

// Shape of GET /api/v1/admin/email-verify/analytics.
export interface EmailAnalytics {
  today: Period; week: Period; month: Period; all_time: number;
  disposable_30d: number; role_based_30d: number; no_mx_30d: number; smtp_probed_30d: number;
  batch_share_30d: number;
  daily: { day: string; total: number; valid: number; invalid: number; risky: number }[];
  top_users: { user_id: string; email: string; total: number; invalid: number; last_used: string }[];
  top_domains: { key: string; count: number }[];
  top_reasons: { key: string; count: number }[];
}
interface Period { total: number; users: number; valid: number; risky: number; invalid: number; unknown: number }

const C = { valid: "#10b981", risky: "#f59e0b", invalid: "#ef4444", unknown: "#a1a1aa" };
const CREDITS_PER_CHECK = 0.05; // 1 credit = $0.01
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

// ── Daily stacked chart ───────────────────────────────────────────────────
function DailyChart({ daily }: { daily: EmailAnalytics["daily"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...daily.map((d) => d.total));
  const total = sum(daily.map((d) => d.total));
  const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString([], { month: "short", day: "numeric" });
  const h = hover !== null ? daily[hover] : null;
  return (
    <div className="ov-rise rounded-2xl border border-border/60 bg-card p-4 sm:p-5" style={{ animationDelay: "240ms" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Verifications per day</p>
          <p className="text-xs text-muted-foreground"><span className="font-medium tabular-nums text-foreground">{total.toLocaleString()}</span> checks in the last 30 days</p>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          {(["valid", "risky", "invalid"] as const).map((k) => (
            <span key={k} className="flex items-center gap-1 capitalize"><span className="h-2 w-2 rounded-sm" style={{ background: C[k] }} />{k}</span>
          ))}
        </div>
      </div>
      <div className="relative mt-4">
        {total === 0 ? (
          <div className="flex h-44 items-center justify-center rounded-xl border border-dashed border-border text-xs text-muted-foreground">No verifications in this window yet.</div>
        ) : (
          <div className="flex h-44 items-end gap-[3px]" onMouseLeave={() => setHover(null)}>
            {daily.map((d, i) => {
              const other = Math.max(0, d.total - d.valid - d.risky - d.invalid);
              const seg = (n: number, color: string) => n > 0 && (
                <div style={{ height: `${(n / d.total) * 100}%`, background: color }} />
              );
              return (
                <div key={d.day} className="group flex h-full flex-1 cursor-default items-end" onMouseEnter={() => setHover(i)}>
                  {d.total === 0 ? (
                    <div className="h-[2px] w-full rounded-full bg-muted" />
                  ) : (
                    <div className={`ov-grow-y flex w-full flex-col-reverse overflow-hidden rounded-t-[3px] transition-opacity ${hover !== null && hover !== i ? "opacity-40" : ""}`}
                      style={{ height: `${Math.max(4, (d.total / max) * 100)}%`, animationDelay: `${300 + i * 15}ms` }}>
                      {seg(d.valid, C.valid)}{seg(d.risky, C.risky)}{seg(d.invalid, C.invalid)}{seg(other, C.unknown)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {h && hover !== null && (
          <div className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-popover px-2.5 py-1.5 text-[11px] shadow-md"
            style={{ left: `${((hover + 0.5) / daily.length) * 100}%` }}>
            <p className="font-medium">{fmt(h.day)} · {h.total.toLocaleString()} checks</p>
            <p className="tabular-nums text-muted-foreground">
              <span style={{ color: C.valid }}>{h.valid} valid</span> · <span style={{ color: C.risky }}>{h.risky} risky</span> · <span style={{ color: C.invalid }}>{h.invalid} invalid</span>
            </p>
          </div>
        )}
        {daily.length > 0 && (
          <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-muted-foreground">
            <span>{fmt(daily[0].day)}</span><span>{fmt(daily[Math.floor(daily.length / 2)].day)}</span><span>Today</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Result mix ring ───────────────────────────────────────────────────────
function ResultMix({ m }: { m: Period }) {
  const parts = ([
    ["Valid", m.valid, C.valid], ["Risky", m.risky, C.risky], ["Invalid", m.invalid, C.invalid], ["Unknown", m.unknown, C.unknown],
  ] as const).map(([label, n, color]) => ({ label, n, color }));
  const total = Math.max(1, m.total);
  const R = 52, CIRC = 2 * Math.PI * R;
  const segs = parts.filter((p) => p.n > 0).map((p, i, arr) => ({
    ...p, len: (p.n / total) * CIRC, offset: arr.slice(0, i).reduce((a, q) => a + (q.n / total) * CIRC, 0),
  }));
  return (
    <div className="ov-rise rounded-2xl border border-border/60 bg-card p-4 sm:p-5" style={{ animationDelay: "300ms" }}>
      <p className="text-sm font-semibold">Result mix <span className="font-normal text-muted-foreground">· 30d</span></p>
      <div className="mt-3 flex flex-wrap items-center gap-5">
        <div className="relative mx-auto h-32 w-32 shrink-0 sm:mx-0">
          <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
            <circle cx="64" cy="64" r={R} fill="none" className="stroke-muted" strokeWidth="12" />
            {segs.map((s) => (
              <circle key={s.label} cx="64" cy="64" r={R} fill="none" stroke={s.color} strokeWidth="12"
                strokeDasharray={`${Math.max(0, s.len - (segs.length > 1 ? 2 : 0))} ${CIRC}`} strokeDashoffset={-s.offset} className="ov-ring" />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-semibold tabular-nums"><CountUp value={pct(m.valid, m.total)} />%</span>
            <span className="text-[10px] text-muted-foreground">deliverable</span>
          </div>
        </div>
        <div className="min-w-[9rem] flex-1 space-y-1.5">
          {parts.map((p) => (
            <div key={p.label} className="flex items-center gap-2 text-xs">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />
              <span className="flex-1 text-muted-foreground">{p.label}</span>
              <span className="tabular-nums font-medium">{p.n.toLocaleString()}</span>
              <span className="w-9 text-right tabular-nums text-muted-foreground">{pct(p.n, m.total)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── List-health signals ───────────────────────────────────────────────────
function Signals({ a }: { a: EmailAnalytics }) {
  const t = a.month.total;
  const rows = [
    { icon: Trash2, label: "Disposable addresses", n: a.disposable_30d, color: "#f97316", hint: "throwaway inboxes (mailinator, temp-mail…)" },
    { icon: ServerOff, label: "Dead domains (no MX)", n: a.no_mx_30d, color: "#ef4444", hint: "domains that can't receive mail" },
    { icon: AtSign, label: "Role-based", n: a.role_based_30d, color: "#8b5cf6", hint: "info@, support@, admin@…" },
    { icon: Radar, label: "Mailbox (SMTP) probed", n: a.smtp_probed_30d, color: "#0ea5e9", hint: "inbox existence checked directly" },
  ];
  return (
    <div className="ov-rise rounded-2xl border border-border/60 bg-card p-4 sm:p-5" style={{ animationDelay: "360ms" }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">List health <span className="font-normal text-muted-foreground">· 30d</span></p>
        <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"><Layers className="h-3 w-3" />{a.batch_share_30d}% via batch</span>
      </div>
      <div className="mt-3 space-y-3">
        {rows.map((r, i) => (
          <div key={r.label} title={r.hint}>
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-1.5"><r.icon className="h-3.5 w-3.5 shrink-0" style={{ color: r.color }} /><span className="truncate">{r.label}</span></span>
              <span className="shrink-0 tabular-nums text-muted-foreground"><span className="font-medium text-foreground">{r.n.toLocaleString()}</span> · {pct(r.n, t)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="ov-grow h-full rounded-full" style={{ width: `${pct(r.n, t)}%`, background: r.color, animationDelay: `${420 + i * 60}ms` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Ranked({ title, rows, mono, delay, empty }: { title: string; rows: { key: string; count: number }[]; mono?: boolean; delay: number; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="ov-rise rounded-2xl border border-border/60 bg-card p-4 sm:p-5" style={{ animationDelay: `${delay}ms` }}>
      <p className="text-sm font-semibold">{title} <span className="font-normal text-muted-foreground">· 30d</span></p>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="mt-3 space-y-1">
          {rows.slice(0, 8).map((r, i) => (
            <div key={r.key} className="relative flex items-center justify-between gap-2 overflow-hidden rounded-md px-2 py-1.5 text-xs">
              <div className="ov-grow absolute inset-y-0 left-0 rounded-md bg-foreground/[0.06]" style={{ width: `${(r.count / max) * 100}%`, animationDelay: `${delay + 60 + i * 40}ms` }} />
              <span className={`relative truncate ${mono ? "font-mono" : ""}`}>{r.key}</span>
              <span className="relative shrink-0 tabular-nums text-muted-foreground">{r.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TopUsers({ users, onOpenUser }: { users: EmailAnalytics["top_users"]; onOpenUser?: (email: string) => void }) {
  const max = Math.max(1, ...users.map((u) => u.total));
  return (
    <div className="ov-rise rounded-2xl border border-border/60 bg-card p-4 sm:p-5" style={{ animationDelay: "420ms" }}>
      <p className="text-sm font-semibold">Top users <span className="font-normal text-muted-foreground">· 30d</span></p>
      {users.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">Nobody has used the validator in this window.</p>
      ) : (
        <div className="mt-3 divide-y divide-border/50">
          {users.map((u, i) => {
            const bad = pct(u.invalid, u.total);
            const name = u.email || "API / anonymous";
            return (
              <div key={u.user_id || i} className="flex items-center gap-3 py-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold uppercase">{name.slice(0, 2)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    {u.email && onOpenUser ? (
                      <button className="truncate text-xs font-medium hover:underline" onClick={() => onOpenUser(u.email)}>{name}</button>
                    ) : <span className="truncate text-xs font-medium">{name}</span>}
                    <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(u.last_used)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="ov-grow h-full rounded-full bg-foreground/60" style={{ width: `${(u.total / max) * 100}%`, animationDelay: `${480 + i * 40}ms` }} />
                    </div>
                    <span className="w-14 shrink-0 text-right text-[11px] tabular-nums">{u.total.toLocaleString()}</span>
                    <span className={`w-16 shrink-0 text-right text-[10px] tabular-nums ${bad >= 50 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>{bad}% invalid</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function EmailValidatorDashboard({ a, onOpenUser }: { a: EmailAnalytics | null; onOpenUser?: (email: string) => void }) {
  const series = useMemo(() => (a ? halves(a.daily.map((d) => d.total)) : null), [a]);
  if (!a || !series) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[150px] animate-pulse rounded-2xl bg-muted/50" />)}
      </div>
    );
  }
  const m = a.month;
  const credits = m.total * CREDITS_PER_CHECK;
  return (
    <div className="@container space-y-4">
      <DashMotion />
      <div className="ov-rise flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><MailCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /> Email Validator</h2>
          <p className="text-sm text-muted-foreground">Who uses the verification API, and how healthy the lists they check are.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-border/60 px-2.5 py-1"><span className="font-medium tabular-nums text-foreground">{a.all_time.toLocaleString()}</span> checks all-time</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 @md:grid-cols-2 @3xl:grid-cols-3 @7xl:grid-cols-6">
        <KpiCard icon={MailCheck} label="Checks today" value={a.today.total} color="#10b981" delay={0}
          sub={<>{a.today.users} user{a.today.users === 1 ? "" : "s"} · {a.week.total.toLocaleString()} this week</>} />
        <KpiCard icon={CalendarDays} label="Checks" period="30d" value={m.total} color="#8b5cf6" delay={40}
          cur={series.cur} prev={series.prev} span={15} series={series.recent} sub={<>vs previous 15 days</>} />
        <KpiCard icon={Users} label="Active users" period="30d" value={m.users} color="#0ea5e9" delay={80}
          sub={<>{a.week.users} in the last 7 days</>} />
        <KpiCard icon={ShieldCheck} label="Deliverable" period="30d" value={pct(m.valid, m.total)} format={(n) => `${n}%`} color="#14b8a6" delay={120}
          sub={<>{m.valid.toLocaleString()} valid of {m.total.toLocaleString()}</>} />
        <KpiCard icon={Trash2} label="Disposable" period="30d" value={pct(a.disposable_30d, m.total)} format={(n) => `${n}%`} color="#f97316" delay={160}
          sub={<>{a.disposable_30d.toLocaleString()} throwaway addresses</>} />
        <KpiCard icon={Coins} label="Credits used" period="30d" value={Math.round(credits * 100)} format={(n) => (n / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })} color="#ec4899" delay={200}
          sub={<>≈ ${(credits / 100).toFixed(2)} at {CREDITS_PER_CHECK} cr/check</>} />
      </div>

      <div className="grid gap-4 @5xl:grid-cols-3">
        <div className="min-w-0 @5xl:col-span-2"><DailyChart daily={a.daily} /></div>
        <ResultMix m={m} />
      </div>

      <div className="grid gap-4 @3xl:grid-cols-2 @6xl:grid-cols-3">
        <TopUsers users={a.top_users} onOpenUser={onOpenUser} />
        <Signals a={a} />
        <div className="grid gap-4 @3xl:col-span-2 @3xl:grid-cols-2 @6xl:col-span-1 @6xl:grid-cols-1">
          <Ranked title="Top domains" rows={a.top_domains} mono delay={480} empty="No domains checked yet." />
          <Ranked title="Why addresses fail" rows={a.top_reasons} delay={540} empty="No failure reasons recorded." />
        </div>
      </div>
    </div>
  );
}
