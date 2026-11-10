"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, ChevronRight, Database, ExternalLink, GitBranch, Globe, Plus, Rocket, Search, Waypoints, Zap } from "lucide-react";
import { AnimatedCounter } from "@/components/marketing/animated-counter";
import { openCommandMenu } from "@/components/dashboard/command-menu";
import { EmptyState, PanelHeader, StackIcon, StatusPill, TONE_DOT, statusTone, type Tone } from "@/components/dashboard/kit";
import { API, headers } from "@/components/project/project-shared";
import { fetchPlanCards, type PlanLimits } from "@/lib/plans";
import { useModKey } from "@/lib/use-me";
import { cn } from "@/lib/utils";

// Overview: the dashboard landing. Fleet health first (how many apps are up,
// what needs attention), then the project list, then shortcuts and plan usage.

interface Project {
  id: string;
  name: string;
  subdomain: string;
  framework: string;
  status: string;
  last_deploy_at: string | null;
  branch: string;
  repo_url: string;
}
interface Tunnel { url: string; protocol: string; name: string; type?: string }
interface Domain { id: string; domain: string }
interface DbRow { id: string; type: string }
interface Me { name: string; email: string; plan: string }

const DB_LABEL: Record<string, string> = { postgres: "Postgres", postgresql: "Postgres", redis: "Redis", mongo: "Mongo", mongodb: "Mongo", mysql: "MySQL" };

type Filter = "all" | "ok" | "bad" | "idle";

