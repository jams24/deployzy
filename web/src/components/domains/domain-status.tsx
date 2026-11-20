"use client";

import { CheckCircleIcon, CircleNotchIcon, LinkBreakIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import type { Domain } from "@/lib/api";

// One status per custom domain, always icon + words (never colour alone):
//   Live              DNS verified and routed to an app or tunnel
//   Not connected     DNS verified, nothing to route to yet
//   Needs attention   our last check found the record wrong (hint explains)
//   Waiting for DNS   not seen yet; we keep checking

export type DomainState = "live" | "unbound" | "attention" | "waiting";

export function domainState(d: Domain): DomainState {
  if (d.verified) return d.target_subdomain ? "live" : "unbound";
  // "No DNS record found yet" is normal right after adding; anything else
  // (proxied, points elsewhere) needs the user to change something.
  if (d.check_hint && !/^No DNS record found/.test(d.check_hint)) return "attention";
  return "waiting";
}

const STYLE: Record<DomainState, { label: string; cls: string; Icon: typeof CheckCircleIcon; spin?: boolean }> = {
  live: { label: "Live", cls: "border-brand/25 bg-brand/10 text-[var(--dz-green-strong)] dark:text-brand", Icon: CheckCircleIcon },
  unbound: { label: "Not connected", cls: "border-[var(--dz-hairline)] bg-foreground/[0.04] text-muted-foreground", Icon: LinkBreakIcon },
  attention: { label: "Needs attention", cls: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400", Icon: WarningCircleIcon },
  waiting: { label: "Waiting for DNS", cls: "border-[var(--dz-hairline)] bg-foreground/[0.04] text-muted-foreground", Icon: CircleNotchIcon, spin: true },
};

export function DomainStatus({ domain, className }: { domain: Domain; className?: string }) {
  const s = STYLE[domainState(domain)];
  return (
    <span className={cn("inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full border px-2 text-[12px] font-medium", s.cls, className)}>
      <s.Icon weight="bold" className={cn("h-3 w-3", s.spin && "animate-spin [animation-duration:2.4s]")} />
      {s.label}
    </span>
  );
}

/** "just now", "3 min ago", "2 h ago" */
export function checkedAgo(iso?: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
