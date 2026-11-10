"use client";

import * as React from "react";
import { useInView, useReducedMotion } from "framer-motion";
import { Check, Globe2, Loader2, Lock, Plus, Server } from "lucide-react";
import { STACK_LOGOS } from "@/lib/stack-logos";
import { cn } from "@/lib/utils";

/* ── Shared ──────────────────────────────────────────────────────────────── */

/** Runs `tick` every `ms` while the element is on screen (and motion is on). */
function useTicker(ref: React.RefObject<HTMLElement | null>, ms: number, tick: () => void) {
  const inView = useInView(ref, { margin: "-10% 0px" });
  const reduce = useReducedMotion();
  const cb = React.useRef(tick);
  React.useLayoutEffect(() => {
    cb.current = tick;
  });
  React.useEffect(() => {
    if (!inView || reduce) return;
    const id = setInterval(() => cb.current(), ms);
    return () => clearInterval(id);
  }, [inView, reduce, ms]);
  return { inView, reduce };
}

function Card({
  className,
  eyebrow,
  title,
  body,
  children,
}: {
  className?: string;
  eyebrow: string;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
      className={cn("panel spotlight reveal-up flex flex-col overflow-hidden", className)}
    >
      <div className="relative flex-1 p-3 sm:p-4">{children}</div>
      <div className="px-5 pb-5 pt-1 sm:px-6 sm:pb-6">
        <p className="eyebrow">{eyebrow}</p>
        <h3 className="mt-2 text-[19px] font-semibold tracking-[-0.02em]">{title}</h3>
        <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

/** Dark "screen" used for terminals and request logs in both themes. */
function Screen({ className, children, ref }: { className?: string; children: React.ReactNode; ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cn("relative h-full overflow-hidden rounded-xl border border-white/[0.06] bg-[#0b0c10] font-mono text-[12.5px] text-white/80", className)}>
      {children}
    </div>
  );
}

/* ── A. Push to deploy ───────────────────────────────────────────────────── */

const BUILD = [
  { t: "$ git push origin main", tone: "cmd" },
  { t: "Detected Next.js 15 · Node 20", tone: "dim", at: "0.4s" },
  { t: "Installing dependencies", tone: "dim", at: "4.1s" },
  { t: "Building production bundle", tone: "dim", at: "17.8s" },
  { t: "Starting container · health check passed", tone: "dim", at: "1.6s" },
  { t: "Live at https://shop.deployzy.app", tone: "ok", at: "24s" },
] as const;

function DeployDemo() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [step, setStep] = React.useState(0);
  const { reduce } = useTicker(ref, 900, () => setStep((s) => (s >= BUILD.length + 3 ? 0 : s + 1)));
  const shown = reduce ? BUILD.length : Math.min(step, BUILD.length);
  const done = shown === BUILD.length;

  return (
    <Screen ref={ref} className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
        <span className="ml-2 truncate text-[11.5px] text-white/40">shop · production · main@a1f3c9e</span>
        <span
          className={cn(
            "ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
            done ? "bg-brand/15 text-brand" : "bg-amber-400/10 text-amber-300",
          )}
        >
          {done ? <span className="live-dot !h-1.5 !w-1.5" /> : <Loader2 className="h-3 w-3 animate-spin" />}
          {done ? "Live" : "Building"}
        </span>
      </div>
      <div className="h-0.5 bg-white/[0.04]">
        <div
          className="h-full bg-gradient-to-r from-brand to-brand-cyan transition-[width] duration-700 ease-out"
          style={{ width: `${(shown / BUILD.length) * 100}%` }}
        />
      </div>
      <div className="space-y-2 px-4 py-4 sm:text-[13px]">
        {BUILD.map((l, i) => (
          <div
            key={l.t}
            className={cn(
              "flex items-start gap-3 transition-all duration-500",
              i < shown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
            )}
          >
            <span className={cn("shrink-0", l.tone === "ok" ? "text-brand" : l.tone === "cmd" ? "text-brand-cyan" : "text-white/25")}>
              {l.tone === "ok" ? "✓" : l.tone === "cmd" ? "›" : "→"}
            </span>
            <span className={cn("min-w-0 flex-1 break-all", l.tone === "ok" ? "text-brand" : l.tone === "cmd" ? "text-white" : "text-white/65")}>
              {l.t}
            </span>
            {"at" in l && <span className="shrink-0 tabular-nums text-white/30">{l.at}</span>}
          </div>
        ))}
      </div>

      {/* The deployed app: a wireframe while building, lit up once live. */}
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
        <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-white/[0.08]">
          <div className="flex items-center gap-2 border-b border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-[11px]">
            <Lock className="h-3 w-3 text-white/35" />
            <span className="truncate text-white/55">shop.deployzy.app</span>
            <span className={cn("ml-auto tabular-nums transition-colors duration-500", done ? "text-brand" : "text-white/25")}>
              {done ? "200 OK" : "pending"}
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-3 p-3.5">
            <div className="grid grid-cols-[1.4fr_1fr] gap-3">
              <div className="space-y-2">
                <div className={cn("h-2.5 w-3/4 rounded-full transition-colors duration-700", done ? "bg-white/75" : "bg-white/10")} />
                <div className="h-2 w-full rounded-full bg-white/10" />
                <div className="h-2 w-5/6 rounded-full bg-white/10" />
                <div className={cn("!mt-3.5 h-5 w-20 rounded-full transition-colors duration-700", done ? "bg-brand" : "bg-white/10")} />
              </div>
              <div
                className={cn(
                  "rounded-md bg-gradient-to-br transition-opacity duration-700",
                  done ? "from-brand/45 to-brand-cyan/25 opacity-100" : "from-white/[0.07] to-white/[0.03] opacity-60",
                )}
              />
            </div>
            <div className="mt-auto grid grid-cols-3 gap-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="space-y-1.5 rounded-md border border-white/[0.05] p-2"
                >
                  <div
                    className={cn("h-8 rounded transition-colors duration-700", done ? "bg-white/[0.09]" : "bg-white/[0.04]")}
                    style={{ transitionDelay: done ? `${150 + i * 120}ms` : "0ms" }}
                  />
                  <div className="h-1.5 w-2/3 rounded-full bg-white/10" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Screen>
  );
}

