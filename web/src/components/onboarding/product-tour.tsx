"use client";

// Product tour: a spotlight on real navigation items plus a small popover.
// Steps point at [data-tour="…"] anchors (sidebar links on desktop, the tab
// bar on phones); a step whose anchor isn't visible on this screen is skipped,
// so one list serves both layouts. Portalled to <body> so no transformed
// wrapper can trap the fixed layers.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftIcon, ArrowRightIcon, XIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useOnboarding } from "@/lib/onboarding";
import { useModKey } from "@/lib/use-me";

interface Step {
  anchor: string;
  title: string;
  body: string;
  code?: string;
}

const STEPS: Step[] = [
  { anchor: "overview", title: "Overview", body: "Your home base: what’s running, what needs attention, and shortcuts to everything." },
  { anchor: "new", title: "Deploy something", body: "Start a project from a GitHub repo, a folder on your computer or a template. Most apps are live in under a minute." },
  { anchor: "projects", title: "Projects", body: "Every app you deploy. Open one for its deploys, logs, environment variables, domains and metrics." },
  { anchor: "services", title: "Databases", body: "Postgres, MySQL, MongoDB and Redis, with connection strings ready to paste into your app." },
  { anchor: "tunnels", title: "Tunnels", body: "Put localhost on a public URL straight from your terminal.", code: "deployzy http 3000" },
  { anchor: "agent", title: "Agent", body: "Describe an app in plain English, and the agent writes, builds and deploys it for you." },
  { anchor: "more", title: "Everything else", body: "Tunnels, domains, the agent, API keys and settings all live under More." },
];

const GAP = 14;
const MARGIN = 12;
const POP_W = 304;

