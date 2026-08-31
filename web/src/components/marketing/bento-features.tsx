"use client";

import { useCallback } from "react";
import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import {
  GitBranch, Database, Globe, BarChart3, GitPullRequest, Server,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Bento feature grid — each cell carries a hand-built animated SVG illustration
// (pure CSS keyframes, no JS on the main thread) and a cursor spotlight hover.
// ─────────────────────────────────────────────────────────────────────────────

const CSS = `
@keyframes dz-blink { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
@keyframes dz-draw { from { stroke-dashoffset: 320; } to { stroke-dashoffset: 0; } }
@keyframes dz-packet { 0% { offset-distance: 0%; opacity: 0; } 8% { opacity: 1; } 92% { opacity: 1; } 100% { offset-distance: 100%; opacity: 0; } }
@keyframes dz-swap-up { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
.dz-blink { animation: dz-blink 2.2s ease-in-out infinite; }
.dz-packet { opacity: 0; offset-rotate: 0deg; }
@supports (offset-path: path("M0 0")) {
  .dz-packet { animation: dz-packet 3.2s linear infinite; }
}
.dz-swap-up { animation: dz-swap-up 5s ease-in-out infinite; }
.dz-draw { stroke-dasharray: 320; animation: dz-draw 3.4s cubic-bezier(0.22,1,0.36,1) infinite alternate; }
@media (prefers-reduced-motion: reduce) {
  .dz-blink, .dz-packet, .dz-swap-up, .dz-draw { animation: none; }
}
`;

/* Cursor spotlight — sets --mx/--my used by .spotlight::before in globals.css */
function useSpotlight() {
  return useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, []);
}

function Cell({
  icon: Icon, title, desc, visual, className = "", delay = 0,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  visual: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const onMove = useSpotlight();
  return (
    <ScrollReveal delay={delay} className={className}>
      <div
        onMouseMove={onMove}
        className="spotlight group flex h-full flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/60 p-6 transition-colors duration-300 hover:border-foreground/20 dark:bg-[#0c0d0f]/80"
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground transition-colors duration-300 group-hover:border-emerald-500/40 group-hover:text-emerald-500">
            <Icon className="h-4 w-4" />
          </span>
          <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
        </div>
        <p className="mt-2.5 max-w-md text-[13px] leading-relaxed text-muted-foreground">{desc}</p>
        <div className="relative mt-auto pt-6">{visual}</div>
      </div>
    </ScrollReveal>
  );
}

/* ── SVG illustrations ───────────────────────────────────────────────────── */

// Git push → build → merge flow
function GitGraphVisual() {
  return (
    <svg viewBox="0 0 420 150" className="w-full" aria-hidden>
      <defs>
        <linearGradient id="bf-merge" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      {/* main branch */}
      <path d="M14 116 H406" fill="none" className="stroke-zinc-400/25 dark:stroke-zinc-600/40" strokeWidth="1.5" />
      {/* feature branch */}
      <path d="M74 116 C 110 116, 110 52, 150 52 H 260 C 300 52, 300 116, 336 116"
        fill="none" stroke="url(#bf-merge)" strokeWidth="1.5" />
      {/* flow on feature branch */}
      <path d="M74 116 C 110 116, 110 52, 150 52 H 260 C 300 52, 300 116, 336 116"
        fill="none" className="beam stroke-emerald-400" strokeWidth="1.5" strokeLinecap="round" />
      {/* commits */}
      {[[38, 116], [74, 116]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="4.5" className="fill-background stroke-zinc-400/60 dark:fill-[#0c0d0f] dark:stroke-zinc-500" strokeWidth="1.5" />
      ))}
      {[[186, 52], [238, 52]].map(([x, y], i) => (
        <circle key={`f${i}`} cx={x} cy={y} r="4.5" className="dz-blink fill-background stroke-emerald-400 dark:fill-[#0c0d0f]" strokeWidth="1.5" style={{ animationDelay: `${i * 0.5}s` }} />
      ))}
      {/* merge node */}
      <circle cx="336" cy="116" r="6" className="fill-emerald-500/20 stroke-emerald-400" strokeWidth="1.5" />
      <circle cx="336" cy="116" r="2.4" className="fill-emerald-400" />
      {/* shipped */}
      <circle cx="382" cy="116" r="4.5" className="dz-blink fill-emerald-400" style={{ animationDelay: "0.9s" }} />
      {/* labels */}
      <text x="150" y="38" className="fill-zinc-500 font-mono" fontSize="10">feat/checkout</text>
      <text x="316" y="140" className="fill-emerald-500 font-mono" fontSize="10">merged → live</text>
    </svg>
  );
}