function timeAgo(ts: string | null) {
  if (!ts) return null;
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function OverviewPage() {
  const mod = useModKey();
  const [user, setUser] = useState<Me | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [dbs, setDbs] = useState<DbRow[]>([]);
  const [limits, setLimits] = useState<PlanLimits[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    const get = (path: string, fallback: unknown) =>
      fetch(`${API}${path}`, { headers: headers() })
        .then((r) => (r.ok ? r.json() : fallback))
        .catch(() => fallback);
    Promise.all([get("/api/v1/users/me", null), get("/api/v1/projects", []), get("/api/v1/tunnels", []), get("/api/v1/domains", []), get("/api/v1/databases", [])])
      .then(([u, p, t, d, db]) => {
        setUser(u as Me | null);
        setProjects(Array.isArray(p) ? p : []);
        setTunnels(Array.isArray(t) ? t : []);
        setDomains(Array.isArray(d) ? d : []);
        setDbs(Array.isArray(db) ? db : []);
      })
      .finally(() => setLoading(false));
    fetchPlanCards().then((cards) => setLimits(cards ? cards.map((c) => c.limits) : null));
  }, []);

  const byTone = useMemo(() => {
    const c: Record<Tone, number> = { ok: 0, busy: 0, bad: 0, idle: 0, new: 0 };
    for (const p of projects) c[statusTone(p.status)]++;
    return c;
  }, [projects]);

  const sorted = useMemo(
    () =>
      [...projects].sort((a, b) => {
        // Problems first, then most recently deployed.
        const rank = (p: Project) => (statusTone(p.status) === "bad" ? 0 : statusTone(p.status) === "busy" ? 1 : 2);
        return rank(a) - rank(b) || (b.last_deploy_at ?? "").localeCompare(a.last_deploy_at ?? "");
      }),
    [projects],
  );
  const visible = sorted.filter((p) => {
    const t = statusTone(p.status);
    if (filter === "all") return true;
    if (filter === "idle") return t === "idle" || t === "new";
    if (filter === "ok") return t === "ok" || t === "busy";
    return t === filter;
  });

  const activeTunnels = tunnels.filter((t) => t.type === "tunnel");
  const dbMix = Object.entries(
    dbs.reduce<Record<string, number>>((acc, d) => {
      const k = DB_LABEL[d.type] ?? d.type;
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}\u00a0${v}`) // keep "Redis 1" on one line when the tile wraps
    .join(" · ");

  const planLimits = limits?.find((l) => l.plan === user?.plan) ?? null;
  const firstName = user?.name?.split(" ")[0] || "there";
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const total = projects.length;

  if (loading) {
    return (
      <div className="space-y-8" aria-busy>
        <div className="space-y-3">
          <div className="h-3 w-40 animate-pulse rounded-full bg-muted" />
          <div className="h-9 w-72 animate-pulse rounded-xl bg-muted" />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="col-span-2 h-[148px] animate-pulse rounded-3xl bg-muted" />
          <div className="h-[148px] animate-pulse rounded-3xl bg-muted" />
          <div className="h-[148px] animate-pulse rounded-3xl bg-muted" />
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="h-80 animate-pulse rounded-3xl bg-muted" />
          <div className="h-80 animate-pulse rounded-3xl bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="rise flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">{today}</p>
          <h1 className="mt-2 text-[30px] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[38px]">
            {greeting()}, <span className="accent-serif text-brand">{firstName}</span>.
          </h1>
          <p className="mt-2 flex items-center gap-2 text-[14.5px] text-muted-foreground">
            {byTone.ok > 0 && <span className="live-dot bg-brand" />}
            {total === 0
              ? "Nothing deployed yet. Your first app is a minute away."
              : byTone.bad > 0
                ? `${byTone.ok} of ${total} up · ${byTone.bad} need${byTone.bad === 1 ? "s" : ""} attention`
                : `${byTone.ok} of ${total} up${byTone.busy ? ` · ${byTone.busy} building` : " · all healthy"}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* .pill is unlayered CSS and would beat `hidden`, so the wrapper does the hiding. */}
          <span className="hidden sm:contents">
            <button type="button" onClick={openCommandMenu} className="pill pill-line pill-sm">
              <Search className="h-4 w-4" />
              Search
              <kbd className="rounded-md border px-1.5 font-mono text-[11px] text-muted-foreground">{mod}K</kbd>
            </button>
          </span>
          <Link href="/new" className="pill pill-ink pill-sm">
            <Plus className="h-4 w-4" />
            New project
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link
          href="/projects"
          className="rise surface group col-span-2 flex flex-col justify-between gap-5 rounded-3xl p-5 transition-colors hover:border-foreground/15 sm:p-6"
          style={{ animationDelay: "60ms" }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Projects</p>
              <p className="figure mt-2 text-[40px] font-semibold leading-none tracking-[-0.04em]">
                <AnimatedCounter value={total} duration={0.9} />
              </p>
            </div>
            <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
          </div>
          <div>
            <div className="flex h-2 w-full gap-[3px] overflow-hidden rounded-full bg-foreground/[0.06]" role="img" aria-label="Project health">
              {(["ok", "busy", "bad", "idle"] as Tone[]).map((t) => {
                // "created" (never deployed) counts as stopped, same as the legend.
                const n = t === "idle" ? byTone.idle + byTone.new : byTone[t];
                return n ? <span key={t} className={cn("h-full rounded-full", TONE_DOT[t])} style={{ flexGrow: n }} /> : null;
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
              <Legend tone="ok" label="Running" n={byTone.ok} />
              <Legend tone="busy" label="Building" n={byTone.busy} />
              <Legend tone="bad" label="Failed" n={byTone.bad} />
              <Legend tone="idle" label="Stopped" n={byTone.idle + byTone.new} />
            </div>
          </div>
        </Link>
        <StatTile href="/services" eyebrow="Databases" value={dbs.length} sub={dbMix || "None yet"} icon={Database} delay={120} />
        <StatTile href="/domains" eyebrow="Domains" value={domains.length} sub={domains.length ? "TLS issued automatically" : "Bring your own"} icon={Globe} delay={180} />
      </div>

      {/* Body */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="rise min-w-0" style={{ animationDelay: "220ms" }}>
          {total === 0 ? (
            <EmptyState
              icon={Rocket}
              title="No projects yet"
              description="Import a GitHub repo, upload a folder or start from a template. It's live on a deployzy.app URL in about a minute."
              action={
                <Link href="/new" className="pill pill-ink pill-sm">
                  Deploy your first app <ArrowRight className="h-4 w-4" />
                </Link>
              }
            />
          ) : (
            <div className="surface overflow-hidden rounded-3xl">
              <PanelHeader
                title="Projects"
                count={total}
                action={
                  <Link href="/projects" className="group flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
                    View all <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                }
              />
              <div className="flex gap-1.5 overflow-x-auto border-b border-[var(--dz-hairline)] px-4 py-2.5 sm:px-5" role="tablist">
                {(
                  [
                    ["all", "All", total],
                    ["ok", "Live", byTone.ok + byTone.busy],
                    ["bad", "Failed", byTone.bad],
                    ["idle", "Stopped", byTone.idle + byTone.new],
                  ] as [Filter, string, number][]
                ).map(([key, label, n]) =>
                  key !== "all" && n === 0 ? null : (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={filter === key}
                      onClick={() => setFilter(key)}
                      className={cn(
                        "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors",
                        filter === key ? "bg-foreground text-background" : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
                      )}
                    >
                      {label}
                      <span className={cn("figure text-[12px]", filter === key ? "opacity-70" : "opacity-60")}>{n}</span>
                    </button>
                  ),
                )}
              </div>
              <ul className="divide-y divide-[var(--dz-hairline)]">
                {visible.slice(0, 8).map((p) => (
                  <li key={p.id}>
                    <ProjectRow p={p} />
                  </li>
                ))}
              </ul>
              {visible.length > 8 && (
                <Link href="/projects" className="flex items-center justify-center gap-1.5 border-t border-[var(--dz-hairline)] py-3 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
                  {visible.length - 8} more <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          )}
        </section>

        <aside className="rise space-y-4" style={{ animationDelay: "280ms" }}>
          <div className="grid grid-cols-2 gap-2">
            {[
              { icon: Rocket, label: "Deploy repo", href: "/new" },
              { icon: Database, label: "New database", href: "/new?type=database" },
              { icon: Globe, label: "Add domain", href: "/domains" },
              { icon: Waypoints, label: "Open tunnel", href: "/tunnels" },
            ].map((a) => (
              <Link key={a.label} href={a.href} className="surface group flex flex-col gap-3 rounded-2xl p-3.5 transition-colors hover:border-foreground/15">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-foreground/[0.05] text-muted-foreground transition-colors group-hover:bg-brand/15 group-hover:text-brand">
                  <a.icon className="h-4 w-4" />
                </span>
                <span className="text-[13.5px] font-medium leading-tight">{a.label}</span>
              </Link>
            ))}
          </div>

          <div className="surface overflow-hidden rounded-3xl">
            <PanelHeader
              title="Plan usage"
              action={
                user?.plan && (
                  <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-[var(--dz-green-strong)] dark:text-brand">
                    {user.plan}
                  </span>
                )
              }
            />
            <div className="space-y-4 p-4 sm:p-5">
              <Meter label="Projects" used={total} limit={planLimits?.max_projects} />
              <Meter label="Databases" used={dbs.length} limit={planLimits?.max_databases} />
              <Meter label="Custom domains" used={domains.length} limit={planLimits?.max_custom_domains} />
              <Meter label="Tunnels online" used={activeTunnels.length} limit={planLimits?.max_tunnels} />
              {user?.plan === "free" && (
                <Link href="/billing" className="pill pill-launch pill-sm mt-1 w-full">
                  <Zap className="h-4 w-4" /> Upgrade plan
                </Link>
              )}
            </div>
          </div>

          {activeTunnels.length > 0 && (
            <div className="surface overflow-hidden rounded-3xl">
              <PanelHeader title="Live tunnels" count={activeTunnels.length} />
              <ul className="divide-y divide-[var(--dz-hairline)]">
                {activeTunnels.slice(0, 4).map((t) => (
                  <li key={t.url} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <span className="live-dot bg-brand-cyan" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium">{t.name || t.url.replace(/^https?:\/\//, "")}</p>
                      <p className="font-mono text-[12px] uppercase text-muted-foreground">{t.protocol}</p>
                    </div>
                    <a href={t.url} target="_blank" rel="noreferrer" aria-label="Open tunnel" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Legend({ tone, label, n }: { tone: Tone; label: string; n: number }) {
  if (!n) return null;
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-full", TONE_DOT[tone])} />
      {label} <span className="figure font-medium text-foreground">{n}</span>
    </span>
  );
}

function StatTile({ href, eyebrow, value, sub, icon: Icon, delay }: { href: string; eyebrow: string; value: number; sub: string; icon: typeof Rocket; delay: number }) {
  return (
    <Link
      href={href}
      className="rise surface group flex min-w-0 flex-col justify-between gap-5 rounded-3xl p-5 transition-colors hover:border-foreground/15 sm:p-6"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between">
        <p className="eyebrow">{eyebrow}</p>
        <Icon className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-brand" />
      </div>
      <div className="min-w-0">
        <p className="figure text-[34px] font-semibold leading-none tracking-[-0.04em]">
          <AnimatedCounter value={value} duration={0.9} />
        </p>
        <p className="mt-2 line-clamp-2 text-[13px] text-muted-foreground">{sub}</p>
      </div>
    </Link>
  );
}

function ProjectRow({ p }: { p: Project }) {
  const ago = timeAgo(p.last_deploy_at);
  const repo = p.repo_url?.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "") || "";
  return (
    <Link href={`/projects/${p.id}`} className="group flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-foreground/[0.025] sm:px-5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--dz-hairline)] bg-background text-foreground/80 dark:bg-white/[0.03]">
        <StackIcon stack={p.framework} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[14.5px] font-medium">{p.name}</span>
          <StatusPill status={p.status} />
        </div>
        <p className="mt-0.5 truncate font-mono text-[12.5px] text-muted-foreground">{p.subdomain}.deployzy.app</p>
      </div>
      {repo && (
        <span className="hidden max-w-[160px] items-center gap-1.5 truncate text-[12.5px] text-muted-foreground xl:flex">
          <GitBranch className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{repo}</span>
        </span>
      )}
      {ago && <span className="figure hidden w-16 shrink-0 text-right text-[12.5px] text-muted-foreground md:block">{ago}</span>}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
    </Link>
  );
}

function Meter({ label, used, limit }: { label: string; used: number; limit?: number | null }) {
  // limit: undefined/null = unknown, < 0 = unlimited.
  const capped = typeof limit === "number" && limit > 0;
  const pct = capped ? Math.min((used / limit) * 100, 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="figure font-medium">
          {used}
          {capped ? <span className="text-muted-foreground"> / {limit}</span> : typeof limit === "number" && limit < 0 ? <span className="text-muted-foreground"> / ∞</span> : null}
        </span>
      </div>
      {capped && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]">
          <div
            className={cn("h-full rounded-full transition-[width] duration-700", pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-brand")}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
