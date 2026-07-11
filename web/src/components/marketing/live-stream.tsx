"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const allRequests = [
  { time: "12:04:31", method: "POST", path: "/api/webhook", status: 200, ms: 12 },
  { time: "12:04:32", method: "GET", path: "/api/users?page=2", status: 200, ms: 8 },
  { time: "12:04:33", method: "POST", path: "/api/checkout", status: 422, ms: 45 },
  { time: "12:04:34", method: "GET", path: "/health", status: 200, ms: 1 },
  { time: "12:04:35", method: "PUT", path: "/api/settings", status: 200, ms: 23 },
  { time: "12:04:36", method: "GET", path: "/api/products", status: 200, ms: 15 },
  { time: "12:04:37", method: "POST", path: "/api/orders", status: 201, ms: 34 },
  { time: "12:04:38", method: "DELETE", path: "/api/cache", status: 200, ms: 3 },
  { time: "12:04:39", method: "GET", path: "/api/analytics", status: 200, ms: 67 },
  { time: "12:04:40", method: "POST", path: "/api/payment", status: 200, ms: 89 },
];

const methodColor: Record<string, string> = {
  GET: "text-blue-400/80",
  POST: "text-emerald-400/80",
  PUT: "text-amber-400/80",
  DELETE: "text-red-400/80",
};

export function LiveStream() {
  const [requests, setRequests] = useState(allRequests.slice(0, 6));
  const [idx, setIdx] = useState(6);

  useEffect(() => {
    const timer = setInterval(() => {
      setIdx((prev) => {
        const next = (prev + 1) % allRequests.length;
        setRequests((old) => {
          const newReq = {
            ...allRequests[next],
            time: new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          };
          return [newReq, ...old.slice(0, 5)];
        });
        return next;
      });
    }, 2500);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="rounded-lg border border-border/40 bg-[#09090b] overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/[0.04] px-4 py-2">
        <span className="text-[10px] text-zinc-600 font-mono">inspector — localhost:4040</span>
        <span className="flex items-center gap-1.5 text-[10px] text-emerald-500/70">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          live
        </span>
      </div>
      <div className="p-1">
        <AnimatePresence mode="popLayout" initial={false}>
          {requests.map((r, i) => (
            <motion.div
              key={`${r.time}-${r.path}-${i}`}
              layout
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{
                duration: 0.35,
                ease: [0.21, 0.47, 0.32, 0.98] as const,
                layout: { duration: 0.3 },
              }}
              className="flex items-center gap-3 px-3 py-2 text-[11px] font-mono rounded transition-colors hover:bg-white/[0.02]"
            >
              <span className="text-zinc-600 w-16 shrink-0">{r.time}</span>
              <span className={`font-medium w-12 shrink-0 ${methodColor[r.method] || "text-zinc-400"}`}>{r.method}</span>
              <span className={`w-7 text-center text-[10px] rounded px-1 py-0.5 shrink-0 ${r.status < 400 ? "bg-emerald-500/20 text-emerald-400/80" : "bg-red-500/20 text-red-400/80"}`}>
                {r.status}
              </span>
              <span className="text-zinc-500 flex-1 truncate">{r.path}</span>
              <span className="text-zinc-700 shrink-0">{r.ms}ms</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
