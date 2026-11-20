"use client";

// Dashboard onboarding state: the product tour and the setup checklist.
// The server (GET/POST /api/v1/onboarding) stores the two flags and derives
// each checklist step from what the account has really done, so progress is
// the same on every device and can't drift.
//
// Sequencing, so only one thing asks for attention at a time:
//   cookie notice (until "Got it") → tour (auto, once, new accounts only)
//   → checklist (hidden while the tour runs).

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { api, type OnboardingState } from "@/lib/api";
import { useConsent } from "@/lib/consent";

export type { OnboardingState };

const START_EVENT = "dz:start-tour";
/** Accounts younger than this get the tour automatically (once). */
const AUTO_TOUR_DAYS = 14;
/** Older accounts that have already deployed don't need a "Get started" nudge. */
const CHECKLIST_DAYS = 30;

export function accountAgeDays(s: OnboardingState): number {
  return (Date.now() - new Date(s.created_at).getTime()) / 86_400_000;
}

/** Whether the setup checklist should appear at all for this account. */
export function checklistEligible(s: OnboardingState): boolean {
  return !s.checklist_dismissed && (accountAgeDays(s) <= CHECKLIST_DAYS || !s.deployed);
}

/** Open the product tour from anywhere (command menu, checklist). */
export function startTour() {
  window.dispatchEvent(new Event(START_EVENT));
}

interface OnboardingCtx {
  state: OnboardingState | null;
  tourOpen: boolean;
  /** Close the tour. markDone=false keeps it eligible (e.g. nothing to point at here). */
  closeTour: (markDone?: boolean) => void;
  dismissChecklist: () => void;
}

const Ctx = createContext<OnboardingCtx | null>(null);

export function useOnboarding(): OnboardingCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useOnboarding must be used inside <OnboardingProvider>");
  return c;
}

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { decided } = useConsent();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [tourOpen, setTourOpen] = useState(false);
  const autoTried = useRef(false);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Onboarding is a nicety: if the call fails, nothing shows and nothing breaks.
  const call = useCallback(async (patch?: { tour_done?: boolean; checklist_dismissed?: boolean }) => {
    if (!api.getToken()) return;
    try {
      setState(await (patch ? api.updateOnboarding(patch) : api.getOnboarding()));
    } catch {}
  }, []);

  // Checklist steps complete elsewhere (a deploy, a new database…): re-check
  // shortly after each navigation and whenever the tab regains focus.
  useEffect(() => {
    const t = setTimeout(() => call(), 400);
    return () => clearTimeout(t);
  }, [pathname, call]);
  useEffect(() => {
    const onFocus = () => call();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [call]);

  useEffect(() => {
    const open = () => setTourOpen(true);
    window.addEventListener(START_EVENT, open);
    return () => window.removeEventListener(START_EVENT, open);
  }, []);

  // Auto-start once for new accounts, after the cookie notice is dealt with.
  // The timer lives in a ref: a state refresh re-runs this effect, and a
  // cleanup there would cancel the pending start for good.
  useEffect(() => {
    if (autoTried.current || !state || state.tour_done || !decided) return;
    autoTried.current = true;
    if (accountAgeDays(state) > AUTO_TOUR_DAYS) return;
    autoTimer.current = setTimeout(() => setTourOpen(true), 700);
  }, [state, decided]);
  useEffect(() => () => { if (autoTimer.current) clearTimeout(autoTimer.current); }, []);

  const closeTour = useCallback((markDone = true) => {
    setTourOpen(false);
    if (!markDone) return;
    setState((s) => (s ? { ...s, tour_done: true } : s));
    call({ tour_done: true });
  }, [call]);

  const dismissChecklist = useCallback(() => {
    setState((s) => (s ? { ...s, checklist_dismissed: true } : s));
    call({ checklist_dismissed: true });
  }, [call]);

  return <Ctx.Provider value={{ state, tourOpen, closeTour, dismissChecklist }}>{children}</Ctx.Provider>;
}
