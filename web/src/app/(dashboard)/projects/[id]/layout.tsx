"use client";

// Project detail shell — header (identity, status, primary actions) + tab nav.
// Every tab (/overview, /logs, /metrics, /analytics, /settings) renders below
// the shared header and reads the project from ProjectProvider.

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Rocket, Globe, GitBranch, ExternalLink, RefreshCw,
  Play, Square, Loader2, LayoutDashboard, ScrollText, Activity,
  BarChart3, Settings,
} from "lucide-react";
import { ProjectProvider, useProject } from "@/components/project/project-context";
import { ReuploadButton } from "@/components/project/reupload-button";
import { statusDot, statusColor, timeAgo } from "@/components/project/project-shared";

const TABS = [
  { slug: "", label: "Overview", icon: LayoutDashboard },
  { slug: "/logs", label: "Logs", icon: ScrollText },
  { slug: "/metrics", label: "Metrics", icon: Activity },
  { slug: "/analytics", label: "Analytics", icon: BarChart3 },
  { slug: "/settings", label: "Settings", icon: Settings },
] as const;

function ProjectHeader() {
  const { project: p, deploying, deploy, stop, refresh } = useProject();
  const router = useRouter();
  const running = p.status === "running";
  const building = p.status === "building";
  // The ReuploadButton deploys internally after the upload lands — afterwards
  // just refresh + go watch the build stream.
  const afterReupload = () => { refresh(); router.push(`/projects/${p.id}/logs`); };

  return (
    <div>
      {/* Back link */}
      <Link href="/projects" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-3.5 w-3.5" /> Projects
      </Link>

      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        {/* Identity */}
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-background text-muted-foreground shrink-0 mt-0.5">
            <Rocket className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="relative flex h-2 w-2 shrink-0" title={p.status}>
                {running && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />}
                <span className={`relative inline-flex h-2 w-2 rounded-full ${statusDot[p.status] || "bg-zinc-500"}`} />
              </span>
              <h1 className="text-xl font-bold tracking-tight truncate">{p.name}</h1>
              <Badge variant="outline" className={`text-[10px] shrink-0 ${statusColor[p.status] || ""}`}>{p.status}</Badge>
              {(p.labels || []).map((l) => (
                <Badge key={l} variant="outline" className="text-[10px] shrink-0 text-blue-600 dark:text-blue-400 border-blue-500/40 bg-blue-500/5">{l}</Badge>
              ))}
            </div>
            <a
              href={`https://${p.subdomain}.deployzy.app`}
              target="_blank"
              rel="noopener"
              className="mt-1 inline-flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
            >
              <Globe className="h-3 w-3 shrink-0" />
              {p.subdomain}.deployzy.app
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
              <span className="capitalize">{p.framework || "custom"}</span>
              {p.github_repo && (
                <>
                  <span className="text-border">·</span>
                  <span className="inline-flex items-center gap-1 min-w-0">
                    <GitBranch className="h-3 w-3 shrink-0" />
                    <span className="truncate">{p.github_repo}</span>
                  </span>
                  <span className="text-border">·</span>
                  <span>{p.github_branch || p.branch || "main"}</span>
                </>
              )}
              {p.commit_sha && (
                <>
                  <span className="text-border">·</span>
                  <code className="font-mono">@ {p.commit_sha.slice(0, 7)}</code>
                </>
              )}
              <span className="text-border">·</span>
              <span className="whitespace-nowrap">{timeAgo(p.last_deploy_at)}</span>
            </div>
          </div>
        </div>

        {/* Primary actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {building && <Badge className="text-[10px] animate-pulse h-8 px-3">Building…</Badge>}
          {!running && !building && (
            p.deploy_source === "upload" ? (
              <ReuploadButton projectId={p.id} onDeployed={afterReupload} />
            ) : (
              <Button size="sm" className="btn-shine gap-1 h-8 text-xs" title={p.status === "stopped" ? "Start" : "Deploy"} onClick={() => deploy()} disabled={deploying}>
                {deploying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                <span>{p.status === "stopped" ? "Start" : "Deploy"}</span>
              </Button>
            )
          )}
          {running && (
            <>
              <Button size="sm" className="btn-shine gap-1.5 h-8 text-xs" title="Visit site" nativeButton={false} render={<a href={`https://${p.subdomain}.deployzy.app`} target="_blank" rel="noopener" />}>
                <ExternalLink className="h-3 w-3" /><span className="hidden sm:inline">Visit</span>
              </Button>
              {p.deploy_source === "upload" ? (
                <ReuploadButton projectId={p.id} onDeployed={afterReupload} />
              ) : (
                <Button variant="outline" size="sm" className="gap-1 h-8 text-xs" title="Redeploy" onClick={() => deploy()} disabled={deploying}>
                  {deploying ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  <span className="hidden sm:inline">Redeploy</span>
                </Button>
              )}
              <Button variant="outline" size="sm" className="gap-1 h-8 text-xs" title="Stop" onClick={() => stop()}>
                <Square className="h-3 w-3" /><span className="hidden sm:inline">Stop</span>
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TabNav({ base }: { base: string }) {
  const pathname = usePathname();
  return (
    <nav className="mt-6 flex items-center gap-1 border-b border-border/60 overflow-x-auto">
      {TABS.map(({ slug, label, icon: Icon }) => {
        const href = `${base}${slug}`;
        const active = slug === "" ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={slug}
            href={href}
            className={`relative flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap transition-colors ${
              active ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-foreground" />}
          </Link>
        );
      })}
    </nav>
  );
}

export default function ProjectDetailLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const base = `/projects/${id}`;

  return (
    <ProjectProvider id={id}>
      <div className="animate-fade-in-up">
        <ProjectHeader />
        <TabNav base={base} />
        <div className="mt-6">{children}</div>
      </div>
    </ProjectProvider>
  );
}
