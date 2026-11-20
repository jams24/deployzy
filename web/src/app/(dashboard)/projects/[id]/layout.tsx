"use client";

// Project detail shell — header (identity, status, primary actions) + tab nav.
// Every tab (/overview, /logs, /metrics, /analytics, /settings) renders below
// the shared header and reads the project from ProjectProvider.

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeftIcon, ArrowsClockwiseIcon, ArrowUpRightIcon, ChartBarIcon, CircleNotchIcon, FolderOpenIcon, GearSixIcon, GitBranchIcon, PlayIcon, PulseIcon, ScrollIcon, SquaresFourIcon, StopIcon, WarningIcon } from "@phosphor-icons/react";
import { IconTile, StackIcon, StatusDot, StatusPill } from "@/components/dashboard/kit";
import { ProjectProvider, useProject } from "@/components/project/project-context";
import { useReupload } from "@/components/project/reupload-button";
import { RowMenu } from "@/components/dashboard/row-menu";
import { timeAgo } from "@/components/project/project-shared";

const TABS = [
  { slug: "", label: "Overview", icon: SquaresFourIcon },
  { slug: "/logs", label: "Logs", icon: ScrollIcon },
  { slug: "/metrics", label: "Metrics", icon: PulseIcon },
  { slug: "/analytics", label: "Analytics", icon: ChartBarIcon },
  { slug: "/settings", label: "Settings", icon: GearSixIcon },
] as const;

