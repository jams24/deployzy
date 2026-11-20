"use client";

// Setup checklist: a small pill (progress ring + "x/6") that opens into a
// card of first steps. Each step's state comes from the server, so it ticks
// itself off when the thing is actually done. Hidden until the cookie notice
// is dealt with, while the tour runs, on full-height screens, and for good
// once dismissed.

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowRightIcon, CaretDownIcon, CheckIcon, SparkleIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useConsent } from "@/lib/consent";
import { checklistEligible, startTour, useOnboarding, type OnboardingState } from "@/lib/onboarding";
import { showsTabBar } from "@/components/dashboard/mobile-nav";

interface Item {
  id: string;
  done: boolean;
  title: string;
  hint: string;
  href?: string;
  run?: () => void;
}

function items(s: OnboardingState): Item[] {
  return [
    { id: "tour", done: s.tour_done, title: "Take the tour", hint: "A one-minute look around the dashboard.", run: startTour },
    { id: "github", done: s.github_connected, title: "Connect GitHub", hint: "Deploy straight from your repositories.", href: "/new" },
    { id: "deploy", done: s.deployed, title: "Deploy your first app", hint: "From GitHub, a folder or a template.", href: "/new" },
    { id: "database", done: s.database, title: "Create a database", hint: "Postgres, MySQL, MongoDB or Redis.", href: "/new?type=database" },
    { id: "tunnel", done: s.tunnel, title: "Open a tunnel", hint: "Share localhost from the CLI.", href: "/tunnels" },
    { id: "domain", done: s.domain, title: "Add a custom domain", hint: "Serve an app on your own domain.", href: "/domains" },
  ];
}

function Ring({ value, size = 22 }: { value: number; size?: number }) {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 shrink-0" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={2.5} className="stroke-foreground/10" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={2.5} strokeLinecap="round"
        className="stroke-brand transition-[stroke-dashoffset] duration-700"
        strokeDasharray={c} strokeDashoffset={c * (1 - value)}
      />
    </svg>
  );
}

const OPEN_KEY = "dz_checklist_open";

export function SetupChecklist() {
  const { state, tourOpen, dismissChecklist } = useOnboarding();
  const { decided } = useConsent();
  const pathname = usePathname();
  // Remember open/closed per browser (a convenience, not state that matters).
  // Reading storage in the initializer is safe: nothing renders until the
  // onboarding state has loaded on the client, so there's no hydration diff.
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(OPEN_KEY) === "1"; } catch { return false; }
  });
  const toggle = (v: boolean) => {
    setOpen(v);
    try { localStorage.setItem(OPEN_KEY, v ? "1" : "0"); } catch {}
  };

  if (!state || !checklistEligible(state) || !decided || tourOpen || !showsTabBar(pathname)) return null;

  const list = items(state);
  const done = list.filter((x) => x.done).length;
  const all = done === list.length;

  return (
    <div className="dz-float pointer-events-none fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex justify-end sm:inset-x-auto sm:bottom-5 sm:right-5">
      {!open ? (
        <button
          type="button"
          onClick={() => toggle(true)}
          aria-expanded={false}
          aria-label={`Setup checklist, ${done} of ${list.length} done`}
          className="pointer-events-auto flex h-10 items-center gap-2 rounded-full border border-[var(--dz-hairline)] bg-card pl-2 pr-3 sm:gap-2.5 sm:pr-3.5 text-[13px] shadow-[0_14px_40px_-16px_rgb(0_0_0/0.45),0_1px_3px_rgb(0_0_0/0.06)] transition-transform hover:-translate-y-0.5"
        >
          <Ring value={done / list.length} />
          <span className="hidden font-medium tracking-[-0.01em] sm:inline">{all ? "All set" : "Get started"}</span>
          <span className="figure text-[11.5px] text-muted-foreground">{done}/{list.length}</span>
        </button>
      ) : (
        <section
          aria-label="Setup checklist"
          className="dz-tour-step pointer-events-auto w-full overflow-hidden rounded-[18px] border border-[var(--dz-hairline)] bg-card shadow-[0_28px_70px_-24px_rgb(0_0_0/0.5),0_2px_8px_-2px_rgb(0_0_0/0.08)] sm:w-[340px]"
        >
          <header className="flex items-center gap-3 px-4 pb-3 pt-4">
            <Ring value={done / list.length} size={30} />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold tracking-[-0.015em]">{all ? "You’re all set" : "Get set up"}</p>
              <p className="text-[12px] text-muted-foreground">
                {all ? "Everything’s in place. Nice work." : `${done} of ${list.length} done`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => toggle(false)}
              aria-label="Minimise checklist"
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <CaretDownIcon className="h-4 w-4" />
            </button>
          </header>

          <ul className="border-t border-[var(--dz-hairline)] py-1.5">
            {list.map((x) => {
              const inner = (
                <>
                  <span
                    className={cn(
                      "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors",
                      x.done ? "border-brand bg-brand text-[oklch(0.16_0.02_165)]" : "border-foreground/20",
                    )}
                  >
                    {x.done && <CheckIcon className="h-3 w-3" weight="bold" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-[13px] font-medium tracking-[-0.005em]", x.done && "text-muted-foreground")}>{x.title}</span>
                    {!x.done && <span className="block truncate text-[11.5px] text-muted-foreground">{x.hint}</span>}
                  </span>
                  {!x.done && <ArrowRightIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />}
                </>
              );
              const cls = cn(
                "group flex w-full items-center gap-3 px-4 py-2 text-left transition-colors",
                x.done ? "cursor-default" : "hover:bg-foreground/[0.03]",
              );
              return (
                <li key={x.id}>
                  {x.done ? (
                    <div className={cls}>{inner}</div>
                  ) : x.run ? (
                    <button type="button" className={cls} onClick={() => { toggle(false); x.run?.(); }}>{inner}</button>
                  ) : (
                    <Link href={x.href!} className={cls} onClick={() => toggle(false)}>{inner}</Link>
                  )}
                </li>
              );
            })}
          </ul>

          <footer className="flex items-center justify-between gap-3 border-t border-[var(--dz-hairline)] px-4 py-2.5">
            {all ? (
              <>
                <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><SparkleIcon className="h-3.5 w-3.5 text-brand" /> Setup complete</span>
                <button type="button" onClick={dismissChecklist} className="pill pill-ink pill-xs">Close checklist</button>
              </>
            ) : (
              <>
                <span className="text-[11.5px] text-muted-foreground">Ticks itself off as you go.</span>
                <button type="button" onClick={dismissChecklist} className="text-[12px] font-medium text-muted-foreground underline-offset-[3px] transition-colors hover:text-foreground hover:underline">
                  Hide checklist
                </button>
              </>
            )}
          </footer>
        </section>
      )}
    </div>
  );
}