/* ── B. Tunnels ──────────────────────────────────────────────────────────── */

const REQS = [
  ["POST", "/webhooks/stripe", 200, 38],
  ["GET", "/api/users?page=2", 200, 12],
  ["GET", "/dashboard", 304, 6],
  ["POST", "/api/login", 401, 21],
  ["GET", "/images/hero.webp", 200, 9],
  ["PUT", "/api/cart/42", 200, 27],
  ["GET", "/health", 200, 2],
] as const;

function TunnelDemo() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [n, setN] = React.useState(4);
  useTicker(ref, 1300, () => setN((x) => x + 1));
  const rows = Array.from({ length: 4 }, (_, i) => ({ id: n - i, r: REQS[(n - i) % REQS.length] }));

  return (
    <Screen ref={ref}>
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3.5 py-2.5 text-[11.5px]">
        <span className="live-dot !h-1.5 !w-1.5" />
        <span className="truncate text-white/70">jade-fox.deployzy.com</span>
        <span className="text-white/25">→</span>
        <span className="text-white/45">localhost:3000</span>
      </div>
      <div className="divide-y divide-white/[0.04]">
        {rows.map(({ id, r }, i) => (
          <div
            key={id}
            className={cn("flex items-center gap-3 px-3.5 py-2 text-[12px]", i === 0 && "animate-[dz-rise_.5s_cubic-bezier(.16,1,.3,1)_both]")}
          >
            <span className={cn("w-10 shrink-0 font-semibold", r[0] === "GET" ? "text-brand-cyan" : r[0] === "POST" ? "text-brand" : "text-amber-300")}>
              {r[0]}
            </span>
            <span className="min-w-0 flex-1 truncate text-white/70">{r[1]}</span>
            <span className={cn("shrink-0 tabular-nums", r[2] >= 400 ? "text-red-400" : "text-white/50")}>{r[2]}</span>
            <span className="w-10 shrink-0 text-right tabular-nums text-white/30">{r[3]}ms</span>
          </div>
        ))}
      </div>
    </Screen>
  );
}

/* ── C. Databases ────────────────────────────────────────────────────────── */

const ENGINES = [
  { slug: "postgresql", url: "postgresql://app:••••••@database.deployzy.com:21437/app" },
  { slug: "redis", url: "redis://default:••••••@database.deployzy.com:23109" },
  { slug: "mongodb", url: "mongodb://app:••••••@database.deployzy.com:24876/app" },
  { slug: "mysql", url: "mysql://app:••••••@database.deployzy.com:22654/app" },
];