// Database with orbiting engine dots
function DatabaseVisual() {
  return (
    <svg viewBox="0 0 200 130" className="mx-auto w-full max-w-[220px]" aria-hidden>
      <g transform="translate(100 62)">
        {/* orbit rings */}
        <ellipse rx="82" ry="30" fill="none" className="stroke-zinc-400/20 dark:stroke-zinc-600/30" strokeWidth="1" />
        <ellipse rx="60" ry="46" fill="none" className="stroke-zinc-400/15 dark:stroke-zinc-600/25" strokeWidth="1" transform="rotate(55)" />
        {/* orbiting dots */}
        <g className="animate-orbit" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
          <circle cx="82" cy="0" r="4" fill="#4169E1" />
        </g>
        <g className="animate-orbit-slow" style={{ transformBox: "fill-box", transformOrigin: "center", animationDirection: "reverse" }}>
          <circle cx="0" cy="46" r="4" fill="#FF4438" transform="rotate(55)" />
        </g>
        <g className="animate-orbit" style={{ transformBox: "fill-box", transformOrigin: "center", animationDuration: "32s" }}>
          <circle cx="-82" cy="0" r="4" fill="#47A248" />
        </g>
        {/* cylinder */}
        <g>
          <ellipse cx="0" cy="-18" rx="26" ry="9" className="fill-emerald-500/15 stroke-emerald-400/70" strokeWidth="1.4" />
          <path d="M-26 -18 V 18 A 26 9 0 0 0 26 18 V -18" fill="none" className="stroke-emerald-400/70" strokeWidth="1.4" />
          <path d="M-26 0 A 26 9 0 0 0 26 0" fill="none" className="stroke-emerald-400/40" strokeWidth="1.2" />
          <ellipse cx="0" cy="-18" rx="26" ry="9" className="fill-emerald-400/10" />
        </g>
      </g>
      <text x="100" y="122" textAnchor="middle" className="fill-zinc-500 font-mono" fontSize="9.5">postgres · redis · mongo · mysql</text>
    </svg>
  );
}

// Globe → tunnel beam → laptop
function TunnelVisual() {
  return (
    <svg viewBox="0 0 200 110" className="mx-auto w-full max-w-[220px]" aria-hidden>
      <path id="bf-tunnel" d="M46 62 C 80 20, 120 20, 154 62" fill="none" className="stroke-zinc-400/20 dark:stroke-zinc-600/30" strokeWidth="1.4" />
      <path d="M46 62 C 80 20, 120 20, 154 62" fill="none" className="beam stroke-sky-400/80" strokeWidth="1.4" strokeLinecap="round" />
      {/* packet riding the path (CSS offset-path) */}
      <circle r="3.2" className="dz-packet fill-sky-300" style={{ offsetPath: "path('M46 62 C 80 20, 120 20, 154 62')" }} />
      {/* globe */}
      <g transform="translate(34 66)" className="stroke-zinc-400/70 dark:stroke-zinc-500" fill="none" strokeWidth="1.4">
        <circle r="13" />
        <ellipse rx="6" ry="13" />
        <path d="M-13 0 H13 M-11.5 -6.5 H11.5 M-11.5 6.5 H11.5" strokeWidth="1" />
      </g>
      {/* laptop */}
      <g transform="translate(154 66)" className="stroke-zinc-400/70 dark:stroke-zinc-500" fill="none" strokeWidth="1.4">
        <rect x="-11" y="-11" width="22" height="15" rx="2" />
        <path d="M-15 8 H15" strokeLinecap="round" />
      </g>
      <circle cx="46" cy="62" r="3.5" className="dz-blink fill-emerald-400" />
      <circle cx="154" cy="62" r="3.5" className="dz-blink fill-emerald-400" style={{ animationDelay: "0.7s" }} />
      <text x="100" y="102" textAnchor="middle" className="fill-zinc-500 font-mono" fontSize="9.5">dev.deployzy.com → localhost:3000</text>
    </svg>
  );
}

