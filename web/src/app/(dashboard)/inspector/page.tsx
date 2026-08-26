"use client";

import { useEffect, useState, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Eye, Trash2, Search } from "lucide-react";
import { api, type Tunnel, type CapturedRequest } from "@/lib/api";

const methodColors: Record<string, string> = {
  GET: "text-sky-600 dark:text-sky-400",
  POST: "text-emerald-600 dark:text-emerald-400",
  PUT: "text-amber-600 dark:text-amber-400",
  PATCH: "text-orange-600 dark:text-orange-400",
  DELETE: "text-red-600 dark:text-red-400",
};

const statusColor = (code: number) => {
  if (code < 300) return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
  if (code < 400) return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30";
  return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30";
};

export default function InspectorPage() {
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [selectedTunnel, setSelectedTunnel] = useState<string>("");
  const [requests, setRequests] = useState<CapturedRequest[]>([]);
  const [selected, setSelected] = useState<CapturedRequest | null>(null);
  const [filter, setFilter] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    api.listTunnels().then(setTunnels).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedTunnel) return;

    // Load existing requests
    api.listRequests(selectedTunnel).then(setRequests).catch(() => {});

    // Connect WebSocket for live updates
    const wsUrl = `${(process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081").replace("http", "ws")}/api/v1/ws/traffic/${encodeURIComponent(selectedTunnel)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const req = JSON.parse(event.data) as CapturedRequest;
      setRequests((prev) => [req, ...prev].slice(0, 500));
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [selectedTunnel]);

  const filtered = requests.filter(
    (r) =>
      !filter ||
      r.path.toLowerCase().includes(filter.toLowerCase()) ||
      r.method.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] animate-fade-in-up">
      <div className="flex items-center justify-between pb-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Network</p>
          <h1 className="mt-1 text-[22px] sm:text-[26px] font-bold tracking-[-0.02em]">Traffic Inspector</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            View and inspect requests flowing through your tunnels in real-time.
          </p>
        </div>
      </div>

      {/* Tunnel Selector */}
      <div className="flex items-center gap-3 pb-4">
        <select
          className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={selectedTunnel}
          onChange={(e) => {
            setSelectedTunnel(e.target.value);
            setRequests([]);
            setSelected(null);
          }}
        >
          <option value="">Select a tunnel...</option>
          {tunnels.map((t) => (
            <option key={t.url} value={t.url}>
              {t.url}
            </option>
          ))}
        </select>

        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter by path or method..."
            className="pl-9 h-9"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setRequests([]);
            setSelected(null);
          }}
          className="gap-1"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </Button>
      </div>

      {!selectedTunnel ? (
        <div className="flex-1 relative rounded-2xl border border-dashed border-border overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute -top-20 left-1/2 h-40 w-[380px] -translate-x-1/2 rounded-full bg-emerald-500/[0.07] blur-[80px] dark:bg-emerald-400/[0.08]" />
          <div className="relative flex flex-col items-center justify-center h-full py-16">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/70 bg-card">
              <Eye className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Select an active tunnel to inspect traffic
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 gap-4 overflow-hidden">
          {/* Request List */}
          <div className="w-[45%] overflow-y-auto rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Eye className="h-8 w-8 opacity-40" />
                <p className="mt-2 text-sm">Waiting for requests...</p>
              </div>
            ) : (
              filtered.map((r) => (
                <button
                  key={r.id}
                  className={`w-full text-left px-4 py-3 border-b border-border/50 transition-colors hover:bg-accent/50 ${
                    selected?.id === r.id ? "bg-accent" : ""
                  }`}
                  onClick={() => setSelected(r)}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-mono text-xs font-bold ${methodColors[r.method] || "text-foreground"}`}
                    >
                      {r.method}
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${statusColor(r.status_code)}`}
                    >
                      {r.status_code}
                    </Badge>
                    <span className="flex-1 truncate font-mono text-xs text-muted-foreground">
                      {r.path}
                      {r.query ? `?${r.query}` : ""}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span>{new Date(r.timestamp).toLocaleTimeString()}</span>
                    <span>{r.duration_ms}ms</span>
                    <span>{r.remote_addr}</span>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Request Detail */}
          <div className="flex-1 overflow-y-auto rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-4">
            {!selected ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Select a request to inspect
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                    Request
                  </h3>
                  <div className="rounded-md bg-muted/50 p-3 font-mono text-sm">
                    <span className={methodColors[selected.method]}>
                      {selected.method}
                    </span>{" "}
                    {selected.path}
                    {selected.query ? `?${selected.query}` : ""}
                  </div>
                </div>

                <Separator />

                <div>
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                    Request Headers
                  </h3>
                  <div className="rounded-md bg-muted/50 p-3 text-xs font-mono space-y-1">
                    {Object.entries(selected.request_headers || {}).map(
                      ([k, v]) => (
                        <div key={k}>
                          <span className="text-muted-foreground">{k}:</span>{" "}
                          {v}
                        </div>
                      )
                    )}
                  </div>
                </div>

                <Separator />

                <div>
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                    Response Headers
                  </h3>
                  <div className="rounded-md bg-muted/50 p-3 text-xs font-mono space-y-1">
                    {Object.entries(selected.response_headers || {}).map(
                      ([k, v]) => (
                        <div key={k}>
                          <span className="text-muted-foreground">{k}:</span>{" "}
                          {v}
                        </div>
                      )
                    )}
                  </div>
                </div>

                <Separator />

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Status:</span>{" "}
                    <Badge variant="outline" className={statusColor(selected.status_code)}>
                      {selected.status_code}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Duration:</span>{" "}
                    {selected.duration_ms}ms
                  </div>
                  <div>
                    <span className="text-muted-foreground">Request Size:</span>{" "}
                    {selected.request_size} bytes
                  </div>
                  <div>
                    <span className="text-muted-foreground">Response Size:</span>{" "}
                    {selected.response_size} bytes
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
