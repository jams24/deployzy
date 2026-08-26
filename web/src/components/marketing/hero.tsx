"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { ArrowRight, Check, GitPullRequest, Zap } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Deployzy hero — aurora field, masked grid, word-by-word blur-rise headline,
// and a 3D-tilting terminal that types a real deploy session on a loop.
// Everything is GPU-composited (transform/opacity) and reduced-motion safe.
// ─────────────────────────────────────────────────────────────────────────────

const EASE = [0.22, 1, 0.36, 1] as const;

/* ── Headline word reveal ────────────────────────────────────────────────── */
function Words({ text, delay = 0, className = "", wordClassName = "" }: { text: string; delay?: number; className?: string; wordClassName?: string }) {
  return (
    <span className={className}>
      {text.split(" ").map((w, i, arr) => (
        <span key={i} className="inline-block overflow-hidden pb-[0.08em] -mb-[0.08em] align-bottom">
          <motion.span
            className={`inline-block will-change-transform ${wordClassName}`}
            initial={{ y: "110%", opacity: 0, filter: "blur(8px)" }}
            animate={{ y: "0%", opacity: 1, filter: "blur(0px)" }}
            transition={{ duration: 0.9, delay: delay + i * 0.07, ease: EASE }}
          >
            {i < arr.length - 1 ? w + " " : w}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

/* ── Typing terminal ─────────────────────────────────────────────────────── */

type Line = { kind: "cmd" | "out"; text: string; tone?: "wait" | "ok" | "link" | "info" | "dim" };

const SCRIPT: Line[] = [
  { kind: "cmd", text: "git push origin main" },
  { kind: "out", text: "◷  webhook received · queuing build", tone: "wait" },
  { kind: "out", text: "✓  Docker image built · 6/6 layers cached", tone: "ok" },
  { kind: "out", text: "✓  Postgres attached · DATABASE_URL injected", tone: "ok" },
  { kind: "out", text: "✓  Health check /health → 200 OK", tone: "ok" },
  { kind: "out", text: "→  https://my-saas.deployzy.com", tone: "link" },
  { kind: "cmd", text: "deployzy http 3000" },
  { kind: "out", text: "✓  Tunnel live · dev.deployzy.com → localhost:3000", tone: "info" },
];

const toneCls: Record<string, string> = {
  wait: "text-amber-300/90",
  ok: "text-zinc-500",
  link: "text-emerald-300",
  info: "text-sky-300/90",
  dim: "text-zinc-600",
};

function useTypingLoop() {
  const [lineIdx, setLineIdx] = useState(0);
  const [chars, setChars] = useState(0);
  const [round, setRound] = useState(0); // bump to restart

  useEffect(() => {
    const line = SCRIPT[lineIdx];
    if (!line) {
      // Whole script done — hold, then restart.
      const t = setTimeout(() => { setLineIdx(0); setChars(0); setRound((r) => r + 1); }, 4200);
      return () => clearTimeout(t);
    }
    if (line.kind === "cmd") {
      if (chars < line.text.length) {
        const t = setTimeout(() => setChars((c) => c + 1), 34 + Math.random() * 46);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => { setLineIdx((i) => i + 1); setChars(0); }, 480);
      return () => clearTimeout(t);
    }
    // output line — appear, then advance
    const t = setTimeout(() => { setLineIdx((i) => i + 1); setChars(0); }, 330);
    return () => clearTimeout(t);
  }, [lineIdx, chars, round]);

  return { lineIdx, chars };
}

function Terminal() {
  const { lineIdx, chars } = useTypingLoop();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lineIdx, chars]);

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-[#09090b]/95 shadow-[0_24px_80px_-16px_rgba(0,0,0,0.55)] backdrop-blur">
      {/* top hairline highlight */}
      <div aria-hidden className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      {/* window chrome */}
      <div className="flex items-center gap-1.5 border-b border-white/[0.06] bg-white/[0.02] px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
        <span className="ml-3 font-mono text-[11px] text-zinc-500">~/my-saas</span>
        <span className="ml-auto flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          live
        </span>
      </div>

      <div ref={scrollRef} className="h-[300px] overflow-hidden p-5 font-mono text-[12.5px] leading-[1.95] sm:text-[13px]">
        {SCRIPT.slice(0, lineIdx + 1).map((line, i) => {
          const isCurrent = i === lineIdx;
          if (line.kind === "cmd") {
            const shown = isCurrent ? line.text.slice(0, chars) : line.text;
            return (
              <div key={`${i}-${line.text}`} className="flex items-center">
                <span className="mr-2 text-emerald-500/80">$</span>
                <span className="text-zinc-200">{shown}</span>
                {isCurrent && <span className="animate-caret ml-0.5 inline-block h-[15px] w-[7px] translate-y-[2px] bg-emerald-400/90" />}
              </div>
            );
          }
          return (
            <motion.div
              key={`${i}-${line.text}`}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35, ease: EASE }}
              className={`pl-4 ${toneCls[line.tone ?? "dim"]}`}
            >
              {line.text}
            </motion.div>
          );
        })}
        {/* idle prompt while the script holds before restarting */}
        {lineIdx >= SCRIPT.length && (
          <div className="flex items-center">
            <span className="mr-2 text-emerald-500/80">$</span>
            <span className="animate-caret ml-0.5 inline-block h-[15px] w-[7px] translate-y-[2px] bg-emerald-400/90" />
          </div>
        )}
      </div>

      {/* status bar */}
      <div className="flex items-center justify-between border-t border-white/[0.06] bg-white/[0.015] px-4 py-2 font-mono text-[10.5px] text-zinc-600">
        <span className="flex items-center gap-1.5">
          <Zap className="h-3 w-3 text-emerald-500/80" /> deploy complete · 28s
        </span>
        <span>region: fra1 · 0 cold starts</span>
      </div>
    </div>
  );
}

/* ── 3D tilt wrapper (Figma-prototype feel) ──────────────────────────────── */
function Tilt({ children }: { children: React.ReactNode }) {
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const rx = useSpring(useTransform(my, [0, 1], [5, -5]), { stiffness: 140, damping: 18 });
  const ry = useSpring(useTransform(mx, [0, 1], [-6, 6]), { stiffness: 140, damping: 18 });

  return (
    <motion.div
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 1200 }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        mx.set((e.clientX - r.left) / r.width);
        my.set((e.clientY - r.top) / r.height);
      }}
      onMouseLeave={() => { mx.set(0.5); my.set(0.5); }}
      className="relative will-change-transform"
    >
      {children}
    </motion.div>
  );
}

