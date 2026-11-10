"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Rocket, Loader2, Check, ArrowRight, Star, Lock, Zap } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface EnvVarSchema { key: string; label?: string; type?: string; required?: boolean; default?: string; description?: string; }

const PLAN_RANK: Record<string, number> = { hobby: 1, pro: 2, team: 3, enterprise: 3 };
const rankOf = (p?: string) => PLAN_RANK[(p || "").toLowerCase()] ?? 0;
const planLabel = (p: string) => (p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "");

// Auth-aware deploy box on a public template page. Logged-out visitors are sent
// to sign-up (with the template slug preserved); logged-in users deploy inline
// via the same API the dashboard uses, so deploy counts still increment.
export function TemplateDeploy({ slug, name, envVars, requiredPlan = "" }: { slug: string; name: string; envVars: EnvVarSchema[]; requiredPlan?: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState("");
  const [doneId, setDoneId] = useState<string | null>(null);
  const [starred, setStarred] = useState(false);
  const [userPlan, setUserPlan] = useState("");

  useEffect(() => {
    const t = localStorage.getItem("sm_token");
    setToken(t);
    setReady(true);
    if (t) {
      fetch(`${API}/api/v1/users/me`, { headers: { Authorization: `Bearer ${t}` } })
        .then((r) => (r.ok ? r.json() : null))
        .then((u) => { if (u?.plan) setUserPlan(u.plan); })
        .catch(() => {});
    }
  }, []);

  const reqRank = rankOf(requiredPlan);
  const gated = reqRank > 0 && rankOf(userPlan) < reqRank; // logged-in user below the required plan
  const needLabel = planLabel(requiredPlan || "Pro");

  // Small "requires plan" badge shown above the deploy box.
  const planBadge = reqRank > 0 ? (
    <div className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[12.5px] font-medium text-amber-600 dark:text-amber-400 w-fit">
      <Lock className="h-3 w-3" /> Requires {needLabel} plan
    </div>
  ) : null;

  const userVars = envVars.filter((e) => e.type !== "auto");

  async function deploy() {
    // Guard required vars.
    for (const v of userVars) {
      if (v.required && !(values[v.key] || v.default)) {
        setError(`${v.label || v.key} is required`);
        return;
      }
    }
    setDeploying(true);
    setError("");
    // Send each field's effective value — the typed value OR its default. Without
    // this, a required field left at its shown default was omitted and the backend
    // rejected it as a "missing required env var".
    const payload: Record<string, string> = {};
    for (const v of userVars) {
      const val = values[v.key] ?? v.default ?? "";
      if (val !== "") payload[v.key] = val;
    }
    try {
      const res = await fetch(`${API}/api/v1/templates/${encodeURIComponent(slug)}/deploy`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, env_vars: payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Deploy failed");
        return;
      }
      setDoneId(data.project?.id || "ok");
    } catch {
      setError("Deploy failed — please try again.");
    } finally {
      setDeploying(false);
    }
  }

  async function toggleStar() {
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/v1/templates/${encodeURIComponent(slug)}/star`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setStarred((await res.json()).starred);
    } catch {}
  }

  if (!ready) {
    return <div className="h-12 animate-pulse rounded-full bg-foreground/[0.06]" />;
  }

  // Logged out — route to sign-up, preserving the template.
  if (!token) {
    return (
      <div className="space-y-2">
        {planBadge}
        <Link
          href={`/sign-up?template=${encodeURIComponent(slug)}`}
          className="pill pill-launch w-full"
        >
          <Rocket className="h-4 w-4" /> Deploy now
        </Link>
        <p className="text-center text-[12.5px] text-muted-foreground">
          {reqRank > 0 ? `Sign up — ${needLabel} plan required to deploy this one.` : "Free to start — sign up in seconds."}
        </p>
      </div>
    );
  }

  if (doneId) {
    return (
      <div className="rounded-2xl border border-brand/30 bg-brand/10 p-4 text-[14px]">
        <p className="flex items-center gap-2 font-medium text-[var(--dz-green-strong)] dark:text-brand">
          <Check className="h-4 w-4" /> Deploying {name}
        </p>
        <Link href={doneId && doneId !== "ok" ? `/projects/${doneId}` : "/overview"} className="mt-3 inline-flex items-center gap-1 text-[13.5px] font-medium text-foreground hover:underline">
          Watch it build <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    );
  }

  // Logged in but below the required plan — show an upgrade prompt instead.
  if (gated) {
    return (
      <div className="space-y-3">
        {planBadge}
        <div className="rounded-2xl border border-amber-500/25 bg-gradient-to-b from-amber-500/[0.07] to-transparent p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Zap className="h-4 w-4 text-amber-500" /> {needLabel} plan required
          </p>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
            This template needs the {needLabel} plan or higher. Upgrade and you can deploy it right away.
          </p>
          <Link
            href="/billing"
            className="pill pill-ink pill-sm mt-3 w-full"
          >
            <Zap className="h-4 w-4" /> Upgrade to {needLabel}
          </Link>
        </div>
        <button
          onClick={toggleStar}
          className={`flex h-10 w-full items-center justify-center gap-1.5 rounded-full border text-[13.5px] font-medium transition-colors ${
            starred ? "border-amber-500/40 text-amber-500" : "border-[var(--dz-hairline)] text-muted-foreground hover:border-foreground/20 hover:text-foreground"
          }`}
        >
          <Star className={`h-3.5 w-3.5 ${starred ? "fill-amber-500" : ""}`} /> {starred ? "Starred" : "Star this template"}
        </button>
      </div>
    );
  }

  // Logged in — inline deploy.
  return (
    <div className="space-y-3">
      {planBadge}
      {userVars.length > 0 && (
        <div className="space-y-2">
          {userVars.map((v) => (
            <div key={v.key}>
              <label className="text-[12.5px] font-medium text-muted-foreground">
                {v.label || v.key}{v.required && <span className="text-red-500"> *</span>}
              </label>
              <input
                type={v.type === "secret" ? "password" : "text"}
                value={values[v.key] ?? v.default ?? ""}
                onChange={(e) => setValues((p) => ({ ...p, [v.key]: e.target.value }))}
                placeholder={v.description || v.key}
                className="mt-1.5 h-10 w-full rounded-xl border border-[var(--dz-hairline)] bg-background/70 px-3.5 text-[14px] outline-none transition-colors focus:border-foreground/25 dark:bg-white/[0.03]"
              />
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-[13px] text-red-500">{error}</p>}
      <button
        onClick={deploy}
        disabled={deploying}
        className="pill pill-launch w-full disabled:opacity-60"
      >
        {deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
        Deploy now
      </button>
      <button
        onClick={toggleStar}
        className={`flex h-10 w-full items-center justify-center gap-1.5 rounded-full border text-[13.5px] font-medium transition-colors ${
          starred ? "border-amber-500/40 text-amber-500" : "border-[var(--dz-hairline)] text-muted-foreground hover:border-foreground/20 hover:text-foreground"
        }`}
      >
        <Star className={`h-3.5 w-3.5 ${starred ? "fill-amber-500" : ""}`} /> {starred ? "Starred" : "Star this template"}
      </button>
    </div>
  );
}
