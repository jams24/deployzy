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
    <div className="mx-auto max-w-xl px-5 py-14 sm:px-6 sm:py-20">
      <p className="eyebrow rise flex items-center gap-1.5"><ShieldAlert className="h-3.5 w-3.5 text-red-500" />Trust &amp; safety</p>
      <h1 className="rise mt-4 text-[clamp(2.2rem,5.4vw,3.2rem)] font-semibold leading-[1.02] tracking-[-0.045em]" style={{ animationDelay: "0.06s" }}>
        Report <span className="accent-serif">abuse</span>
      </h1>
      <p className="rise mt-5 text-[15.5px] leading-relaxed text-muted-foreground" style={{ animationDelay: "0.12s" }}>
        Found phishing, malware, spam or illegal content on a <span className="font-mono text-foreground">deployzy.app</span> or <span className="font-mono text-foreground">deployzy.com</span> address?
        Report it here and we&apos;ll investigate and take action fast. See our{" "}
        <Link href="/acceptable-use" className="text-[var(--dz-green-strong)] underline underline-offset-2 dark:text-brand">Acceptable Use Policy</Link>.
      </p>

      {done ? (
        <div className="mt-8 rounded-[20px] border border-brand/30 bg-brand/10 p-5 text-[14.5px]">
          <p className="flex items-center gap-2 font-medium text-[var(--dz-green-strong)] dark:text-brand">
            <Check className="h-4 w-4" /> Report received
          </p>
          <p className="mt-2 text-muted-foreground">Thank you. Our team has been notified and will review it shortly.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="surface rise mt-8 space-y-4 rounded-[24px] p-5 sm:p-6" style={{ animationDelay: "0.18s" }}>
          <div>
            <label className="text-[13px] font-medium text-muted-foreground">Reported URL <span className="text-red-500">*</span></label>
            <input
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://something.deployzy.app/…"
              className="mt-1.5 font-mono h-11 w-full rounded-xl border border-[var(--dz-hairline)] bg-background/70 px-3.5 text-[14.5px] outline-none transition-colors focus:border-foreground/25 dark:bg-white/[0.03]"
            />
          </div>
          <div>
            <label className="text-[13px] font-medium text-muted-foreground">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-[var(--dz-hairline)] bg-background/70 px-3.5 text-[14.5px] outline-none transition-colors focus:border-foreground/25 dark:bg-white/[0.03]"
            >
              {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[13px] font-medium text-muted-foreground">What&apos;s happening?</label>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={4}
              placeholder="Describe what you saw…"
              className="mt-1.5 w-full resize-none rounded-xl border border-[var(--dz-hairline)] bg-background/70 px-3.5 py-2.5 text-[14.5px] outline-none transition-colors focus:border-foreground/25 dark:bg-white/[0.03]"
            />
          </div>
          <div>
            <label className="text-[13px] font-medium text-muted-foreground">Your email (optional)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="so we can follow up"
              className="mt-1.5 h-11 w-full rounded-xl border border-[var(--dz-hairline)] bg-background/70 px-3.5 text-[14.5px] outline-none transition-colors focus:border-foreground/25 dark:bg-white/[0.03]"
            />
          </div>
          {error && <p className="text-[13px] text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="pill pill-ink w-full disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />} Submit report
          </button>
          <p className="text-center text-[12.5px] text-muted-foreground">
            Or email <a href="mailto:abuse@deployzy.com" className="underline">abuse@deployzy.com</a>
          </p>
        </form>
      )}
    </div>
  );
}
