import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function read() {
  try {
    return !!localStorage.getItem("sm_token");
  } catch {
    return false; // storage blocked: treat as signed out
  }
}

/** Whether a dashboard session token is stored. Always false during SSR. */
export function useSignedIn() {
  return useSyncExternalStore(subscribe, read, () => false);
}
