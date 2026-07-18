import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AnimatedCounter } from "@/components/marketing/animated-counter";
import { LiveStream } from "@/components/marketing/live-stream";
import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import { FadeIn, SlideIn, StaggerContainer, StaggerItem, HoverScale, GlowCard } from "@/components/marketing/motion-elements";
import {
  ArrowRight, Check, Eye, Lock, Code, Gauge, Users, Shield, Zap,
  Activity, BarChart3, GitBranch, Database, Globe, Terminal,
  GitPullRequest, Clock, HardDrive, Rocket,
} from "lucide-react";

export default function HomePage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────── */}
      <section className="relative border-b border-border/40 overflow-hidden">
        {/* Subtle radial glow */}
        <div className="pointer-events-none absolute inset-0 -top-40 flex justify-center" aria-hidden>
          <div className="h-[600px] w-[900px] rounded-full bg-indigo-50/60 blur-3xl dark:bg-indigo-950/20" />
        </div>
        <div className="relative mx-auto max-w-6xl px-5 sm:px-6">
          <div className="grid lg:grid-cols-[1fr_1.1fr] gap-12 lg:gap-16 py-20 sm:py-28 lg:py-36">

            {/* Left */}
            <FadeIn className="flex flex-col justify-center">
              <FadeIn delay={0.08}>
                <div className="inline-flex items-center gap-2 self-start rounded-full border border-border bg-background px-3 py-1 text-[12px] text-muted-foreground shadow-sm">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </span>
                  Deploy · Databases · Tunnels · BYOC
                </div>
              </FadeIn>

              <FadeIn delay={0.18}>
                <h1 className="mt-6 text-[2.4rem] sm:text-5xl lg:text-[3.25rem] font-bold tracking-[-0.03em] leading-[1.08] text-foreground">
                  Deploy apps.<br />
                  <span className="text-foreground/50">Ship faster.</span>
                </h1>
              </FadeIn>

              <FadeIn delay={0.3}>
                <p className="mt-5 text-[15px] text-muted-foreground leading-relaxed max-w-[420px]">
                  Connect a GitHub repo and go live in under 30 seconds.
                  Managed Postgres, secure tunnels, and bring your own VPS —
                  one platform instead of five tools.
                </p>
              </FadeIn>

              <FadeIn delay={0.42}>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link
                    href="/sign-up"
                    className="inline-flex items-center gap-2 rounded-full bg-foreground text-background text-[13px] font-semibold px-5 py-2.5 hover:opacity-85 transition-opacity shadow-sm"
                  >
                    Start deploying <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                  <Link
                    href="/docs"
                    className="inline-flex items-center gap-2 rounded-full border border-border bg-background text-foreground text-[13px] font-medium px-5 py-2.5 hover:bg-accent transition-colors"
                  >
                    Read docs
                  </Link>
                </div>
              </FadeIn>

              <FadeIn delay={0.52}>
                <div className="mt-7 flex items-center gap-5 text-[12px] text-muted-foreground flex-wrap">
                  {["Free tier", "No credit card", "Self-hostable", "MIT license"].map((t) => (
                    <span key={t} className="flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-emerald-500 shrink-0" />{t}
                    </span>
                  ))}
                </div>
              </FadeIn>
            </FadeIn>

            {/* Right — terminal */}
            <SlideIn delay={0.25} className="flex items-center">
              <div className="w-full rounded-xl border border-border bg-[#09090b] overflow-hidden shadow-xl shadow-black/10 dark:shadow-black/30">
                {/* Window chrome */}
                <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-4 py-3 bg-[#111111]">
                  <div className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
                  <div className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
                  <div className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
                  <span className="ml-3 text-[11px] text-zinc-500 font-mono">~/my-saas — deployzy deploy</span>
                </div>
                <div className="p-5 font-mono text-[12.5px] leading-[1.9] overflow-x-auto">
                  <div className="text-zinc-500">$ git push origin main</div>
                  <div className="mt-0.5 text-zinc-600">  <span className="text-amber-400">◷</span> Deployzy: webhook received</div>
                  <div className="text-zinc-600">  <span className="text-emerald-400">✓</span> Building Docker image...</div>
                  <div className="text-zinc-600">  <span className="text-emerald-400">✓</span> Postgres attached <span className="text-zinc-700">·</span> DATABASE_URL injected</div>
                  <div className="text-zinc-600">  <span className="text-emerald-400">✓</span> Running migrations</div>
                  <div className="text-zinc-600">  <span className="text-emerald-400">✓</span> Health check /health 200 OK</div>
                  <div className="mt-0.5 text-zinc-500">  <span className="text-emerald-300 font-medium">→ https://my-saas.deployzy.com</span></div>
                  <div className="mt-3 text-zinc-500">$ deployzy http 3000</div>
                  <div className="mt-0.5 text-zinc-600">  Tunnel <span className="text-blue-300 font-medium">https://dev.deployzy.com</span> <span className="text-zinc-700">→</span> localhost:3000</div>
                  <div className="mt-3 text-zinc-500">$ deployzy servers add my-vps --host 5.9.x.x</div>
                  <div className="mt-0.5 text-zinc-600">  <span className="text-emerald-400">✓</span> Probed: 8 vCPU · 32 GB · Docker installed</div>
                  <div className="text-zinc-600">  Next deploy → <span className="text-violet-300 font-medium">my-vps</span> · uncapped resources</div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-zinc-600 text-[11px]">Ready in 28s</span>
                  </div>
                </div>
              </div>
            </SlideIn>
          </div>
        </div>
      </section>

      {/* ── Install bar ──────────────────────────────── */}
      <section className="border-b border-border/40 bg-muted/40">
        <div className="mx-auto max-w-6xl px-5 sm:px-6 py-3.5">
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-[12px] text-muted-foreground font-mono">
            <span className="flex items-center gap-2"><span className="text-muted-foreground/40">$</span> npm i -g deployzy</span>
            <span className="hidden sm:block text-border">·</span>
            <span className="flex items-center gap-2"><span className="text-muted-foreground/40">$</span> brew install deployzy</span>
            <span className="hidden sm:block text-border">·</span>
            <span className="flex items-center gap-2"><span className="text-muted-foreground/40">$</span> curl -fsSL get.deployzy.com | sh</span>
          </div>
        </div>
      </section>

      {/* ── Metrics ─────────────────────────────────── */}
      <section className="border-b border-border/40">
        <div className="mx-auto max-w-6xl px-5 sm:px-6 py-12 sm:py-16">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 sm:gap-12 text-center">
            <Metric value={30} prefix="<" suffix="s" label="git push → live" />
            <Metric value={99} suffix="%" label="Uptime" />
            <Metric value={8}  prefix="<" suffix="ms" label="Tunnel latency" />
            <Metric value={0}  label="Cold starts" />
          </div>
        </div>
      </section>

      {/* ── Pillars: Deploy / Data / Tunnel / Observe / BYOC ───────────── */}
      <section className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <ScrollReveal>
            <SectionHeader
              label="Platform"
              title="Everything you'd otherwise glue together"
              desc="Deploys, managed Postgres, tunnels, observability, and your own VPS — all wired together. No five-tool stack, no AWS console deep-dives."
            />
          </ScrollReveal>
          <StaggerContainer className="mt-12 grid gap-4 sm:grid-cols-2">
            {pillars.map((p, i) => (
              <StaggerItem key={p.title} className={i === pillars.length - 1 && pillars.length % 2 === 1 ? "sm:col-span-2" : ""}>
                <GlowCard className="bg-card/30 p-6 sm:p-8 h-full transition-colors hover:bg-accent/20">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-md ${p.iconBg}`}>
                      <p.icon className={`h-4 w-4 ${p.iconColor}`} />
                    </div>
                    <h3 className="text-base font-medium">{p.title}</h3>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{p.desc}</p>
                  <ul className="mt-5 space-y-2">
                    {p.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-2 text-xs text-foreground/80">
                        <Check className="h-3 w-3 mt-0.5 text-emerald-500/80 shrink-0" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </GlowCard>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* ── Dashboard preview ──────────────────────────────────────────── */}
      <section className="border-y border-border/40 py-20 sm:py-28">
        <div className="mx-auto max-w-5xl px-5 sm:px-6">
          <ScrollReveal>
            <div className="text-center max-w-lg mx-auto mb-12">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Dashboard</p>
              <h2 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight">Everything in one tab</h2>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                Deploys, live logs, metrics, analytics, tunnels, databases — all in one place.
                No Grafana, Datadog, or five-tool stack.
              </p>
            </div>
          </ScrollReveal>
          <ScrollReveal delay={150}>
            <DashboardPreview />
          </ScrollReveal>
        </div>
      </section>

      {/* ── Deploy from GitHub ───────────────────────────────────────── */}
      <section className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <ScrollReveal>
              <SectionHeader
                label="Deploys"
                title="Push code. Ship code."
                desc="Connect a GitHub repo, pick a branch. Every push auto-deploys. Every PR gets its own preview URL with a real running container, a comment on the PR, and tear-down on close."
                align="left"
              />
              <div className="mt-6 flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1.5"><GitBranch className="h-3.5 w-3.5" /> Auto-deploy on push</span>
                <span className="flex items-center gap-1.5"><GitPullRequest className="h-3.5 w-3.5" /> PR previews</span>
                <span className="flex items-center gap-1.5"><Rocket className="h-3.5 w-3.5" /> Rollback in 3 clicks</span>
              </div>
            </ScrollReveal>
            <ScrollReveal delay={200}>
              <DeployCard />
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* ── Tunnels (with live inspection) ────────────────────────────── */}
      <section className="border-y border-border/40 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <ScrollReveal>
              <SectionHeader
                label="Tunnels"
                title="Localhost to the internet, instantly"
                desc="HTTP, TCP, or TLS. Every request captured in real time — method, path, headers, body, status, timing. Replay any request with one click."
                align="left"
              />
              <div className="mt-6 flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1.5"><Eye className="h-3.5 w-3.5" /> Live inspection</span>
                <span className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" /> Replay requests</span>
                <span className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" /> Custom domain</span>
              </div>
            </ScrollReveal>
            <ScrollReveal delay={200}><LiveStream /></ScrollReveal>
          </div>
        </div>
      </section>

      {/* ── Everything else ─────────────────────────────── */}
      <section className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <ScrollReveal>
            <SectionHeader
              label="More"
              title="Batteries included"
              desc="The stuff you'd end up bolting on anyway — already there."
            />
          </ScrollReveal>
          <StaggerContainer className="mt-12 grid gap-px rounded-lg border border-border/40 overflow-hidden sm:grid-cols-2 lg:grid-cols-3">
            {extras.map((f) => (
              <StaggerItem key={f.title}>
                <GlowCard className="bg-card/30 p-6 group transition-colors hover:bg-accent/20 h-full">
                  <f.icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  <h3 className="mt-3 text-sm font-medium">{f.title}</h3>
                  <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
                </GlowCard>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* ── SDKs ─────────────────────────────────────── */}
      <section className="border-y border-border/40 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <ScrollReveal>
            <SectionHeader
              label="Programmatic"
              title="CLI + SDKs"
              desc="Scriptable from your terminal, your CI, or your own apps."
            />
          </ScrollReveal>
          <div className="mt-12 grid gap-4 lg:grid-cols-2 items-stretch">
            <ScrollReveal className="h-full"><CodeCard lang="TypeScript" code={tsCode} /></ScrollReveal>
            <ScrollReveal delay={150} className="h-full"><CodeCard lang="Python" code={pyCode} /></ScrollReveal>
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────── */}
      <section id="pricing" className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <ScrollReveal>
            <SectionHeader
              label="Pricing"
              title="Start free, scale when ready"
              desc="Tunneling, deploys, databases, custom domains, analytics — all in one. Upgrade only when you outgrow the limits."
            />
          </ScrollReveal>
          <div className="mt-12 grid gap-4 max-w-5xl mx-auto lg:grid-cols-3 items-stretch">
            {plans.map((plan, i) => (
              <ScrollReveal key={plan.name} delay={i * 150} className="h-full">
                <div className={`flex h-full flex-col rounded-lg border p-6 sm:p-8 transition-all hover:border-foreground/20 ${plan.popular ? "border-foreground/20" : "border-border/40"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{plan.name}</span>
                    {plan.popular && <span className="text-[10px] font-medium text-muted-foreground border border-border/60 rounded px-1.5 py-0.5">Popular</span>}
                  </div>
                  <div className="mt-3 flex items-baseline gap-0.5">
                    <span className="text-3xl font-semibold tracking-tight">{plan.price}</span>
                    {plan.period && <span className="text-sm text-muted-foreground">/{plan.period}</span>}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{plan.desc}</p>
                  <ul className="mt-6 space-y-2.5 flex-1">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-xs text-foreground/70">
                        <Check className="h-3 w-3 text-emerald-500/80 shrink-0" />{f}
                      </li>
                    ))}
                  </ul>
                  <Button className="mt-6 w-full h-9 text-xs" variant={plan.popular ? "default" : "outline"} nativeButton={false} render={<Link href="/sign-up" />}>{plan.cta}</Button>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────── */}
      <section className="border-t border-border/40 py-20 sm:py-28">
        <div className="mx-auto max-w-xl px-5 sm:px-6 text-center">
          <ScrollReveal>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">Ship your first project in 30 seconds</h2>
            <p className="mt-3 text-sm text-muted-foreground">Connect GitHub, pick a repo, get a live URL. No credit card.</p>
            <div className="mt-8 flex flex-col items-center gap-4">
              <Button className="h-10 px-6 text-sm gap-2" nativeButton={false} render={<Link href="/sign-up" />}>Create free account <ArrowRight className="h-3.5 w-3.5" /></Button>
              <code className="text-xs text-muted-foreground font-mono">npm install -g deployzy</code>
            </div>
          </ScrollReveal>
        </div>
      </section>
    </>
  );
}

