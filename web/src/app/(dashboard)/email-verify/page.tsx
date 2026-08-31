"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, MailCheck, Search, ListChecks } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface Result {
  email: string; normalized: string; domain: string;
  score: "valid" | "risky" | "invalid" | "unknown"; reason: string;
  syntax_valid: boolean; has_mx: boolean; disposable: boolean;
  role_based: boolean; free_provider: boolean; suggestion?: string;
  mailbox_checked?: boolean; catch_all?: boolean;
}

const headers = () => {
  const token = typeof window !== "undefined" ? localStorage.getItem("sm_token") : "";
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
};

const scoreStyle: Record<string, string> = {
  valid: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  risky: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  invalid: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",
  unknown: "bg-muted text-muted-foreground border-border/60",
};
const reasonLabel: Record<string, string> = {
  ok: "Domain looks OK (mailbox not checked)", mailbox_exists: "Mailbox exists ✓",
  mailbox_not_found: "Mailbox does not exist", catch_all: "Catch-all domain (accepts anything)",
  smtp_inconclusive: "Mail server didn't give a clear answer", disposable: "Disposable address",
  role_account: "Role / shared inbox", no_mail_server: "Domain can't receive mail",
  invalid_syntax: "Invalid format",
};

function Flag({ on, label }: { on: boolean; label: string }) {
  if (!on) return null;
  return <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground">{label}</span>;
}

function ResultRow({ r }: { r: Result }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/40 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{r.email}</span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${scoreStyle[r.score] || ""}`}>{r.score}</span>
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {reasonLabel[r.reason] || r.reason}
          {r.suggestion && <> · did you mean <span className="text-foreground font-medium">{r.email.split("@")[0]}@{r.suggestion}</span>?</>}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          <Flag on={r.mailbox_checked === true} label="mailbox checked" />
          <Flag on={r.catch_all === true} label="catch-all" />
          <Flag on={r.has_mx} label="MX ok" />
          <Flag on={r.disposable} label="disposable" />
          <Flag on={r.role_based} label="role" />
          <Flag on={r.free_provider} label="free provider" />
        </div>
      </div>
    </div>
  );
}

export default function EmailVerifyPage() {
  const [single, setSingle] = useState("");
  const [singleRes, setSingleRes] = useState<Result | null>(null);
  const [singleBusy, setSingleBusy] = useState(false);

  const [list, setList] = useState("");
  const [listRes, setListRes] = useState<Result[] | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const [err, setErr] = useState("");

  const verifyOne = async () => {
    if (!single.trim()) return;
    setSingleBusy(true); setErr(""); setSingleRes(null);
    try {
      const res = await fetch(`${API}/api/v1/email/verify`, { method: "POST", headers: headers(), body: JSON.stringify({ email: single.trim() }) });
      const d = await res.json();
      if (res.ok) setSingleRes(d); else setErr(d.error || "Verification failed");
    } catch { setErr("Network error"); }
    setSingleBusy(false);
  };

  const verifyList = async () => {
    const emails = list.split(/[\s,;]+/).map(e => e.trim()).filter(Boolean);
    if (emails.length === 0) return;
    if (emails.length > 100) { setErr("Max 100 emails per batch"); return; }
    setListBusy(true); setErr(""); setListRes(null);
    try {
      const res = await fetch(`${API}/api/v1/email/verify/batch`, { method: "POST", headers: headers(), body: JSON.stringify({ emails }) });
      const d = await res.json();
      if (res.ok) setListRes(d.results || []); else setErr(d.error || "Batch verification failed");
    } catch { setErr("Network error"); }
    setListBusy(false);
  };

  const summary = listRes ? {
    valid: listRes.filter(r => r.score === "valid").length,
    risky: listRes.filter(r => r.score === "risky").length,
    invalid: listRes.filter(r => r.score === "invalid").length,
    unknown: listRes.filter(r => r.score === "unknown").length,
  } : null;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="animate-fade-in-up">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Network</p>
        <h1 className="mt-1 flex items-center gap-2 text-[22px] sm:text-[26px] font-bold tracking-[-0.02em]">
          <MailCheck className="h-6 w-6" /> Email Verify
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Check an address for syntax, mail-server (MX), disposable/role detection, and typo suggestions — before you send.
        </p>
      </div>

      {err && <div className="rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-red-600 dark:text-red-400">{err}</div>}

      {/* Single */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="text-sm font-semibold">Verify an address</div>
          <div className="flex gap-2">
            <input value={single} onChange={e => setSingle(e.target.value)}
              onKeyDown={e => e.key === "Enter" && verifyOne()}
              placeholder="name@example.com"
              className="flex-1 h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-foreground/30" />
            <Button onClick={verifyOne} disabled={singleBusy || !single.trim()} className="gap-1.5">
              {singleBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Verify
            </Button>
          </div>
          {singleRes && <div className="pt-1"><ResultRow r={singleRes} /></div>}
        </CardContent>
      </Card>

      {/* Batch */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="text-sm font-semibold">Verify a list <span className="font-normal text-muted-foreground">(up to 100)</span></div>
          <textarea value={list} onChange={e => setList(e.target.value)}
            placeholder={"Paste emails — one per line, or comma/space separated\nalice@company.com\nbob@gmial.com\ninfo@stripe.com"}
            rows={6}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono outline-none focus:border-foreground/30 resize-y" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">{list.split(/[\s,;]+/).filter(Boolean).length} address(es)</span>
            <Button onClick={verifyList} disabled={listBusy} variant="outline" className="gap-1.5">
              {listBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />} Verify list
            </Button>
          </div>

          {summary && (
            <div className="grid grid-cols-4 gap-2 pt-1">
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2 text-center">
                <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{summary.valid}</div>
                <div className="text-[10px] text-muted-foreground">valid</div>
              </div>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-center">
                <div className="text-lg font-bold text-amber-600 dark:text-amber-400">{summary.risky}</div>
                <div className="text-[10px] text-muted-foreground">risky</div>
              </div>
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-center">
                <div className="text-lg font-bold text-red-600 dark:text-red-400">{summary.invalid}</div>
                <div className="text-[10px] text-muted-foreground">invalid</div>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/40 p-2 text-center">
                <div className="text-lg font-bold text-muted-foreground">{summary.unknown}</div>
                <div className="text-[10px] text-muted-foreground">unknown</div>
              </div>
            </div>
          )}
          {listRes && listRes.length > 0 && (
            <div className="pt-1">{listRes.map((r, i) => <ResultRow key={i} r={r} />)}</div>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground">
        Runs syntax, DNS/MX, disposable, role, typo — and (when enabled) a live SMTP mailbox check that confirms the
        exact address exists. Catch-all domains and greylisting return &quot;unknown&quot;. Also via API:
        <code className="font-mono">POST /api/v1/email/verify</code>.
      </p>
    </div>
  );
}
