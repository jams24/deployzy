"use client";

import { useEffect, useRef, useState } from "react";
import { GitBranch, Boxes, Rocket, Activity, Server, Check } from "lucide-react";

// Scroll-driven "deploy pipeline" showcase: a vertical spine of lifecycle stages
// on the left, and a sticky product panel on the right that swaps to match the
// stage currently in view. The active stage is chosen by an IntersectionObserver
// (no scroll math on the main thread). Refined-minimal / emerald identity.

type Stage = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  bullets: string[];
};

const STAGES: Stage[] = [
  {
    key: "push",
    label: "Push",
    icon: GitBranch,
    title: "Connect a repo, push code",
    desc: "Link a GitHub repo and pick a branch. Every push auto-deploys; every pull request gets its own live preview URL.",
    bullets: ["Auto-deploy on push", "Per-PR preview environments", "Rollback in three clicks"],
  },
  {
    key: "build",
    label: "Build",
    icon: Boxes,
    title: "Zero-config builds",
    desc: "Deployzy detects your stack — Node, Python, Go, Docker — and builds a container. No pipeline YAML to babysit.",
    bullets: ["Framework auto-detection", "Dockerfile or buildpacks", "Managed Postgres, Redis, Mongo, MySQL attached"],
  },
  {
    key: "deploy",
    label: "Deploy",
    icon: Rocket,
    title: "Live in about 30 seconds",
    desc: "Health-checked, TLS-terminated, and served on a real URL. Databases wired in with the connection string injected for you.",
    bullets: ["Automatic HTTPS", "Health-gated cutover", "DATABASE_URL injected"],
  },
  {
    key: "observe",
    label: "Observe",
    icon: Activity,
    title: "Logs, metrics, and alerts in one tab",
    desc: "Live logs, resource metrics, request analytics, and tunnel inspection — without bolting on Grafana or Datadog.",
    bullets: ["Streaming logs", "CPU / memory / bandwidth", "Request-level analytics"],
  },
  {
    key: "scale",
    label: "Scale",
    icon: Server,
    title: "Bring your own VPS, uncapped",
    desc: "Outgrow the shared platform? Add your own server and deploy to it with full resources — same one-command flow.",
    bullets: ["BYOC in one command", "Full CPU & RAM of your box", "Move projects between servers"],
  },
];

