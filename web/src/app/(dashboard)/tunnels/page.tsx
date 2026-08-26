"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Waypoints, Globe, Terminal as TermIcon, Rocket, ArrowUpRight } from "lucide-react";
import { api } from "@/lib/api";

// ─────────────────────────────────────────────────────────────────────────────
// Tunnels — live tunnel inventory. Polls every 5s (unchanged); presentation
// rebuilt with the Deployzy 2.0 card language, readable in both themes.
// ─────────────────────────────────────────────────────────────────────────────

interface TunnelItem {
  url: string;
  protocol: string;
  name: string;
  type?: string;
  status?: string;
}

const protocolStyle: Record<string, { box: string }> = {
  deploy: { box: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20" },
  http:   { box: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20" },
  tcp:    { box: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
};

export default function TunnelsPage() {
  const [tunnels, setTunnels] = useState<TunnelItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const data = await api.listTunnels();
      setTunnels(data);
    } catch {
      // not authenticated or no tunnels
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const protocolIcon = (proto: string) => {
    if (proto === "deploy") return <Rocket className="h-4 w-4" />;
    if (proto === "http") return <Globe className="h-4 w-4" />;
    if (proto === "tcp") return <TermIcon className="h-4 w-4" />;
    return <Waypoints className="h-4 w-4" />;
  };

  const protocolBox = (proto: string) =>
    protocolStyle[proto]?.box ?? "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20";

  return (
    <div className="animate-fade-in-up">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Network</p>
          <h1 className="mt-1 text-[22px] sm:text-[26px] font-bold tracking-[-0.02em]">Tunnels</h1>
          <p className="mt-1 text-sm text-muted-foreground hidden sm:block">
            Active tunnels and deployed projects.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-1 h-8 w-8 sm:w-auto sm:px-3 shrink-0 rounded-lg" title="Refresh">
          <RefreshCw className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {loading && tunnels.length === 0 ? (
        <div className="mt-12 text-center text-sm text-muted-foreground animate-pulse">
          Loading tunnels…
        </div>
      ) : tunnels.length === 0 ? (
        <div className="relative mt-8 rounded-2xl border border-dashed border-border overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute -top-20 left-1/2 h-40 w-[380px] -translate-x-1/2 rounded-full bg-sky-500/[0.07] blur-[80px] dark:bg-sky-400/[0.08]" />
          <div className="relative flex flex-col items-center py-16 px-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/70 bg-card">
              <Waypoints className="h-5 w-5 text-sky-600 dark:text-sky-400" />
            </div>
            <h3 className="mt-4 font-semibold">No active tunnels</h3>
            <p className="mt-2 text-sm text-muted-foreground max-w-sm text-center">
              Start a tunnel from your terminal to see it here.
            </p>
            <div className="mt-6 flex items-center gap-2 rounded-xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/60 px-5 py-3 font-mono text-[13px]">
              <span className="text-emerald-500">$</span>
              <span className="text-foreground">deployzy http 3000</span>
              <span className="animate-caret ml-0.5 inline-block h-[14px] w-[7px] translate-y-[2px] bg-emerald-400/90" />
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {tunnels.map((t, i) => (
            <a
              key={t.url}
              href={t.url}
              target="_blank"
              rel="noopener"
              className="animate-fade-in-up group relative block overflow-hidden rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[0_12px_32px_-16px_rgba(0,0,0,0.2)] dark:hover:shadow-[0_12px_32px_-16px_rgba(0,0,0,0.6)]"
              style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`flex h-9 w-9 items-center justify-center rounded-lg border shrink-0 ${protocolBox(t.protocol)}`}>
                  {protocolIcon(t.protocol)}
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
                  </span>
                  <span className="text-[11px] text-sky-600 dark:text-sky-400 font-medium">Active</span>
                </span>
              </div>
              <div className="mt-3 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-mono text-foreground truncate">{t.url.replace(/^https?:\/\//, "")}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0 transition-all duration-300 group-hover:text-foreground group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </div>
                <div className="mt-2 flex items-center gap-2 min-w-0">
                  <Badge variant="outline" className="text-[10px] shrink-0 font-mono">{t.protocol.toUpperCase()}</Badge>
                  {t.name && <span className="text-[11px] text-muted-foreground truncate">{t.name}</span>}
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
