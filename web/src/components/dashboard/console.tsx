"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { ArrowLeft, ChevronsUpDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Shared chrome for the full-height data consoles (Postgres, MongoDB, Redis):
// a framed surface that fills the viewport, a header with the database name
// and a segmented tab switch, and a native picker that replaces the
// table/collection sidebar on phones.

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

export function ConsoleFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("surface flex h-[calc(100dvh-6.5rem)] flex-col overflow-hidden rounded-[22px] sm:h-[calc(100dvh-7.5rem)]", className)}>
      {children}
    </div>
  );
}

const TONES = {
  postgres: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  mongo: "bg-green-500/10 text-green-600 dark:text-green-400",
  redis: "bg-red-500/10 text-red-600 dark:text-red-400",
} as const;

export type ConsoleTab<T extends string> = { id: T; label: string; icon: LucideIcon };

export function ConsoleHeader<T extends string>({
  kind,
  title,
  icon: Icon,
  tone,
  onBack,
  tabs,
  active,
  onTab,
  extra,
  picker,
}: {
  kind: string;
  title: string;
  icon: LucideIcon;
  tone: keyof typeof TONES;
  onBack: () => void;
  tabs: ConsoleTab<T>[];
  active: T;
  onTab: (t: T) => void;
  extra?: React.ReactNode;
  picker?: React.ReactNode;
}) {
  const seg = (
    <div role="tablist" className="flex h-9 items-center gap-0.5 rounded-full bg-foreground/[0.05] p-0.5">
      {tabs.map((t) => {
        const TIcon = t.icon;
        const on = active === t.id;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={on}
            onClick={() => onTab(t.id)}
            className={cn(
              "flex h-full flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors",
              on ? "bg-background text-foreground shadow-sm dark:bg-white/[0.1]" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <TIcon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="shrink-0 border-b border-[var(--dz-hairline)]">
      <div className="flex items-center gap-2.5 px-3 py-2.5 sm:px-4">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to databases"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", TONES[tone])}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow leading-none">{kind}</p>
          <p className="mt-1 truncate text-[15px] font-semibold leading-tight tracking-tight">{title}</p>
        </div>
        {extra && <div className="hidden min-w-0 items-center gap-1.5 lg:flex">{extra}</div>}
        <div className="hidden sm:block">{seg}</div>
      </div>
      {/* Phones: tabs, then the picker, each on its own full-width row */}
      <div className="space-y-2 px-3 pb-2.5 sm:hidden">
        {seg}
        {picker}
      </div>
      {picker && <div className="hidden px-4 pb-2.5 sm:block md:hidden">{picker}</div>}
    </div>
  );
}

// Native select styled like the rest of the kit; on phones it opens the OS
// picker, which beats any custom dropdown for long table lists.
export function ConsolePicker({
  label,
  value,
  options,
  onChange,
  placeholder = "Select…",
}: {
  label: string;
  value: string | null;
  options: { value: string; label: string; hint?: string }[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="relative flex h-9 w-full items-center rounded-full border border-[var(--dz-hairline)] bg-background/70 dark:bg-white/[0.03]">
      <span className="pointer-events-none pl-3.5 font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-full min-w-0 flex-1 appearance-none truncate bg-transparent pl-2 pr-8 font-mono text-[13px] font-medium outline-none"
      >
        {!value && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}{o.hint ? `  ·  ${o.hint}` : ""}
          </option>
        ))}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute right-3 h-3.5 w-3.5 text-muted-foreground" />
    </label>
  );
}

// Look up the database's display name from the combined list so the header
// can say "inventpay-redis" instead of a generic "Redis Browser".
export function useDatabaseName(id: string | undefined): string {
  const [name, setName] = useState("");
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const token = typeof window !== "undefined" ? localStorage.getItem("sm_token") : null;
    const team = typeof window !== "undefined" ? localStorage.getItem("sm_team_id") : null;
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    fetch(`${API}/api/v1/databases${team ? `?team_id=${encodeURIComponent(team)}` : ""}`, { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const rows: { id?: string; project_id?: string; name?: string }[] = Array.isArray(d) ? d : d?.databases ?? d?.data ?? [];
        const hit = rows.find((x) => x.id === id || x.project_id === id);
        if (alive && hit?.name) setName(hit.name.trim());
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [id]);
  return name;
}
