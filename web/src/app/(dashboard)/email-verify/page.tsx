"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2, MailCheck, Search, ListChecks, Upload, Download, Copy, Check, X, ShieldCheck, Coins, Wand2,
  CircleCheck, CircleX, CircleAlert, CircleHelp, Code2, CalendarDays,
} from "lucide-react";
import { DashMotion, KpiCard } from "@/components/admin/dash-kit";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface Result {
  email: string; normalized: string; domain: string;
  score: "valid" | "risky" | "invalid" | "unknown"; reason: string;
  syntax_valid: boolean; has_mx: boolean; disposable: boolean;
  role_based: boolean; free_provider: boolean; suggestion?: string;
  mailbox_checked?: boolean; catch_all?: boolean;
}
interface Usage {
  usage: { month: { total: number; valid: number; risky: number; invalid: number; unknown: number }; today: number; all_time: number; daily: { day: string; total: number }[] };
  cost_per_check: number; batch_max: number;
}

const headers = () => ({ Authorization: `Bearer ${localStorage.getItem("sm_token")}`, "Content-Type": "application/json" });

const SCORE: Record<Result["score"], { label: string; tone: string; icon: typeof CircleCheck; color: string }> = {
  valid: { label: "Valid", tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30", icon: CircleCheck, color: "#10b981" },
  risky: { label: "Risky", tone: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30", icon: CircleAlert, color: "#f59e0b" },
  invalid: { label: "Invalid", tone: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30", icon: CircleX, color: "#ef4444" },
  unknown: { label: "Unknown", tone: "bg-muted text-muted-foreground border-border/60", icon: CircleHelp, color: "#a1a1aa" },
};
const REASON: Record<string, string> = {
  ok: "Domain accepts mail (mailbox not checked)", mailbox_exists: "Mailbox exists",
  mailbox_not_found: "Mailbox does not exist", catch_all: "Catch-all domain: accepts any address",
  smtp_inconclusive: "Mail server didn't give a clear answer", disposable: "Disposable / throwaway address",
  role_account: "Role or shared inbox (info@, support@…)", no_mail_server: "Domain can't receive mail",
  invalid_syntax: "Not a valid email format",
};
const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const parseEmails = (text: string) => [...new Set((text.match(EMAIL_RE) ?? []).map((e) => e.trim().toLowerCase()))];

function CopyBtn({ text, label, small }: { text: string; label: string; small?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); })}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-border/60 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${small ? "h-7 px-2 text-[11px]" : "h-8 px-2.5 text-xs"}`}>
      {done ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}{label}
    </button>
  );
}

function Checklist({ r }: { r: Result }) {
  const items: [string, boolean | undefined, boolean][] = [
    // [label, value, value-is-good]
    ["Valid format", r.syntax_valid, true],
    ["Domain receives mail (MX)", r.has_mx, true],
    ["Not disposable", !r.disposable, true],
    ["Not a role inbox", !r.role_based, true],
    ["Mailbox confirmed", r.mailbox_checked ? r.reason === "mailbox_exists" : undefined, true],
  ];
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {items.map(([label, v]) => (
        <div key={label} className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs">
          {v === undefined ? <CircleHelp className="h-3.5 w-3.5 text-muted-foreground" /> : v ? <CircleCheck className="h-3.5 w-3.5 text-emerald-500" /> : <CircleX className="h-3.5 w-3.5 text-red-500" />}
          <span className={v === undefined ? "text-muted-foreground" : ""}>{label}{v === undefined ? " (not checked)" : ""}</span>
        </div>
      ))}
      {r.free_provider && <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground"><CircleHelp className="h-3.5 w-3.5" /> Free provider (Gmail, Yahoo…)</div>}
      {r.catch_all && <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground"><CircleAlert className="h-3.5 w-3.5 text-amber-500" /> Catch-all domain</div>}
    </div>
  );
}

function SingleResult({ r, onFix }: { r: Result; onFix: (email: string) => void }) {
  const s = SCORE[r.score] ?? SCORE.unknown;
  const fixed = r.suggestion ? `${r.email.split("@")[0]}@${r.suggestion}` : "";
  return (
    <div className="ov-rise mt-4 rounded-xl border border-border/60 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <s.icon className="h-8 w-8" style={{ color: s.color }} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm">{r.email}</p>
          <p className="text-xs text-muted-foreground">{REASON[r.reason] || r.reason}</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${s.tone}`}>{s.label}</span>
      </div>
      {fixed && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs">
          <Wand2 className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
          Did you mean <span className="font-mono font-medium">{fixed}</span>?
          <button onClick={() => onFix(fixed)} className="ml-auto font-medium text-sky-700 hover:underline dark:text-sky-400">Check that instead</button>
        </div>
      )}
      <div className="mt-3"><Checklist r={r} /></div>
    </div>
  );
}

