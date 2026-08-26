import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AnimatedCounter } from "@/components/marketing/animated-counter";
import { fetchPlanCards } from "@/lib/plans";
import { LiveStream } from "@/components/marketing/live-stream";
import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import { PlanCta } from "@/components/marketing/plan-cta";
import { ConnectStack } from "@/components/marketing/connect-stack";
import { DeployPipeline } from "@/components/marketing/deploy-pipeline";
import { ShowcaseCards } from "@/components/marketing/showcase-cards";
import { LogoCloud } from "@/components/marketing/logo-cloud";
import { Hero } from "@/components/marketing/hero";
import { BentoFeatures } from "@/components/marketing/bento-features";
import {
  ArrowRight, Check, Eye, Activity, Globe, BarChart3, Rocket,
} from "lucide-react";

export default async function HomePage() {
  // Live pricing from plan_limits (ISR-cached 60s so admin edits appear within a
  // minute without a redeploy). Falls back to the static list if unreachable.
  const liveCards = await fetchPlanCards(60);
  const plans = liveCards
    ? liveCards.map((c) => ({ name: c.name, price: c.price, period: c.period, popular: c.popular, desc: c.tagline, cta: c.cta, features: c.features }))
    : FALLBACK_PLANS;
  return (
    <>
      {/* ── Hero: aurora + typing terminal ──────────────────── */}
      <Hero />

      {/* ── Install bar ──────────────────────────────── */}
      <section className="border-b border-border/40 bg-muted/40">
        <div className="mx-auto max-w-6xl px-5 sm:px-6 py-3.5">
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-[12px] text-muted-foreground font-mono">
            <span className="flex items-center gap-2"><span className="text-emerald-500/70">$</span> npm i -g deployzy</span>
            <span className="hidden sm:block text-border">·</span>
            <span className="flex items-center gap-2"><span className="text-emerald-500/70">$</span> brew install deployzy</span>
            <span className="hidden sm:block text-border">·</span>
            <span className="flex items-center gap-2"><span className="text-emerald-500/70">$</span> curl -fsSL get.deployzy.com | sh</span>
          </div>
        </div>
      </section>

      {/* ── Stack marquee ───────────────────────────────────── */}
      <LogoCloud />

      {/* ── Bento feature grid (id="features") ─────────────── */}
      <BentoFeatures />

      {/* ── How it works: scroll pipeline spine + sticky panel ─────────── */}
      <DeployPipeline />

      {/* ── Connect your stack (converging cables) ─────────────────────── */}
      <ConnectStack />

      {/* ── Showcase cards (sticky stack) ──────────────────────────────── */}
      <ShowcaseCards />

      {/* ── Dashboard preview ──────────────────────────────────────────── */}
      <section className="border-y border-border/40 py-20 sm:py-28">
        <div className="mx-auto max-w-5xl px-5 sm:px-6">
          <ScrollReveal>
            <div className="text-center max-w-lg mx-auto mb-12">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Dashboard</p>
              <h2 className="mt-2 text-2xl sm:text-4xl font-semibold tracking-tight">Everything in one tab</h2>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                Deploys, live logs, metrics, analytics, tunnels, databases — all in one place.
                No Grafana, Datadog, or five-tool stack.
              </p>
            </div>
          </ScrollReveal>
          <ScrollReveal delay={150}>
            <div className="relative">
              <div aria-hidden className="absolute -inset-10 rounded-[40px] bg-emerald-500/[0.06] blur-3xl dark:bg-emerald-400/[0.05]" />
              <div className="gradient-border relative rounded-2xl">
                <DashboardPreview />
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ── Tunnels (with live inspection) ────────────────────────────── */}
      <section className="py-20 sm:py-28">
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

      {/* ── Metrics ─────────────────────────────────── */}
      <section className="border-y border-border/40 bg-muted/30">
        <div className="mx-auto max-w-6xl px-5 sm:px-6 py-14 sm:py-16">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 sm:gap-12 text-center">
            <Metric value={30} prefix="<" suffix="s" label="git push → live" />
            <Metric value={99} suffix="%" label="Uptime" />
            <Metric value={8}  prefix="<" suffix="ms" label="Tunnel latency" />
            <Metric value={0}  label="Cold starts" />
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────── */}
      <section id="pricing" className="scroll-mt-20 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <ScrollReveal>
            <SectionHeader
              label="Pricing"
              title="Start free, scale when ready"
              desc="Tunneling, deploys, databases, custom domains, analytics — all in one. Upgrade only when you outgrow the limits."
            />
          </ScrollReveal>
          <div className="mt-12 grid gap-4 max-w-6xl mx-auto sm:grid-cols-2 lg:grid-cols-4 items-stretch">
            {plans.map((plan, i) => (
              <ScrollReveal key={plan.name} delay={i * 120} className="h-full">
                <div
                  className={`group relative flex h-full flex-col rounded-2xl p-6 sm:p-7 transition-all duration-300 hover:-translate-y-1.5 ${
                    plan.popular
                      ? "gradient-border shadow-[0_20px_60px_-20px_rgba(16,185,129,0.35)]"
                      : "border border-border/60 bg-card/60 hover:border-foreground/25 hover:shadow-[0_16px_48px_-20px_rgba(0,0,0,0.25)] dark:bg-[#0c0d0f]/60"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{plan.name}</span>
                    {plan.popular && (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                        Popular
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-[2rem] font-semibold tracking-tight">{plan.price}</span>
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
                  <PlanCta planId={plan.name.toLowerCase()} cta={plan.cta} popular={plan.popular} />
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────── */}
      <section className="relative overflow-hidden border-t border-border/40 py-24 sm:py-32">
        {/* aurora glow */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="animate-aurora-a absolute left-1/2 top-1/2 h-[380px] w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/[0.10] blur-[120px] dark:bg-emerald-400/[0.08]" />
          <div className="mask-radial-center absolute inset-0 text-foreground/[0.04] dark:text-white/[0.05]">
            <div className="bg-grid absolute inset-0" />
          </div>
        </div>
        <div className="relative mx-auto max-w-xl px-5 sm:px-6 text-center">
          <ScrollReveal>
            <h2 className="text-3xl sm:text-[2.75rem] font-bold tracking-[-0.03em] leading-[1.08]">
              Ship your first project in <span className="text-gradient">30 seconds</span>
            </h2>
            <p className="mt-4 text-sm sm:text-[15px] text-muted-foreground">Connect GitHub, pick a repo, get a live URL. No credit card.</p>
            <div className="mt-9 flex flex-col items-center gap-4">
              <Button
                className="btn-shine h-11 px-7 text-sm gap-2 rounded-full transition-transform duration-300 hover:scale-[1.04] active:scale-[0.97]"
                nativeButton={false}
                render={<Link href="/sign-up" />}
              >
                Create free account <ArrowRight className="h-4 w-4" />
              </Button>
              <code className="rounded-lg border border-border/60 bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground font-mono">
                <span className="text-emerald-500">$</span> npm install -g deployzy
              </code>
            </div>
          </ScrollReveal>
        </div>
      </section>
    </>
  );
}

// ─── Data ────────────────────────────────────────────



const FALLBACK_PLANS = [
  {
    name: "Free", price: "$0", period: null, popular: false,
    desc: "For hobby projects and learning.",
    cta: "Get started",
    features: [
      "3 projects, 1 PostgreSQL database (1 GB)",
      "5 subdomains, 5 active tunnels",
      "1 BYOC server, 1 custom domain",
      "512 MB RAM / 0.25 vCPU per project",
      "50 GB bandwidth, 120 build min/mo",
      "Cookieless website analytics (7d)",
      "3-day deploy log retention",
    ],
  },
  {
    name: "Hobby", price: "$5", period: "mo", popular: false,
    desc: "Perfect for indie hackers and side projects.",
    cta: "Start with Hobby",
    features: [
      "All Free features, plus:",
      "5 projects, 3 databases · Redis, Mongo & MySQL",
      "5 GB DB storage · migrate existing databases",
      "8 subdomains, 8 tunnels, 2 BYOC servers",
      "2 custom domains, 2 PR previews, 2 cron jobs",
      "1 GB RAM / 0.5 vCPU per project",
      "150 GB bandwidth, 300 build min/mo",
      "TCP/TLS tunnels, private repos, live logs",
      "Health checks, release commands, Telegram alerts",
      "30-day analytics, 7-day deploy logs",
    ],
  },
  {
    name: "Pro", price: "$12", period: "mo", popular: true,
    desc: "Built for production-ready applications.",
    cta: "Upgrade to Pro",
    features: [
      "All Hobby features, plus:",
      "10 projects, 5 databases, 10 services",
      "10 GB DB storage · migrate existing databases",
      "10 subdomains, 15 tunnels, 5 BYOC servers",
      "5 custom domains, 5 PR previews, 5 cron jobs",
      "1 GB RAM / 1 vCPU (configurable)",
      "500 GB bandwidth, 600 build min/mo",
      "7-day backups, 90-day analytics, 14-day deploy logs",
    ],
  },
  {
    name: "Team", price: "$35", period: "mo per seat", popular: false,
    desc: "For small teams shipping in production.",
    cta: "Upgrade to Team",
    features: [
      "All Pro features, plus:",
      "50 subdomains / projects, 20 databases",
      "50 GB DB storage · migrate existing databases",
      "15 BYOC servers, 25 custom domains",
      "25 scheduled jobs, 25 active PR previews",
      "Up to 8 GB RAM / 4 vCPU per project",
      "1 TB bandwidth, 1800 build min/mo",
      "30-day backups, 1-year analytics, 30-day deploy logs",
      "Multi-user collaboration, priority support",
    ],
  },
];



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
      <div className="text-4xl sm:text-5xl font-extrabold tracking-tight">
        {prefix}<AnimatedCounter value={value} suffix={suffix} />
      </div>
      <div className="mt-1.5 text-[13px] font-medium text-muted-foreground">{label}</div>
    </div>
  );
}

function DashboardPreview() {
  return (
    <div className="relative rounded-2xl bg-[#09090b] overflow-hidden sm-terminal">
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

      <div className="absolute inset-0 pointer-events-none rounded-2xl ring-1 ring-inset ring-white/[0.03]" />
    </div>
  );
}
