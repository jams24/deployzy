"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RefreshCw, Waypoints, Globe, Terminal as TermIcon, Rocket } from "lucide-react";
import { api } from "@/lib/api";

interface TunnelItem {
  url: string;
  protocol: string;
  name: string;
  type?: string;
  status?: string;
}

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

  const protocolColor = (proto: string) => {
    if (proto === "deploy") return "bg-orange-500/20 text-orange-500";
    if (proto === "http") return "bg-blue-500/20 text-blue-500";
    if (proto === "tcp") return "bg-green-500/10 text-green-500";
    return "bg-violet-500/20 text-violet-500";
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Tunnels</h1>
          <p className="mt-1 text-sm text-muted-foreground hidden sm:block">
            Active tunnels and deployed projects.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-1 h-8 w-8 sm:w-auto sm:px-3 shrink-0" title="Refresh">
          <RefreshCw className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {loading && tunnels.length === 0 ? (
        <div className="mt-12 text-center text-muted-foreground">
          Loading...
        </div>
      ) : tunnels.length === 0 ? (
        <Card className="mt-8">
          <CardContent className="flex flex-col items-center py-16">
            <Waypoints className="h-12 w-12 text-muted-foreground/40" />
            <h3 className="mt-4 font-semibold">No active tunnels</h3>
            <p className="mt-2 text-sm text-muted-foreground max-w-sm text-center">
              Start a tunnel from your terminal to see it here.
            </p>
            <div className="mt-6 rounded-lg border border-border bg-zinc-950 px-6 py-4 font-mono text-sm text-zinc-300">
              <span className="text-zinc-500">$</span> deployzy http 3000
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {tunnels.map((t) => (
            <Card key={t.url} className="hover:border-foreground/20 transition-colors">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${protocolColor(t.protocol)}`}>
                    {protocolIcon(t.protocol)}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                    </span>
                    <span className="text-xs text-green-500 font-medium">Active</span>
                  </div>
                </div>
                <div className="min-w-0">
                  <a href={t.url} target="_blank" rel="noopener" className="text-sm font-mono break-all hover:underline">{t.url}</a>
                  <div className="mt-1.5 flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="text-[10px] shrink-0">{t.protocol.toUpperCase()}</Badge>
                    {t.name && <span className="text-xs text-muted-foreground truncate">{t.name}</span>}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