function toCSV(rows: Result[]) {
  const cols: (keyof Result)[] = ["email", "score", "reason", "suggestion", "domain", "has_mx", "disposable", "role_based", "free_provider", "mailbox_checked", "catch_all"];
  const esc = (v: unknown) => { const s = v === undefined || v === null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export default function EmailVerifyPage() {
  const [tab, setTab] = useState<"single" | "bulk">("single");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [credits, setCredits] = useState<{ available: number; unlimited: boolean } | null>(null);
  const [err, setErr] = useState("");

  const [single, setSingle] = useState("");
  const [singleRes, setSingleRes] = useState<Result | null>(null);
  const [singleBusy, setSingleBusy] = useState(false);

  const [list, setList] = useState("");
  const [listRes, setListRes] = useState<Result[] | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | Result["score"]>("all");
  const [q, setQ] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const loadMeta = useCallback(async () => {
    try {
      const [u, c] = await Promise.all([
        fetch(`${API}/api/v1/email/verify/usage`, { headers: headers() }),
        fetch(`${API}/api/v1/ai/credits`, { headers: headers() }),
      ]);
      if (u.ok) setUsage(await u.json());
      if (c.ok) { const d = await c.json(); setCredits({ available: d.status?.available ?? 0, unlimited: !!d.unlimited }); }
    } catch { /* non-critical */ }
  }, []);
  useEffect(() => { const t = setTimeout(loadMeta, 0); return () => clearTimeout(t); }, [loadMeta]);

  const cost = usage?.cost_per_check ?? 0.05;
  const batchMax = usage?.batch_max ?? 100;
  const emails = useMemo(() => parseEmails(list), [list]);

  const verifyOne = async (addr?: string) => {
    const email = (addr ?? single).trim();
    if (!email) return;
    if (addr) setSingle(addr);
    setSingleBusy(true); setErr(""); setSingleRes(null);
    try {
      const res = await fetch(`${API}/api/v1/email/verify`, { method: "POST", headers: headers(), body: JSON.stringify({ email }) });
      const d = await res.json();
      if (res.ok) setSingleRes(d); else setErr(d.error || "Verification failed");
    } catch { setErr("Network error"); }
    setSingleBusy(false); loadMeta();
  };

  const verifyList = async () => {
    if (emails.length === 0) return;
    if (emails.length > batchMax) { setErr(`Up to ${batchMax} addresses per run (you have ${emails.length}).`); return; }
    setListBusy(true); setErr(""); setListRes(null); setFilter("all");
    try {
      const res = await fetch(`${API}/api/v1/email/verify/batch`, { method: "POST", headers: headers(), body: JSON.stringify({ emails }) });
      const d = await res.json();
      if (res.ok) setListRes(d.results || []); else setErr(d.error || "Batch verification failed");
    } catch { setErr("Network error"); }
    setListBusy(false); loadMeta();
  };

  const onFile = async (f?: File) => {
    if (!f) return;
    const text = await f.text();
    const found = parseEmails(text);
    setList(found.join("\n"));
    setErr(found.length ? "" : "No email addresses found in that file.");
  };

  const counts = useMemo(() => {
    const c = { valid: 0, risky: 0, invalid: 0, unknown: 0 };
    listRes?.forEach((r) => { c[r.score] = (c[r.score] ?? 0) + 1; });
    return c;
  }, [listRes]);
  const shownRes = (listRes ?? []).filter((r) => (filter === "all" || r.score === filter) && (!q || r.email.includes(q.toLowerCase())));
  const download = () => {
    const blob = new Blob([toCSV(shownRes)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `email-verification-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(a.href);
  };

  const m = usage?.usage.month;
  const deliverable = m && m.total ? Math.round((m.valid / m.total) * 100) : 0;
  const insufficient = !!credits && !credits.unlimited && credits.available < emails.length * cost;

  return (
    <div className="@container animate-fade-in-up space-y-5">
      <DashMotion />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Network</p>
          <h1 className="mt-1 flex items-center gap-2 text-[22px] font-bold tracking-[-0.02em] sm:text-[26px]"><MailCheck className="h-6 w-6" /> Email Verify</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Catch typos, dead domains, throwaway and role addresses before you send, one at a time or a whole list.</p>
        </div>
        <Link href="/billing" className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-2 text-xs hover:border-foreground/20">
          <Coins className="h-4 w-4 text-amber-500" />
          <span><span className="font-semibold tabular-nums">{credits ? (credits.unlimited ? "Unlimited" : credits.available.toLocaleString(undefined, { maximumFractionDigits: 2 })) : "…"}</span> credits</span>
          <span className="text-muted-foreground">· {cost} per check</span>
        </Link>
      </div>

      {usage && usage.usage.all_time > 0 && (
        <div className="grid grid-cols-1 gap-3 @md:grid-cols-2 @4xl:grid-cols-4">
          <KpiCard icon={CalendarDays} label="Checks" period="30d" value={m?.total ?? 0} color="#8b5cf6" delay={0}
            series={usage.usage.daily.map((d) => d.total)} sub={<>{usage.usage.today} today</>} />
          <KpiCard icon={ShieldCheck} label="Deliverable" period="30d" value={deliverable} format={(n) => `${n}%`} color="#10b981" delay={40}
            sub={<>{m?.valid ?? 0} valid of {m?.total ?? 0}</>} />
          <KpiCard icon={CircleX} label="Caught" period="30d" value={(m?.invalid ?? 0) + (m?.risky ?? 0)} color="#ef4444" delay={80}
            sub={<>{m?.invalid ?? 0} invalid · {m?.risky ?? 0} risky</>} />
          <KpiCard icon={Coins} label="Credits used" period="30d" value={Math.round((m?.total ?? 0) * cost * 100)} format={(n) => (n / 100).toLocaleString()} color="#f59e0b" delay={120}
            sub={<>{usage.usage.all_time.toLocaleString()} checks all-time</>} />
        </div>
      )}

      <div className="ov-rise overflow-hidden rounded-2xl border border-border/60 bg-card" style={{ animationDelay: "150ms" }}>
        <div className="flex border-b border-border/60 px-2">
          {([["single", "Single address", Search], ["bulk", "Bulk list", ListChecks]] as const).map(([k, l, I]) => (
            <button key={k} onClick={() => { setTab(k); setErr(""); }}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-medium transition-colors ${tab === k ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              <I className="h-4 w-4" />{l}
            </button>
          ))}
        </div>

        <div className="p-4 sm:p-5">
          {err && <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2.5 text-sm text-red-600 dark:text-red-400"><X className="mt-0.5 h-4 w-4 shrink-0" />{err}</div>}

          {tab === "single" ? (
            <>
              <form onSubmit={(e) => { e.preventDefault(); verifyOne(); }} className="flex flex-col gap-2 sm:flex-row">
                <input value={single} onChange={(e) => setSingle(e.target.value)} placeholder="name@example.com" type="email" autoFocus
                  className="h-11 min-w-0 flex-1 rounded-xl border border-input bg-background px-4 font-mono text-sm outline-none focus:border-foreground/30 focus:ring-4 focus:ring-emerald-500/10" />
                <button type="submit" disabled={singleBusy || !single.trim()}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-foreground px-5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-40">
                  {singleBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Verify
                </button>
              </form>
              {singleRes && <SingleResult r={singleRes} onFix={(e) => verifyOne(e)} />}
            </>
          ) : (
            <>
              <textarea value={list} onChange={(e) => setList(e.target.value)} rows={7} spellCheck={false}
                placeholder={"Paste emails, one per line or separated by commas/spaces\nalice@company.com\nbob@gmial.com\ninfo@stripe.com"}
                className="w-full resize-y rounded-xl border border-input bg-background p-3 font-mono text-sm outline-none focus:border-foreground/30 focus:ring-4 focus:ring-emerald-500/10" />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-xs font-medium hover:bg-accent"><Upload className="h-3.5 w-3.5" /> Upload CSV / TXT</button>
                <span className={`text-xs ${emails.length > batchMax ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                  <span className="font-medium tabular-nums text-foreground">{emails.length}</span> unique address{emails.length === 1 ? "" : "es"} · max {batchMax}
                  {emails.length > 0 && <> · costs <span className="tabular-nums">{(emails.length * cost).toFixed(2)}</span> credits</>}
                </span>
                <button onClick={verifyList} disabled={listBusy || emails.length === 0 || emails.length > batchMax || insufficient}
                  className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 disabled:opacity-40">
                  {listBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />} Verify list
                </button>
              </div>
              {insufficient && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Not enough credits for this list. <Link href="/billing" className="font-medium underline">Top up</Link></p>}

              {listRes && (
                <div className="ov-rise mt-5">
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                    {(["valid", "risky", "invalid", "unknown"] as const).map((k) => counts[k] > 0 && (
                      <div key={k} className="ov-grow h-full" style={{ width: `${(counts[k] / listRes.length) * 100}%`, background: SCORE[k].color }} />
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <button onClick={() => setFilter("all")} className={`h-7 rounded-full border px-3 text-xs ${filter === "all" ? "border-primary bg-primary text-primary-foreground" : "border-border/60 text-muted-foreground"}`}>All {listRes.length}</button>
                    {(["valid", "risky", "invalid", "unknown"] as const).map((k) => (
                      <button key={k} onClick={() => setFilter(k)}
                        className={`flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs ${filter === k ? "border-primary bg-primary text-primary-foreground" : "border-border/60 text-muted-foreground"}`}>
                        <span className="h-2 w-2 rounded-full" style={{ background: SCORE[k].color }} />{SCORE[k].label} {counts[k]}
                      </button>
                    ))}
                    <div className="relative ml-auto w-full sm:w-48">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="h-8 w-full rounded-lg border border-input bg-background pl-8 pr-2 text-xs outline-none" />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={download} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/60 px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"><Download className="h-3.5 w-3.5" /> Export CSV</button>
                    <CopyBtn text={listRes.filter((r) => r.score === "valid").map((r) => r.email).join("\n")} label={`Copy ${counts.valid} valid`} />
                  </div>
                  <div className="mt-3 divide-y divide-border/50 rounded-xl border border-border/60">
                    {shownRes.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No results match.</p> : shownRes.map((r) => {
                      const s = SCORE[r.score] ?? SCORE.unknown;
                      return (
                        <div key={r.email} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                          <s.icon className="h-4 w-4 shrink-0" style={{ color: s.color }} />
                          <span className="min-w-0 flex-1 truncate font-mono text-xs">{r.email}</span>
                          <span className="hidden text-[11px] text-muted-foreground md:inline">{REASON[r.reason] || r.reason}</span>
                          {r.suggestion && <span className="text-[11px] text-sky-700 dark:text-sky-400">→ {r.email.split("@")[0]}@{r.suggestion}</span>}
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${s.tone}`}>{s.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="ov-rise rounded-2xl border border-border/60 bg-card p-4 sm:p-5" style={{ animationDelay: "220ms" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold"><Code2 className="h-4 w-4 text-muted-foreground" /> Use it from your code</p>
          <Link href="/api-keys" className="text-xs font-medium hover:underline">Get an API key →</Link>
        </div>
        <div className="relative mt-3">
          <pre className="overflow-x-auto rounded-xl bg-[#0d1117] p-4 font-mono text-[12px] leading-relaxed text-[#e6edf3]">{`curl -X POST ${API}/api/v1/email/verify \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"email": "alice@company.com"}'`}</pre>
          <div className="absolute right-2 top-2"><CopyBtn small label="Copy" text={`curl -X POST ${API}/api/v1/email/verify -H "X-API-Key: YOUR_API_KEY" -H "Content-Type: application/json" -d '{"email": "alice@company.com"}'`} /></div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Batch: <span className="font-mono">POST /api/v1/email/verify/batch</span> with <span className="font-mono">{`{"emails": [...]}`}</span> (up to {batchMax}). Also in the JS SDK as <span className="font-mono">client.email.verify()</span> / <span className="font-mono">verifyBatch()</span>. Catch-all domains and greylisting return <span className="font-mono">unknown</span>.</p>
      </div>
    </div>
  );
}
