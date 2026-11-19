// Shared layout for the legal pages (/terms, /privacy, /cookies, and the tab
// row on /acceptable-use): tab nav between policies, a quiet header, a sticky
// numbered contents list and compact, small-type prose (.legal-prose).

import Link from "next/link";
import { cn } from "@/lib/utils";

export type LegalTab = "terms" | "privacy" | "cookies" | "acceptable-use";

const TABS: { id: LegalTab; label: string; href: string }[] = [
  { id: "terms", label: "Terms", href: "/terms" },
  { id: "privacy", label: "Privacy", href: "/privacy" },
  { id: "cookies", label: "Cookies", href: "/cookies" },
  { id: "acceptable-use", label: "Acceptable use", href: "/acceptable-use" },
];

/** Date shown on the policies. Change it whenever a policy's text changes. */
export const LEGAL_UPDATED = "19 November 2026";

export function LegalNav({ active, className }: { active: LegalTab; className?: string }) {
  return (
    <nav aria-label="Legal documents" className={cn("flex flex-wrap gap-1.5", className)}>
      {TABS.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={t.id === active ? "page" : undefined}
          className={cn(
            "inline-flex h-7 items-center rounded-full border px-3 text-[12px] font-medium tracking-[-0.005em] transition-colors",
            t.id === active
              ? "border-foreground bg-foreground text-background"
              : "border-[var(--dz-hairline)] text-muted-foreground hover:border-foreground/25 hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export interface LegalSection {
  id: string;
  title: string;
  body: React.ReactNode;
}

export function LegalShell({
  active, title, intro, sections, aside,
}: {
  active: LegalTab;
  title: React.ReactNode;
  intro: React.ReactNode;
  sections: LegalSection[];
  /** Optional extra block under the contents list (e.g. Cookie settings). */
  aside?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[1080px] px-5 py-12 sm:px-6 sm:py-16">
      <LegalNav active={active} className="rise" />

      <header className="rise mt-10 max-w-2xl" style={{ animationDelay: "0.05s" }}>
        <p className="eyebrow">Legal</p>
        <h1 className="mt-3 text-[clamp(2rem,4.6vw,2.9rem)] font-semibold leading-[1.04] tracking-[-0.045em]">{title}</h1>
        <div className="mt-4 text-[14.5px] leading-[1.7] text-muted-foreground">{intro}</div>
        <p className="mt-5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted-foreground">
          <span>Last updated <time className="text-foreground/80">{LEGAL_UPDATED}</time></span>
          <span aria-hidden className="hidden text-border sm:inline">·</span>
          <a href="mailto:support@deployzy.com" className="transition-colors hover:text-foreground">support@deployzy.com</a>
        </p>
      </header>

      <div className="mt-12 border-t border-[var(--dz-hairline)] pt-10 lg:grid lg:grid-cols-[208px_minmax(0,1fr)] lg:gap-14">
        <aside className="mb-8 lg:mb-0">
          {/* Phones: a collapsed "Contents" disclosure so the policy starts right away. */}
          <details className="group/toc rounded-xl border border-[var(--dz-hairline)] lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 [&::-webkit-details-marker]:hidden">
              <span className="eyebrow">Contents · {sections.length}</span>
              <span aria-hidden className="text-[12px] text-muted-foreground transition-transform group-open/toc:rotate-45">+</span>
            </summary>
            <div className="border-t border-[var(--dz-hairline)] px-3.5 py-2.5"><Toc sections={sections} /></div>
          </details>
          {aside && <div className="mt-4 lg:hidden">{aside}</div>}

          <div className="hidden lg:sticky lg:top-24 lg:block">
            <p className="eyebrow mb-3">Contents</p>
            <Toc sections={sections} />
            {aside && <div className="mt-6">{aside}</div>}
          </div>
        </aside>

        <article className="min-w-0 max-w-[680px]">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-24 border-b border-[var(--dz-hairline)] py-8 first:pt-0 last:border-0">
              <p className="figure text-[11px] text-muted-foreground/70">{String(i + 1).padStart(2, "0")}</p>
              <h2 className="mt-1.5 text-[16px] font-semibold tracking-[-0.02em]">{s.title}</h2>
              <div className="legal-prose mt-3">{s.body}</div>
            </section>
          ))}
        </article>
      </div>
    </div>
  );
}

function Toc({ sections }: { sections: LegalSection[] }) {
  return (
    <ol className="space-y-0.5">
      {sections.map((s, i) => (
        <li key={s.id}>
          <a
            href={`#${s.id}`}
            className="group flex items-baseline gap-2.5 rounded-lg py-1 text-[12.5px] leading-snug text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="figure w-4 shrink-0 text-[10.5px] text-muted-foreground/60 group-hover:text-brand">{String(i + 1).padStart(2, "0")}</span>
            {s.title}
          </a>
        </li>
      ))}
    </ol>
  );
}

/** Compact two-or-more column table for the policies (cookies, providers). */
export function LegalTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="not-prose mt-4 overflow-x-auto rounded-xl border border-[var(--dz-hairline)]">
      <table className="w-full min-w-[520px] border-collapse text-left text-[12.5px]">
        <thead>
          <tr className="bg-foreground/[0.025]">
            {head.map((h) => (
              <th key={h} scope="col" className="eyebrow whitespace-nowrap px-3 py-2.5 !text-[10px] font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--dz-hairline)]">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((c, j) => (
                <td key={j} className={cn("px-3 py-2.5 leading-[1.55] text-muted-foreground", j === 0 && "whitespace-nowrap font-mono text-[11.5px] text-foreground")}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