// Live metrics sparkline
function MetricsVisual() {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
        <span>cpu · 30m</span>
        <span className="flex items-center gap-1.5 text-emerald-500">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          0.42 vCPU
        </span>
      </div>
      <svg viewBox="0 0 220 70" className="w-full" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="bf-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* gridlines */}
        {[16, 34, 52].map((y) => (
          <line key={y} x1="0" y1={y} x2="220" y2={y} className="stroke-zinc-400/10 dark:stroke-zinc-600/20" strokeWidth="1" strokeDasharray="3 5" />
        ))}
        <path d="M0 56 L22 48 L44 52 L66 36 L88 42 L110 26 L132 33 L154 18 L176 24 L198 12 L220 16 L220 70 L0 70 Z" fill="url(#bf-area)" />
        <path d="M0 56 L22 48 L44 52 L66 36 L88 42 L110 26 L132 33 L154 18 L176 24 L198 12 L220 16"
          fill="none" className="dz-draw stroke-emerald-400" strokeWidth="2" strokeLinecap="round" />
        <circle cx="220" cy="16" r="3.4" className="dz-blink fill-emerald-400" />
      </svg>
    </div>
  );
}

// PR preview environments
function PreviewVisual() {
  return (
    <div className="relative mx-auto w-full max-w-[240px]">
      <div className="rounded-lg border border-border/70 bg-background/80 p-3 dark:bg-white/[0.03]">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-400/50" />
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-400/50" />
          <span className="ml-2 font-mono text-[9.5px] text-muted-foreground">my-saas.deployzy.com</span>
        </div>
        <div className="mt-2 space-y-1.5">
          <div className="h-1.5 w-3/4 rounded bg-zinc-400/20 dark:bg-zinc-600/30" />
          <div className="h-1.5 w-1/2 rounded bg-zinc-400/20 dark:bg-zinc-600/30" />
        </div>
      </div>
      <div className="dz-swap-up absolute -bottom-4 -right-2 w-[78%] rounded-lg border border-violet-500/30 bg-background p-3 shadow-lg shadow-black/10 dark:bg-[#101014] dark:shadow-black/40">
        <div className="flex items-center gap-1.5">
          <GitPullRequest className="h-3 w-3 text-violet-400" />
          <span className="font-mono text-[9.5px] text-violet-300/90 dark:text-violet-300">pr-42.deployzy.com</span>
          <span className="ml-auto flex items-center gap-1 text-[8.5px] font-medium text-emerald-500">
            <span className="h-1 w-1 rounded-full bg-emerald-400" /> live
          </span>
        </div>
        <div className="mt-2 space-y-1.5">
          <div className="h-1.5 w-2/3 rounded bg-violet-400/20" />
          <div className="h-1.5 w-1/3 rounded bg-violet-400/20" />
        </div>
      </div>
    </div>
  );
}

