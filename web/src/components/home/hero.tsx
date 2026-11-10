"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, BookOpen, Check, Copy, MousePointerClick } from "lucide-react";
import { STACK_LOGOS } from "@/lib/stack-logos";
import { cn } from "@/lib/utils";
import { useSignedIn } from "@/lib/use-signed-in";

const DeployField = dynamic(() => import("./deploy-field"), { ssr: false });

/* ── Draggable stack chips with a Figma-style selection frame ───────────── */

const CHIPS = [
  { slug: "nextdotjs", left: "7%", top: "22%", rot: -5 },
  { slug: "postgresql", left: "79%", top: "18%", rot: 4 },
  { slug: "docker", left: "10%", top: "62%", rot: 5 },
  { slug: "python", left: "80%", top: "58%", rot: -4 },
];

function Chip({ chip, i, bounds }: { chip: (typeof CHIPS)[number]; i: number; bounds: React.RefObject<HTMLElement | null> }) {
  const logo = STACK_LOGOS.find((l) => l.slug === chip.slug);
  const ref = React.useRef<HTMLButtonElement>(null);
  const [size, setSize] = React.useState<[number, number]>([0, 0]);
  const [active, setActive] = React.useState(false);
  React.useEffect(() => {
    if (ref.current) setSize([ref.current.offsetWidth, ref.current.offsetHeight]);
  }, []);
  if (!logo) return null;
  // Next.js's brand colour is black; on the ink card it needs to be white.
  const tint = logo.hex === "#000000" ? "#ffffff" : logo.hex;

  return (
    <motion.button
      ref={ref}
      type="button"
      data-no-deploy
      aria-label={`${logo.title} (drag me)`}
      drag
      dragConstraints={bounds}
      dragSnapToOrigin
      dragElastic={0.35}
      dragTransition={{ bounceStiffness: 380, bounceDamping: 22 }}
      onHoverStart={() => setActive(true)}
      onHoverEnd={() => setActive(false)}
      whileDrag={{ scale: 1.08, rotate: 0, cursor: "grabbing" }}
      initial={{ opacity: 0, scale: 0.6, rotate: chip.rot }}
      animate={{ opacity: 1, scale: 1, rotate: chip.rot, y: [0, -8, 0] }}
      transition={{
        opacity: { delay: 0.8 + i * 0.12, duration: 0.5 },
        scale: { delay: 0.8 + i * 0.12, type: "spring", stiffness: 420, damping: 30 },
        y: { duration: 5 + i, repeat: Infinity, ease: "easeInOut" },
      }}
      className="absolute z-10 hidden cursor-grab touch-none select-none lg:block"
      style={{ left: chip.left, top: chip.top }}
    >
      <span className="flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] py-2 pl-2.5 pr-3.5 text-[13.5px] font-medium text-white/85 backdrop-blur-md">
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
          <path d={logo.path} fill={tint} />
        </svg>
        {logo.title}
      </span>
      <span
        className={cn(
          "pointer-events-none absolute -inset-1.5 rounded-full border border-brand transition-opacity duration-150",
          active ? "opacity-100" : "opacity-0",
        )}
      >
        {["-left-[3px] -top-[3px]", "-right-[3px] -top-[3px]", "-left-[3px] -bottom-[3px]", "-right-[3px] -bottom-[3px]"].map((p) => (
          <span key={p} className={cn("absolute h-1.5 w-1.5 border border-brand bg-[#0b0c10]", p)} />
        ))}
        <span className="absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-brand px-1.5 py-px font-mono text-[10.5px] font-semibold text-black">
          {size[0]} × {size[1]}
        </span>
      </span>
    </motion.button>
  );
}

/* ── Install command with copy ───────────────────────────────────────────── */

function InstallCopy() {
  const [copied, setCopied] = React.useState(false);
  const cmd = "npm i -g deployzy";
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(cmd).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
      className="group inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-[#0b0c10]/80 py-1.5 pl-3.5 pr-2 font-mono text-[12.5px] text-white/70 backdrop-blur-md transition-colors hover:border-white/20 hover:text-white/80"
      aria-label={`Copy ${cmd}`}
    >
      <span className="text-brand">$</span>
      {cmd}
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.06]">
        {copied ? <Check className="h-3 w-3 text-brand" /> : <Copy className="h-3 w-3" />}
      </span>
    </button>
  );
}

/* ── Hero ────────────────────────────────────────────────────────────────── */

const FACTS = [
  { value: "~30s", label: "git push to live URL" },
  { value: "4", label: "databases: Postgres, Redis, Mongo, MySQL" },
  { value: "Any VPS", label: "bring your own server, or use ours" },
  { value: "$0", label: "to start, no card needed" },
];

