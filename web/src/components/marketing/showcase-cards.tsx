"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowRight, GitBranch, Rocket, Server, Check } from "lucide-react";

// Sticky "card-stack" scroll (pxxl.app style): each big split card pins near the
// top and the next card slides up and stacks over it — previous cards' top edges
// peek behind, building a deck as you scroll. Inside each card, the headline
// reveals word-by-word when it first enters view. Pure CSS position:sticky for
// the stack; IntersectionObserver for the text. Reduced-motion safe, SSR'd.

const STICK_TOP = 96;   // px from top where a card pins
const PEEK = 26;        // px each earlier card peeks above the next

const CSS = `
.dz-word { display:inline-block; opacity:0; transform: translateY(0.6em) rotateX(50deg); transform-origin: bottom; transition: opacity .55s cubic-bezier(.22,1,.36,1), transform .55s cubic-bezier(.22,1,.36,1); }
.dz-sc.in .dz-word { opacity:1; transform:none; }
.dz-rise { opacity:0; transform: translateY(16px); transition: opacity .6s ease .3s, transform .6s cubic-bezier(.22,1,.36,1) .3s; }
.dz-sc.in .dz-rise { opacity:1; transform:none; }
@media (prefers-reduced-motion: reduce){
  .dz-stack-card{position:relative!important;top:auto!important;}
  .dz-word,.dz-rise{opacity:1!important;transform:none!important;transition:none!important;}
}
`;

function Words({ text }: { text: string }) {
  return (
    <>
      {text.split(" ").map((w, i) => (
        <span key={i} className="dz-word" style={{ transitionDelay: `${i * 55}ms` }}>
          {w}&nbsp;
        </span>
      ))}
    </>
  );
}

type Card = {
  eyebrow: string;
  title: string;
  desc: string;
  cta: { label: string; href: string };
  bullets: string[];
  visual: "repo" | "live" | "byoc";
  reverse?: boolean;
};

const CARDS: Card[] = [
  {
    eyebrow: "From your repo",
    title: "Ship straight from your repo.",
    desc: "Connect GitHub, push your branch, and Deployzy takes it the rest of the way — build, migrate, health-check, and serve on a real URL.",
    cta: { label: "Start deploying", href: "/sign-up" },
    bullets: ["Auto-deploy on every push", "Preview URL per pull request"],
    visual: "repo",
  },
  {
    eyebrow: "Anywhere",
    title: "Code anywhere, deploy instantly.",
    desc: "Work from any setup, push when you're ready, and let Deployzy turn your project into a live deployment in seconds — HTTPS and databases wired in.",
    cta: { label: "Read the docs", href: "/docs" },
    bullets: ["Live in ~30 seconds", "Automatic HTTPS + managed Postgres"],
    visual: "live",
    reverse: true,
  },
  {
    eyebrow: "Your hardware",
    title: "Bring your own server.",
    desc: "Outgrow the shared platform? Add any Linux VPS over SSH and deploy to it with full resources — the same one-command flow, none of the caps.",
    cta: { label: "Add a server", href: "/sign-up" },
    bullets: ["Uncapped CPU & RAM", "Move projects between servers"],
    visual: "byoc",
  },
];

function Visual({ kind }: { kind: Card["visual"] }) {
  return (
    <div className="relative h-full min-h-[280px] overflow-hidden rounded-2xl border border-white/10 bg-[#0a0b0a]">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(80%_60%_at_30%_20%,rgba(16,185,129,0.22),transparent_60%)]" />
      <div className="relative h-full p-6 font-mono text-[12.5px] leading-[1.9] text-zinc-400">
        {kind === "repo" && (
          <>
            <div className="flex items-center gap-2 text-zinc-300"><GitBranch className="h-4 w-4 text-emerald-400" /> main · pushed</div>
            <div className="mt-3 text-zinc-500">$ git push origin main</div>
            <div className="text-zinc-500">  <span className="text-emerald-400">✓</span> webhook received</div>
            <div className="text-zinc-500">  <span className="text-emerald-400">✓</span> Docker image built</div>
            <div className="text-zinc-500">  <span className="text-emerald-400">✓</span> migrations · health 200</div>
            <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-200">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> my-saas.deployzy.com
            </div>
          </>
        )}
        {kind === "live" && (
          <>
            <div className="flex items-center gap-2 text-zinc-300"><Rocket className="h-4 w-4 text-emerald-400" /> deploying…</div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-[88%] rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {["build 0:22", "TLS ✓", "DB linked", "region eu"].map((t) => (
                <div key={t} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-zinc-400">{t}</div>
              ))}
            </div>
            <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-200">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> Live · 28s
            </div>
          </>
        )}
        {kind === "byoc" && (
          <>
            <div className="flex items-center gap-2 text-zinc-300"><Server className="h-4 w-4 text-emerald-400" /> my-vps · probed</div>
            <div className="mt-3 text-zinc-500">$ deployzy servers add my-vps</div>
            <div className="text-zinc-500">  <span className="text-emerald-400">✓</span> 8 vCPU · 32 GB · Docker</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-zinc-400">platform · shared</div>
              <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-violet-200">my-vps · uncapped</div>
            </div>
            <div className="mt-3 text-zinc-500">  next deploy → <span className="text-violet-300">my-vps</span></div>
          </>
        )}
      </div>
    </div>
  );
}

function StackCard({ card, index, total }: { card: Card; index: number; total: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) el.classList.add("in"); },
      { rootMargin: "0px 0px -20% 0px", threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      className="dz-stack-card sticky"
      style={{ top: `${STICK_TOP + index * PEEK}px`, zIndex: index + 1, marginBottom: index === total - 1 ? 0 : "2.5rem" }}
    >
      <div
        ref={ref}
        className="dz-sc group relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-b from-card to-card/80 p-4 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.25)] backdrop-blur-sm sm:p-5 dark:from-[#0e1211] dark:to-[#0a0d0c]"
      >
        <div className={`grid items-stretch gap-4 sm:gap-6 lg:grid-cols-2 ${card.reverse ? "lg:[&>*:first-child]:order-2" : ""}`}>
          <Visual kind={card.visual} />
          <div className="flex flex-col justify-center px-2 py-6 sm:px-6">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-500">{card.eyebrow}</span>
            <h3 className="mt-3 text-2xl font-bold leading-[1.1] tracking-tight sm:text-[2rem]" style={{ perspective: "600px" }}>
              <Words text={card.title} />
            </h3>
            <p className="dz-rise mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">{card.desc}</p>
            <ul className="dz-rise mt-4 space-y-2">
              {card.bullets.map((b) => (
                <li key={b} className="flex items-center gap-2 text-[13px] text-foreground/75">
                  <Check className="h-3.5 w-3.5 text-emerald-500" /> {b}
                </li>
              ))}
            </ul>
            <div className="dz-rise mt-6">
              <Link href={card.cta.href} className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-[13px] font-semibold text-background transition-opacity hover:opacity-85">
                {card.cta.label} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ShowcaseCards() {
  return (
    <section aria-label="Deployzy in action" className="py-20 sm:py-28">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        {CARDS.map((c, i) => (
          <StackCard key={c.title} card={c} index={i} total={CARDS.length} />
        ))}
      </div>
    </section>
  );
}