function DatabaseDemo() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [tick, setTick] = React.useState(0);
  const { reduce } = useTicker(ref, 1100, () => setTick((t) => t + 1));
  const sel = Math.floor(tick / 3) % ENGINES.length;
  const ready = reduce || tick % 3 !== 0;
  const engine = ENGINES[sel];

  return (
    <div ref={ref} className="flex h-full flex-col justify-between gap-3 rounded-xl border bg-muted/40 p-3">
      <div className="grid grid-cols-4 gap-2">
        {ENGINES.map((e, i) => {
          const logo = STACK_LOGOS.find((l) => l.slug === e.slug)!;
          return (
            <button
              key={e.slug}
              type="button"
              onClick={() => setTick(i * 3 + 1)}
              aria-label={logo.title}
              className={cn(
                "flex aspect-square items-center justify-center rounded-lg border bg-card transition-all duration-300",
                i === sel ? "scale-[1.04] border-brand/60 ring-3 ring-brand/15" : "opacity-60 hover:opacity-100",
              )}
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
                <path d={logo.path} fill={logo.hex} />
              </svg>
            </button>
          );
        })}
      </div>
      <div className="rounded-lg border bg-card px-3 py-2.5">
        <div className="flex items-center gap-2 text-[12.5px]">
          {ready ? <Check className="h-3.5 w-3.5 text-brand" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <span className="font-medium">{ready ? "Ready" : "Provisioning"}</span>
          <span className="text-muted-foreground">{ready ? "· 3s" : "…"}</span>
        </div>
        <p className={cn("mt-1.5 truncate font-mono text-[11.5px] text-muted-foreground transition-opacity", ready ? "opacity-100" : "opacity-30")}>
          {engine.url}
        </p>
      </div>
    </div>
  );
}

/* ── D. Domains ──────────────────────────────────────────────────────────── */

const DOMAIN = "shop.acme.com";
const DOMAIN_STEPS = ["CNAME record verified", "SSL certificate issued", "Serving over HTTPS"];