// BYOC server rack
function RackVisual() {
  return (
    <svg viewBox="0 0 420 110" className="w-full" aria-hidden>
      {/* link platform → own vps */}
      <path d="M112 55 C 170 55, 220 55, 268 55" fill="none" className="stroke-zinc-400/20 dark:stroke-zinc-600/30" strokeWidth="1.4" />
      <path d="M112 55 C 170 55, 220 55, 268 55" fill="none" className="beam stroke-violet-400/80" strokeWidth="1.4" strokeLinecap="round" />
      {/* platform node */}
      <g transform="translate(24 30)">
        <rect width="88" height="50" rx="9" className="fill-emerald-500/10 stroke-emerald-400/50" strokeWidth="1.3" />
        <text x="44" y="24" textAnchor="middle" className="fill-emerald-500 font-mono" fontSize="10">deployzy</text>
        <text x="44" y="38" textAnchor="middle" className="fill-zinc-500 font-mono" fontSize="8.5">shared platform</text>
      </g>
      {/* vps rack */}
      <g transform="translate(268 14)">
        {[0, 1, 2].map((i) => (
          <g key={i} transform={`translate(0 ${i * 28})`}>
            <rect width="128" height="22" rx="5" className="fill-background stroke-zinc-400/30 dark:fill-white/[0.03] dark:stroke-zinc-600/40" strokeWidth="1.2" />
            <circle cx="12" cy="11" r="3" className="dz-blink fill-emerald-400" style={{ animationDelay: `${i * 0.45}s` }} />
            <rect x="22" y="7" width="46" height="8" rx="2" className="fill-zinc-400/15 dark:fill-zinc-600/25" />
            <rect x="76" y="7" width="18" height="8" rx="2" className="fill-zinc-400/15 dark:fill-zinc-600/25" />
            <text x="104" y="14" className="fill-zinc-500 font-mono" fontSize="8">{["8 vCPU", "32 GB", "nvme"][i]}</text>
          </g>
        ))}
      </g>
      <text x="190" y="30" textAnchor="middle" className="fill-violet-400 font-mono" fontSize="9">same CLI →</text>
      <text x="332" y="105" textAnchor="middle" className="fill-zinc-500 font-mono" fontSize="9.5">my-vps · uncapped resources</text>
    </svg>
  );
}

/* ── Section ─────────────────────────────────────────────────────────────── */
export function BentoFeatures() {
  return (
    <section id="features" aria-label="Platform features" className="scroll-mt-20 border-b border-border/40 py-20 sm:py-28">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <ScrollReveal>
          <div className="mx-auto max-w-xl text-center">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">The platform</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-4xl">
              Everything after <span className="font-mono text-emerald-500">git push</span>
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Builds, databases, previews, tunnels, metrics, and your own servers —
              composed into one workflow instead of five dashboards.
            </p>
          </div>
        </ScrollReveal>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <Cell
            icon={GitBranch}
            title="Push to deploy"
            desc="Connect GitHub, pick a branch. Every push builds, runs migrations, health-checks, and cuts over automatically."
            visual={<GitGraphVisual />}
            className="sm:col-span-2 lg:col-span-4"
            delay={0}
          />
          <Cell
            icon={Database}
            title="Managed databases"
            desc="Postgres, Redis, Mongo & MySQL provisioned beside your app — connection string injected at deploy time."
            visual={<DatabaseVisual />}
            className="lg:col-span-2"
            delay={90}
          />
          <Cell
            icon={BarChart3}
            title="Metrics & live logs"
            desc="CPU, memory, bandwidth, and streaming logs in the same tab — no Grafana or Datadog bolt-on."
            visual={<MetricsVisual />}
            className="lg:col-span-2"
            delay={0}
          />
          <Cell
            icon={Globe}
            title="Instant tunnels"
            desc="HTTP, TCP, or TLS from localhost to a public URL, with request-level inspection and one-click replay."
            visual={<TunnelVisual />}
            className="lg:col-span-2"
            delay={90}
          />
          <Cell
            icon={GitPullRequest}
            title="PR preview environments"
            desc="Every pull request spins up a real running container with its own URL — torn down on merge."
            visual={<PreviewVisual />}
            className="lg:col-span-2"
            delay={180}
          />
          <Cell
            icon={Server}
            title="Bring your own VPS"
            desc="Outgrow the shared tier? Point Deployzy at any Linux box over SSH — uncapped CPU and RAM, same one-command flow."
            visual={<RackVisual />}
            className="sm:col-span-2 lg:col-span-6"
            delay={0}
          />
        </div>
      </div>
    </section>
  );
}
