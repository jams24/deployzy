"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldAlert, Loader2, Check } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

const CATEGORIES = [
  { v: "phishing", l: "Phishing / fraud" },
  { v: "malware", l: "Malware / C2" },
  { v: "spam", l: "Spam" },
  { v: "illegal", l: "Illegal content" },
  { v: "other", l: "Other" },
];

export default function ReportAbusePage() {
  const [targetUrl, setTargetUrl] = useState("");
  const [category, setCategory] = useState("phishing");
  const [details, setDetails] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!targetUrl.trim()) { setError("Please enter the URL you're reporting."); return; }
    setBusy(true); setError("");
    try {
      const res = await fetch(`${API}/api/v1/abuse-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_url: targetUrl, category, details, reporter_email: email }),
      });
      if (res.ok) setDone(true);
      else { const d = await res.json().catch(() => ({})); setError(d.error || "Could not submit — please try again."); }
    } catch { setError("Could not submit — please try again."); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-xl px-5 sm:px-6 py-16 sm:py-24">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-500/10 text-red-500">
          <ShieldAlert className="h-5 w-5" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Report abuse</h1>
      </div>
      <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
        Found phishing, malware, spam, or illegal content on a <span className="font-mono">deployzy.com</span> address?
        Report it here and we&apos;ll investigate and take action fast. See our{" "}
        <Link href="/acceptable-use" className="text-emerald-600 dark:text-emerald-400 underline underline-offset-2">Acceptable Use Policy</Link>.
      </p>

      {done ? (
        <div className="mt-8 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-5 text-sm">
          <p className="flex items-center gap-2 font-medium text-emerald-600 dark:text-emerald-400">
            <Check className="h-4 w-4" /> Report received
          </p>
          <p className="mt-2 text-muted-foreground">Thank you. Our team has been notified and will review it shortly.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-8 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Reported URL <span className="text-red-500">*</span></label>
            <input
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://something.deployzy.com/…"
              className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm font-mono outline-none focus:border-foreground/30"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm"
            >
              {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">What&apos;s happening?</label>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={4}
              placeholder="Describe what you saw…"
              className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30 resize-none"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Your email (optional)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="so we can follow up"
              className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-foreground/30"
            />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-foreground text-background text-sm font-semibold hover:opacity-85 transition-opacity disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />} Submit report
          </button>
          <p className="text-center text-[11px] text-muted-foreground">
            Or email <a href="mailto:abuse@deployzy.com" className="underline">abuse@deployzy.com</a>
          </p>
        </form>
      )}
    </div>
  );
}
