"use client";

import { useEffect, useState } from "react";
import { Globe, Server, Loader2, Check, ChevronDown } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

export interface SelectableServer {
  id: string;
  label: string;
  region: string;
  is_byoc: boolean;
  is_local: boolean;
  full: boolean;
  total_memory_mb: number;
  used_memory_mb: number;
  load_avg: number;
  current_projects: number;
  max_projects: number;
}

// A small country-flag emoji for common regions, purely decorative. Falls back
// to a globe when a region isn't recognised, so an unknown label still renders.
function regionFlag(region: string): string {
  const r = region.toLowerCase();
  if (r.includes("us") || r.includes("america")) return "🇺🇸";
  if (r.includes("eu") || r.includes("germany") || r.includes("frankfurt")) return "🇪🇺";
  if (r.includes("uk") || r.includes("london")) return "🇬🇧";
  if (r.includes("asia") || r.includes("singapore") || r.includes("sg")) return "🇸🇬";
  if (r.includes("india") || r.includes("mumbai")) return "🇮🇳";
  if (r.includes("japan") || r.includes("tokyo")) return "🇯🇵";
  if (r.includes("africa") || r.includes("lagos") || r.includes("ng")) return "🇳🇬";
  return "";
}

function serverLabel(s: SelectableServer): string {
  if (s.is_byoc) return `${s.label} (your server)`;
  if (s.region && s.region !== "default") return `${s.region}`;
  return s.label || "Deployzy Cloud";
}

/**
 * Region/server picker for the project create flow. Fetches the servers the
 * user is actually allowed to deploy to (platform regions + own BYOC) and
 * makes them pick — no silent auto-assignment. Reports the chosen server id
 * (empty string only while loading or if nothing is available).
 */
export function RegionPicker({
  value,
  onChange,
  label = "Region",
}: {
  value: string;
  onChange: (serverId: string) => void;
  label?: string;
}) {
  const [servers, setServers] = useState<SelectableServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("sm_token") : null;
    fetch(`${API}/api/v1/servers/selectable`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: SelectableServer[]) => {
        const list = Array.isArray(rows) ? rows : [];
        setServers(list);
        // Default to the first available (least-loaded platform) so the field
        // is never empty, but the choice is explicit and changeable.
        if (!value) {
          const firstOk = list.find((s) => !s.full) || list[0];
          if (firstOk) onChange(firstOk.id);
        }
      })
      .catch(() => setServers([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = servers.find((s) => s.id === value);

  if (loading) {
    return (
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
        <div className="flex h-10 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading regions…
        </div>
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-600 dark:text-amber-400">
          No regions are currently available. Your project will deploy to the default host.
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center justify-between rounded-lg border border-input bg-background px-3 text-sm transition-colors hover:border-foreground/30"
      >
        <span className="flex items-center gap-2 min-w-0">
          {selected?.is_byoc ? (
            <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <span className="text-base leading-none">{regionFlag(selected?.region || "")}</span>
          )}
          {!selected?.is_byoc && !regionFlag(selected?.region || "") && (
            <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{selected ? serverLabel(selected) : "Select a region"}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          {/* click-away */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
            {servers.map((s) => {
              const isSel = s.id === value;
              const memPct = s.total_memory_mb > 0 ? Math.round((s.used_memory_mb / s.total_memory_mb) * 100) : 0;
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={s.full}
                  onClick={() => {
                    if (s.full) return;
                    onChange(s.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors ${
                    s.full ? "cursor-not-allowed opacity-50" : "hover:bg-muted/60"
                  } ${isSel ? "bg-muted/40" : ""}`}
                >
                  {s.is_byoc ? (
                    <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : regionFlag(s.region) ? (
                    <span className="text-base leading-none">{regionFlag(s.region)}</span>
                  ) : (
                    <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{serverLabel(s)}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {s.is_byoc
                        ? "Your own server"
                        : s.full
                          ? "At capacity"
                          : `${memPct}% memory · ${s.current_projects}/${s.max_projects || "∞"} projects`}
                    </span>
                  </span>
                  {isSel && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