export function DeployPipeline() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        // Pick the entry closest to the viewport centre that's intersecting.
        let best = -1;
        let bestDist = Infinity;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const idx = Number((e.target as HTMLElement).dataset.idx);
          const rect = e.boundingClientRect;
          const dist = Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2);
          if (dist < bestDist) { bestDist = dist; best = idx; }
        }
        if (best >= 0) setActive(best);
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <section aria-label="How Deployzy works" className="border-y border-border/40 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">How it works</p>
          <h2 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight">
            From <span className="font-mono text-emerald-500">git push</span> to global, in one flow
          </h2>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
            One platform for the whole lifecycle — push, build, deploy, observe, and scale — instead of five tools stitched together.
          </p>
        </div>

        <div className="mt-14 grid gap-10 lg:grid-cols-2 lg:gap-16">
          {/* Left: the spine */}
          <ol className="relative">
            {/* vertical track */}
            <span aria-hidden className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />
            {STAGES.map((s, i) => {
              const on = i === active;
              return (
                <li
                  key={s.key}
                  data-idx={i}
                  ref={(el) => { refs.current[i] = el; }}
                  className="relative min-h-[46vh] pl-12 pb-4 flex flex-col justify-center"
                >
                  {/* node */}
                  <span
                    aria-hidden
                    className={`absolute left-0 top-[calc(50%-16px)] flex h-8 w-8 items-center justify-center rounded-full border transition-all duration-300 ${
                      on
                        ? "border-emerald-500 bg-emerald-500 text-white scale-110 shadow-[0_0_0_4px_rgba(16,185,129,0.15)]"
                        : "border-border bg-background text-muted-foreground"
                    }`}
                  >
                    <s.icon className="h-4 w-4" />
                  </span>
                  <div className={`transition-all duration-300 ${on ? "opacity-100" : "opacity-45"}`}>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-500">{s.label}</span>
                    <h3 className="mt-1 text-xl font-semibold tracking-tight">{s.title}</h3>
                    <p className="mt-2 max-w-md text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
                    <ul className="mt-4 space-y-1.5">
                      {s.bullets.map((b) => (
                        <li key={b} className="flex items-center gap-2 text-[13px] text-foreground/80">
                          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> {b}
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              );
            })}
          </ol>

          {/* Right: sticky product panel that swaps per active stage */}
          <div className="hidden lg:block">
            <div className="sticky top-24">
              <div className="relative h-[420px] w-full overflow-hidden rounded-2xl border border-border bg-[#0a0a0b] shadow-2xl shadow-black/20">
                {/* window chrome */}
                <div className="flex items-center gap-1.5 border-b border-white/[0.06] bg-[#101012] px-4 py-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
                  <span className="ml-3 font-mono text-[11px] text-zinc-500">deployzy · {STAGES[active].key}</span>
                </div>
                <div className="relative h-[calc(420px-45px)]">
                  {STAGES.map((s, i) => (
                    <div
                      key={s.key}
                      className={`absolute inset-0 p-5 transition-all duration-500 ${
                        i === active ? "opacity-100 translate-y-0" : "pointer-events-none opacity-0 translate-y-2"
                      }`}
                    >
                      <StagePanel stage={s.key} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Per-stage product visuals (lightweight, styled — no images) ──────────────
function StagePanel({ stage }: { stage: string }) {
  const mono = "font-mono text-[12.5px] leading-[1.85]";
  if (stage === "push") {
    return (
      <div className={mono}>
        <div className="text-zinc-500">$ git push origin main</div>
        <div className="mt-1 text-zinc-600">  <span className="text-amber-400">◷</span> Deployzy: webhook received</div>
        <div className="text-zinc-600">  <span className="text-emerald-400">✓</span> Repo linked · branch <span className="text-zinc-300">main</span></div>
        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <div className="flex items-center gap-2 text-zinc-300"><GitBranch className="h-3.5 w-3.5 text-violet-400" /> feat/checkout · PR #42</div>
          <div className="mt-1.5 text-[11px] text-zinc-500">Preview → <span className="text-emerald-300">pr-42.deployzy.com</span></div>
        </div>
      </div>
    );
  }
  if (stage === "build") {
    return (
      <div className={mono}>
        <div className="text-zinc-500">Detected: <span className="text-emerald-300">Node.js</span> · npm</div>
        <div className="mt-1 text-zinc-600">  <span className="text-emerald-400">✓</span> Building Docker image…</div>
        <div className="text-zinc-600">  <span className="text-emerald-400">✓</span> Layers cached · 6/6</div>
        <div className="text-zinc-600">  <span className="text-emerald-400">✓</span> Postgres attached</div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-[82%] rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300" />
        </div>
        <div className="mt-1.5 text-[11px] text-zinc-500">Build 0:24 · 82%</div>
      </div>
    );
  }
  if (stage === "deploy") {
    return (
      <div className={mono}>
        <div className="text-zinc-600">  <span className="text-emerald-400">✓</span> Health check /health <span className="text-emerald-300">200 OK</span></div>
        <div className="text-zinc-600">  <span className="text-emerald-400">✓</span> TLS provisioned · HTTPS</div>
        <div className="text-zinc-600">  <span className="text-emerald-400">✓</span> DATABASE_URL injected</div>
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          <span className="text-emerald-200">https://my-saas.deployzy.com</span>
        </div>
        <div className="mt-2 text-[11px] text-zinc-500">Live · deployed in 28s</div>
      </div>
    );
  }
  if (stage === "observe") {
    return (
      <div>
        <div className="flex items-center justify-between text-[11px] text-zinc-400">
          <span>CPU · last 30m</span><span className="text-emerald-300">0.42 vCPU</span>
        </div>
        <svg viewBox="0 0 300 90" className="mt-2 w-full" preserveAspectRatio="none">
          <polyline fill="none" stroke="#34d399" strokeWidth="2"
            points="0,70 30,60 60,64 90,45 120,52 150,30 180,38 210,22 240,28 270,16 300,20" />
          <polyline fill="none" stroke="#60a5fa" strokeWidth="1.5" opacity="0.7"
            points="0,80 30,76 60,78 90,70 120,74 150,66 180,70 210,62 240,66 270,58 300,60" />
        </svg>
        <div className="mt-3 space-y-1 font-mono text-[11.5px] text-zinc-500">
          <div><span className="text-zinc-600">12:04:31</span> GET /api/orders <span className="text-emerald-400">200</span> 24ms</div>
          <div><span className="text-zinc-600">12:04:31</span> GET /health <span className="text-emerald-400">200</span> 3ms</div>
          <div><span className="text-zinc-600">12:04:30</span> POST /webhook <span className="text-emerald-400">200</span> 88ms</div>
        </div>
      </div>
    );
  }
  // scale
  return (
    <div className={mono}>
      <div className="text-zinc-500">$ deployzy servers add my-vps --host 5.9.x.x</div>
      <div className="mt-1 text-zinc-600">  <span className="text-emerald-400">✓</span> Probed: <span className="text-zinc-300">8 vCPU · 32 GB</span> · Docker</div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <div className="text-[11px] text-zinc-500">Platform</div>
          <div className="mt-0.5 text-zinc-300">shared · fair-share</div>
        </div>
        <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 p-3">
          <div className="text-[11px] text-violet-300/80">my-vps</div>
          <div className="mt-0.5 text-violet-200">uncapped</div>
        </div>
      </div>
      <div className="mt-2 text-[11px] text-zinc-500">Next deploy → <span className="text-violet-300">my-vps</span></div>
    </div>
  );
}