// ─── Data ────────────────────────────────────────────

const pillars = [
  {
    icon: Rocket,
    iconBg: "bg-emerald-500/10", iconColor: "text-emerald-400",
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
    iconBg: "bg-blue-500/10", iconColor: "text-blue-400",
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
    iconBg: "bg-violet-500/10", iconColor: "text-violet-400",
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
    iconBg: "bg-amber-500/10", iconColor: "text-amber-400",
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
    iconBg: "bg-orange-500/10", iconColor: "text-orange-400",
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

const extras = [
  { icon: Clock,       title: "Scheduled jobs",     desc: "Cron-like jobs that run in a one-shot container from your image. Same env, same DB access." },
  { icon: GitBranch,   title: "Preview deploys",    desc: "Every PR gets its own URL. Auto-cleanup when the PR closes." },
  { icon: Eye,         title: "Health checks",      desc: "Deploy isn't marked 'running' until your /health endpoint returns 2xx. No silent bad pushes." },
  { icon: Terminal,    title: "Release commands",   desc: "Run migrations, seed data, or warm caches in a one-shot container before the app starts." },
  { icon: Users,       title: "Team collaboration", desc: "Invite members with roles. Shared projects, shared databases, shared tunnels." },
  { icon: Shield,      title: "OAuth at edge",      desc: "Google/GitHub auth before traffic reaches your app — no code changes needed." },
  { icon: Zap,         title: "Fast by default",    desc: "Go server, Docker under the hood, smux-multiplexed tunnels. Sub-ms overhead." },
  { icon: Lock,        title: "End-to-end TLS",     desc: "Let's Encrypt via Caddy on-demand. Works with your custom domains automatically." },
  { icon: Code,        title: "Self-hostable",      desc: "One-command install on any Ubuntu VPS. MIT license. Run your own stack." },
];

const plans = [
  {
    name: "Free", price: "$0", period: null, popular: false,
    desc: "Try Deployzy with a real side project.",
    cta: "Get started",
    features: [
      "5 subdomains, 5 active tunnels",
      "3 projects, 1 database, 1 standalone service",
      "1 BYOC server, 1 custom domain",
      "512 MB RAM / 0.25 vCPU per project",
      "50 GB bandwidth, 120 build min/mo",
      "Cookieless website analytics (7d)",
    ],
  },
  {
    name: "Pro", price: "$12", period: "mo", popular: true,
    desc: "For freelancers + indie hackers.",
    cta: "Upgrade to Pro",
    features: [
      "10 subdomains, 15 tunnels, 10 projects",
      "5 databases, 10 services, 5 BYOC servers",
      "5 custom domains, 5 PR previews",
      "1 GB RAM / 1 vCPU (configurable)",
      "500 GB bandwidth, 600 build min/mo",
      "Live logs, release commands, health checks",
      "Private repos, TCP/TLS tunnels, Telegram alerts",
      "90-day analytics retention",
    ],
  },
  {
    name: "Team", price: "$35", period: "mo per seat", popular: false,
    desc: "For small teams shipping in production.",
    cta: "Contact us",
    features: [
      "Everything in Pro, plus:",
      "50 subdomains / projects, 20 databases",
      "15 BYOC servers, 25 custom domains",
      "25 scheduled jobs, 25 active PR previews",
      "Up to 8 GB RAM / 4 vCPU per project",
      "1 TB bandwidth, 1800 build min/mo",
      "30-day backups, 1-year analytics",
      "Multi-user collaboration, priority support",
    ],
  },
];

const tsCode = `import { Deployzy } from 'deployzy-sdk';

const sm = new Deployzy({ apiKey: 'sm_live_...' });

// Deploy a GitHub repo
const project = await sm.projects.create({
  name: 'my-saas',
  subdomain: 'my-saas',
  github_repo: 'me/my-saas',
});
await sm.projects.deploy(project.id);

// Tail live container logs
for await (const line of sm.projects.logs(project.id)) {
  console.log(line.message);
}`;

const pyCode = `from deployzy import Deployzy

sm = Deployzy(api_key="sm_live_...")

# Spin up a managed database
db = sm.services.create(name="my-db", type="postgres")
print(db.external_connection_url)

# Trigger a deploy from a specific commit
sm.projects.deploy(project_id,
                   commit_sha="a1b2c3d")`;

// ─── Components ──────────────────────────────────────

function SectionHeader({ label, title, desc, align = "center" }: { label: string; title: string; desc: string; align?: string }) {
  return (
    <div className={align === "center" ? "text-center max-w-lg mx-auto" : "max-w-lg"}>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">{label}</p>
      <h2 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}

function Metric({ value, suffix, prefix, label }: { value: number; suffix?: string; prefix?: string; label: string }) {
  return (
    <div>
      <div className="text-2xl sm:text-3xl font-semibold tracking-tight">
        {prefix}<AnimatedCounter value={value} suffix={suffix} />
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

// Small card that animates a GitHub deploy flow — shown in the "Deploys" section.
function DeployCard() {
  return (
    <div className="rounded-xl border border-border/60 bg-[#09090b] overflow-hidden shadow-2xl shadow-black/20 sm-terminal">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3 bg-zinc-950">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
        </div>
        <div className="flex-1 mx-4">
          <div className="mx-auto max-w-xs h-6 rounded-md bg-white/[0.04] flex items-center justify-center text-[10px] text-zinc-600 font-mono">
            deployzy.com/projects/my-saas
          </div>
        </div>
      </div>
      <div className="p-5 space-y-3">
        {/* Project header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-400">
              <Rocket className="h-4 w-4" />
            </div>
            <div>
              <div className="text-[13px] font-medium text-zinc-200">my-saas</div>
              <div className="text-[10px] text-zinc-600 font-mono">my-saas.deployzy.com</div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 text-[10px] text-emerald-500 font-medium">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            running
          </span>
        </div>

        {/* Deploy timeline */}
        <div className="space-y-1.5">
          {[
            { label: "Cloning me/my-saas @ a1b2c3d",  time: "0.8s",  icon: Check, color: "text-emerald-500" },
            { label: "Building Docker image",          time: "22.1s", icon: Check, color: "text-emerald-500" },
            { label: "npx prisma migrate deploy",      time: "1.4s",  icon: Check, color: "text-emerald-500" },
            { label: "Health check /health → 200 OK",  time: "0.3s",  icon: Check, color: "text-emerald-500" },
          ].map((s, i) => (
            <div key={i} className="flex items-center gap-2 rounded-md bg-white/[0.02] px-2.5 py-1.5 animate-fade-in-up" style={{ animationDelay: `${i * 0.18}s` }}>
              <s.icon className={`h-3 w-3 ${s.color} shrink-0`} />
              <span className="flex-1 text-[11px] text-zinc-400 truncate">{s.label}</span>
              <span className="text-[10px] text-zinc-700 font-mono">{s.time}</span>
            </div>
          ))}
        </div>

        {/* PR preview chip */}
        <div className="mt-3 rounded-md border border-blue-500/20 bg-blue-500/5 px-3 py-2">
          <div className="flex items-center gap-2 text-[10px] text-blue-400">
            <GitPullRequest className="h-3 w-3" />
            <span>PR #42 preview:</span>
            <span className="font-mono">my-saas-pr-42.deployzy.com</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardPreview() {
  return (
    <div className="relative rounded-xl border border-border/60 bg-[#09090b] overflow-hidden shadow-2xl shadow-black/20 sm-terminal">
      {/* Browser chrome */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3 bg-zinc-950">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
        </div>
        <div className="flex-1 mx-4">
          <div className="mx-auto max-w-xs h-6 rounded-md bg-white/[0.04] flex items-center justify-center text-[10px] text-zinc-600 font-mono">
            deployzy.com/projects
          </div>
        </div>
      </div>

      <div className="flex min-h-[380px] sm:min-h-[440px]">
        {/* Sidebar */}
        <div className="hidden sm:flex flex-col w-48 border-r border-white/[0.04] p-3 gap-0.5 shrink-0">
          <div className="flex items-center gap-2 px-2.5 py-2 text-[11px] text-zinc-600 font-mono font-medium mb-2">
            <div className="h-5 w-5 rounded bg-white/5 flex items-center justify-center text-[9px]">S</div>
            Deployzy
          </div>
          {[
            ["Overview", false],
            ["Projects", true],
            ["Services", false],
            ["Tunnels", false],
            ["Analytics", false],
            ["Domains", false],
            ["Inspector", false],
          ].map(([item, active]) => (
            <div key={item as string} className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px] font-mono transition-colors ${active ? "bg-white/[0.06] text-zinc-300" : "text-zinc-600"}`}>
              <div className={`h-1 w-1 rounded-full ${active ? "bg-emerald-500" : "bg-transparent"}`} />
              {item}
            </div>
          ))}
        </div>

        {/* Main content — project list with a live resource widget */}
        <div className="flex-1 p-4 sm:p-6 overflow-hidden">
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="text-sm font-medium text-zinc-200">Projects</div>
              <div className="text-[11px] text-zinc-600 mt-0.5">3 running · 1 building</div>
            </div>
            <div className="h-7 px-3 rounded-md bg-white/[0.06] text-[10px] text-zinc-400 flex items-center gap-1.5 font-mono">
              + New project
            </div>
          </div>

          <div className="space-y-2">
            {[
              { name: "my-saas",       sub: "my-saas.deployzy.com",       status: "running",  pingCls: "bg-emerald-400", dotCls: "bg-emerald-500", textCls: "text-emerald-500", framework: "Next.js", delay: "0s" },
              { name: "api-server",    sub: "api-server.deployzy.com",    status: "running",  pingCls: "bg-emerald-400", dotCls: "bg-emerald-500", textCls: "text-emerald-500", framework: "Node",    delay: "0.15s" },
              { name: "analytics-etl", sub: "analytics-etl.deployzy.com", status: "building", pingCls: "bg-amber-400",   dotCls: "bg-amber-500",   textCls: "text-amber-500",   framework: "Python",  delay: "0.3s" },
            ].map((p) => (
              <div key={p.name} className="flex items-center gap-3 rounded-lg border border-white/[0.04] bg-white/[0.02] p-3 animate-fade-in-up" style={{ animationDelay: p.delay }}>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-white/[0.04] shrink-0">
                  <Rocket className="h-3.5 w-3.5 text-zinc-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium text-zinc-300 truncate">{p.name}</span>
                    <span className="text-[9px] text-zinc-600 font-mono">{p.framework}</span>
                  </div>
                  <div className="text-[10px] text-zinc-600 font-mono mt-0.5">{p.sub}</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${p.pingCls}`} />
                    <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${p.dotCls}`} />
                  </span>
                  <span className={`text-[10px] font-medium ${p.textCls}`}>{p.status}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Mini metrics widget */}
          <div className="mt-5 rounded-lg border border-white/[0.04] bg-white/[0.01] p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] text-zinc-600 font-mono flex items-center gap-1.5">
                <BarChart3 className="h-3 w-3" />
                my-saas · metrics
              </div>
              <div className="flex gap-1 text-[9px] text-zinc-600">
                <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-zinc-400">1h</span>
                <span>6h</span><span>24h</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "CPU",     val: "23%",    color: "bg-emerald-500" },
                { label: "Memory",  val: "412 MB", color: "bg-blue-500" },
                { label: "Network", val: "1.2 MB", color: "bg-amber-500" },
              ].map((m) => (
                <div key={m.label} className="rounded bg-[#0c0c0e] px-2 py-1.5">
                  <div className="text-[9px] text-zinc-600">{m.label}</div>
                  <div className="text-[11px] text-zinc-300 font-mono mt-0.5">{m.val}</div>
                  <div className="mt-1.5 h-0.5 w-full rounded-full bg-white/[0.04] overflow-hidden">
                    <div className={`h-full ${m.color} opacity-60`} style={{ width: "60%" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="absolute inset-0 pointer-events-none rounded-xl ring-1 ring-inset ring-white/[0.03]" />
    </div>
  );
}

function CodeCard({ lang, code }: { lang: string; code: string }) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-border overflow-hidden transition-colors hover:border-foreground/30 sm-terminal bg-zinc-50 dark:bg-[#09090b]">
      <div className="border-b border-border px-4 py-2 text-[10px] font-mono shrink-0 text-muted-foreground">
        {lang}
      </div>
      <div className="flex-1 overflow-x-auto">
        <pre className="p-4 text-[12px] leading-relaxed">
          <code className="font-mono text-zinc-700 dark:text-zinc-400">{code}</code>
        </pre>
      </div>
    </div>
  );
}
