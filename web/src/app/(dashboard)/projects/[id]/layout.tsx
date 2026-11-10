"use client";

// Project detail shell — header (identity, status, primary actions) + tab nav.
// Every tab (/overview, /logs, /metrics, /analytics, /settings) renders below
// the shared header and reads the project from ProjectProvider.

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, ArrowUpRight, Globe, GitBranch, ExternalLink, RefreshCw,
  Play, Square, Loader2, LayoutDashboard, ScrollText, Activity,
  BarChart3, Settings,
} from "lucide-react";
import { StackIcon, StatusDot, StatusPill } from "@/components/dashboard/kit";
import { ProjectProvider, useProject } from "@/components/project/project-context";
import { ReuploadButton } from "@/components/project/reupload-button";
import { timeAgo } from "@/components/project/project-shared";

const TABS = [
  { slug: "", label: "Overview", icon: LayoutDashboard },
  { slug: "/logs", label: "Logs", icon: ScrollText },
  { slug: "/metrics", label: "Metrics", icon: Activity },
  { slug: "/analytics", label: "Analytics", icon: BarChart3 },
  { slug: "/settings", label: "Settings", icon: Settings },
] as const;

const btn = "h-9 gap-1.5 rounded-full px-3.5 text-[13.5px]";

function ProjectHeader() {
  const { project: p, deploying, deploy, stop, refresh } = useProject();
  const router = useRouter();
  const running = p.status === "running";
  const building = p.status === "building";
  // The ReuploadButton deploys internally after the upload lands — afterwards
  // just refresh + go watch the build stream.
  const afterReupload = () => { refresh(); router.push(`/projects/${p.id}/logs`); };
  const url = `${p.subdomain}.deployzy.app`;
  const branch = p.github_branch || p.branch || "main";

  return (
    <div>
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Link href="/projects" className="inline-flex items-center gap-1 transition-colors hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Projects
        </Link>
        <span className="text-border">/</span>
        <span className="truncate text-foreground/80">{p.name}</span>
      </nav>

      <div className="mt-4 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        {/* Identity */}
        <div className="flex min-w-0 items-start gap-4">
          <span className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[var(--dz-hairline)] bg-background text-foreground/85 dark:bg-white/[0.03]">
            <StackIcon stack={p.framework} className="h-6 w-6" />
            {/* .live-dot sets position itself (unlayered), so the wrapper places it. */}
            <span className="absolute -right-1 -top-1 flex rounded-full ring-[3px] ring-background">
              <StatusDot status={p.status} />
            </span>
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[26px] font-semibold leading-tight tracking-[-0.03em] sm:text-[30px]">{p.name}</h1>
              <StatusPill status={p.status} />
              {(p.labels || []).map((l) => (
                <span key={l} className="inline-flex h-[22px] items-center rounded-full border border-brand-cyan/30 bg-brand-cyan/10 px-2 text-[12px] font-medium text-cyan-700 dark:text-brand-cyan">{l}</span>
              ))}
            </div>
            <a
              href={`https://${url}`}
              target="_blank"
              rel="noopener"
              className="group mt-1.5 inline-flex max-w-full items-center gap-1.5 font-mono text-[13px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <Globe className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{url}</span>
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </a>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <span className="rounded-full border border-[var(--dz-hairline)] px-2 py-0.5 capitalize">{p.framework || "custom"}</span>
              {p.github_repo && (
                <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-[var(--dz-hairline)] px-2 py-0.5">
                  <GitBranch className="h-3 w-3 shrink-0" />
                  <span className="truncate">{p.github_repo}</span>
                  <span className="text-border">·</span>
                  <span>{branch}</span>
                </span>
              )}
              {p.commit_sha && <code className="rounded-full border border-[var(--dz-hairline)] px-2 py-0.5 font-mono">{p.commit_sha.slice(0, 7)}</code>}
              {p.last_deploy_at && <span className="whitespace-nowrap px-1">Deployed {timeAgo(p.last_deploy_at)}</span>}
            </div>
          </div>
        </div>

        {/* Primary actions */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {building && (
            <span className="inline-flex h-9 items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 text-[13.5px] font-medium text-amber-700 dark:text-amber-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Building…
            </span>
          )}
          {!running && !building && (
            p.deploy_source === "upload" ? (
              <>
                {/* Redeploy reuses the already-uploaded build context (no need to
                    re-pick the folder) — the quick way to recover a crashed or
                    failed upload. Re-upload is for pushing changed code. */}
                <Button size="sm" className={btn} title="Redeploy the last uploaded build" onClick={() => deploy()} disabled={deploying}>
                  {deploying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  <span>{p.status === "stopped" ? "Start" : "Redeploy"}</span>
                </Button>
                <ReuploadButton projectId={p.id} onDeployed={afterReupload} />
              </>
            ) : (
              <Button size="sm" className={btn} title={p.status === "stopped" ? "Start" : "Deploy"} onClick={() => deploy()} disabled={deploying}>
                {deploying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                <span>{p.status === "stopped" ? "Start" : "Deploy"}</span>
              </Button>
            )
          )}
          {running && (
            <>
              <Button size="sm" className={btn} title="Visit site" nativeButton={false} render={<a href={`https://${url}`} target="_blank" rel="noopener" />}>
                <ExternalLink className="h-3.5 w-3.5" />Visit
              </Button>
              <Button variant="outline" size="sm" className={btn} title={p.deploy_source === "upload" ? "Redeploy the last uploaded build" : "Redeploy"} onClick={() => deploy()} disabled={deploying}>
                {deploying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Redeploy
              </Button>
              {p.deploy_source === "upload" && (
                <ReuploadButton projectId={p.id} onDeployed={afterReupload} />
              )}
              <Button variant="outline" size="sm" className={btn} title="Stop" onClick={() => stop()}>
                <Square className="h-3.5 w-3.5" /><span className="hidden sm:inline">Stop</span>
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
    <nav className="frost sticky top-0 z-10 -mx-4 mt-6 border-b border-[var(--dz-hairline)] px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="-mb-px flex items-center gap-0.5 overflow-x-auto [mask-image:linear-gradient(to_right,#000_88%,transparent)] [scrollbar-width:none] sm:gap-1 sm:[mask-image:none]">
        {TABS.map(({ slug, label, icon: Icon }) => {
          const href = `${base}${slug}`;
          const active = slug === "" ? pathname === base : pathname.startsWith(href);
          return (
            <Link
              key={slug}
              href={href}
              aria-current={active ? "page" : undefined}
              ref={active ? (el: HTMLAnchorElement | null) => { el?.scrollIntoView({ block: "nearest", inline: "nearest" }); } : undefined}
              className={`relative flex h-12 items-center gap-2 whitespace-nowrap px-2.5 text-[14px] transition-colors sm:px-3 ${
                active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className={`hidden h-4 w-4 sm:block ${active ? "text-brand" : ""}`} />
              {label}
              {active && (
                <motion.span layoutId="dz-project-tab" transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }} className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-brand" />
              )}
            </Link>
          );
        })}
      </div>
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
        <div className="mt-6 sm:mt-8">{children}</div>
      </div>
    </ProjectProvider>
  );
}
