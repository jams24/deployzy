"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Waypoints, Globe, Terminal as TermIcon, Rocket, ArrowUpRight, Copy, Check, Eye, Moon, ArrowRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { DashMotion } from "@/components/admin/dash-kit";
import { fmtBytes } from "@/components/admin/pager";

// ─────────────────────────────────────────────────────────────────────────────
// Tunnels — live CLI tunnels first (local → public mapping, uptime, traffic),
// then the workspace's deployed apps. Polls every 5s without flashing.
// ─────────────────────────────────────────────────────────────────────────────

interface Item {
  url: string; protocol: string; name: string; type: "tunnel" | "project";
  // tunnels
  local_addr?: string; inspect?: boolean; created_at?: string; requests?: number; bytes?: number;
  // projects
  id?: string; status?: string; framework?: string;
}

function uptime(iso?: string) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

function CopyButton({ text, label = "Copy URL" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" title={label} aria-label={label}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }); }}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
      {done ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

const PROTO: Record<string, { icon: typeof Globe; tone: string; label: string }> = {
  http: { icon: Globe, tone: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20", label: "HTTP" },
  tls: { icon: Globe, tone: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20", label: "TLS" },
  tcp: { icon: TermIcon, tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20", label: "TCP" },
};

function TunnelCard({ t, i }: { t: Item; i: number }) {
  const p = PROTO[t.protocol] ?? { icon: Waypoints, tone: "bg-muted text-muted-foreground border-border", label: t.protocol.toUpperCase() };
  const host = t.url.replace(/^[a-z]+:\/\//, "");
  return (
    <div className="ov-rise group relative overflow-hidden rounded-2xl border border-border/60 bg-card p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-lg hover:shadow-black/[0.04]"
      style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-500/60 to-transparent" />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${p.tone}`}><p.icon className="h-4 w-4" /></span>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70 motion-reduce:hidden" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
              Live · {p.label}{t.name ? <span className="truncate">· {t.name}</span> : null}
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground"><Clock className="h-3 w-3" /> up {uptime(t.created_at)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <CopyButton text={t.url} />
          {t.protocol !== "tcp" && (
            <a href={t.url} target="_blank" rel="noopener" title="Open" aria-label="Open"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>

      {/* local → public */}
      <div className="mt-4 flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2.5 font-mono text-[12.5px]">
        <span className="shrink-0 text-muted-foreground">{t.local_addr || "local"}</span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        <span className="min-w-0 truncate text-foreground" title={t.url}>{host}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span><span className="font-medium tabular-nums text-foreground">{(t.requests ?? 0).toLocaleString()}</span> requests</span>
        <span><span className="font-medium tabular-nums text-foreground">{fmtBytes(t.bytes ?? 0)}</span> transferred</span>
        {t.inspect ? (
          <Link href="/inspector" className="inline-flex items-center gap-1 text-violet-600 hover:underline dark:text-violet-400"><Eye className="h-3 w-3" /> inspecting</Link>
        ) : null}
      </div>
    </div>
  );
}

function StartTunnel() {
  const cmds = [
    { cmd: "deployzy http 3000", hint: "Share a local web app over HTTPS" },
    { cmd: "deployzy tcp 5432", hint: "Expose a TCP port (databases, SSH…)" },
  ];
  return (
    <div className="ov-rise relative overflow-hidden rounded-2xl border border-dashed border-border px-5 py-8 sm:px-8">
      <div aria-hidden className="pointer-events-none absolute -top-20 left-1/2 h-40 w-[380px] -translate-x-1/2 rounded-full bg-sky-500/[0.08] blur-[80px]" />
      <div className="relative flex flex-col items-center text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/70 bg-card"><Waypoints className="h-5 w-5 text-sky-600 dark:text-sky-400" /></div>
        <h3 className="mt-4 font-semibold">No tunnels running</h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">Run one of these in your terminal. The tunnel appears here the moment it connects.</p>
        <div className="mt-5 grid w-full max-w-lg gap-2">
          {cmds.map((c) => (
            <div key={c.cmd} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-2.5 text-left">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[13px]"><span className="text-emerald-500">$</span> {c.cmd}</p>
                <p className="text-[11px] text-muted-foreground">{c.hint}</p>
              </div>
              <CopyButton text={c.cmd} label="Copy command" />
            </div>
          ))}
        </div>
        <Link href="/docs/cli" className="mt-4 text-xs font-medium hover:underline">Install the CLI →</Link>
      </div>
    </div>
  );
}

export default function TunnelsPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [, tick] = useState(0); // re-render each second for uptime

  const load = useCallback(async () => {
    setRefreshing(true);
    try { setItems(await api.listTunnels()); } catch { setItems((prev) => prev ?? []); }
    setRefreshing(false);
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const poll = setInterval(load, 5000);
    const clock = setInterval(() => tick((n) => n + 1), 1000);
    return () => { clearTimeout(first); clearInterval(poll); clearInterval(clock); };
  }, [load]);

  const tunnels = (items ?? []).filter((i) => i.type !== "project");
  const apps = (items ?? []).filter((i) => i.type === "project");
  const sleeping = apps.filter((a) => a.status === "sleeping").length;

  return (
    <div className="@container animate-fade-in-up space-y-6">
      <DashMotion />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Network</p>
          <h1 className="mt-1 text-[22px] font-bold tracking-[-0.02em] sm:text-[26px]">Tunnels</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your live localhost tunnels, plus the apps you have deployed.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="h-8 shrink-0 gap-1.5 rounded-lg" title="Refresh">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {items === null ? (
        <div className="grid gap-3 @2xl:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-[168px] animate-pulse rounded-2xl bg-muted/50" />)}
        </div>
      ) : (
        <>
          <section>
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-sm font-semibold">Live tunnels</h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">{tunnels.length}</span>
            </div>
            {tunnels.length === 0 ? <StartTunnel /> : (
              <div className="grid gap-3 @2xl:grid-cols-2 @6xl:grid-cols-3">
                {tunnels.map((t, i) => <TunnelCard key={t.url} t={t} i={i} />)}
              </div>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">Deployed apps</h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">{apps.length}</span>
                {sleeping > 0 && <span className="text-[11px] text-muted-foreground">· {sleeping} asleep (wake on next visit)</span>}
              </div>
              <Link href="/projects" className="text-xs font-medium text-muted-foreground hover:text-foreground">All projects →</Link>
            </div>
            {apps.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border px-6 py-8 text-center text-sm text-muted-foreground">
                No running apps. <Link href="/new" className="font-medium text-foreground hover:underline">Deploy one</Link>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-border/60 bg-card">
                <div className="divide-y divide-border/50">
                  {apps.map((a, i) => {
                    const asleep = a.status === "sleeping";
                    return (
                      <div key={a.url} className="ov-rise flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/30" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${asleep ? "border-indigo-500/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" : "border-orange-500/20 bg-orange-500/10 text-orange-600 dark:text-orange-400"}`}>
                          {asleep ? <Moon className="h-3.5 w-3.5" /> : <Rocket className="h-3.5 w-3.5" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {a.id ? <Link href={`/projects/${a.id}`} className="truncate text-sm font-medium hover:underline">{a.name}</Link> : <span className="truncate text-sm font-medium">{a.name}</span>}
                            {a.framework && <span className="hidden rounded border border-border/60 px-1.5 text-[10px] text-muted-foreground sm:inline">{a.framework}</span>}
                          </div>
                          <p className="truncate font-mono text-[11px] text-muted-foreground">{a.url.replace(/^https?:\/\//, "")}</p>
                        </div>
                        <span className={`hidden shrink-0 items-center gap-1.5 text-[11px] font-medium sm:flex ${asleep ? "text-indigo-600 dark:text-indigo-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${asleep ? "bg-indigo-500" : "bg-emerald-500"}`} />{asleep ? "Sleeping" : "Running"}
                        </span>
                        <CopyButton text={a.url} />
                        <a href={a.url} target="_blank" rel="noopener" title="Open app" aria-label="Open app"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
