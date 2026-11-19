"use client";

// Small cookie & privacy notice, mounted once in the root layout. Two modes,
// driven by OPTIONAL_CATEGORIES in lib/consent:
//   • none registered (today) → an honest heads-up with "Got it": we only use
//     essential storage, which needs no consent.
//   • some registered → Accept optional / Reject optional / Choose, and nothing
//     optional loads (<ConsentGate>) before a yes.
// "Cookie settings" links anywhere call openCookieSettings() to reopen it.

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, Cookie, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  OPTIONAL_CATEGORIES, onOpenCookieSettings, openCookieSettings, useConsent, type ConsentRecord,
} from "@/lib/consent";

const link = "font-medium text-foreground underline decoration-foreground/25 underline-offset-[3px] transition-colors hover:decoration-foreground";

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors",
        checked ? "bg-brand" : "bg-foreground/15",
      )}
    >
      <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  );
}

export function CookieNotice() {
  const { record, decided, acceptAll, rejectAll, save } = useConsent();
  const [settings, setSettings] = useState(false);
  const [draft, setDraft] = useState<ConsentRecord["choices"]>({});
  const hasOptional = OPTIONAL_CATEGORIES.length > 0;

  useEffect(
    () => onOpenCookieSettings(() => {
      setDraft(record?.choices ?? {});
      setSettings(true);
    }),
    [record],
  );

  // undefined = still hydrating: render nothing so it never flashes.
  if (record === undefined || (decided && !settings)) return null;

  const close = () => setSettings(false);
  const done = (fn: () => void) => () => { fn(); close(); };

  return (
    <section
      aria-label="Cookies and privacy"
      className="dz-cookie fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[45] sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[380px]"
    >
      <div className="rounded-[18px] border border-[var(--dz-hairline)] bg-card p-4 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.45),0_2px_8px_-2px_rgb(0_0_0/0.08)]">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] border border-[var(--dz-hairline)] bg-foreground/[0.03] text-foreground/70">
            <Cookie className="h-3.5 w-3.5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold tracking-[-0.01em]">
              {settings ? "Cookie settings" : "Cookies & privacy"}
            </p>
            <p className="mt-1 text-[12.5px] leading-[1.55] text-muted-foreground">
              {hasOptional
                ? "We use essential cookies to keep you signed in. Anything else is optional and off until you say yes."
                : "We only use essential cookies and storage, to keep you signed in and remember your settings. No ads, no tracking."}{" "}
              Read our <Link href="/privacy" className={link}>Privacy Policy</Link> and <Link href="/cookies" className={link}>Cookie Policy</Link>.
            </p>
          </div>
          {settings && decided && (
            <button
              type="button"
              onClick={close}
              aria-label="Close cookie settings"
              className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {settings && (
          <ul className="mt-3.5 divide-y divide-[var(--dz-hairline)] overflow-hidden rounded-xl border border-[var(--dz-hairline)]">
            <li className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium">Essential</p>
                <p className="text-[11.5px] leading-snug text-muted-foreground">Sign-in, security and your preferences.</p>
              </div>
              <span className="eyebrow shrink-0 !text-[10px]">Always on</span>
            </li>
            {OPTIONAL_CATEGORIES.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium">{c.label}</p>
                  <p className="text-[11.5px] leading-snug text-muted-foreground">{c.description}</p>
                </div>
                <Toggle
                  label={c.label}
                  checked={!!draft[c.id]}
                  onChange={(v) => setDraft((d) => ({ ...d, [c.id]: v }))}
                />
              </li>
            ))}
            {!hasOptional && (
              <li className="px-3 py-2.5 text-[11.5px] leading-snug text-muted-foreground">
                We don’t use any optional cookies right now. If that changes, we’ll ask you here first.
              </li>
            )}
          </ul>
        )}

        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          {!hasOptional ? (
            <button type="button" onClick={done(() => save({}))} className="pill pill-ink pill-xs">
              {settings && <Check className="h-3.5 w-3.5" />}
              {settings ? "Done" : "Got it"}
            </button>
          ) : settings ? (
            <button type="button" onClick={done(() => save(draft))} className="pill pill-ink pill-xs">
              <Check className="h-3.5 w-3.5" /> Save choices
            </button>
          ) : (
            <>
              <button type="button" onClick={acceptAll} className="pill pill-ink pill-xs">Accept optional</button>
              <button type="button" onClick={rejectAll} className="pill pill-line pill-xs">Reject optional</button>
              <button
                type="button"
                onClick={() => { setDraft({}); setSettings(true); }}
                className="ml-auto text-[12px] font-medium text-muted-foreground underline-offset-[3px] hover:text-foreground hover:underline"
              >
                Choose
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/** Text button that reopens the notice as a settings panel. */
export function CookieSettingsButton({ className, children = "Cookie settings" }: { className?: string; children?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={openCookieSettings}
      className={className}
    >
      {children}
    </button>
  );
}
