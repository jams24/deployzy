"use client";

// Projects index — a clean list/grid of project cards. Everything about a
// single project (logs, metrics, analytics, settings…) lives one click away
// on the /projects/[id] routes; this page only handles browsing, importing
// repos and quick actions (visit / redeploy / start / stop).

import Link from "next/link";
import { EmptyState, IconTile, PageHeader, StackIcon, StatusPill } from "@/components/dashboard/kit";
import { RowMenu } from "@/components/dashboard/row-menu";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";
import { showPlanLimit } from "@/components/upgrade-dialog";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowsClockwiseIcon, ArrowUpRightIcon, CaretDownIcon, CaretRightIcon, CircleNotchIcon, FolderIcon, FolderOpenIcon,
  GearSixIcon, GitBranchIcon, GithubLogoIcon, MagnifyingGlassIcon, PlayIcon, PlusIcon, RocketLaunchIcon, RowsIcon,
  SlidersHorizontalIcon, SquaresFourIcon, StackSimpleIcon, StopIcon, TerminalWindowIcon,
} from "@phosphor-icons/react";
import { parseEnvText, autoFormatEnvText } from "@/lib/parseEnvText";
import { getBuildPlaceholders } from "@/lib/placeholders";
import { DirectoryPicker } from "@/components/DirectoryPicker";
import { ServiceCards } from "@/components/project/service-cards";
import { useReupload } from "@/components/project/reupload-button";
import {
  API, detectFramework, detectStackFor, emptyBuildConfig, headers,
  servicesPayload, timeAgo,
  type BuildConfig, type GitHubRepo, type Project, type ServiceCfg, type UserServer,
} from "@/components/project/project-shared";

const langColor: Record<string, string> = {
  JavaScript: "bg-yellow-400", TypeScript: "bg-blue-400", Python: "bg-green-400",
  Go: "bg-cyan-400", Rust: "bg-orange-400", Java: "bg-red-400",
  Ruby: "bg-red-500", PHP: "bg-violet-400", HTML: "bg-orange-500",
};

function ProjectsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [ghConnected, setGhConnected] = useState(false);
  const [ghUsername, setGhUsername] = useState("");
  const [ghRepos, setGhRepos] = useState<GitHubRepo[]>([]);
  const [repoSearch, setRepoSearch] = useState("");
  const [showRepoPicker, setShowRepoPicker] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [deploying, setDeploying] = useState<string | null>(null);
  const [importRepo, setImportRepo] = useState<GitHubRepo | null>(null);
  const [importName, setImportName] = useState("");
  const [importSubdomain, setImportSubdomain] = useState("");
  const [importing, setImporting] = useState(false);
  const [importEnvText, setImportEnvText] = useState("");
  const [userServers, setUserServers] = useState<UserServer[]>([]);
  const [selectedServer, setSelectedServer] = useState("");
  // Labels
  const [labelFilter, setLabelFilter] = useState<string>("");
  // List vs grid (Railway-style cards). Persisted; grid is the default.
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  useEffect(() => {
    const v = localStorage.getItem("sm_projects_view");
    if (v !== "grid" && v !== "list") return;
    // Deferred — a mount effect must not set state synchronously.
    const t = setTimeout(() => setViewMode(v), 0);
    return () => clearTimeout(t);
  }, []);
  function changeView(v: "grid" | "list") { setViewMode(v); localStorage.setItem("sm_projects_view", v); }
  const [importShowAdvanced, setImportShowAdvanced] = useState(false);
  const [importBuildCfg, setImportBuildCfg] = useState<BuildConfig>(emptyBuildConfig);
  // Multiple Services — import flow.
  const [importMultiService, setImportMultiService] = useState(false);
  const [importServices, setImportServices] = useState<ServiceCfg[]>([]);
  // Directory picker target — which field the picked path writes back to.
  const [dirPicker, setDirPicker] = useState<
    | { kind: "root" }
    | { kind: "service"; index: number }
    | null
  >(null);

  // Plan limits — populates real memory/cpu caps in the advanced build form
  const [planLimits, setPlanLimits] = useState<{ max_memory_mb: number; max_cpus: number } | null>(null);
  useEffect(() => {
    fetch(`${API}/api/v1/users/me/limits`, { headers: headers() })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.limits) setPlanLimits({ max_memory_mb: d.limits.max_memory_mb, max_cpus: d.limits.max_cpus }); })
      .catch(() => {});
  }, []);

  // Handle GitHub OAuth callback
  useEffect(() => {
    const ghToken = searchParams.get("github_token");
    // refresh_token + expires_in come through so the backend can persist them
    // and auto-refresh when the user's token expires.
    const ghRefreshToken = searchParams.get("refresh_token") || "";
    const ghExpiresIn = parseInt(searchParams.get("expires_in") || "0");
    const ghRefreshExpiresIn = parseInt(searchParams.get("refresh_expires_in") || "0");
    const ghUser = searchParams.get("github_user");
    if (ghToken && ghUser) {
      fetch(`${API}/api/v1/github/connect`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({
          access_token: ghToken,
          refresh_token: ghRefreshToken,
          github_username: ghUser,
          installation_id: parseInt(searchParams.get("installation_id") || "0"),
          expires_in: ghExpiresIn,
          refresh_token_expires_in: ghRefreshExpiresIn,
        }),
      }).then(() => {
        setGhConnected(true);
        setGhUsername(ghUser);
        window.history.replaceState({}, "", "/projects");
      });
    }
  }, [searchParams]);

  // Back-compat: /projects?id=<id> used to deep-link the inline expansion —
  // forward it to the real project page.
  useEffect(() => {
    const targetId = searchParams.get("id");
    if (targetId) router.replace(`/projects/${targetId}`);
  }, [searchParams, router]);

  const loadGHStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/github/status`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setGhConnected(data.connected);
        if (data.username) setGhUsername(data.username);
      }
    } catch {}
  }, []);

  async function loadRepos() {
    setLoadingRepos(true);
    try {
      const res = await fetch(`${API}/api/v1/github/repos`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setGhRepos(Array.isArray(data) ? data : []);
      }
    } catch {}
    setLoadingRepos(false);
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/projects`, { headers: headers() });
      if (res.ok) {
        // A project whose server went offline isn't really "running" — show it
        // as offline so the card offers Deploy (which fails over elsewhere).
        const list: Project[] = await res.json();
        setProjects(list.map((p) => (p.server_offline && p.status !== "building" ? { ...p, status: "offline" } : p)));
      }
    } catch {}
    setLoading(false);
  }, []);

  function selectRepoForImport(repo: GitHubRepo) {
    setImportRepo(repo);
    setImportName(repo.name);
    setImportSubdomain(repo.name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-"));
    setSelectedServer("");
    setImportEnvText("");
    // Load user's BYOC servers
    fetch(`${API}/api/v1/servers`, { headers: headers() })
      .then(r => r.ok ? r.json() : [])
      .then(data => setUserServers(Array.isArray(data) ? data : []))
      .catch(() => {});
  }

  async function createFromRepo() {
    if (!importRepo || !importName || !importSubdomain) return;
    setImporting(true);
    const framework = detectFramework(importRepo.language);

    // Create project with repo info in a single call
    const res = await fetch(`${API}/api/v1/projects`, {
      method: "POST", headers: headers(),
      body: JSON.stringify({
        name: importName,
        subdomain: importSubdomain,
        framework,
        repo_url: importRepo.html_url + ".git",
        branch: importRepo.default_branch || "main",
        github_repo: importRepo.full_name,
        worker_server_id: selectedServer || undefined,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to create project" }));
      const msg = err.error || "Failed to create project";
      if (!showPlanLimit(msg)) alert(msg);
      setImporting(false);
      return;
    }

    const project = await res.json();

    // Set env vars if provided
    if (importEnvText.trim()) {
      const envVars = parseEnvText(importEnvText);
      await fetch(`${API}/api/v1/projects/${project.id}`, {
        method: "PUT", headers: headers(),
        body: JSON.stringify({ env_vars: envVars }),
      });
    }

    // Build the services payload (only when the toggle is on). Env text → map.
    const services = servicesPayload(importMultiService, importServices);

    // Apply build config before deploy if any advanced setting was customized
    // or the project has extra services.
    const c = importBuildCfg;
    if (services.length > 0 || c.install_cmd || c.build_cmd || c.start_cmd || c.root_dir || c.node_version || c.port_override || c.memory_mb || c.cpus || c.dockerfile_path) {
      await fetch(`${API}/api/v1/projects/${project.id}/build-config`, {
        method: "PUT", headers: headers(),
        body: JSON.stringify({ ...c, services }),
      });
    }

    // Deploy
    await fetch(`${API}/api/v1/projects/${project.id}/deploy`, {
      method: "POST", headers: headers(),
    });
    // Reset advanced form for next import
    setImportBuildCfg(emptyBuildConfig);
    setImportMultiService(false);
    setImportServices([]);
    setImportShowAdvanced(false);
    setShowRepoPicker(false);
    setImportRepo(null);
    setImporting(false);
    // Go straight to the new project's logs so the user watches the first build.
    router.push(`/projects/${project.id}/logs`);
  }

  async function deploy(id: string) {
    setDeploying(id);
    // Optimistically mark as building so the polling useEffect kicks in immediately.
    setProjects((prev) => prev.map((p) => p.id === id ? { ...p, status: "building" } : p));
    await fetch(`${API}/api/v1/projects/${id}/deploy`, { method: "POST", headers: headers() });
    setTimeout(() => setDeploying(null), 3000);
  }

  async function stop(id: string) {
    // Optimistic update so the UI flips to "stopped" immediately without
    // waiting for the load() round-trip.
    setProjects((prev) => prev.map((p) => p.id === id ? { ...p, status: "stopped" } : p));
    await fetch(`${API}/api/v1/projects/${id}/stop`, { method: "POST", headers: headers() });
    load();
  }

  async function disconnectGH() {
    await fetch(`${API}/api/v1/github`, { method: "DELETE", headers: headers() });
    setGhConnected(false); setGhUsername(""); setGhRepos([]);
  }

  // Deferred so the mount effect doesn't synchronously trigger a setState.
  useEffect(() => {
    const t = setTimeout(() => { load(); loadGHStatus(); }, 0);
    return () => clearTimeout(t);
  }, [load, loadGHStatus]);

  // Slow unconditional poll — catches auto-deploys (GitHub webhook), BYOC
  // status changes, and anything else the frontend didn't trigger itself.
  useEffect(() => {
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  // Fast poll (3 s) while any project is actively building so the badge
  // and buttons update quickly without waiting for the 15 s tick.
  useEffect(() => {
    const hasBuilding = projects.some(p => p.status === "building");
    if (!hasBuilding) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [projects, load]);

  const filteredRepos = (ghRepos || []).filter((r) =>
    !repoSearch || r.name.toLowerCase().includes(repoSearch.toLowerCase()) || r.full_name.toLowerCase().includes(repoSearch.toLowerCase())
  );

  const importPh = getBuildPlaceholders(importRepo ? detectFramework(importRepo.language) : "node");

  return (
    <div className="animate-fade-in-up">
      <PageHeader
        title="Projects"
        description={ghConnected && ghUsername ? (
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            <GithubLogoIcon className="h-4 w-4 text-foreground/70" />
            Deploying from GitHub as <span className="font-medium text-foreground">@{ghUsername}</span>
            <span className="text-border">·</span>
            <button type="button" onClick={disconnectGH} className="underline-offset-[3px] transition-colors hover:text-foreground hover:underline">Disconnect</button>
          </span>
        ) : "Every app you’ve deployed, from GitHub, a folder or a template."}
        actions={
          <>
            {/* Grid / list view toggle */}
            <div className="flex items-center rounded-full border border-[var(--dz-hairline)] p-0.5" role="group" aria-label="View">
              {([["grid", SquaresFourIcon, "Grid view"], ["list", RowsIcon, "List view"]] as const).map(([v, I, t]) => (
                <button key={v} type="button" onClick={() => changeView(v)} title={t} aria-label={t} aria-pressed={viewMode === v}
                  className={cn("flex h-7 w-7 items-center justify-center rounded-full transition-colors", viewMode === v ? "bg-foreground/[0.08] text-foreground" : "text-muted-foreground hover:text-foreground")}>
                  <I className="h-4 w-4" />
                </button>
              ))}
            </div>
            <button type="button" onClick={load} title="Refresh" aria-label="Refresh" className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--dz-hairline)] text-muted-foreground transition-colors hover:text-foreground">
              <ArrowsClockwiseIcon className="h-4 w-4" />
            </button>
            {ghConnected ? (
              <button type="button" onClick={() => { setShowRepoPicker(true); loadRepos(); }} className="pill pill-ink pill-xs">
                <PlusIcon weight="bold" className="h-3.5 w-3.5" /> Import repo
              </button>
            ) : (
              <a href={`${API}/api/v1/github/connect`} className="pill pill-ink pill-xs">
                <GithubLogoIcon className="h-4 w-4" /> Connect GitHub
              </a>
            )}
          </>
        }
      />

      {/* Repo picker modal */}
      {showRepoPicker && (
        <Card className="mt-6 rounded-[18px]">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-[15px] font-semibold tracking-[-0.01em]">Import a repository</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setShowRepoPicker(false)}>Cancel</Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="relative mb-4">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search repos..." className="pl-9 h-9 text-sm" value={repoSearch} onChange={(e) => setRepoSearch(e.target.value)} />
            </div>

            {loadingRepos ? (
              <div className="flex items-center justify-center py-8"><CircleNotchIcon className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="max-h-80 overflow-y-auto space-y-1">
                {filteredRepos.map((repo) => (
                  <div key={repo.id} className="flex items-center justify-between rounded-lg border border-border/60 p-3 hover:bg-accent/60 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      {repo.language && (
                        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${langColor[repo.language] || "bg-gray-400"}`} />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{repo.name}</span>
                          {repo.private && <Badge variant="outline" className="text-[9px]">private</Badge>}
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate">{repo.description || repo.full_name}</p>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1 shrink-0 ml-2" onClick={() => selectRepoForImport(repo)}>
                      <RocketLaunchIcon className="h-3 w-3" /> Import
                    </Button>
                  </div>
                ))}
                {filteredRepos.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No repos found</p>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Import customization modal */}
      {importRepo && (
        <Card className="mt-6 rounded-[18px]">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-[15px] font-semibold tracking-[-0.01em]">Configure project</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setImportRepo(null)}>Cancel</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-border/60 p-3 bg-muted/50">
              {importRepo.language && (
                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${langColor[importRepo.language] || "bg-gray-400"}`} />
              )}
              <div className="min-w-0">
                <span className="text-sm font-medium">{importRepo.full_name}</span>
                {importRepo.private && <Badge variant="outline" className="ml-2 text-[9px]">private</Badge>}
                <p className="text-[11px] text-muted-foreground truncate">{importRepo.description || ""}</p>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Project Name</label>
              <Input
                value={importName}
                onChange={(e) => setImportName(e.target.value)}
                placeholder="my-project"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Subdomain</label>
              <div className="flex items-center gap-0">
                <Input
                  value={importSubdomain}
                  onChange={(e) => setImportSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  placeholder="my-project"
                  className="h-9 text-sm rounded-r-none font-mono"
                />
                <span className="flex h-9 items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-xs text-muted-foreground">.deployzy.com</span>
              </div>
            </div>
            {userServers.length > 0 && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Deploy to</label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={selectedServer}
                  onChange={(e) => setSelectedServer(e.target.value)}
                >
                  <option value="">Deployzy Cloud (default)</option>
                  {userServers.filter(s => s.status === "active").map((s) => (
                    <option key={s.id} value={s.id}>{s.label} ({s.host})</option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Environment Variables <span className="text-[10px] text-muted-foreground font-normal">(optional)</span></label>
                <button
                  type="button"
                  onClick={() => setImportEnvText(autoFormatEnvText(importEnvText))}
                  disabled={!importEnvText.trim()}
                  className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Parse and rewrite as one KEY=VALUE per line. Recovers from pasted values with missing newlines."
                >
                  Auto-format
                </button>
              </div>
              <textarea
                value={importEnvText}
                onChange={(e) => setImportEnvText(e.target.value)}
                placeholder={importPh.env}
                className="w-full h-24 rounded-md border border-input bg-muted px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <p className="text-[10px] text-muted-foreground">KEY=VALUE format, one per line. Click Auto-format if a paste came out mangled.</p>
            </div>

            {/* Multiple Services */}
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-start gap-2">
                  <StackSimpleIcon className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <span className="text-xs font-medium">Multiple Services</span>
                    <p className="text-[10px] text-muted-foreground">Deploy multiple directories from this repository as services inside one container.</p>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={importMultiService}
                  onClick={() => {
                    const next = !importMultiService;
                    setImportMultiService(next);
                    if (next && importServices.length === 0) setImportServices([{ name: "service-1", root_dir: "", port: 3001, framework: "", install_cmd: "npm install", build_cmd: "npm run build", start_cmd: "npm run start", env_text: "" }]);
                  }}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${importMultiService ? "bg-violet-600" : "bg-zinc-300 dark:bg-zinc-700"}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${importMultiService ? "left-[18px]" : "left-0.5"}`} />
                </button>
              </div>
              {importMultiService && (
                <div className="border-t border-border/40 p-4">
                  <ServiceCards
                    services={importServices}
                    onChange={setImportServices}
                    subdomain={importSubdomain}
                    repoConnected={!!importRepo?.full_name}
                    onBrowse={(i) => setDirPicker({ kind: "service", index: i })}
                    detectStack={(dir) => detectStackFor(importRepo?.full_name || "", importRepo?.default_branch || "main", dir)}
                  />
                </div>
              )}
            </div>

            {/* Advanced Build & Runtime Settings */}
            <div className="rounded-lg border border-border overflow-hidden">
              <button type="button" onClick={() => setImportShowAdvanced(!importShowAdvanced)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/60 transition-colors">
                <div className="flex items-center gap-2">
                  <SlidersHorizontalIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium">Advanced Build &amp; Runtime Settings</span>
                  <span className="text-[10px] text-muted-foreground">(optional)</span>
                </div>
                {importShowAdvanced ? <CaretDownIcon className="h-4 w-4 text-muted-foreground" /> : <CaretRightIcon className="h-4 w-4 text-muted-foreground" />}
              </button>
              {importShowAdvanced && (
                <div className="border-t border-border/40 p-4 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">Root Directory <span className="text-muted-foreground">(monorepos)</span></label>
                      <div className="relative">
                        <input type="text" placeholder="apps/web" value={importBuildCfg.root_dir} onChange={(e) => setImportBuildCfg({ ...importBuildCfg, root_dir: e.target.value })} className="w-full h-8 rounded-md border border-input bg-muted pl-2 pr-8 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                        <button type="button" title="Browse repository directories" disabled={!importRepo?.full_name} onClick={() => setDirPicker({ kind: "root" })} className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-violet-500 hover:bg-accent disabled:opacity-40">
                          <FolderIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">Node Version</label>
                      <select value={importBuildCfg.node_version} onChange={(e) => setImportBuildCfg({ ...importBuildCfg, node_version: e.target.value })} className="w-full h-8 rounded-md border border-input bg-muted px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                        <option value="">Default (20)</option>
                        <option value="18">Node 18</option>
                        <option value="20">Node 20</option>
                        <option value="22">Node 22</option>
                      </select>
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-[10px] text-muted-foreground">Install Command</label>
                      <input type="text" placeholder={importPh.install} value={importBuildCfg.install_cmd} onChange={(e) => setImportBuildCfg({ ...importBuildCfg, install_cmd: e.target.value })} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-[10px] text-muted-foreground">Build Command</label>
                      <input type="text" placeholder={importPh.build} value={importBuildCfg.build_cmd} onChange={(e) => setImportBuildCfg({ ...importBuildCfg, build_cmd: e.target.value })} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-[10px] text-muted-foreground">Start Command</label>
                      <input type="text" placeholder={importPh.start} value={importBuildCfg.start_cmd} onChange={(e) => setImportBuildCfg({ ...importBuildCfg, start_cmd: e.target.value })} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">Port <span className="text-muted-foreground">(0 = auto)</span></label>
                      <input type="number" min="0" max="65535" value={importBuildCfg.port_override || ""} onChange={(e) => setImportBuildCfg({ ...importBuildCfg, port_override: parseInt(e.target.value) || 0 })} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">
                        Memory MB <span className="text-muted-foreground">(0 = {planLimits && planLimits.max_memory_mb > 0 ? Math.min(512, planLimits.max_memory_mb) : 512}{planLimits && planLimits.max_memory_mb > 0 ? `, plan max ${planLimits.max_memory_mb}` : ""})</span>
                      </label>
                      <input type="number" min="0" max={planLimits && planLimits.max_memory_mb > 0 ? planLimits.max_memory_mb : 16384} step="128" value={importBuildCfg.memory_mb || ""} onChange={(e) => { const v = parseInt(e.target.value) || 0; const cap = planLimits && planLimits.max_memory_mb > 0 ? planLimits.max_memory_mb : Infinity; setImportBuildCfg({ ...importBuildCfg, memory_mb: Math.min(v, cap) }); }} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">
                        CPUs <span className="text-muted-foreground">(0 = {planLimits && planLimits.max_cpus > 0 ? Math.min(0.5, planLimits.max_cpus) : 0.5}{planLimits && planLimits.max_cpus > 0 ? `, plan max ${planLimits.max_cpus}` : ""})</span>
                      </label>
                      <input type="number" min="0" max={planLimits && planLimits.max_cpus > 0 ? planLimits.max_cpus : 8} step="0.25" value={importBuildCfg.cpus || ""} onChange={(e) => { const v = parseFloat(e.target.value) || 0; const cap = planLimits && planLimits.max_cpus > 0 ? planLimits.max_cpus : Infinity; setImportBuildCfg({ ...importBuildCfg, cpus: Math.min(v, cap) }); }} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-[10px] text-muted-foreground">Health Check Path <span className="text-muted-foreground">(e.g. /health; empty = skip)</span></label>
                      <input type="text" placeholder={importPh.healthCheck} value={importBuildCfg.health_check_path} onChange={(e) => setImportBuildCfg({ ...importBuildCfg, health_check_path: e.target.value })} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-[10px] text-muted-foreground">Release Command <span className="text-muted-foreground">(runs before start, e.g. migrations)</span></label>
                      <input type="text" placeholder={importPh.release} value={importBuildCfg.release_cmd} onChange={(e) => setImportBuildCfg({ ...importBuildCfg, release_cmd: e.target.value })} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-[10px] text-muted-foreground">Dockerfile Path <span className="text-muted-foreground">(e.g. Dockerfile.bot; empty = Dockerfile)</span></label>
                      <input type="text" placeholder="Dockerfile" value={importBuildCfg.dockerfile_path} onChange={(e) => setImportBuildCfg({ ...importBuildCfg, dockerfile_path: e.target.value })} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">All fields optional — blank uses defaults. Editable anytime after deployment.</p>
                </div>
              )}
            </div>

            <Button
              className="w-full gap-2"
              onClick={createFromRepo}
              disabled={importing || !importName || !importSubdomain}
            >
              {importing ? <CircleNotchIcon className="h-4 w-4 animate-spin" /> : <RocketLaunchIcon className="h-4 w-4" />}
              Deploy Project
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Projects list */}
      {loading ? (
        <p className="mt-8 text-sm text-muted-foreground animate-pulse">Loading projects…</p>
      ) : projects.length === 0 && !showRepoPicker ? (
        <EmptyState
          className="mt-8"
          icon={RocketLaunchIcon}
          title="No projects yet"
          description={ghConnected ? "Import a repo from GitHub to deploy your first app." : "Connect GitHub to import a repo, or start from a folder or a template."}
          action={ghConnected ? (
            <button type="button" onClick={() => { setShowRepoPicker(true); loadRepos(); }} className="pill pill-ink pill-sm"><PlusIcon weight="bold" className="h-4 w-4" /> Import repo</button>
          ) : (
            <div className="flex flex-wrap justify-center gap-2">
              <a href={`${API}/api/v1/github/connect`} className="pill pill-ink pill-sm"><GithubLogoIcon className="h-4 w-4" /> Connect GitHub</a>
              <Link href="/new" className="pill pill-line pill-sm">Other ways to deploy</Link>
            </div>
          )}
        />
      ) : (
        <div className="mt-7 space-y-3">
          {/* Label filter bar — only show once there are any labels across projects */}
          {(() => {
            const allLabels = Array.from(new Set(projects.flatMap((p) => p.labels || []))).sort();
            if (allLabels.length === 0) return null;
            return (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="eyebrow mr-1">Labels</span>
                <button onClick={() => setLabelFilter("")} className={cn("h-7 rounded-full border px-3 text-[12.5px] transition-colors", labelFilter === "" ? "border-foreground bg-foreground text-background" : "border-[var(--dz-hairline)] text-muted-foreground hover:text-foreground")}>All</button>
                {allLabels.map((l) => (
                  <button key={l} onClick={() => setLabelFilter(labelFilter === l ? "" : l)} className={cn("h-7 rounded-full border px-3 text-[12.5px] transition-colors", labelFilter === l ? "border-brand/40 bg-brand/10 text-[var(--dz-green-strong)] dark:text-brand" : "border-[var(--dz-hairline)] text-muted-foreground hover:text-foreground")}>{l}</button>
                ))}
              </div>
            );
          })()}
          <div className={viewMode === "grid"
            ? "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
            : "surface divide-y divide-[var(--dz-hairline)] overflow-hidden rounded-[18px]"}>
            {projects.filter((p) => labelFilter === "" || (p.labels || []).includes(labelFilter)).map((p) => (
              <ProjectRow
                key={p.id}
                p={p}
                grid={viewMode === "grid"}
                deploying={deploying === p.id}
                onDeploy={() => deploy(p.id)}
                onStop={() => stop(p.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Base directory picker — writes back to a root_dir or a service's dir
          in the import form. */}
      {dirPicker && importRepo && (
        <DirectoryPicker
          repo={importRepo.full_name}
          branch={importRepo.default_branch || "main"}
          initialPath={dirPicker.kind === "root" ? importBuildCfg.root_dir : (importServices[dirPicker.index]?.root_dir || "")}
          onClose={() => setDirPicker(null)}
          onSelect={async (path) => {
            const dp = dirPicker;
            if (dp.kind === "root") {
              setImportBuildCfg({ ...importBuildCfg, root_dir: path });
            } else {
              const fw = await detectStackFor(importRepo.full_name, importRepo.default_branch || "main", path);
              setImportServices((prev) => prev.map((s, j) => (j === dp.index ? { ...s, root_dir: path, framework: fw } : s)));
            }
            setDirPicker(null);
          }}
        />
      )}
    </div>
  );
}

// One project as a list row or a grid card. One obvious action stays on the
// row (Visit / Start / Deploy); everything else lives in the ⋯ menu.
function ProjectRow({ p, grid, deploying, onDeploy, onStop }: {
  p: Project;
  grid: boolean;
  deploying: boolean;
  onDeploy: () => void;
  onStop: () => void;
}) {
  const router = useRouter();
  const upload = p.deploy_source === "upload";
  const reup = useReupload(p.id, () => router.push(`/projects/${p.id}/logs`));
  const url = `${p.subdomain}.deployzy.app`;
  const running = p.status === "running";
  const building = p.status === "building" || deploying;

  const primary = building ? (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-amber-500/10 px-3 text-[12.5px] font-medium text-amber-700 dark:text-amber-400">
      <CircleNotchIcon className="h-3.5 w-3.5 animate-spin" /> {reup.phase || "Building…"}
    </span>
  ) : reup.busy ? (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-foreground/[0.05] px-3 text-[12.5px] text-muted-foreground">
      <CircleNotchIcon className="h-3.5 w-3.5 animate-spin" /> {reup.phase || "Uploading…"}
    </span>
  ) : running ? (
    <a href={`https://${url}`} target="_blank" rel="noopener" className="pill pill-line pill-xs" title={`Open ${url}`}>
      Visit <ArrowUpRightIcon className="h-3.5 w-3.5" />
    </a>
  ) : (
    <button type="button" onClick={onDeploy} className="pill pill-line pill-xs" title={upload ? "Redeploy the last uploaded build" : undefined}>
      <PlayIcon className="h-3.5 w-3.5" /> {p.status === "stopped" ? "Start" : "Deploy"}
    </button>
  );

  const menu = (
    <RowMenu
      label={`Actions for ${p.name}`}
      items={[
        running && !building && { label: "Redeploy", icon: ArrowsClockwiseIcon, onSelect: onDeploy },
        upload && !building && { label: "Re-upload folder", icon: FolderOpenIcon, onSelect: reup.start },
        { label: "Deploy logs", icon: TerminalWindowIcon, href: `/projects/${p.id}/logs` },
        { label: "Settings", icon: GearSixIcon, href: `/projects/${p.id}/settings` },
        running && { label: "Stop", icon: StopIcon, onSelect: onStop, danger: true, divider: true },
      ]}
    />
  );

  const meta = (
    <>
      <span className="capitalize">{p.framework || "custom"}</span>
      {p.github_repo && (
        <>
          <span aria-hidden className="text-foreground/20">·</span>
          <span className="inline-flex min-w-0 items-center gap-1"><GitBranchIcon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{p.github_repo}</span></span>
        </>
      )}
      <span aria-hidden className="text-foreground/20">·</span>
      <span className="whitespace-nowrap">{timeAgo(p.last_deploy_at)}</span>
    </>
  );

  const open = () => router.push(`/projects/${p.id}`);
  const tile = (
    <IconTile size="md" className="text-foreground/75">
      <StackIcon stack={p.framework} className="h-[18px] w-[18px]" />
    </IconTile>
  );
  const labels = (p.labels || []).map((l) => (
    <span key={l} className="hidden h-[20px] shrink-0 items-center rounded-full bg-brand-cyan/10 px-2 text-[11.5px] text-cyan-700 lg:inline-flex dark:text-brand-cyan">{l}</span>
  ));

  if (grid) {
    return (
      <div
        role="link"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => { if (e.key === "Enter") open(); }}
        className="surface group flex cursor-pointer flex-col rounded-[18px] p-4 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-foreground/15 hover:shadow-[0_14px_36px_-22px_rgb(0_0_0/0.4)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        {reup.element}
        <div className="flex items-start gap-3">
          {tile}
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="truncate text-[14.5px] font-semibold tracking-[-0.01em]">{p.name}</p>
            <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">{url}</p>
          </div>
          <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>{menu}</div>
        </div>
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-muted-foreground">{meta}</div>
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-[var(--dz-hairline)] pt-3">
          <div className="flex min-w-0 items-center gap-1.5"><StatusPill status={p.status} />{labels}</div>
          <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>{primary}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => { if (e.key === "Enter") open(); }}
      className="group flex cursor-pointer items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-foreground/[0.025] focus-visible:bg-foreground/[0.03] focus-visible:outline-none sm:px-5"
    >
      {reup.element}
      {tile}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[14px] font-semibold tracking-[-0.01em]">{p.name}</span>
          <StatusPill status={p.status} />
          {labels}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-x-1.5 text-[12.5px] text-muted-foreground">
          <span className="truncate">{url}</span>
          <span className="hidden min-w-0 items-center gap-x-1.5 md:inline-flex"><span aria-hidden className="text-foreground/20">·</span>{meta}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <span className="hidden sm:inline-flex">{primary}</span>
        {menu}
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground p-8">Loading...</div>}>
      <ProjectsContent />
    </Suspense>
  );
}
