"use client";

import { useSyncExternalStore } from "react";
import { API, headers } from "@/components/project/project-shared";

// One shared fetch of the signed-in user and admin flag for the whole dashboard
// shell. The sidebar, topbar and command menu all read it, so it must not be
// fetched once per component.

export interface Me {
  id: string;
  name: string;
  email: string;
  plan: string;
}

interface Session {
  me: Me | null;
  isAdmin: boolean;
}

let session: Session = { me: null, isAdmin: false };
let started = false;
const listeners = new Set<() => void>();

function set(patch: Partial<Session>) {
  session = { ...session, ...patch };
  listeners.forEach((l) => l());
}

function load() {
  if (started || typeof window === "undefined" || !localStorage.getItem("sm_token")) return;
  started = true;
  fetch(`${API}/api/v1/users/me`, { headers: headers() })
    .then((r) => (r.ok ? r.json() : null))
    .then((u) => u && set({ me: { id: u.id, name: u.name ?? "", email: u.email ?? "", plan: u.plan ?? "free" } }))
    .catch(() => {});
  fetch(`${API}/api/v1/admin/stats`, { headers: headers() })
    .then((r) => r.ok && set({ isAdmin: true }))
    .catch(() => {});
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  load();
  return () => listeners.delete(cb);
}

const SERVER: Session = { me: null, isAdmin: false };

export function useSession(): Session {
  return useSyncExternalStore(subscribe, () => session, () => SERVER);
}

export function initials(text: string): string {
  return (
    text
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "U"
  );
}

const subscribeNoop = () => () => {};
/** ⌘ on Apple platforms, Ctrl elsewhere. */
export function useModKey(): string {
  return useSyncExternalStore(
    subscribeNoop,
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl "),
    () => "⌘",
  );
}
