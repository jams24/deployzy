"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

// Page-number pagination for admin lists: "Showing 26–50 of 182", prev/next,
// a compact page strip with ellipses, and a page-size picker.
export function Pager({
  total, page, pageSize, onPage, onPageSize, loading,
}: {
  total: number;
  page: number; // 1-based
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
  loading?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  // 1 … 4 5 [6] 7 8 … 20
  const shown = [...new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2])]
    .filter((n) => n >= 1 && n <= pages)
    .sort((a, b) => a - b);
  const strip: (number | "…")[] = [];
  shown.forEach((n, i) => {
    if (i > 0 && n - shown[i - 1] > 1) strip.push("…");
    strip.push(n);
  });

  const btn = "h-8 min-w-8 px-2 rounded-md text-xs border transition-colors disabled:opacity-40 disabled:pointer-events-none";
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
      <p className="text-xs text-muted-foreground tabular-nums">
        {total === 0 ? "No results" : <>Showing <span className="text-foreground font-medium">{from}–{to}</span> of <span className="text-foreground font-medium">{total.toLocaleString()}</span></>}
        {loading && <span className="ml-2 animate-pulse">· loading…</span>}
      </p>
      <div className="flex items-center gap-1 flex-wrap">
        <button className={`${btn} border-border/60 hover:bg-muted/50`} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        {strip.map((n, i) => n === "…" ? (
          <span key={`e${i}`} className="px-1 text-xs text-muted-foreground">…</span>
        ) : (
          <button key={n} onClick={() => onPage(n)}
            className={`${btn} tabular-nums ${n === page ? "bg-primary text-primary-foreground border-primary" : "border-border/60 hover:bg-muted/50"}`}>
            {n}
          </button>
        ))}
        <button className={`${btn} border-border/60 hover:bg-muted/50`} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}
          className="ml-1 h-8 rounded-md border border-input bg-background px-2 text-xs" aria-label="Rows per page">
          {[25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
        </select>
      </div>
    </div>
  );
}

// A filter chip with an optional count, used above admin lists.
export function FilterChip({
  active, onClick, children, count, tone,
}: {
  active: boolean; onClick: () => void; children: React.ReactNode; count?: number;
  tone?: "danger" | "warn";
}) {
  const toneCls = !active && tone === "danger" && count ? "border-red-500/40 text-red-600 dark:text-red-400"
    : !active && tone === "warn" && count ? "border-amber-500/40 text-amber-600 dark:text-amber-400"
    : "";
  return (
    <button onClick={onClick}
      className={`h-7 px-3 rounded-full text-xs border transition-colors inline-flex items-center gap-1.5 whitespace-nowrap ${
        active ? "bg-primary text-primary-foreground border-primary" : `border-border/60 text-muted-foreground hover:bg-muted/40 ${toneCls}`
      }`}>
      {children}
      {count !== undefined && <span className={`tabular-nums ${active ? "opacity-80" : "opacity-70"}`}>{count.toLocaleString()}</span>}
    </button>
  );
}

export function fmtBytes(b: number): string {
  if (!b) return "0";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toFixed(i >= 3 ? 2 : i ? 1 : 0)} ${u[i]}`;
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
