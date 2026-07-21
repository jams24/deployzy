"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Rocket, Globe, Waypoints, Plus, ArrowRight, Activity,
  Database, ExternalLink, GitBranch, Circle, Clock, Server,
  ChevronRight, Zap, Link2,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface Project {
  id: string; name: string; subdomain: string; framework: string;
  status: string; last_deploy_at: string | null; branch: string; repo_url: string;
}
interface Tunnel { url: string; protocol: string; name: string; type?: string; }
interface Domain { id: string; domain: string; }
interface Service { id: string; kind: string; label: string; status: string; }
interface Me { name: string; email: string; plan: string; }

const STATUS = {
  running:  { dot: "bg-emerald-500", ring: "bg-emerald-400", label: "running",  cls: "text-emerald-600 dark:text-emerald-400" },
  building: { dot: "bg-sky-500",     ring: "bg-sky-400",     label: "building", cls: "text-sky-600 dark:text-sky-400" },
  stopped:  { dot: "bg-zinc-400",    ring: "bg-zinc-300",    label: "stopped",  cls: "text-muted-foreground" },
  failed:   { dot: "bg-red-500",     ring: "bg-red-400",     label: "failed",   cls: "text-red-600 dark:text-red-400" },
  created:  { dot: "bg-amber-400",   ring: "bg-amber-300",   label: "created",  cls: "text-amber-600 dark:text-amber-400" },
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

export default function OverviewPage() {
  const [user, setUser] = useState<Me | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {greeting()}, {firstName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {running.length > 0
              ? `${running.length} service${running.length !== 1 ? "s" : ""} running`
              : "No services running yet"}
            {building.length > 0 && ` · ${building.length} building`}
          </p>
        </div>
        <Link
          href="/new"
          className="flex items-center gap-2 rounded-lg bg-foreground text-background px-4 py-2 text-sm font-semibold hover:opacity-85 transition-opacity shrink-0"
        >
          <Plus className="h-4 w-4" /> New Project
        </Link>
      </div>

      {/* ── Stat strip ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Projects",   value: projects.length,     icon: Rocket,   href: "/projects" },
          { label: "Running",          value: running.length,      icon: Activity, href: "/projects" },
          { label: "Databases",        value: services.length,     icon: Database, href: "/services" },
          { label: "Custom Domains",   value: domains.length,      icon: Globe,    href: "/domains"  },
        ].map(s => (
          <Link key={s.label} href={s.href}>
            <div className="group rounded-xl border border-border bg-card px-4 py-4 hover:border-foreground/20 transition-colors cursor-pointer">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground font-medium">{s.label}</span>
                <s.icon className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
              </div>
              <p className="text-2xl font-bold tracking-tight">{s.value}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* ── Body: projects list + sidebar ──────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">

        {/* Projects list */}
        <div className="space-y-4">

          {/* Running */}
          {running.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
                  Running
                  <span className="text-muted-foreground font-normal">({running.length})</span>
                </h2>
                <Link href="/projects" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                  View all <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
                {running.slice(0, 8).map(p => (
                  <ProjectRow key={p.id} p={p} />
                ))}
              </div>
            </section>
          )}

          {/* Building */}
          {building.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-sky-500 animate-pulse" />
                Building
                <span className="text-muted-foreground font-normal">({building.length})</span>
              </h2>
              <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
                {building.map(p => <ProjectRow key={p.id} p={p} />)}
              </div>
            </section>
          )}

          {/* Stopped / failed */}
          {stopped.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold mb-2 text-muted-foreground flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-zinc-400" />
                Stopped / Failed
                <span className="font-normal">({stopped.length})</span>
              </h2>
              <div className="rounded-xl border border-border overflow-hidden divide-y divide-border opacity-70">
                {stopped.slice(0, 4).map(p => <ProjectRow key={p.id} p={p} />)}
              </div>
            </section>
          )}

          {/* Empty state */}
          {projects.length === 0 && (
            <div className="rounded-xl border border-dashed border-border py-16 flex flex-col items-center gap-3 text-center">
              <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center">
                <Rocket className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="font-semibold text-sm">No projects yet</p>
                <p className="text-xs text-muted-foreground mt-0.5">Deploy your first app from a GitHub repo.</p>
              </div>
              <Link href="/new" className="mt-1 flex items-center gap-1.5 text-sm font-medium hover:text-muted-foreground transition-colors">
                Get started <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}
        </div>

        {/* ── Sidebar ──────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Quick actions */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="px-3 py-2.5 border-b border-border">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Quick Deploy</p>
            </div>
            <div className="divide-y divide-border">
              {[
                { icon: Rocket,   label: "Deploy from GitHub",  sub: "Import a repo",          href: "/new" },
                { icon: Database, label: "Add Database",         sub: "PostgreSQL, Redis, Mongo", href: "/services" },
                { icon: Globe,    label: "Add Custom Domain",    sub: "TLS auto-provisioned",   href: "/domains" },
                { icon: Waypoints,label: "Open a Tunnel",        sub: "Expose local port",      href: "/tunnels" },
              ].map(a => (
                <Link key={a.label} href={a.href} className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent transition-colors group">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted shrink-0 group-hover:bg-accent-foreground/5 transition-colors">
                    <a.icon className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium leading-tight">{a.label}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{a.sub}</p>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                </Link>
              ))}
            </div>
          </div>

          {/* Plan & usage */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="px-3 py-2.5 border-b border-border flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Plan</p>
              {user?.plan && (
                <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${
                  user.plan === "pro"  ? "bg-blue-500/15 text-blue-600 dark:text-blue-400" :
                  user.plan === "team" ? "bg-violet-500/15 text-violet-600 dark:text-violet-400" :
                                        "bg-muted text-muted-foreground"
                }`}>{user.plan}</span>
              )}
            </div>
            <div className="p-3 space-y-3">
              <UsageStat label="Projects" used={projects.length} limit={user?.plan === "free" ? 5 : null} />
              <UsageStat label="Tunnels"  used={activeTunnels.length} limit={null} />
              <UsageStat label="Domains"  used={domains.length} limit={null} />
              {user?.plan === "free" && (
                <Link href="/billing" className="flex items-center justify-center gap-1.5 w-full rounded-lg border border-border py-2 text-[12px] font-medium hover:bg-accent transition-colors mt-2">
                  <Zap className="h-3 w-3" /> Upgrade to Pro
                </Link>
              )}
            </div>
          </div>

          {/* Active tunnels */}
          {activeTunnels.length > 0 && (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-3 py-2.5 border-b border-border">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Active Tunnels</p>
              </div>
              <div className="divide-y divide-border">
                {activeTunnels.slice(0, 3).map((t, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2">
                    <span className="relative flex h-1.5 w-1.5 shrink-0"><span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 animate-ping" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-medium truncate">{t.name || t.url}</p>
                      <p className="text-[10px] text-muted-foreground font-mono truncate">{t.protocol}</p>
                    </div>
                    <a href={t.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectRow({ p }: { p: Project }) {
  const s = STATUS[p.status as keyof typeof STATUS] ?? STATUS.stopped;
  const ago = timeAgo(p.last_deploy_at);
  const repo = p.repo_url?.replace("https://github.com/", "") || "";

  return (
    <Link href={`/projects?id=${p.id}`} className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-accent/50 transition-colors group">
      {/* Status dot */}
      <StatusDot status={p.status} />

      {/* Name + subdomain */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-medium truncate">{p.name}</span>
          <span className={`text-[10px] font-medium shrink-0 ${s.cls}`}>{s.label}</span>
        </div>
        <p className="text-[11px] text-muted-foreground font-mono truncate">{p.subdomain}.deployzy.com</p>
      </div>

      {/* Framework + branch */}
      <div className="hidden sm:flex items-center gap-2 shrink-0">
        {p.framework && (
          <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full font-mono">
            {p.framework}
          </span>
        )}
        {repo && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-1 hidden lg:flex">
            <GitBranch className="h-3 w-3" />{repo.split("/")[1] || repo}
          </span>
        )}
      </div>

      {/* Last deploy */}
      {ago && (
        <span className="text-[10px] text-muted-foreground shrink-0 hidden md:block flex items-center gap-1">
          <Clock className="h-3 w-3 inline mr-0.5" />{ago}
        </span>
      )}

      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
    </Link>
  );
}

function UsageStat({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min((used / limit) * 100, 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[12px] text-muted-foreground">{label}</span>
        <span className="text-[12px] font-medium tabular-nums">
          {used}{limit ? <span className="text-muted-foreground">/{limit}</span> : ""}
        </span>
      </div>
      {limit && (
        <div className="h-1 w-full rounded-full bg-border overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-foreground"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