/* ── Floating proof chips around the terminal ────────────────────────────── */
function FloatChips() {
  return (
    <>
      {/* Entrance on the wrapper (one-shot), float loop on the child — two
          transform animations never live on the same element. */}
      <div aria-hidden className="animate-rise-in absolute -top-5 left-6 z-10 hidden md:block" style={{ animationDelay: "1.1s" }}>
        <div className="animate-float-y flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#0c0d0f]/90 px-3 py-2 shadow-xl backdrop-blur">
          <GitPullRequest className="h-3.5 w-3.5 text-violet-400" />
          <span className="font-mono text-[11px] text-zinc-400">pr-42 preview <span className="text-emerald-400">live</span></span>
        </div>
      </div>
      <div aria-hidden className="animate-rise-in absolute -bottom-5 right-6 z-10 hidden md:block" style={{ animationDelay: "1.4s" }}>
        <div className="animate-float-y flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#0c0d0f]/90 px-3 py-2 shadow-xl backdrop-blur" style={{ animationDelay: "0.7s" }}>
          <span className="pulse-ring h-2 w-2 rounded-full bg-emerald-400 text-emerald-400" />
          <span className="font-mono text-[11px] text-zinc-400">tunnel · 8ms</span>
        </div>
      </div>
    </>
  );
}

