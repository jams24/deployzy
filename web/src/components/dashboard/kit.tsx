"use client";

import * as React from "react";
import { CubeIcon, GlobeSimpleIcon, type Icon as PhosphorIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { STACK_LOGOS } from "@/lib/stack-logos";

// Small shared kit for dashboard pages, so every page speaks one calm visual
// language: quiet headers, hairline "surface" cards, duotone icon tiles, one
// status vocabulary.

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
  level = 1,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  /** 2 = a section header under a shared page header (e.g. Settings tabs). */
  level?: 1 | 2;
}) {
  const H = level === 1 ? "h1" : "h2";
  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:justify-between", level === 1 ? "sm:items-end" : "sm:items-center", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <H className={cn(
          "font-semibold",
          level === 1 ? "text-[22px] leading-[1.2] tracking-[-0.022em] sm:text-[24px]" : "text-[17px] leading-snug tracking-[-0.015em]",
          eyebrow && "mt-1",
        )}>{title}</H>
        {description && <p className={cn("max-w-2xl leading-relaxed text-muted-foreground", level === 1 ? "mt-1 text-[13.5px]" : "mt-0.5 text-[13px]")}>{description}</p>}
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
  icon: PhosphorIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3.5 rounded-[18px] border border-dashed border-[var(--dz-hairline)] px-6 py-14 text-center", className)}>
      <IconTile icon={Icon} size="lg" tone="brand" />
      <div>
        <p className="text-[15px] font-semibold tracking-[-0.01em]">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

// A soft square holding one duotone icon: the dashboard's standard "this
// thing" marker on cards, rows and empty states. Tones tint the icon and its
// soft fill; "muted" is the resting grey.
export type IconTone = "muted" | "brand" | "sky" | "violet" | "amber" | "rose" | "cyan" | "red";

const TILE_TONE: Record<IconTone, string> = {
  muted: "bg-foreground/[0.045] text-foreground/70",
  brand: "bg-brand/[0.1] text-[var(--dz-green-strong)] dark:text-brand",
  sky: "bg-sky-500/[0.1] text-sky-600 dark:text-sky-400",
  violet: "bg-violet-500/[0.1] text-violet-600 dark:text-violet-400",
  amber: "bg-amber-500/[0.12] text-amber-600 dark:text-amber-400",
  rose: "bg-rose-500/[0.1] text-rose-600 dark:text-rose-400",
  cyan: "bg-cyan-500/[0.1] text-cyan-600 dark:text-cyan-400",
  red: "bg-red-500/[0.1] text-red-600 dark:text-red-400",
};

const TILE_SIZE = {
  sm: "h-8 w-8 rounded-[9px] [&>svg]:h-4 [&>svg]:w-4",
  md: "h-10 w-10 rounded-[11px] [&>svg]:h-5 [&>svg]:w-5",
  lg: "h-12 w-12 rounded-[14px] [&>svg]:h-6 [&>svg]:w-6",
};

export function IconTile({
  icon: Icon,
  tone = "muted",
  size = "md",
  className,
  children,
}: {
  icon?: PhosphorIcon;
  tone?: IconTone;
  size?: keyof typeof TILE_SIZE;
  className?: string;
  /** Custom content (e.g. a brand logo) instead of an icon. */
  children?: React.ReactNode;
}) {
  return (
    <span aria-hidden className={cn("dz-ico-tint flex shrink-0 items-center justify-center", TILE_SIZE[size], TILE_TONE[tone], className)}>
      {Icon ? <Icon weight="duotone" /> : children}
    </span>
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
    case "offline":
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
  const Fallback = key === "static" ? GlobeSimpleIcon : CubeIcon;
  return <Fallback className={cn("h-4 w-4", className)} aria-hidden />;
}
