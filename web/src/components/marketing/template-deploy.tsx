"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Rocket, Loader2, Check, ArrowRight, Star } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface EnvVarSchema { key: string; label?: string; type?: string; required?: boolean; default?: string; description?: string; }

// Auth-aware deploy box on a public template page. Logged-out visitors are sent
// to sign-up (with the template slug preserved); logged-in users deploy inline
// via the same API the dashboard uses, so deploy counts still increment.
export function TemplateDeploy({ slug, name, envVars }: { slug: string; name: string; envVars: EnvVarSchema[] }) {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState("");
  const [doneId, setDoneId] = useState<string | null>(null);
  const [starred, setStarred] = useState(false);

  useEffect(() => {
    setToken(localStorage.getItem("sm_token"));
    setReady(true);
  }, []);

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
    try {
      const res = await fetch(`${API}/api/v1/templates/${encodeURIComponent(slug)}/deploy`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, env_vars: values }),
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
    return <div className="h-11 rounded-xl border border-border/60 animate-pulse" />;
  }

  // Logged out — route to sign-up, preserving the template.
  if (!token) {
    return (
      <div className="space-y-2">
        <Link
          href={`/sign-up?template=${encodeURIComponent(slug)}`}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-foreground text-background text-sm font-semibold hover:opacity-85 transition-opacity"
        >
          <Rocket className="h-4 w-4" /> Deploy Now
        </Link>
        <p className="text-center text-[11px] text-muted-foreground">Free to start — sign up in seconds.</p>
      </div>
    );
  }

  if (doneId) {
    return (
      <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
        <p className="flex items-center gap-2 font-medium text-emerald-600 dark:text-emerald-400">
          <Check className="h-4 w-4" /> Deploying {name}
        </p>
        <Link href="/overview" className="mt-3 flex items-center gap-1 text-xs font-medium text-foreground hover:underline">
          Go to dashboard <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    );
  }

  // Logged in — inline deploy.
  return (
    <div className="space-y-3">
      {userVars.length > 0 && (
        <div className="space-y-2">
          {userVars.map((v) => (
            <div key={v.key}>
              <label className="text-[11px] font-medium text-muted-foreground">
                {v.label || v.key}{v.required && <span className="text-red-500"> *</span>}
              </label>
              <input
                type={v.type === "secret" ? "password" : "text"}
                value={values[v.key] ?? v.default ?? ""}
                onChange={(e) => setValues((p) => ({ ...p, [v.key]: e.target.value }))}
                placeholder={v.description || v.key}
                className="mt-1 w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-foreground/30"
              />
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
      <button
        onClick={deploy}
        disabled={deploying}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-foreground text-background text-sm font-semibold hover:opacity-85 transition-opacity disabled:opacity-60"
      >
        {deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
        Deploy Now
      </button>
      <button
        onClick={toggleStar}
        className={`flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border text-xs font-medium transition-colors ${
          starred ? "border-amber-500/40 text-amber-500" : "border-border text-muted-foreground hover:text-foreground"
        }`}
      >
        <Star className={`h-3.5 w-3.5 ${starred ? "fill-amber-500" : ""}`} /> {starred ? "Starred" : "Star this template"}
      </button>
    </div>
  );
}
