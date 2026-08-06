"use client";

import { useEffect, useRef } from "react";
import { Rocket, Database, Globe, Activity, HardDrive, Check } from "lucide-react";

// Scroll-driven "fold-up" reveal for the platform pillars. Each card starts
// folded back in 3D (rotateX, lifted, dimmed) and unfolds into place as it
// enters the viewport, staggered across the row. Distinct from the pipeline's
// fade/slide — this is a hinge/unfold. IntersectionObserver toggles a class;
// CSS does the transform. Reduced-motion safe. Content is SSR'd for SEO.

const PILLARS = [
  {
    icon: Rocket,
    iconBg: "bg-emerald-500/10", iconColor: "text-emerald-500", glow: "bg-emerald-500/15",
    title: "Deploy",
    desc: "Connect a GitHub repo. Every push builds a Docker image, runs migrations, health-checks, and serves on a subdomain.",
    bullets: [
      "Auto-deploy on push to any branch",
      "Preview URL for every pull request",
      "Framework auto-detect: Next.js, Node, Python, Docker, static",
      "Custom domains with automatic TLS",
      "Deploy from specific commits, roll back in one click",
    ],
  },
  {
    icon: Database,
    iconBg: "bg-blue-500/10", iconColor: "text-blue-500", glow: "bg-blue-500/15",
    title: "Data",
    desc: "Managed PostgreSQL you can reach from your container and from your laptop. Backups on a schedule.",
    bullets: [
      "PostgreSQL 16 per project, auto-injected as DATABASE_URL",
      "External connection URL (pgAdmin, DBeaver, psql from your laptop)",
      "Scheduled backups + one-click restore",
      "Standalone databases not tied to a project",
    ],
  },
  {
    icon: Globe,
    iconBg: "bg-violet-500/10", iconColor: "text-violet-500", glow: "bg-violet-500/15",
    title: "Tunnel",
    desc: "Expose your local machine to the internet over HTTP, TCP, or TLS. Real-time request inspector + replay.",
    bullets: [
      "HTTP tunnels with custom subdomains",
      "TCP tunnels for databases, game servers, SSH",
      "TLS passthrough (your certs, your control)",
      "Live request capture + one-click replay",
    ],
  },
  {
    icon: Activity,
    iconBg: "bg-amber-500/10", iconColor: "text-amber-500", glow: "bg-amber-500/15",
    title: "Observe",
    desc: "Cookieless website analytics, CPU/memory/network metrics, and live-streaming container logs.",
    bullets: [
      "Privacy-first analytics (no cookies, GDPR-safe)",
      "Real-time visitor counter, top pages, countries",
      "CPU / memory / network per project with sparklines",
      "Live container logs via WebSocket — stop paying for Datadog",
    ],
  },
  {
    icon: HardDrive,
    iconBg: "bg-orange-500/10", iconColor: "text-orange-500", glow: "bg-orange-500/15",
    title: "BYOC",
    desc: "Bring your own VPS. We SSH in, install Docker, and deploy projects there with no plan resource caps. The escape hatch every PaaS lacks.",
    bullets: [
      "Add any Linux VPS via SSH — we probe CPU/RAM and provision Docker",
      "Deploys go straight to your hardware — no plan memory/CPU ceiling",
      "Run managed Postgres on your own disk, your own quota",
      "Mix BYOC with platform overflow — scheduler picks lowest priority with capacity",
    ],
  },
];

const CSS = `
.dz-fold {
  opacity: 0;
  transform: rotateX(58deg) translateY(70px) scale(0.9);
  transform-origin: center top;
  transition: opacity .8s cubic-bezier(.22,1,.36,1), transform .85s cubic-bezier(.22,1,.36,1);
  will-change: transform, opacity;
}
.dz-fold.in { opacity: 1; transform: rotateX(0deg) translateY(0) scale(1); }
@media (prefers-reduced-motion: reduce) {
  .dz-fold { opacity: 1; transform: none; transition: none; }
}
`;

export function PillarsFold() {
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.15 },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" style={{ perspective: "1400px" }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {PILLARS.map((p, i) => (
        <div
          key={p.title}
          ref={(el) => { refs.current[i] = el; }}
          style={{ transitionDelay: `${(i % 3) * 90}ms` }}
          className={`dz-fold ${i === PILLARS.length - 1 && PILLARS.length % 3 === 1 ? "sm:col-span-2 lg:col-span-1 lg:col-start-2" : ""}`}
        >
          <div className="group relative h-full overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-b from-card/80 to-card/30 p-6 sm:p-7 transition-all duration-300 hover:-translate-y-1 hover:border-foreground/15 hover:shadow-xl hover:shadow-black/5 dark:hover:shadow-black/20">
            <div aria-hidden className={`pointer-events-none absolute -top-20 left-1/2 h-40 w-72 -translate-x-1/2 rounded-full ${p.glow} opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100`} />
            <div className="relative flex items-center gap-3.5">
              <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${p.iconBg} ring-1 ring-inset ring-white/10 shadow-sm`}>
                <p.icon className={`h-5 w-5 ${p.iconColor}`} />
              </div>
              <h3 className="text-[15px] font-semibold tracking-tight">{p.title}</h3>
            </div>
            <p className="relative mt-4 text-[13.5px] text-muted-foreground leading-relaxed">{p.desc}</p>
            <ul className="relative mt-5 space-y-2.5">
              {p.bullets.map((b) => (
                <li key={b} className="flex items-start gap-2.5 text-[13px] text-foreground/75">
                  <span className="mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/12">
                    <Check className="h-2.5 w-2.5 text-emerald-500" />
                  </span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}
