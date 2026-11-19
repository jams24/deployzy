"use client";

// Cookie / storage consent — our own, no third-party CMP.
//
// Today Deployzy only uses strictly necessary storage (sign-in, security,
// preferences), which needs no consent under GDPR/ePrivacy. The notice is
// therefore informational ("Got it"). The moment an optional script is added
// (product analytics, a support chat…), register it in OPTIONAL_CATEGORIES and
// load it through <ConsentGate category="…">: the notice then asks Accept /
// Reject, nothing optional loads before a yes, and "Cookie settings" lets
// people change their mind.
//
// Bump CONSENT_VERSION whenever the categories or the cookie policy change in a
// way people should see — everyone gets the notice again.

import { useCallback, useSyncExternalStore } from "react";

export const CONSENT_VERSION = 1;

export type OptionalCategoryId = "analytics" | "support";

export interface OptionalCategory {
  id: OptionalCategoryId;
  label: string;
  description: string;
}

// Empty on purpose — see the header comment. Example entry:
// { id: "analytics", label: "Analytics", description: "Anonymous usage stats that help us improve Deployzy." },
export const OPTIONAL_CATEGORIES: OptionalCategory[] = [];

export interface ConsentRecord {
  v: number;
  /** ISO time the choice was made. */
  at: string;
  choices: Partial<Record<OptionalCategoryId, boolean>>;
}

const KEY = "dz_consent";
const CHANGE = "dz:consent";
const OPEN = "dz:cookie-settings";

function read(): ConsentRecord | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as ConsentRecord;
    return rec && rec.v === CONSENT_VERSION ? rec : null;
  } catch {
    return null;
  }
}

// useSyncExternalStore needs a stable snapshot: cache by the raw string.
let cacheRaw: string | null | undefined;
let cacheRec: ConsentRecord | null = null;
function snapshot(): ConsentRecord | null {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch {}
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    cacheRec = read();
  }
  return cacheRec;
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) cb(); };
  window.addEventListener(CHANGE, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE, cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function saveConsent(choices: ConsentRecord["choices"]) {
  const rec: ConsentRecord = { v: CONSENT_VERSION, at: new Date().toISOString(), choices };
  try { localStorage.setItem(KEY, JSON.stringify(rec)); } catch {}
  window.dispatchEvent(new Event(CHANGE));
}

/** True only after an explicit yes for that category. */
export function hasConsent(id: OptionalCategoryId): boolean {
  return !!read()?.choices[id];
}

/** Re-open the notice as a settings panel (footer / settings "Cookie settings"). */
export function openCookieSettings() {
  window.dispatchEvent(new Event(OPEN));
}

export function onOpenCookieSettings(cb: () => void) {
  window.addEventListener(OPEN, cb);
  return () => window.removeEventListener(OPEN, cb);
}

const allChoices = (value: boolean) =>
  Object.fromEntries(OPTIONAL_CATEGORIES.map((c) => [c.id, value])) as ConsentRecord["choices"];

export function useConsent() {
  // Server snapshot = "unknown" (undefined) so nothing optional renders and the
  // notice never flashes during hydration.
  const record = useSyncExternalStore<ConsentRecord | null | undefined>(subscribe, snapshot, () => undefined);
  return {
    /** undefined while hydrating; null when no choice has been made yet. */
    record,
    decided: !!record,
    acceptAll: useCallback(() => saveConsent(allChoices(true)), []),
    rejectAll: useCallback(() => saveConsent(allChoices(false)), []),
    save: saveConsent,
  };
}

/** Renders children (e.g. a <Script>) only once the visitor said yes to `category`. */
export function ConsentGate({ category, children }: { category: OptionalCategoryId; children: React.ReactNode }) {
  const { record } = useConsent();
  return record?.choices[category] ? <>{children}</> : null;
}
