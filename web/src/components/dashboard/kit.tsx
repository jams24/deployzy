"use client";

import * as React from "react";
import { Box, Globe, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { STACK_LOGOS } from "@/lib/stack-logos";

// Small shared kit for dashboard pages, so every page speaks the same visual
// language as the marketing site: mono eyebrows, tight headlines, hairline
// "surface" cards, one status vocabulary.

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="mt-2 text-[28px] font-semibold leading-[1.1] tracking-[-0.035em] sm:text-[34px]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PanelHeader({ title, count, action, className }: { title: React.ReactNode; count?: number; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 border-b border-[var(--dz-hairline)] px-4 py-3 sm:px-5", className)}>
      <p className="flex items-center gap-2 text-[14.5px] font-semibold tracking-tight">
        {title}
        {count !== undefined && <span className="figure rounded-full bg-foreground/[0.06] px-2 py-px text-[12px] font-medium text-muted-foreground">{count}</span>}
      </p>
      {action}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative flex flex-col items-center gap-4 overflow-hidden rounded-3xl border border-dashed border-[var(--dz-hairline)] px-6 py-14 text-center", className)}>
      <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[420px] -translate-x-1/2 rounded-full bg-brand/[0.08] blur-[80px]" />
      <span className="surface relative flex h-12 w-12 items-center justify-center rounded-2xl">
        <Icon className="h-5 w-5 text-brand" />
      </span>
      <div className="relative">
        <p className="text-[15px] font-semibold">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-sm text-[13.5px] text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="relative">{action}</div>}
    </div>
  );
}

// One status vocabulary for projects, services and deploys.
export type Tone = "ok" | "busy" | "bad" | "idle" | "new";

export function statusTone(status: string): Tone {
  switch (status) {
    case "running":
    case "active":
    case "online":
      return "ok";
    case "building":
    case "deploying":
    case "pending":
    case "starting":
      return "busy";
    case "failed":
    case "crashed":
    case "error":
      return "bad";
    case "created":
      return "new";
    default:
      return "idle";
  }
}

export const TONE_DOT: Record<Tone, string> = {
  ok: "bg-brand",
  busy: "bg-amber-500",
  bad: "bg-red-500",
  idle: "bg-zinc-400 dark:bg-zinc-500",
  new: "bg-brand-cyan",
};

const TONE_PILL: Record<Tone, string> = {
  ok: "border-brand/25 bg-brand/10 text-[var(--dz-green-strong)] dark:text-brand",
  busy: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  bad: "border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-400",
  idle: "border-[var(--dz-hairline)] bg-foreground/[0.04] text-muted-foreground",
  new: "border-brand-cyan/25 bg-brand-cyan/10 text-cyan-700 dark:text-brand-cyan",
};

export function StatusDot({ status, className }: { status: string; className?: string }) {
  const tone = statusTone(status);
  return (
    <span
      className={cn(TONE_DOT[tone], tone === "ok" || tone === "busy" ? "live-dot" : "inline-block h-2 w-2 shrink-0 rounded-full", className)}
      aria-hidden
    />
  );
}

export function StatusPill({ status, className }: { status: string; className?: string }) {
  const tone = statusTone(status);
  return (
    <span className={cn("inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border px-2 text-[12px] font-medium capitalize", TONE_PILL[tone], className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[tone], tone === "busy" && "animate-pulse")} />
      {status}
    </span>
  );
}

// Framework / database type → Simple Icons slug in lib/stack-logos.ts.
const STACK_ALIAS: Record<string, string> = {
  node: "nodedotjs",
  nodejs: "nodedotjs",
  express: "nodedotjs",
  next: "nextdotjs",
  nextjs: "nextdotjs",
  vue: "vuedotjs",
  nuxt: "vuedotjs",
  postgres: "postgresql",
  postgresql: "postgresql",
  mongo: "mongodb",
  golang: "go",
  csharp: "dotnet",
};
const LOGO_BY_SLUG = new Map(STACK_LOGOS.map((l) => [l.slug, l]));

export function StackIcon({ stack, className }: { stack?: string | null; className?: string }) {
  const key = (stack || "").toLowerCase().replace(/[\s.-]/g, "");
  const logo = LOGO_BY_SLUG.get(STACK_ALIAS[key] ?? key);
  if (logo) {
    return (
      <svg viewBox="0 0 24 24" role="img" aria-label={logo.title} className={cn("h-4 w-4", className)} fill="currentColor">
        <path d={logo.path} />
      </svg>
    );
  }
  const Fallback = key === "static" ? Globe : Box;
  return <Fallback className={cn("h-4 w-4", className)} aria-hidden />;
}