function ProjectHeader() {
  const { project: p, deploying, deploy, stop, refresh } = useProject();
  const router = useRouter();
  const building = p.status === "building";
  // The heartbeat marked the server offline: whatever the last status says,
  // the app isn't reachable. Redeploying moves it to a healthy server.
  const serverDown = !!p.server?.offline && !building;
  const running = p.status === "running" && !serverDown;
  // The ReuploadButton deploys internally after the upload lands — afterwards
  // just refresh + go watch the build stream.
  const afterReupload = () => { refresh(); router.push(`/projects/${p.id}/logs`); };
  const reup = useReupload(p.id, afterReupload);
  const url = `${p.subdomain}.deployzy.app`;
  const branch = p.github_branch || p.branch || "main";

  return (
    <div>
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Link href="/projects" className="inline-flex items-center gap-1 transition-colors hover:text-foreground">
          <ArrowLeftIcon className="h-3.5 w-3.5" /> Projects
        </Link>
        <span className="text-border">/</span>
        <span className="truncate text-foreground/80">{p.name}</span>
      </nav>

      <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        {/* Identity */}
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="relative">
            <IconTile size="lg" className="text-foreground/80">
              <StackIcon stack={p.framework} className="h-[22px] w-[22px]" />
            </IconTile>
            {/* .live-dot sets position itself (unlayered), so the wrapper places it. */}
            <span className="absolute -right-1 -top-1 flex rounded-full ring-[3px] ring-background">
              <StatusDot status={serverDown ? "failed" : p.status} />
            </span>
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[22px] font-semibold leading-tight tracking-[-0.022em] sm:text-[24px]">{p.name}</h1>
              {serverDown ? (
                <span className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border border-red-500/25 bg-red-500/10 px-2 text-[12px] font-medium text-red-600 dark:text-red-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />Server offline
                </span>
              ) : (
                <StatusPill status={p.status} />
              )}
              {(p.labels || []).map((l) => (
                <span key={l} className="inline-flex h-[20px] items-center rounded-full bg-brand-cyan/10 px-2 text-[11.5px] font-medium text-cyan-700 dark:text-brand-cyan">{l}</span>
              ))}
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-muted-foreground">
              <a href={`https://${url}`} target="_blank" rel="noopener" className="group inline-flex min-w-0 max-w-full items-center gap-1 text-foreground/80 transition-colors hover:text-foreground">
                <span className="truncate">{url}</span>
                <ArrowUpRightIcon className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </a>
              <span aria-hidden className="text-foreground/20">·</span>
              <span className="capitalize">{p.framework || "custom"}</span>
              {p.github_repo && (
                <>
                  <span aria-hidden className="text-foreground/20">·</span>
                  <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                    <GitBranchIcon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{p.github_repo}</span>
                    <span className="text-foreground/30">/</span>
                    <span>{branch}</span>
                  </span>
                </>
              )}
              {p.commit_sha && (<><span aria-hidden className="text-foreground/20">·</span><code className="font-mono text-[12px]">{p.commit_sha.slice(0, 7)}</code></>)}
              {p.last_deploy_at && (<><span aria-hidden className="text-foreground/20">·</span><span className="whitespace-nowrap">Deployed {timeAgo(p.last_deploy_at)}</span></>)}
            </div>
          </div>
        </div>

        {/* Primary actions: one obvious button, the rest in ⋯ */}
        <div className="flex shrink-0 items-center gap-1.5">
          {reup.element}
          {building || reup.busy ? (
            <span className="inline-flex h-8 items-center gap-2 rounded-full bg-amber-500/10 px-3 text-[12.5px] font-medium text-amber-700 dark:text-amber-400">
              <CircleNotchIcon className="h-3.5 w-3.5 animate-spin" /> {reup.phase || "Building…"}
            </span>
          ) : running ? (
            <>
              <a href={`https://${url}`} target="_blank" rel="noopener" className="pill pill-ink pill-xs">Visit <ArrowUpRightIcon className="h-3.5 w-3.5" /></a>
              <button type="button" onClick={() => deploy()} disabled={deploying} className="pill pill-line pill-xs" title={p.deploy_source === "upload" ? "Redeploy the last uploaded build" : undefined}>
                {deploying ? <CircleNotchIcon className="h-3.5 w-3.5 animate-spin" /> : <ArrowsClockwiseIcon className="h-3.5 w-3.5" />} Redeploy
              </button>
            </>
          ) : (
            <button type="button" onClick={() => deploy()} disabled={deploying} className="pill pill-ink pill-xs"
              title={serverDown ? "Redeploy on a healthy server" : p.deploy_source === "upload" ? "Redeploy the last uploaded build" : undefined}>
              {deploying ? <CircleNotchIcon className="h-3.5 w-3.5 animate-spin" /> : serverDown ? <ArrowsClockwiseIcon className="h-3.5 w-3.5" /> : <PlayIcon className="h-3.5 w-3.5" />}
              {serverDown ? "Redeploy elsewhere" : p.status === "stopped" ? "Start" : p.deploy_source === "upload" ? "Redeploy" : "Deploy"}
            </button>
          )}
          <RowMenu
            label="More project actions"
            items={[
              p.deploy_source === "upload" && !building && { label: "Re-upload folder", icon: FolderOpenIcon, onSelect: reup.start },
              { label: "Deploy logs", icon: ScrollIcon, href: `/projects/${p.id}/logs` },
              { label: "Settings", icon: GearSixIcon, href: `/projects/${p.id}/settings` },
              running && { label: "Stop", icon: StopIcon, onSelect: () => stop(), danger: true, divider: true },
            ]}
          />
        </div>
      </div>

      {serverDown && (
        <div role="alert" className="mt-5 flex gap-3 rounded-2xl border border-red-500/30 bg-red-500/[0.06] px-4 py-3.5">
          <WarningIcon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-red-500" />
          <div className="min-w-0 flex-1 text-[13.5px]">
            <p className="font-semibold text-red-600 dark:text-red-400">
              {`${p.server?.label ?? "This server"} is offline, so ${p.name} isn't reachable.`}
            </p>
            <p className="mt-0.5 leading-snug text-muted-foreground">
              {`Redeploy elsewhere moves it to a healthy server${p.server?.byoc ? " (another of your servers, or Deployzy Cloud)" : ""}. Files it saved on that server's disk can't be brought over while the server is down.`}
            </p>
          </div>
        </div>
      )}
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
              className={`group relative flex h-11 items-center gap-2 whitespace-nowrap px-2.5 text-[13.5px] transition-colors sm:px-3 ${
                active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon weight="duotone" className={`dz-ico hidden h-[17px] w-[17px] sm:block ${active ? "dz-ico-on" : ""}`} />
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
