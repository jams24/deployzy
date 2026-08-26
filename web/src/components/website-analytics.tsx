"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Globe, Users, Eye, Bot } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "https://api.deployzy.com";
const RANGES = ["24h", "7d", "30d"] as const;

type Overview = { pageviews: number; visitors: number; bots: number };
type Point = { ts: string; pageviews: number; visitors: number };
type Row = { key: string; count: number };

function headers() {
  return { Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("sm_token") : ""}` };
}

// 2-letter ISO country code → flag emoji.
function flag(cc: string) {
  if (!cc || cc.length !== 2) return "🌐";
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}
const OS_LABEL: Record<string, string> = { windows: "Windows", macos: "macOS", linux: "Linux", ios: "iOS", android: "Android" };
function labelFor(field: string, key: string) {
  const k = key || "(unknown)";
  if (field === "country") return `${flag(k)}  ${k}`;
  if (field === "os") return OS_LABEL[k] ?? (k[0]?.toUpperCase() + k.slice(1));
  if (field === "browser" || field === "device") return k[0]?.toUpperCase() + k.slice(1);
  if (field === "referrer") return k === "" ? "Direct / none" : k;
  return k;
}

function TopList({ title, field, rows }: { title: string; field: string; rows: Row[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      {rows.length === 0 ? (
        <p className="text-[12px] text-muted-foreground/60">No data yet</p>
      ) : (
        <div className="space-y-1.5">
          {rows.slice(0, 6).map((r) => (
            <div key={r.key} className="relative flex items-center justify-between overflow-hidden rounded-md px-2 py-1 text-[12.5px]">
              <div className="absolute inset-y-0 left-0 rounded-md bg-foreground/[0.06]" style={{ width: `${(r.count / max) * 100}%` }} />
              <span className="relative truncate pr-2">{labelFor(field, r.key)}</span>
              <span className="relative font-mono text-[11px] text-muted-foreground">{r.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function WebsiteAnalytics() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("7d");
  const [ov, setOv] = useState<Overview | null>(null);
  const [series, setSeries] = useState<Point[]>([]);
  const [live, setLive] = useState<number>(0);
  const [tops, setTops] = useState<Record<string, Row[]>>({});
  const [hidden, setHidden] = useState(false);

  const load = useCallback(async () => {
    try {
      const fields = ["country", "path", "referrer", "browser", "os", "device"];
      const [ovRes, ...topRes] = await Promise.all([
        fetch(`${API}/api/v1/admin/website/analytics?range=${range}`, { headers: headers() }),
        ...fields.map((f) => fetch(`${API}/api/v1/admin/website/analytics/top?field=${f}&range=${range}`, { headers: headers() })),
      ]);
      if (!ovRes.ok) { setHidden(true); return; } // non-admin → hide the card
      const o = await ovRes.json();
      setOv(o.overview || { pageviews: 0, visitors: 0, bots: 0 });
      setSeries(Array.isArray(o.timeseries) ? o.timeseries : []);
      setLive(o.realtime?.visitors ?? 0);
      const map: Record<string, Row[]> = {};
      for (let i = 0; i < fields.length; i++) map[fields[i]] = topRes[i].ok ? await topRes[i].json() : [];
      setTops(map);
    } catch { /* keep last data */ }
  }, [range]);

  useEffect(() => { load(); }, [load]);
  // Refresh the live counter (and everything) every 30s.
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  if (hidden) return null;

  const maxPv = Math.max(1, ...series.map((p) => p.pageviews));

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Website Traffic <span className="text-muted-foreground font-normal">· deployzy.com</span></CardTitle>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-500">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
            {live} online now
          </span>
          <div className="flex rounded-lg border border-border overflow-hidden">
            {RANGES.map((r) => (
              <button key={r} onClick={() => setRange(r)} className={`px-2.5 py-1 text-[11px] ${range === r ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>{r}</button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Stat tiles */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-border/60 p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Eye className="h-3 w-3" /> Pageviews</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{(ov?.pageviews ?? 0).toLocaleString()}</div>
          </div>
          <div className="rounded-xl border border-border/60 p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Users className="h-3 w-3" /> Visitors</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{(ov?.visitors ?? 0).toLocaleString()}</div>
          </div>
          <div className="rounded-xl border border-border/60 p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Bot className="h-3 w-3" /> Bots</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-muted-foreground">{(ov?.bots ?? 0).toLocaleString()}</div>
          </div>
        </div>

        {/* Timeseries */}
        <div>
          <div className="flex h-28 items-end gap-[3px]">
            {series.length === 0 ? (
              <div className="flex h-full w-full items-center justify-center text-[12px] text-muted-foreground/60">No traffic in this range yet</div>
            ) : series.map((p, i) => (
              <div key={i} className="group relative flex-1" title={`${new Date(p.ts).toLocaleString()} · ${p.pageviews} views · ${p.visitors} visitors`}>
                <div className="w-full rounded-t bg-foreground/70 transition-colors group-hover:bg-foreground" style={{ height: `${(p.pageviews / maxPv) * 100}%`, minHeight: p.pageviews > 0 ? 2 : 0 }} />
              </div>
            ))}
          </div>
        </div>

        {/* Breakdowns */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <TopList title="Top countries" field="country" rows={tops.country || []} />
          <TopList title="Top pages" field="path" rows={tops.path || []} />
          <TopList title="Top referrers" field="referrer" rows={tops.referrer || []} />
          <TopList title="Browsers" field="browser" rows={tops.browser || []} />
          <TopList title="Operating systems" field="os" rows={tops.os || []} />
          <TopList title="Devices" field="device" rows={tops.device || []} />
        </div>
      </CardContent>
    </Card>
  );
}