/** The first visible element for a step (display:none → zero-size rect). */
function findAnchor(id: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

type Side = "right" | "top" | "bottom";

function place(rect: DOMRect, popH: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(POP_W, vw - MARGIN * 2);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  if (rect.right + GAP + w <= vw - MARGIN) {
    const top = clamp(cy - popH / 2, MARGIN, vh - popH - MARGIN);
    return { side: "right" as Side, left: rect.right + GAP, top, w, arrow: clamp(cy - top, 18, popH - 18) };
  }
  const left = clamp(cx - w / 2, MARGIN, vw - w - MARGIN);
  const arrow = clamp(cx - left, 18, w - 18);
  if (rect.top - GAP - popH >= MARGIN) return { side: "top" as Side, left, top: rect.top - GAP - popH, w, arrow };
  return { side: "bottom" as Side, left, top: Math.min(rect.bottom + GAP, vh - popH - MARGIN), w, arrow };
}

export function ProductTour() {
  const { tourOpen } = useOnboarding();
  // Mounted only while open, so each run starts fresh at step 1.
  return tourOpen ? <Tour /> : null;
}

function Tour() {
  const { closeTour } = useOnboarding();
  const mod = useModKey();
  // Which steps exist on this screen (sidebar on desktop, tab bar on phones).
  const [steps] = useState<Step[]>(() => STEPS.filter((s) => findAnchor(s.anchor)));
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [popH, setPopH] = useState(180);
  const popRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  // Nothing to point at here (e.g. a full-screen editor): try again elsewhere.
  useEffect(() => {
    if (steps.length === 0) closeTour(false);
  }, [steps, closeTour]);

  const step = steps[i] as Step | undefined;
  const last = i === steps.length - 1;

  // Track the anchor's position (scrolling nav, resize).
  useLayoutEffect(() => {
    if (!step) return;
    const el = findAnchor(step.anchor);
    el?.scrollIntoView({ block: "nearest" });
    const update = () => setRect(findAnchor(step.anchor)?.getBoundingClientRect() ?? null);
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step]);

  useLayoutEffect(() => {
    if (popRef.current) setPopH(popRef.current.offsetHeight);
  }, [step, rect]);

  useEffect(() => {
    if (step) nextRef.current?.focus({ preventScroll: true });
  }, [step]);

  const next = useCallback(() => (last ? closeTour(true) : setI((n) => n + 1)), [last, closeTour]);
  const back = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeTour(true); }
      else if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
      else if (e.key === "Tab" && popRef.current) {
        // Keep focus inside the popover while the page behind is shielded.
        const els = [...popRef.current.querySelectorAll<HTMLElement>("button")];
        if (!els.length) return;
        const at = els.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        els[(at + (e.shiftKey ? -1 : 1) + els.length) % els.length].focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, next, back, closeTour]);

  const pos = useMemo(() => (rect ? place(rect, popH) : null), [rect, popH]);

  if (!step || !rect || !pos) return null;

  const isDesktop = window.innerWidth >= 768;
  // Pad the anchor by 4px but keep the ring on screen (tab-bar items touch the edges).
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const hl = Math.max(2, rect.left - 4);
  const ht = Math.max(2, rect.top - 4);
  const hole = { left: hl, top: ht, width: Math.min(vw - 2, rect.right + 4) - hl, height: Math.min(vh - 2, rect.bottom + 4) - ht };

  return createPortal(
    <>
      {/* Click shield: the page stays put while the tour is open. */}
      <div className="fixed inset-0 z-[80]" aria-hidden onClick={() => nextRef.current?.focus()} />
      {/* Spotlight: dims everything except the anchor. */}
      <div
        aria-hidden
        className="dz-tour-glide pointer-events-none fixed z-[81] rounded-[13px]"
        style={{
          ...hole,
          boxShadow: "0 0 0 9999px var(--dz-tour-dim), 0 0 0 1.5px color-mix(in oklch, var(--dz-green) 75%, transparent), 0 0 28px 2px color-mix(in oklch, var(--dz-green) 22%, transparent)",
        }}
      />

      <div
        ref={popRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dz-tour-title"
        aria-describedby="dz-tour-body"
        className="dz-tour-glide fixed z-[82] rounded-[18px] border border-[var(--dz-hairline)] bg-card dark:border-white/[0.1] p-4 text-card-foreground shadow-[0_28px_70px_-24px_rgb(0_0_0/0.55),0_2px_8px_-2px_rgb(0_0_0/0.1)]"
        style={{ left: pos.left, top: pos.top, width: pos.w }}
      >
        {/* Pointer toward the anchor */}
        <span
          aria-hidden
          className={cn(
            "absolute h-3 w-3 rotate-45 border-[var(--dz-hairline)] bg-card",
            pos.side === "right" && "-left-[6.5px] border-b border-l",
            pos.side === "top" && "-bottom-[6.5px] border-b border-r",
            pos.side === "bottom" && "-top-[6.5px] border-l border-t",
          )}
          style={pos.side === "right" ? { top: pos.arrow - 6 } : { left: pos.arrow - 6 }}
        />

        <div key={i} className="dz-tour-step">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="eyebrow !text-[11.5px]">Tour · {i + 1} of {steps.length}</p>
              <h2 id="dz-tour-title" className="mt-1.5 text-[14.5px] font-semibold tracking-[-0.015em]">{step.title}</h2>
            </div>
            <button
              type="button"
              onClick={() => closeTour(true)}
              aria-label="Close tour"
              className="-mr-1.5 -mt-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          <p id="dz-tour-body" className="mt-1.5 text-[12.5px] leading-[1.6] text-muted-foreground">{step.body}</p>
          {step.code && (
            <code className="mt-2.5 block rounded-lg border border-[var(--dz-hairline)] bg-foreground/[0.035] px-2.5 py-1.5 font-mono text-[11.5px] text-foreground">
              <span className="text-brand">$</span> {step.code}
            </code>
          )}
          {last && isDesktop && (
            <p className="mt-2.5 text-[11.5px] text-muted-foreground">
              Tip: press <kbd className="rounded-md border border-[var(--dz-hairline)] px-1 font-mono text-[10.5px] text-foreground">{mod}K</kbd> anytime to jump anywhere.
            </p>
          )}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <div className="flex items-center gap-1" aria-hidden>
            {steps.map((s, n) => (
              <span key={s.anchor} className={cn("h-1.5 rounded-full transition-all duration-300", n === i ? "w-4 bg-brand" : "w-1.5 bg-foreground/15")} />
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {i > 0 && (
              <button type="button" onClick={back} className="pill pill-line pill-xs">
                <ArrowLeftIcon className="h-3.5 w-3.5" /> Back
              </button>
            )}
            <button ref={nextRef} type="button" onClick={next} className="pill pill-ink pill-xs">
              {last ? "Finish" : "Next"} {!last && <ArrowRightIcon className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
