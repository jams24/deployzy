"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Globe, Plus, Trash2, Check, X, Crown, Search, Copy, Loader2, Radio, Rocket, ArrowRight, Terminal } from "lucide-react";
import { DashMotion } from "@/components/admin/dash-kit";
import { timeAgo } from "@/components/admin/pager";

// ─────────────────────────────────────────────────────────────────────────────
// Subdomains — reserve exclusive names on the app domain for tunnels/apps.
// Shows what each name is used by right now (live tunnel / deployed app) so
// it's clear what's safe to release.
// ─────────────────────────────────────────────────────────────────────────────

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface Sub {
  id: string; subdomain: string; created_at: string;
  tunnel?: { url: string; local_addr: string; protocol: string };
  project?: { id: string; name: string; status: string };
}
interface Data { subdomains: Sub[]; count: number; limit: number; plan: string; domain: string; plan_limits: Record<string, number> }

const headers = () => ({ Authorization: `Bearer ${localStorage.getItem("sm_token")}`, "Content-Type": "application/json" });
const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, "");

function CopyIcon({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button title={label} aria-label={label}
      onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); })}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
      {done ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export default function SubdomainsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [newSub, setNewSub] = useState("");
  const [check, setCheck] = useState<{ available: boolean; reason: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [reserving, setReserving] = useState(false);
  const [releasing, setReleasing] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [view, setView] = useState<"all" | "used" | "idle">("all");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/subdomains`, { headers: headers() });
      if (res.ok) setData(await res.json());
    } catch { /* keep last data */ }
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    const poll = setInterval(load, 15000); // tunnel usage changes as CLIs connect
    return () => { clearTimeout(t); clearInterval(poll); };
  }, [load]);

  // Debounced availability check.
  useEffect(() => {
    const sub = clean(newSub);
    if (!sub) { const t = setTimeout(() => setCheck(null), 0); return () => clearTimeout(t); }
    const t = setTimeout(async () => {
      setChecking(true);
      try {
        const res = await fetch(`${API}/api/v1/subdomains/check?subdomain=${encodeURIComponent(sub)}`, { headers: headers() });
        if (res.ok) setCheck(await res.json());
      } catch { /* ignore */ }
      setChecking(false);
    }, 300);
    return () => clearTimeout(t);
  }, [newSub]);

  async function reserve(e?: React.FormEvent) {
    e?.preventDefault();
    const sub = clean(newSub);
    if (!sub) return;
    setReserving(true);
    try {
      const res = await fetch(`${API}/api/v1/subdomains`, { method: "POST", headers: headers(), body: JSON.stringify({ subdomain: sub }) });
      if (res.ok) { setNewSub(""); setCheck(null); await load(); }
      else { const err = await res.json().catch(() => ({})); setCheck({ available: false, reason: err.error || "Couldn't reserve it" }); }
    } catch { setCheck({ available: false, reason: "Network error" }); }
    setReserving(false);
  }

  async function release(s: Sub) {
    const inUse = s.tunnel ? "A tunnel is using it right now. " : s.project ? `The app "${s.project.name}" uses it. ` : "";
    if (!confirm(`Release ${s.subdomain}?\n\n${inUse}Once released, anyone can claim it.`)) return;
    setReleasing(s.subdomain);
    try { await fetch(`${API}/api/v1/subdomains`, { method: "DELETE", headers: headers(), body: JSON.stringify({ subdomain: s.subdomain }) }); await load(); } catch { /* ignore */ }
    setReleasing(null);
  }

  const domain = data?.domain || "deployzy.app";
  const unlimited = (data?.limit ?? 0) < 0;
  const atLimit = !!data && !unlimited && data.count >= data.limit;
  const pct = data && !unlimited && data.limit > 0 ? Math.min(100, (data.count / data.limit) * 100) : 0;
  const usedCount = data?.subdomains.filter((s) => s.tunnel || s.project).length ?? 0;
  const shown = useMemo(() => (data?.subdomains ?? []).filter((s) =>
    (!q || s.subdomain.includes(q.toLowerCase())) &&
    (view === "all" || (view === "used" ? !!(s.tunnel || s.project) : !(s.tunnel || s.project)))), [data, q, view]);
  const sub = clean(newSub);
  const canReserve = !!sub && !atLimit && !reserving && (check === null || check.available);
  const upgradeTiers = Object.entries(data?.plan_limits ?? {}).sort((a, b) => a[1] - b[1]);

  return (
    <div className="@container animate-fade-in-up space-y-5">
      <DashMotion />
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Network</p>
        <h1 className="mt-1 text-[22px] font-bold tracking-[-0.02em] sm:text-[26px]">Subdomains</h1>
        <p className="mt-1 text-sm text-muted-foreground">Reserve names on <span className="font-mono">{domain}</span> so they&apos;re yours every time you start a tunnel. Nobody else can use a reserved name.</p>
      </div>

      <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* Reserve */}
        <form onSubmit={reserve} className="ov-rise rounded-2xl border border-border/60 bg-card p-4 sm:p-5">
          <p className="text-sm font-semibold">Reserve a subdomain</p>
          <div className={`mt-3 flex items-center overflow-hidden rounded-xl border bg-background shadow-sm transition-all focus-within:ring-4 ${
            check && !check.available ? "border-red-500/50 focus-within:ring-red-500/10" : check?.available ? "border-emerald-500/50 focus-within:ring-emerald-500/10" : "border-input focus-within:border-foreground/30 focus-within:ring-emerald-500/10"}`}>
            <Globe className="ml-3.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="myapp" disabled={atLimit} aria-label="Subdomain"
              className="h-11 min-w-0 flex-1 bg-transparent px-2.5 font-mono text-sm outline-none placeholder:text-muted-foreground/50 disabled:opacity-50" />
            <span className="shrink-0 pr-3 font-mono text-sm text-muted-foreground">.{domain}</span>
          </div>
          <div className="mt-2 flex min-h-[20px] items-center justify-between gap-3">
            <p className="text-xs">
              {atLimit ? <span className="text-amber-700 dark:text-amber-400">You&apos;ve used all {data?.limit} reserved names on your plan.</span>
                : checking ? <span className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Checking…</span>
                : check?.available ? <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400"><Check className="h-3.5 w-3.5" /><span className="font-mono">{sub}.{domain}</span> is available</span>
                : check ? <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400"><X className="h-3.5 w-3.5" />{check.reason}</span>
                : <span className="text-muted-foreground">Lowercase letters, numbers and hyphens.</span>}
            </p>
            <button type="submit" disabled={!canReserve}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-3.5 text-sm font-medium text-background transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
              {reserving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Reserve
            </button>
          </div>
        </form>

        {/* Usage */}
        <div className="ov-rise rounded-2xl border border-border/60 bg-card p-4 sm:p-5" style={{ animationDelay: "60ms" }}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Usage</p>
            <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-medium capitalize">{data?.plan ?? "…"} plan</span>
          </div>
          <p className="mt-3 text-2xl font-semibold tabular-nums">
            {data?.count ?? "–"}<span className="text-base font-normal text-muted-foreground"> / {unlimited ? "∞" : data?.limit ?? "–"}</span>
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div className={`ov-grow h-full rounded-full ${atLimit ? "bg-red-500" : pct > 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${unlimited ? 4 : pct}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{usedCount} in use · {(data?.count ?? 0) - usedCount} idle</p>
          {(atLimit || data?.plan === "free") && upgradeTiers.length > 0 && (
            <div className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              <p className="mb-1 flex items-center gap-1 font-medium text-foreground"><Crown className="h-3 w-3 text-amber-500" /> More with a bigger plan</p>
              {upgradeTiers.map(([p, n]) => <span key={p} className="mr-3 capitalize">{p}: <span className="tabular-nums text-foreground">{n < 0 ? "∞" : n}</span></span>)}
              <Link href="/billing" className="mt-1 block font-medium text-foreground hover:underline">Upgrade →</Link>
            </div>
          )}
        </div>
      </div>

      {/* List */}
      <div className="ov-rise rounded-2xl border border-border/60 bg-card" style={{ animationDelay: "120ms" }}>
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-3 sm:px-4">
          <p className="mr-auto text-sm font-semibold">Your subdomains <span className="font-normal text-muted-foreground">({data?.count ?? 0})</span></p>
          <div className="flex rounded-lg border border-border/60 p-0.5">
            {([["all", "All"], ["used", "In use"], ["idle", "Idle"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setView(k)} className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${view === k ? "bg-accent text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
            ))}
          </div>
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="h-8 w-full rounded-lg border border-input bg-background pl-8 pr-2 text-xs outline-none focus:border-foreground/30" />
          </div>
        </div>

        {data === null ? (
          <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/50" />)}</div>
        ) : data.subdomains.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <Globe className="h-6 w-6 text-muted-foreground/50" />
            <p className="mt-2 text-sm font-medium">No reserved subdomains yet</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">Reserve one above, then start a tunnel on it with <span className="font-mono">deployzy http 3000 --subdomain myapp</span>.</p>
          </div>
        ) : shown.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">No subdomains match.</p>
        ) : (
          <div className="divide-y divide-border/50">
            {shown.map((s, i) => {
              const url = `https://${s.subdomain}.${domain}`;
              const cmd = `deployzy http 3000 --subdomain ${s.subdomain}`;
              return (
                <div key={s.id} className="ov-rise flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/30" style={{ animationDelay: `${140 + Math.min(i, 14) * 25}ms` }}>
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                    s.tunnel ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : s.project ? "border-orange-500/20 bg-orange-500/10 text-orange-600 dark:text-orange-400" : "border-border/60 bg-muted/40 text-muted-foreground"}`}>
                    {s.tunnel ? <Radio className="h-4 w-4" /> : s.project ? <Rocket className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm font-medium">{s.subdomain}<span className="text-muted-foreground">.{domain}</span></p>
                    <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                      {s.tunnel ? (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live tunnel <span className="font-mono text-muted-foreground">{s.tunnel.local_addr}</span><ArrowRight className="h-2.5 w-2.5" />
                        </span>
                      ) : null}
                      {s.project ? <Link href={`/projects/${s.project.id}`} className="hover:underline">App: <span className="text-foreground">{s.project.name}</span> · {s.project.status}</Link> : null}
                      {!s.tunnel && !s.project ? <span>Idle</span> : null}
                      <span>· reserved {timeAgo(s.created_at)}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {!s.tunnel && !s.project && <CopyIcon text={cmd} label={`Copy: ${cmd}`} />}
                    <CopyIcon text={url} label="Copy URL" />
                    {(s.tunnel || s.project) && (
                      <a href={url} target="_blank" rel="noopener" title="Open" aria-label="Open"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 text-muted-foreground hover:bg-accent hover:text-foreground"><ArrowRight className="h-3.5 w-3.5 -rotate-45" /></a>
                    )}
                    <button onClick={() => release(s)} disabled={releasing === s.subdomain} title="Release" aria-label={`Release ${s.subdomain}`}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-600 disabled:opacity-50">
                      {releasing === s.subdomain ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="ov-rise flex items-start gap-3 rounded-2xl border border-border/60 bg-muted/20 p-4 text-xs text-muted-foreground" style={{ animationDelay: "200ms" }}>
        <Terminal className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Start a tunnel on a reserved name with <span className="font-mono text-foreground">deployzy http 3000 --subdomain NAME</span>. Use the copy button on an idle row to grab the exact command.</p>
      </div>
    </div>
  );
}
