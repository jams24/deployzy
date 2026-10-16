"use client";

import { useEffect, useState } from "react";

// Render-purity-safe clock (react-hooks/purity forbids Date.now() during
// render, react-hooks/set-state-in-effect forbids a synchronous setState in
// the effect body — so the first read is deferred to a macrotask). Returns
// null until mounted, then the current timestamp; pass an interval to keep
// long-lived pages ticking.
export function useNow(intervalMs?: number) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const read = () => setNow(Date.now());
    const kick = setTimeout(read, 0);
    const tick = intervalMs ? setInterval(read, intervalMs) : undefined;
    return () => {
      clearTimeout(kick);
      if (tick) clearInterval(tick);
    };
  }, [intervalMs]);
  return now;
}