function DomainDemo() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [t, setT] = React.useState(0);
  const { reduce } = useTicker(ref, 160, () => setT((x) => (x > DOMAIN.length + 34 ? 0 : x + 1)));
  const typed = reduce ? DOMAIN.length : Math.min(t, DOMAIN.length);
  const stepsDone = reduce ? 3 : Math.max(0, Math.min(3, Math.floor((t - DOMAIN.length) / 5)));

  return (
    <div ref={ref} className="flex h-full flex-col gap-2.5 rounded-xl border bg-muted/40 p-3">
      <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 font-mono text-[12.5px]">
        <Lock className={cn("h-3.5 w-3.5 transition-colors", stepsDone === 3 ? "text-brand" : "text-muted-foreground")} />
        <span>
          https://{DOMAIN.slice(0, typed)}
          <span className={cn("ml-px inline-block h-3.5 w-px translate-y-0.5 bg-foreground", typed < DOMAIN.length ? "animate-caret" : "opacity-0")} />
        </span>
      </div>
      <ul className="space-y-1.5 px-1">
        {DOMAIN_STEPS.map((s, i) => (
          <li key={s} className={cn("flex items-center gap-2 text-[12.5px] transition-opacity duration-300", i < stepsDone ? "opacity-100" : "opacity-35")}>
            <span className={cn("flex h-4 w-4 items-center justify-center rounded-full", i < stepsDone ? "bg-brand/15 text-brand" : "bg-muted text-muted-foreground")}>
              <Check className="h-2.5 w-2.5" />
            </span>
            <span className="font-mono text-[11.5px]">{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── E. Metrics ──────────────────────────────────────────────────────────── */

function seedSeries(n: number) {
  return Array.from({ length: n }, (_, i) => 40 + 18 * Math.sin(i / 3) + ((i * 37) % 11));
}

function MetricsDemo() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [pts, setPts] = React.useState(() => seedSeries(28));
  useTicker(ref, 700, () =>
    setPts((p) => {
      const last = p[p.length - 1];
      const next = Math.max(12, Math.min(88, last + (Math.random() - 0.5) * 22));
      return [...p.slice(1), next];
    }),
  );
  const w = 280;
  const h = 84;
  const step = w / (pts.length - 1);
  const line = pts.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(h - (v / 100) * h).toFixed(1)}`).join(" ");
  const cpu = Math.round(pts[pts.length - 1] * 0.5);

  return (
    <div ref={ref} className="flex h-full flex-col justify-between rounded-xl border bg-muted/40 p-3">
      <div className="flex items-baseline justify-between">
        <span className="eyebrow">CPU · 1h</span>
        <span className="figure text-[22px] font-semibold">{cpu}%</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-2 min-h-0 w-full flex-1 overflow-visible" aria-hidden>
        <defs>
          <linearGradient id="dz-spark" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--dz-green)" stopOpacity="0.3" />
            <stop offset="1" stopColor="var(--dz-green)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L${w},${h} L0,${h} Z`} fill="url(#dz-spark)" />
        <path d={line} fill="none" stroke="var(--dz-green)" strokeWidth="1.75" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-2.5 grid shrink-0 grid-cols-3 gap-2 text-[11.5px] text-muted-foreground">
        <span>
          RAM <b className="figure font-medium text-foreground">412 MB</b>
        </span>
        <span>
          Req/s <b className="figure font-medium text-foreground">{Math.round(cpu * 1.7)}</b>
        </span>
        <span>
          p95 <b className="figure font-medium text-foreground">84 ms</b>
        </span>
      </div>
    </div>
  );
}

/* ── F. Bring your own server ────────────────────────────────────────────── */

function ServerRow({ name, where, badge, mine }: { name: string; where: string; badge: React.ReactNode; mine?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2">
      <span className={cn("flex h-7 w-7 items-center justify-center rounded-md", mine ? "bg-brand/12 text-brand" : "bg-muted text-muted-foreground")}>
        {mine ? <Server className="h-3.5 w-3.5" /> : <Globe2 className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{name}</p>
        <p className="truncate text-[11.5px] text-muted-foreground">{where}</p>
      </div>
      {badge}
    </div>
  );
}

function ByocDemo() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [t, setT] = React.useState(0);
  const { reduce } = useTicker(ref, 1000, () => setT((x) => (x >= 7 ? 0 : x + 1)));
  const phase = reduce ? 3 : t < 2 ? 0 : t < 3 ? 1 : t < 5 ? 2 : 3; // 0 hidden, 1 added, 2 installing, 3 ready

  return (
    <div ref={ref} className="flex h-full flex-col gap-2 rounded-xl border bg-muted/40 p-3">
      <ServerRow name="Deployzy Cloud" where="US · Europe" badge={<span className="text-[11px] text-muted-foreground">managed</span>} />
      {phase === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-[12.5px] text-muted-foreground">
          <Plus className="h-3.5 w-3.5" /> Add server
        </div>
      ) : (
        <div className="animate-[dz-rise_.5s_cubic-bezier(.16,1,.3,1)_both]">
          <ServerRow
            mine
            name="hetzner-1"
            where="your server · 203.0.113.10"
            badge={
              phase < 3 ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> {phase === 1 ? "Connecting" : "Installing Docker"}
                </span>
              ) : (
                <span className="rounded-full bg-brand/12 px-2 py-0.5 text-[11px] font-medium text-brand">Docker ✓</span>
              )
            }
          />
        </div>
      )}
    </div>
  );
}

/* ── Grid ────────────────────────────────────────────────────────────────── */

export function Bento() {
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      <Card
        className="md:col-span-2 lg:row-span-2"
        eyebrow="Deploys"
        title="Push to deploy"
        body="Connect a repo and every push builds and ships. Next.js, Node, Python, Go, static sites or any Dockerfile, with build logs you can actually read."
      >
        <div className="h-full min-h-[300px]">
          <DeployDemo />
        </div>
      </Card>
      <Card eyebrow="Tunnels" title="Localhost, public in a second" body="Share a local port on a real URL. Inspect and replay every request.">
        <div className="h-[184px]">
          <TunnelDemo />
        </div>
      </Card>
      <Card eyebrow="Databases" title="Postgres, Redis, Mongo, MySQL" body="One click for a managed database, with a connection string ready to paste into your app.">
        <div className="h-[184px]">
          <DatabaseDemo />
        </div>
      </Card>
      <Card eyebrow="Domains" title="Your domain, HTTPS included" body="Point a CNAME and we issue and renew the certificate.">
        <div className="h-[150px]">
          <DomainDemo />
        </div>
      </Card>
      <Card eyebrow="Observability" title="Metrics and logs built in" body="CPU, memory, requests and live logs per app. No extra tools.">
        <div className="h-[150px]">
          <MetricsDemo />
        </div>
      </Card>
      <Card eyebrow="Bring your own server" title="Run it on your VPS" body="Attach any Ubuntu or Debian server. We install Docker and handle builds, routing and TLS.">
        <div className="h-[150px]">
          <ByocDemo />
        </div>
      </Card>
    </div>
  );
}
