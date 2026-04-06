import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AnimatedCounter } from "@/components/marketing/animated-counter";
import { LiveStream } from "@/components/marketing/live-stream";
import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import {
  ArrowRight, Check, Eye, Lock, Code, Gauge, Users, Shield, Zap,
  Activity, BarChart3,
} from "lucide-react";

export default function HomePage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────── */}
      <section className="relative border-b border-border/40">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 py-20 sm:py-28 lg:py-36">
            <div className="flex flex-col justify-center animate-fade-in-up">
              <div className="inline-flex items-center gap-2 self-start rounded-full border border-border/60 bg-card/50 px-3 py-1 text-xs text-muted-foreground">
                <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" /></span>
                v1.0 — Now open source
              </div>
              <h1 className="mt-6 text-3xl sm:text-4xl lg:text-[2.75rem] font-semibold tracking-tight leading-[1.15]">Expose localhost<br />to the internet</h1>
              <p className="mt-5 text-base text-muted-foreground leading-relaxed max-w-md">Secure tunnels from the public internet to your local machine. HTTP, TCP, TLS — with real-time request inspection.</p>
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <Button className="h-10 px-5 text-sm gap-2" nativeButton={false} render={<Link href="/sign-up" />}>Get started <ArrowRight className="h-3.5 w-3.5" /></Button>
                <Button variant="outline" className="h-10 px-5 text-sm" nativeButton={false} render={<Link href="/docs" />}>Read docs</Button>
              </div>
              <div className="mt-8 flex items-center gap-5 text-xs text-muted-foreground">
                {["Free tier", "No credit card", "Self-hostable"].map((t) => (<span key={t} className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-500" />{t}</span>))}
              </div>
            </div>
            <div className="flex items-center animate-slide-in-right" style={{ animationDelay: "200ms" }}>
              <div className="w-full rounded-lg border border-border/60 bg-[#09090b] overflow-hidden">
                <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-4 py-2.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-white/10" /><div className="h-2.5 w-2.5 rounded-full bg-white/10" /><div className="h-2.5 w-2.5 rounded-full bg-white/10" />
                  <span className="ml-2 text-[10px] text-zinc-600 font-mono">terminal</span>
                </div>
                <div className="p-4 sm:p-5 font-mono text-[12px] sm:text-[13px] leading-[1.9] overflow-x-auto">
                  <div className="text-zinc-600">$ serverme http 3000</div>
                  <div className="mt-3 text-zinc-500">  ServerMe</div>
                  <div className="text-zinc-500">  Inspect  <span className="text-blue-400/80">http://127.0.0.1:4040</span></div>
                  <div className="mt-2 text-zinc-500">  HTTP  <span className="text-emerald-400 font-medium">https://myapp.serverme.site</span> <span className="text-zinc-700">→</span> <span className="text-zinc-400">localhost:3000</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Install ──────────────────────────────────── */}
      <section className="border-b border-border/40">
        <div className="mx-auto max-w-6xl px-5 sm:px-6 py-4">
          <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center justify-center gap-3 sm:gap-6 text-xs text-muted-foreground font-mono">
            <span>npm i -g serverme-cli</span><span className="hidden sm:block text-border/60">·</span>
            <span>brew install jams24/serverme/serverme</span><span className="hidden sm:block text-border/60">·</span>
            <span>curl -fsSL get.serverme.site | sh</span>
          </div>
        </div>
      </section>

      {/* ── Metrics ─────────────────────────────────── */}
      <section className="border-b border-border/40">
        <div className="mx-auto max-w-6xl px-5 sm:px-6 py-12 sm:py-16">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 sm:gap-12 text-center">
            <Metric value={805} label="Requests proxied" />
            <Metric value={99} suffix="%" label="Uptime" />
            <Metric value={8} prefix="<" suffix="ms" label="Avg latency" />
            <Metric value={4} label="Active users" />
          </div>
        </div>
      </section>

      {/* ── Video Preview ────────────────────────────── */}
      <section className="py-20 sm:py-28">
        <div className="mx-auto max-w-5xl px-5 sm:px-6">
          <ScrollReveal>
            <div className="text-center max-w-lg mx-auto mb-12">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">See it in action</p>
              <h2 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight">From terminal to production</h2>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">One command to expose your local server. A full dashboard to manage everything.</p>
            </div>
          </ScrollReveal>
          <ScrollReveal delay={150}>
            <DashboardPreview />
          </ScrollReveal>
        </div>
      </section>

      {/* ── Protocols ────────────────────────────────── */}
      <section className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <ScrollReveal><SectionHeader label="Protocols" title="HTTP. TCP. TLS." desc="Not just web traffic. Expose databases, game servers, or any TCP service." /></ScrollReveal>
          <div className="mt-12 grid gap-px rounded-lg border border-border/40 overflow-hidden sm:grid-cols-3 stagger-children">
            {protocols.map((p) => (
              <div key={p.name} className="bg-card/30 p-6 sm:p-8 transition-colors hover:bg-accent/20">
                <div className="font-mono text-xs font-medium text-muted-foreground uppercase tracking-wider">{p.name}</div>
                <p className="mt-3 text-sm text-foreground/80 leading-relaxed">{p.desc}</p>
                <code className="mt-4 block font-mono text-[11px] text-muted-foreground">{p.cmd}</code>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Inspection (live stream) ─────────────────── */}
      <section className="border-y border-border/40 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <ScrollReveal>
              <SectionHeader label="Inspection" title="See every request" desc="Every HTTP request is captured in real-time — method, path, headers, body, status, timing. Replay any request with one click." align="left" />
              <div className="mt-6 flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><Eye className="h-3.5 w-3.5" /> Real-time</span>
                <span className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" /> WebSocket</span>
                <span className="flex items-center gap-1.5"><BarChart3 className="h-3.5 w-3.5" /> Analytics</span>
              </div>
            </ScrollReveal>
            <ScrollReveal delay={200}><LiveStream /></ScrollReveal>
          </div>
        </div>
      </section>

      {/* ── Features Grid ────────────────────────────── */}
      <section className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <ScrollReveal><SectionHeader label="Platform" title="Everything you need" desc="A complete tunneling platform — not just a port forwarder." /></ScrollReveal>
          <div className="mt-12 grid gap-px rounded-lg border border-border/40 overflow-hidden sm:grid-cols-2 lg:grid-cols-3 stagger-children">
            {features.map((f) => (
              <div key={f.title} className="bg-card/30 p-6 group transition-colors hover:bg-accent/20">
                <f.icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                <h3 className="mt-3 text-sm font-medium">{f.title}</h3>
                <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SDKs ─────────────────────────────────────── */}
      <section className="border-y border-border/40 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <ScrollReveal><SectionHeader label="SDKs" title="Programmatic access" desc="Manage tunnels, stream traffic, and replay requests from your code." /></ScrollReveal>
          <div className="mt-12 grid gap-4 lg:grid-cols-2">
            <ScrollReveal><CodeCard lang="TypeScript" code={tsCode} /></ScrollReveal>
            <ScrollReveal delay={150}><CodeCard lang="Python" code={pyCode} /></ScrollReveal>
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────── */}
      <section id="pricing" className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-5 sm:px-6">
          <ScrollReveal><SectionHeader label="Pricing" title="Generous free tier" desc="Most developers never need to pay. Upgrade when your team grows." /></ScrollReveal>
          <div className="mt-12 grid gap-4 max-w-2xl mx-auto lg:grid-cols-2">
            {plans.map((plan, i) => (
              <ScrollReveal key={plan.name} delay={i * 150}>
                <div className={`rounded-lg border p-6 sm:p-8 h-full transition-all hover:border-foreground/20 ${plan.popular ? "border-foreground/20" : "border-border/40"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{plan.name}</span>
                    {plan.popular && <span className="text-[10px] font-medium text-muted-foreground border border-border/60 rounded px-1.5 py-0.5">Popular</span>}
                  </div>
                  <div className="mt-3 flex items-baseline gap-0.5"><span className="text-3xl font-semibold tracking-tight">{plan.price}</span>{plan.period && <span className="text-sm text-muted-foreground">/{plan.period}</span>}</div>
                  <p className="mt-2 text-xs text-muted-foreground">{plan.desc}</p>
                  <ul className="mt-6 space-y-2.5">{plan.features.map((f) => (<li key={f} className="flex items-center gap-2 text-xs text-foreground/70"><Check className="h-3 w-3 text-emerald-500/80 shrink-0" />{f}</li>))}</ul>
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
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">Start tunneling in seconds</h2>
            <p className="mt-3 text-sm text-muted-foreground">No credit card. No config files. One command.</p>
            <div className="mt-8 flex flex-col items-center gap-4">
              <Button className="h-10 px-6 text-sm gap-2" nativeButton={false} render={<Link href="/sign-up" />}>Create free account <ArrowRight className="h-3.5 w-3.5" /></Button>
              <code className="text-xs text-muted-foreground font-mono">npm install -g serverme-cli</code>
            </div>
          </ScrollReveal>
        </div>
      </section>
    </>
  );
}

// ─── Data ────────────────────────────────────────────
const protocols = [
  { name: "HTTP", desc: "Expose web apps, APIs, and webhooks with custom subdomains and automatic TLS.", cmd: "$ serverme http 3000" },
  { name: "TCP", desc: "Forward PostgreSQL, Redis, MySQL — any TCP service gets a public port.", cmd: "$ serverme tcp 5432" },
  { name: "TLS", desc: "Passthrough encrypted traffic without termination. Your certs, your control.", cmd: "$ serverme tls 443" },
];
const features = [
  { icon: Eye, title: "Request inspection", desc: "View every request in real-time at localhost:4040. Headers, body, timing." },
  { icon: Activity, title: "Replay requests", desc: "Re-send any captured request with one click. Debug webhooks effortlessly." },
  { icon: Gauge, title: "Custom domains", desc: "Bring your own domain with automatic Let's Encrypt TLS." },
  { icon: Zap, title: "Blazing fast", desc: "Written in Go with smux multiplexing. Sub-millisecond overhead." },
  { icon: Users, title: "Teams", desc: "Invite members, share tunnels, and manage access with roles." },
  { icon: Shield, title: "Auth at edge", desc: "Basic auth, Google OAuth, or IP restrictions. No code changes." },
  { icon: Lock, title: "E2E encryption", desc: "All traffic encrypted with TLS 1.3. Zero plaintext on our servers." },
  { icon: BarChart3, title: "Analytics", desc: "Success rates, latency, bandwidth — all in real-time." },
  { icon: Code, title: "Self-hostable", desc: "Deploy your own server with one command. MIT licensed." },
];
const plans = [
  { name: "Free", price: "$0", period: null, popular: true, desc: "Everything you need to build and ship.", cta: "Get started", features: ["10 tunnels", "10 subdomains", "HTTP, TCP, TLS", "Custom domains", "Inspection & replay", "Analytics", "100 req/s"] },
  { name: "Premium", price: "$10", period: "mo", popular: false, desc: "For teams and power users.", cta: "Upgrade", features: ["10 tunnels", "50 subdomains", "Wildcard domains", "OAuth at edge", "500 req/s", "Team management", "Traffic policies", "Priority support"] },
];
const tsCode = `import { ServerMe } from '@serverme/sdk';

const client = new ServerMe({ authtoken: 'sm_live_...' });
const tunnels = await client.tunnels.list();

for await (const req of client.inspect.subscribe(url)) {
  console.log(\`\${req.method} \${req.path} → \${req.statusCode}\`);
}`;
const pyCode = `from serverme import ServerMe

async with ServerMe(authtoken="sm_live_...") as client:
    tunnels = await client.tunnels.list()

    async for req in client.inspect.subscribe(url):
        print(f"{req.method} {req.path} → {req.status_code}")`;

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
      <div className="text-2xl sm:text-3xl font-semibold tracking-tight">{prefix}<AnimatedCounter value={value} suffix={suffix} /></div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
function DashboardPreview() {
  return (
    <div className="relative rounded-xl border border-border/60 bg-[#09090b] overflow-hidden shadow-2xl shadow-black/20">
      {/* Browser chrome */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3 bg-zinc-950">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
        </div>
        <div className="flex-1 mx-4">
          <div className="mx-auto max-w-xs h-6 rounded-md bg-white/[0.04] flex items-center justify-center text-[10px] text-zinc-600 font-mono">
            serverme.site/tunnels
          </div>
        </div>
      </div>

      {/* Dashboard content */}
      <div className="flex min-h-[380px] sm:min-h-[440px]">
        {/* Sidebar */}
        <div className="hidden sm:flex flex-col w-48 border-r border-white/[0.04] p-3 gap-0.5 shrink-0">
          <div className="flex items-center gap-2 px-2.5 py-2 text-[11px] text-zinc-600 font-mono font-medium mb-2">
            <div className="h-5 w-5 rounded bg-white/5 flex items-center justify-center text-[9px]">S</div>
            ServerMe
          </div>
          {["Tunnels", "Projects", "Analytics", "Inspector", "Domains", "Team"].map((item, i) => (
            <div key={item} className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px] font-mono transition-colors ${i === 0 ? "bg-white/[0.06] text-zinc-300" : "text-zinc-600 hover:text-zinc-400"}`}>
              <div className={`h-1 w-1 rounded-full ${i === 0 ? "bg-emerald-500" : "bg-transparent"}`} />
              {item}
            </div>
          ))}
        </div>

        {/* Main content */}
        <div className="flex-1 p-4 sm:p-6 overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="text-sm font-medium text-zinc-200">Active Tunnels</div>
              <div className="text-[11px] text-zinc-600 mt-0.5">3 tunnels running</div>
            </div>
            <div className="h-7 px-3 rounded-md bg-white/[0.06] text-[10px] text-zinc-400 flex items-center gap-1.5 font-mono">
              + New Tunnel
            </div>
          </div>

          {/* Tunnel cards - animated entrance */}
          <div className="space-y-2.5">
            {[
              { name: "api-dev", url: "api-dev.serverme.site", proto: "HTTP", port: "3000", status: "active", delay: "0s" },
              { name: "postgres", url: "tcp://serverme.site:41923", proto: "TCP", port: "5432", status: "active", delay: "0.15s" },
              { name: "my-saas", url: "my-saas.serverme.site", proto: "HTTP", port: "8080", status: "active", delay: "0.3s" },
            ].map((t) => (
              <div key={t.name} className="flex items-center gap-3 rounded-lg border border-white/[0.04] bg-white/[0.02] p-3 animate-fade-in-up" style={{ animationDelay: t.delay }}>
                <div className={`flex h-8 w-8 items-center justify-center rounded-md text-[10px] font-mono font-medium shrink-0 ${t.proto === "TCP" ? "bg-green-500/10 text-green-400" : "bg-blue-500/10 text-blue-400"}`}>
                  {t.proto}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium text-zinc-300 truncate">{t.url}</span>
                  </div>
                  <div className="text-[10px] text-zinc-600 font-mono mt-0.5">→ localhost:{t.port}</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </span>
                  <span className="text-[10px] text-emerald-500 font-medium">Active</span>
                </div>
              </div>
            ))}
          </div>

          {/* Live request stream */}
          <div className="mt-5 rounded-lg border border-white/[0.04] bg-white/[0.01] overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/[0.04] px-3 py-1.5">
              <div className="text-[10px] text-zinc-600 font-mono flex items-center gap-1.5">
                <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500" /></span>
                Live Traffic
              </div>
              <div className="text-[9px] text-zinc-700 font-mono">12 req/s</div>
            </div>
            <div className="p-2 space-y-0.5 font-mono text-[10px]">
              {[
                { method: "GET", path: "/api/users", status: "200", time: "12ms", color: "text-emerald-400" },
                { method: "POST", path: "/api/webhooks/stripe", status: "201", time: "45ms", color: "text-emerald-400" },
                { method: "GET", path: "/api/products?page=2", status: "200", time: "8ms", color: "text-emerald-400" },
                { method: "DELETE", path: "/api/sessions/expired", status: "204", time: "3ms", color: "text-emerald-400" },
                { method: "POST", path: "/api/auth/login", status: "401", time: "6ms", color: "text-red-400" },
              ].map((req, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/[0.02] animate-fade-in-up" style={{ animationDelay: `${0.5 + i * 0.12}s` }}>
                  <span className={`w-10 shrink-0 font-medium ${req.method === "GET" ? "text-blue-400" : req.method === "POST" ? "text-amber-400" : "text-red-400"}`}>{req.method}</span>
                  <span className="flex-1 text-zinc-400 truncate">{req.path}</span>
                  <span className={`w-6 text-right ${req.color}`}>{req.status}</span>
                  <span className="w-10 text-right text-zinc-600">{req.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Glow effect */}
      <div className="absolute inset-0 pointer-events-none rounded-xl ring-1 ring-inset ring-white/[0.03]" />
    </div>
  );
}

function CodeCard({ lang, code }: { lang: string; code: string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-[#09090b] overflow-hidden transition-colors hover:border-border/60">
      <div className="border-b border-white/[0.04] px-4 py-2 text-[10px] text-zinc-600 font-mono">{lang}</div>
      <div className="overflow-x-auto"><pre className="p-4 text-[12px] leading-relaxed"><code className="text-zinc-400 font-mono">{code}</code></pre></div>
    </div>
  );
}