/* ── Backdrop: aurora + masked grid ──────────────────────────────────────── */
function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* aurora blobs */}
      <div className="animate-aurora-a absolute -top-32 left-[8%] h-[420px] w-[560px] rounded-full bg-emerald-500/[0.16] blur-[110px] dark:bg-emerald-500/[0.13]" />
      <div className="animate-aurora-b absolute -top-20 right-[4%] h-[380px] w-[520px] rounded-full bg-cyan-500/[0.12] blur-[110px] dark:bg-cyan-400/[0.10]" />
      <div className="animate-aurora-a absolute top-64 left-[38%] h-[300px] w-[420px] rounded-full bg-violet-500/[0.08] blur-[120px]" style={{ animationDelay: "-8s" }} />
      {/* grid with radial mask */}
      <div className="mask-radial-center absolute inset-0 text-foreground/[0.05] dark:text-white/[0.055]">
        <div className="bg-grid bg-grid-animated absolute inset-0" />
      </div>
      {/* horizon fade into page bg */}
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
}

/* ── Hero ─────────────────────────────────────────────────────────────────── */
export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border/40">
      <Backdrop />
      <div className="relative mx-auto max-w-6xl px-5 sm:px-6">
        <div className="grid items-center gap-14 py-20 sm:py-24 lg:grid-cols-[1.05fr_1fr] lg:gap-12 lg:py-32">

          {/* Copy */}
          <div>
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE }}
              className="inline-flex items-center gap-2.5 rounded-full border border-border/70 bg-background/70 py-1 pl-1.5 pr-3.5 text-[12px] text-muted-foreground shadow-sm backdrop-blur"
            >
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10.5px] font-semibold tracking-wide text-emerald-600 dark:text-emerald-400">
                NEW
              </span>
              Deploys · Databases · Tunnels · BYOC
            </motion.div>

            <h1 className="mt-6 text-[2.6rem] font-bold leading-[1.04] tracking-[-0.035em] sm:text-6xl lg:text-[4.1rem]">
              <Words text="Deploy apps." delay={0.1} />
              <br />
              <Words text="Ship faster." delay={0.32} wordClassName="text-gradient" />
            </h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.55, ease: EASE }}
              className="mt-5 max-w-[440px] text-[15px] leading-relaxed text-muted-foreground"
            >
              Connect a GitHub repo and go live in under 30 seconds. Managed
              Postgres, secure tunnels, and bring-your-own VPS — one platform
              instead of five tools.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.68, ease: EASE }}
              className="mt-8 flex flex-wrap items-center gap-3"
            >
              <Link
                href="/sign-up"
                className="btn-shine inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-[13.5px] font-semibold text-background shadow-lg shadow-black/10 transition-transform duration-300 hover:scale-[1.03] active:scale-[0.98] dark:shadow-black/40"
              >
                Start deploying <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/docs"
                className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-background/60 px-6 py-3 text-[13.5px] font-medium text-foreground backdrop-blur transition-colors hover:bg-accent"
              >
                Read docs
              </Link>
              <code className="hidden items-center gap-2 rounded-lg border border-border/60 bg-muted/60 px-3 py-2 font-mono text-[12px] text-muted-foreground sm:inline-flex">
                <span className="text-emerald-500">$</span> npm i -g deployzy
              </code>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.9, delay: 0.85 }}
              className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-muted-foreground"
            >
              {["Free tier", "No credit card", "Self-hostable", "MIT license"].map((t) => (
                <span key={t} className="flex items-center gap-1.5">
                  <Check className="h-3 w-3 shrink-0 text-emerald-500" />{t}
                </span>
              ))}
            </motion.div>
          </div>

          {/* Terminal */}
          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 1, delay: 0.45, ease: EASE }}
            className="relative"
          >
            {/* glow under terminal */}
            <div aria-hidden className="absolute -inset-8 rounded-[32px] bg-emerald-500/[0.07] blur-2xl dark:bg-emerald-400/[0.06]" />
            <Tilt>
              <Terminal />
            </Tilt>
            <FloatChips />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
