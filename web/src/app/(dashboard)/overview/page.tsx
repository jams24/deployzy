"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { AnimatedCounter } from "@/components/marketing/animated-counter";
import {
  Rocket, Globe, Waypoints, Plus, ArrowRight, Activity,
  Database, ExternalLink, GitBranch, Clock,
  ChevronRight, Zap, ArrowUpRight,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Overview — the dashboard landing. Same data sources as before; presentation
// rebuilt with the Deployzy 2.0 language: staggered rise-ins, spotlight stat
// cards with count-ups, refined rows, emerald accents that read in both themes.
// ─────────────────────────────────────────────────────────────────────────────

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";
const EASE = [0.22, 1, 0.36, 1] as const;

interface Project {
  id: string; name: string; subdomain: string; framework: string;
  status: string; last_deploy_at: string | null; branch: string; repo_url: string;
}
interface Tunnel { url: string; protocol: string; name: string; type?: string; }
interface Domain { id: string; domain: string; }
interface Service { id: string; kind: string; label: string; status: string; }
interface Me { name: string; email: string; plan: string; }

const STATUS = {
  running:  { dot: "bg-emerald-500", ring: "bg-emerald-400", label: "running",  pill: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  building: { dot: "bg-sky-500",     ring: "bg-sky-400",     label: "building", pill: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  stopped:  { dot: "bg-zinc-400",    ring: "bg-zinc-300",    label: "stopped",  pill: "bg-muted text-muted-foreground" },
  failed:   { dot: "bg-red-500",     ring: "bg-red-400",     label: "failed",   pill: "bg-red-500/10 text-red-600 dark:text-red-400" },
  created:  { dot: "bg-amber-400",   ring: "bg-amber-300",   label: "created",  pill: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
} as const;

function timeAgo(ts: string | null) {
  if (!ts) return null;
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* Staggered entrance wrapper — mounts after data load, animates once. */
function Rise({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.7, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function StatusDot({ status }: { status: string }) {
  const s = STATUS[status as keyof typeof STATUS] ?? STATUS.stopped;
  const pulse = status === "running" || status === "building";
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {pulse && <span className={`absolute inline-flex h-full w-full rounded-full ${s.ring} opacity-60 animate-ping`} />}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${s.dot}`} />
    </span>
  );
}

/* Cursor spotlight — same technique as the marketing bento grid. */
function useSpotlight() {
  return useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, []);
}

export default function OverviewPage() {
  const [user, setUser] = useState<Me | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const onSpotlight = useSpotlight();

  const headers = () => {
    const token = localStorage.getItem("sm_token");
    return { Authorization: `Bearer ${token}` };
  };

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/v1/users/me`, { headers: headers() }).then(r => r.ok ? r.json() : null),
      fetch(`${API}/api/v1/projects`, { headers: headers() }).then(r => r.ok ? r.json() : []),
      fetch(`${API}/api/v1/tunnels`, { headers: headers() }).then(r => r.ok ? r.json() : []),
      fetch(`${API}/api/v1/domains`, { headers: headers() }).then(r => r.ok ? r.json() : []),
      fetch(`${API}/api/v1/services`, { headers: headers() }).then(r => r.ok ? r.json() : []),
    ]).then(([u, p, t, d, sv]) => {
      setUser(u);
      setProjects(Array.isArray(p) ? p : []);
      setTunnels(Array.isArray(t) ? t : []);
      setDomains(Array.isArray(d) ? d : []);
      setServices(Array.isArray(sv) ? sv : []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  };

  const running  = projects.filter(p => p.status === "running");
  const building = projects.filter(p => p.status === "building");
  const stopped  = projects.filter(p => p.status === "stopped" || p.status === "failed");
  const activeTunnels = tunnels.filter(t => t.type === "tunnel");

  const firstName = user?.name?.split(" ")[0] || "there";
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const dbKinds = [...new Set(services.map(s => s.kind))].slice(0, 3).join(" · ");

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="space-y-2.5">
          <div className="h-3 w-40 bg-muted rounded-full animate-pulse" />
          <div className="h-8 w-64 bg-muted rounded-lg animate-pulse" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-[104px] bg-muted rounded-2xl animate-pulse" />)}
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
          <div className="h-72 bg-muted rounded-2xl animate-pulse" />
          <div className="h-72 bg-muted rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">

      {/* ── Header ─────────────────────────────────────────────── */}
      <Rise>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
              {today}
            </p>
            <h1 className="mt-1.5 text-[26px] font-bold tracking-[-0.02em] leading-tight">
              {greeting()}, {firstName}.
            </h1>
            <p className="mt-1.5 flex items-center gap-2 text-[13px] text-muted-foreground">
              {running.length > 0 && (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
              )}
              {running.length > 0
                ? `${running.length} service${running.length !== 1 ? "s" : ""} running`
                : "No services running yet"}
              {building.length > 0 && ` · ${building.length} building`}
            </p>
          </div>
          <Link
            href="/new"
            className="btn-shine flex items-center gap-2 rounded-full bg-foreground text-background px-5 py-2.5 text-[13px] font-semibold transition-transform duration-200 hover:scale-[1.03] active:scale-[0.97] shrink-0"
          >
            <Plus className="h-4 w-4" /> New Project
          </Link>
        </div>
      </Rise>

      {/* ── Stat strip ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Projects", value: projects.length, icon: Rocket,   href: "/projects", sub: "across your workspace" },
          { label: "Running",        value: running.length,  icon: Activity, href: "/projects", sub: building.length > 0 ? `${building.length} building now` : "all systems normal", live: true },
          { label: "Databases",      value: services.length, icon: Database, href: "/services", sub: dbKinds || "none provisioned" },
          { label: "Custom Domains", value: domains.length,  icon: Globe,    href: "/domains",  sub: "auto-TLS enabled" },
        ].map((s, i) => (
          <Rise key={s.label} delay={0.08 + i * 0.06}>
            <Link
              href={s.href}
              onMouseMove={onSpotlight}
              className="spotlight group relative block overflow-hidden rounded-2xl border border-border/60 bg-card/60 px-4 py-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[0_12px_32px_-16px_rgba(0,0,0,0.2)] dark:bg-[#0c0d0f]/40 dark:hover:shadow-[0_12px_32px_-16px_rgba(0,0,0,0.6)]"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground transition-colors duration-300 group-hover:border-emerald-500/40 group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                  <s.icon className="h-3.5 w-3.5" />
                </span>
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/50 transition-all duration-300 group-hover:text-foreground group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
              <p className="text-[26px] font-bold tracking-tight leading-none tabular-nums">
                <AnimatedCounter value={s.value} duration={0.9} />
              </p>
              <p className="mt-1.5 text-[11px] text-muted-foreground flex items-center gap-1.5 truncate">
                {"live" in s && s.live && s.value > 0 && (
                  <span className="h-1 w-1 rounded-full bg-emerald-500 shrink-0" />
                )}
                {s.label}
                <span className="text-muted-foreground/50 truncate">· {s.sub}</span>
              </p>
            </Link>
          </Rise>
        ))}
      </div>

      {/* ── Body: projects list + rail ─────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">

        {/* Projects list */}
        <Rise delay={0.28} className="space-y-6">

          {/* Running */}
          {running.length > 0 && (
            <section>
              <SectionHead
                dot={<span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>}
                title="Running"
                count={running.length}
                href="/projects"
              />
              <div className="rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 overflow-hidden divide-y divide-border/60">
                {running.slice(0, 8).map(p => (
                  <ProjectRow key={p.id} p={p} />
                ))}
              </div>
            </section>
          )}

          {/* Building */}
          {building.length > 0 && (
            <section>
              <SectionHead
                dot={<span className="h-2 w-2 rounded-full bg-sky-500 animate-pulse" />}
                title="Building"
                count={building.length}
              />
              <div className="rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 overflow-hidden divide-y divide-border/60">
                {building.map(p => <ProjectRow key={p.id} p={p} />)}
              </div>
            </section>
          )}

          {/* Stopped / failed */}
          {stopped.length > 0 && (
            <section>
              <SectionHead
                dot={<span className="h-2 w-2 rounded-full bg-zinc-400" />}
                title="Stopped / Failed"
                count={stopped.length}
                muted
              />
              <div className="rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 overflow-hidden divide-y divide-border/60 opacity-70">
                {stopped.slice(0, 4).map(p => <ProjectRow key={p.id} p={p} />)}
              </div>
            </section>
          )}

          {/* Empty state */}
          {projects.length === 0 && (
            <div className="relative rounded-2xl border border-dashed border-border py-16 flex flex-col items-center gap-4 text-center overflow-hidden">
              <div aria-hidden className="pointer-events-none absolute -top-20 left-1/2 h-40 w-[380px] -translate-x-1/2 rounded-full bg-emerald-500/[0.07] blur-[80px] dark:bg-emerald-400/[0.08]" />
              <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-border/70 bg-card">
                <Rocket className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="relative">
                <p className="font-semibold text-sm">No projects yet</p>
                <p className="text-xs text-muted-foreground mt-1">Deploy your first app from a GitHub repo — live in under 30 seconds.</p>
              </div>
              <Link
                href="/new"
                className="btn-shine relative mt-1 flex items-center gap-1.5 rounded-full bg-foreground px-5 py-2.5 text-[13px] font-semibold text-background transition-transform duration-200 hover:scale-[1.03] active:scale-[0.97]"
              >
                Get started <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}
        </Rise>

        {/* ── Rail ─────────────────────────────────────────────── */}
        <Rise delay={0.36} className="space-y-4">

          {/* Quick actions */}
          <div className="rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 overflow-hidden">
            <RailHead label="Quick Deploy" />
            <div className="divide-y divide-border/60">
              {[
                { icon: Rocket,    label: "Deploy from GitHub", sub: "Import a repo",            href: "/new" },
                { icon: Database,  label: "Add Database",       sub: "PostgreSQL, Redis, Mongo", href: "/services" },
                { icon: Globe,     label: "Add Custom Domain",  sub: "TLS auto-provisioned",     href: "/domains" },
                { icon: Waypoints, label: "Open a Tunnel",      sub: "Expose a local port",      href: "/tunnels" },
              ].map(a => (
                <Link key={a.label} href={a.href} className="flex items-center gap-3 px-3.5 py-3 hover:bg-accent/60 transition-colors group">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground shrink-0 transition-colors duration-300 group-hover:border-emerald-500/40 group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                    <a.icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium leading-tight">{a.label}</p>
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">{a.sub}</p>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-foreground" />
                </Link>
              ))}
            </div>
          </div>

          {/* Plan & usage */}
          <div className="rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 overflow-hidden">
            <div className="px-3.5 py-2.5 border-b border-border/60 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Plan</p>
              {user?.plan && (
                <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${
                  user.plan === "pro"  ? "bg-blue-500/15 text-blue-600 dark:text-blue-400" :
                  user.plan === "team" ? "bg-violet-500/15 text-violet-600 dark:text-violet-400" :
                                        "bg-muted text-muted-foreground"
                }`}>{user.plan}</span>
              )}
            </div>
            <div className="p-3.5 space-y-3.5">
              <UsageStat label="Projects" used={projects.length} limit={user?.plan === "free" ? 5 : null} />
              <UsageStat label="Tunnels"  used={activeTunnels.length} limit={null} />
              <UsageStat label="Domains"  used={domains.length} limit={null} />
              {user?.plan === "free" && (
                <Link
                  href="/billing"
                  className="btn-shine flex items-center justify-center gap-1.5 w-full rounded-full bg-foreground py-2 text-[12px] font-semibold text-background transition-transform duration-200 hover:scale-[1.02] active:scale-[0.98] mt-1"
                >
                  <Zap className="h-3 w-3" /> Upgrade to Pro
                </Link>
              )}
            </div>
          </div>

          {/* Active tunnels */}
          {activeTunnels.length > 0 && (
            <div className="rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 overflow-hidden">
              <RailHead label="Active Tunnels" />
              <div className="divide-y divide-border/60">
                {activeTunnels.slice(0, 3).map((t, i) => (
                  <div key={i} className="flex items-center gap-2.5 px-3.5 py-2.5">
                    <span className="relative flex h-1.5 w-1.5 shrink-0">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75 animate-ping" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-sky-500" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-medium truncate">{t.name || t.url}</p>
                      <p className="text-[10px] text-muted-foreground font-mono truncate">{t.protocol}</p>
                    </div>
                    <a href={t.url} target="_blank" rel="noreferrer" className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0">
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Rise>
      </div>
    </div>
  );
}

/* ── Bits ─────────────────────────────────────────────────────────────────── */

function SectionHead({ dot, title, count, href, muted = false }: {
  dot: React.ReactNode; title: string; count: number; href?: string; muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between mb-2.5">
      <h2 className={`text-[13px] font-semibold flex items-center gap-2 ${muted ? "text-muted-foreground" : ""}`}>
        {dot}
        {title}
        <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground tabular-nums">{count}</span>
      </h2>
      {href && (
        <Link href={href} className="group text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
          View all <ArrowRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}

function RailHead({ label }: { label: string }) {
  return (
    <div className="px-3.5 py-2.5 border-b border-border/60">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">{label}</p>
    </div>
  );
}

function ProjectRow({ p }: { p: Project }) {
  const s = STATUS[p.status as keyof typeof STATUS] ?? STATUS.stopped;
  const ago = timeAgo(p.last_deploy_at);
  const repo = p.repo_url?.replace("https://github.com/", "") || "";

  return (
    <Link href={`/projects?id=${p.id}`} className="group flex items-center gap-3 px-4 py-3.5 hover:bg-accent/60 transition-colors">
      <StatusDot status={p.status} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-medium truncate">{p.name}</span>
          <span className={`text-[10px] font-medium shrink-0 rounded-full px-2 py-px ${s.pill}`}>{s.label}</span>
        </div>
        <p className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">{p.subdomain}.deployzy.app</p>
      </div>

      <div className="hidden sm:flex items-center gap-2 shrink-0">
        {p.framework && (
          <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full font-mono">
            {p.framework}
          </span>
        )}
        {repo && (
          <span className="text-[10px] text-muted-foreground items-center gap-1 hidden lg:flex">
            <GitBranch className="h-3 w-3" />{repo.split("/")[1] || repo}
          </span>
        )}
      </div>

      {ago && (
        <span className="text-[10px] text-muted-foreground shrink-0 hidden md:flex items-center gap-1 tabular-nums">
          <Clock className="h-3 w-3" />{ago}
        </span>
      )}

      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-foreground" />
    </Link>
  );
}

function UsageStat({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min((used / limit) * 100, 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] text-muted-foreground">{label}</span>
        <span className="text-[12px] font-medium tabular-nums">
          {used}{limit ? <span className="text-muted-foreground">/{limit}</span> : ""}
        </span>
      </div>
      {limit && (
        <div className="h-1 w-full rounded-full bg-border overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              pct >= 90 ? "bg-red-500" :
              pct >= 70 ? "bg-amber-500" :
              "bg-gradient-to-r from-emerald-500 to-emerald-400"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