export function Hero() {
  const card = React.useRef<HTMLDivElement>(null);
  const [deploys, setDeploys] = React.useState(0);
  const loggedIn = useSignedIn();

  // Count only deploys the visitor fires; ambient ones are scenery.
  const onDeploy = React.useCallback((byVisitor: boolean) => {
    if (byVisitor) setDeploys((n) => n + 1);
  }, []);

  const rise = (delay: number) => ({ style: { animationDelay: `${delay}s` } });

  return (
    <section className="px-2 pt-2 sm:px-3 sm:pt-3">
      <div
        ref={card}
        className="dark grain relative isolate overflow-hidden rounded-[22px] bg-[#0b0c10] text-white sm:rounded-[28px]"
      >
        <DeployField className="absolute inset-0 -z-10" onDeploy={onDeploy} eventRef={card} />
        {/* Readability: darken behind the copy, fade top and bottom edges. */}
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_44%_52%_at_50%_42%,rgba(11,12,16,.9)_30%,rgba(11,12,16,.55)_62%,transparent_86%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-40 bg-gradient-to-b from-[#0b0c10] to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-48 bg-gradient-to-t from-[#0b0c10] via-[#0b0c10]/60 to-transparent" />

        {CHIPS.map((chip, i) => (
          <Chip key={chip.slug} chip={chip} i={i} bounds={card} />
        ))}

        <div className="relative mx-auto flex min-h-[680px] max-w-4xl flex-col items-center px-5 pb-10 pt-20 text-center sm:min-h-[760px] sm:pb-44 sm:pt-28 lg:min-h-[820px]">
          <span
            {...rise(0)}
            className="rise inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-2.5 pr-3 text-[12.5px] text-white/70 backdrop-blur-md"
          >
            <span className="live-dot" />
            Apps, databases and tunnels in one place
          </span>

          <h1 className="mt-6 text-[clamp(2.9rem,9vw,6.75rem)] font-semibold leading-[0.95] tracking-[-0.045em] [perspective:800px]">
            <span className="block">
              {["Push", "code."].map((w, i) => (
                <span key={w} className="flip pr-[0.22em]" style={{ animationDelay: `${0.1 + i * 0.08}s` }}>
                  {w}
                </span>
              ))}
            </span>
            <span className="rise block" {...rise(0.3)}>
              It&rsquo;s <span className="accent-serif text-launch pr-2">live.</span>
            </span>
          </h1>

          <p {...rise(0.45)} className="rise mx-auto mt-6 max-w-xl text-[15.5px] leading-relaxed text-white/60 sm:text-[17.5px]">
            Deploy apps, databases and localhost tunnels from one dashboard, on our cloud or your own server. Free to
            start, live in about 30 seconds.
          </p>

          <div {...rise(0.55)} className="rise mt-9 flex w-full max-w-xs flex-col gap-2.5 sm:w-auto sm:max-w-none sm:flex-row">
            <Link href={loggedIn ? "/overview" : "/sign-up"} className="pill pill-launch group">
              {loggedIn ? "Open dashboard" : "Start deploying free"}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link href="/docs" className="pill border border-white/15 bg-white/[0.04] text-white backdrop-blur-md hover:bg-white/10">
              <BookOpen className="h-4 w-4" /> Read the docs
            </Link>
          </div>

          <div {...rise(0.65)} className="rise mt-6 flex flex-col items-center gap-3">
            <InstallCopy />
            <p className="flex items-center gap-1.5 rounded-full bg-[#0b0c10]/70 px-2.5 py-1 font-mono text-[11.5px] text-white/50" aria-live="polite">
              <MousePointerClick className="h-3.5 w-3.5" />
              {deploys === 0 ? (
                <>
                  <span className="hidden sm:inline">Click</span>
                  <span className="sm:hidden">Tap</span> the grid to ship a deploy
                </>
              ) : (
                <span className="text-brand">
                  {deploys} {deploys === 1 ? "deploy" : "deploys"} shipped. Real ones take about 30s.
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Facts bar */}
        <dl
          {...rise(0.8)}
          className="rise relative grid grid-cols-2 border-t border-white/10 bg-[#0b0c10]/70 backdrop-blur-md sm:absolute sm:inset-x-0 sm:bottom-0 sm:grid-cols-4"
        >
          {FACTS.map((f, i) => (
            <div
              key={f.label}
              className={cn(
                "flex flex-col-reverse px-5 py-4 sm:px-7 sm:py-5",
                i % 2 === 1 && "border-l border-white/10",
                i >= 2 && "border-t border-white/10 sm:border-t-0",
                i === 2 && "sm:border-l",
              )}
            >
              <dt className="mt-0.5 text-[12.5px] leading-snug text-white/45">{f.label}</dt>
              <dd className="text-[26px] font-semibold tracking-tight text-white sm:text-[30px]">{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
