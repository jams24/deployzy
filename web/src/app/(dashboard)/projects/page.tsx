"use client";

// Projects index — a clean list/grid of project cards. Everything about a
// single project (logs, metrics, analytics, settings…) lives one click away
// on the /projects/[id] routes; this page only handles browsing, importing
// repos and quick actions (visit / redeploy / start / stop).

import { useCallback, useEffect, useState } from "react";
import { showPlanLimit } from "@/components/upgrade-dialog";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Rocket, Plus, Play, Square, ExternalLink, RefreshCw,
  GitBranch, Search, Check, Loader2, Settings2, ChevronRight, ChevronDown,
  Globe, Layers, LayoutGrid, List, Folder,
} from "lucide-react";
import { parseEnvText, autoFormatEnvText } from "@/lib/parseEnvText";
import { getBuildPlaceholders } from "@/lib/placeholders";
import { DirectoryPicker } from "@/components/DirectoryPicker";
import { ServiceCards } from "@/components/project/service-cards";
import { ReuploadButton } from "@/components/project/reupload-button";
import {
  API, detectFramework, detectStackFor, emptyBuildConfig, headers,
  servicesPayload, statusDot, timeAgo,
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
      if (res.ok) setProjects(await res.json());
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Deploy</p>
          <h1 className="mt-1 text-[22px] sm:text-[26px] font-bold tracking-[-0.02em]">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground hidden sm:block">Deploy apps from your GitHub repos.</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Grid / list view toggle */}
          <div className="flex items-center rounded-lg border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-0.5">
            <button type="button" onClick={() => changeView("grid")} title="Grid view" className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${viewMode === "grid" ? "bg-accent text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => changeView("list")} title="List view" className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${viewMode === "list" ? "bg-accent text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={load} title="Refresh" className="h-8 w-8 p-0 sm:w-auto sm:px-3 gap-1 rounded-lg">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {ghConnected ? (
            <Button size="sm" onClick={() => { setShowRepoPicker(true); loadRepos(); }} className="btn-shine gap-1 h-8 px-2.5 sm:px-3 rounded-lg">
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Import Repo</span>
            </Button>
          ) : (
            <Button size="sm" nativeButton={false} render={<a href={`${API}/api/v1/github/connect`} />} className="btn-shine gap-1 h-8 px-2.5 sm:px-3 rounded-lg">
              <GitBranch className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Connect GitHub</span>
            </Button>
          )}
        </div>
      </div>

      {/* GitHub status */}
      {ghConnected && (
        <div className="mt-4 flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground hidden sm:inline">Connected to GitHub as</span>
            <span className="font-medium truncate">@{ghUsername}</span>
            <Badge variant="outline" className="text-[10px] text-emerald-600 dark:text-emerald-400 border-emerald-500/40 shrink-0"><Check className="h-2.5 w-2.5 mr-0.5" /> Connected</Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={disconnectGH} className="text-xs text-muted-foreground">Disconnect</Button>
        </div>
      )}

      {/* Repo picker modal */}
      {showRepoPicker && (
        <Card className="mt-4">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Import a Repository</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setShowRepoPicker(false)}>Cancel</Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search repos..." className="pl-9 h-9 text-sm" value={repoSearch} onChange={(e) => setRepoSearch(e.target.value)} />
            </div>

            {loadingRepos ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
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
                      <Rocket className="h-3 w-3" /> Import
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
        <Card className="mt-4 border-primary/30">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Configure Project</CardTitle>
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
                  <Layers className="h-4 w-4 text-muted-foreground mt-0.5" />
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
                  <Settings2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium">Advanced Build &amp; Runtime Settings</span>
                  <span className="text-[10px] text-muted-foreground">(optional)</span>
                </div>
                {importShowAdvanced ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </button>
              {importShowAdvanced && (
                <div className="border-t border-border/40 p-4 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">Root Directory <span className="text-muted-foreground">(monorepos)</span></label>
                      <div className="relative">
                        <input type="text" placeholder="apps/web" value={importBuildCfg.root_dir} onChange={(e) => setImportBuildCfg({ ...importBuildCfg, root_dir: e.target.value })} className="w-full h-8 rounded-md border border-input bg-muted pl-2 pr-8 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                        <button type="button" title="Browse repository directories" disabled={!importRepo?.full_name} onClick={() => setDirPicker({ kind: "root" })} className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-violet-500 hover:bg-accent disabled:opacity-40">
                          <Folder className="h-3.5 w-3.5" />
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
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Deploy Project
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Projects list */}
      {loading ? (
        <p className="mt-8 text-sm text-muted-foreground animate-pulse">Loading projects…</p>
      ) : projects.length === 0 && !showRepoPicker ? (
        <div className="relative mt-8 rounded-2xl border border-dashed border-border overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute -top-20 left-1/2 h-40 w-[380px] -translate-x-1/2 rounded-full bg-emerald-500/[0.07] blur-[80px] dark:bg-emerald-400/[0.08]" />
          <div className="relative flex flex-col items-center py-16 px-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/70 bg-card">
              <Rocket className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h3 className="mt-4 font-semibold">No projects yet</h3>
            <p className="mt-2 text-sm text-muted-foreground text-center max-w-sm">
              {ghConnected ? "Import a repo from GitHub to deploy your first app." : "Connect your GitHub account to import and deploy repos."}
            </p>
            {ghConnected ? (
              <Button onClick={() => { setShowRepoPicker(true); loadRepos(); }} className="btn-shine mt-5 gap-1 rounded-full px-5"><Plus className="h-4 w-4" /> Import Repo</Button>
            ) : (
              <Button nativeButton={false} render={<a href={`${API}/api/v1/github/connect`} />} className="btn-shine mt-5 gap-1 rounded-full px-5">
                <GitBranch className="h-4 w-4" /> Connect GitHub
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {/* Label filter bar — only show once there are any labels across projects */}
          {(() => {
            const allLabels = Array.from(new Set(projects.flatMap((p) => p.labels || []))).sort();
            if (allLabels.length === 0) return null;
            return (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-muted-foreground">Filter:</span>
                <button onClick={() => setLabelFilter("")} className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${labelFilter === "" ? "border-foreground/30 bg-accent text-foreground" : "border-border/60 text-muted-foreground hover:text-foreground"}`}>All</button>
                {allLabels.map((l) => (
                  <button key={l} onClick={() => setLabelFilter(labelFilter === l ? "" : l)} className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${labelFilter === l ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "border-border/60 text-muted-foreground hover:text-foreground"}`}>{l}</button>
                ))}
              </div>
            );
          })()}
          <div className={viewMode === "grid"
            ? "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3"
            : "rounded-2xl border border-border/60 divide-y divide-border/60 overflow-hidden bg-card/60 dark:bg-[#0c0d0f]/40"}>
            {/* table header (list view only) */}
            {viewMode === "list" && (
              <div className="hidden md:flex items-center gap-3 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70 bg-muted/40">
                <span className="flex-1">Project</span>
                <span className="w-44 text-right pr-2">Actions</span>
              </div>
            )}
          {projects.filter((p) => labelFilter === "" || (p.labels || []).includes(labelFilter)).map((p) => {
            const isGrid = viewMode === "grid";
            return (
            <div
              key={p.id}
              id={`project-row-${p.id}`}
              onClick={() => router.push(`/projects/${p.id}`)}
              className={isGrid
                ? `cursor-pointer rounded-2xl border bg-card/60 dark:bg-[#0c0d0f]/40 overflow-hidden transition-all duration-300 border-border/60 hover:border-foreground/25 hover:shadow-[0_12px_32px_-20px_rgba(0,0,0,0.25)]`
                : `cursor-pointer transition-colors hover:bg-accent/40`}>
              <div className={isGrid ? "p-5" : "px-4 py-2.5"}>
                <div className={isGrid ? "flex flex-col gap-3 items-stretch" : "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3"}>
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground shrink-0">
                      <Rocket className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="relative flex h-1.5 w-1.5 shrink-0" title={p.status}>
                          {p.status === "running" && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />}
                          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${statusDot[p.status] || "bg-zinc-500"}`} />
                        </span>
                        <span className="text-[15px] font-medium truncate">{p.name}</span>
                        <span className="text-[11px] text-muted-foreground shrink-0 capitalize">{p.status}</span>
                        {(p.labels || []).map((l) => (
                          <Badge key={l} variant="outline" className="text-[10px] shrink-0 text-blue-600 dark:text-blue-400 border-blue-500/40 bg-blue-500/5 hidden lg:inline-flex">{l}</Badge>
                        ))}
                      </div>

                      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground font-mono min-w-0">
                        <Globe className="h-3 w-3 shrink-0" />
                        <span className="truncate">{p.subdomain}.deployzy.app</span>
                      </div>

                      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground min-w-0 flex-wrap">
                        <span className="capitalize">{p.framework || "custom"}</span>
                        {p.github_repo && (
                          <>
                            <span className="text-border">·</span>
                            <span className="inline-flex items-center gap-1 min-w-0">
                              <GitBranch className="h-3 w-3 shrink-0" />
                              <span className="truncate">{p.github_repo}</span>
                            </span>
                          </>
                        )}
                        <span className="text-border">·</span>
                        <span className="whitespace-nowrap">{timeAgo(p.last_deploy_at)}</span>
                      </div>
                    </div>
                  </div>
                  {/* Quick actions — stopPropagation so they don't navigate */}
                  <div
                    className={isGrid
                      ? "flex items-center gap-1.5 flex-wrap pt-3 border-t border-border/70"
                      : "flex items-center gap-1 flex-wrap shrink-0"}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {p.status !== "running" && p.status !== "building" && (
                      p.deploy_source === "upload" ? (
                        <>
                          <Button variant="outline" size="sm" className="gap-1 h-8 text-xs" title="Redeploy the last uploaded build" onClick={() => deploy(p.id)} disabled={deploying === p.id}>
                            {deploying === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                            <span className="hidden sm:inline">{p.status === "stopped" ? "Start" : "Redeploy"}</span>
                          </Button>
                          <ReuploadButton projectId={p.id} onDeployed={() => router.push(`/projects/${p.id}/logs`)} />
                        </>
                      ) : (
                        <Button variant="outline" size="sm" className="gap-1 h-8 text-xs" title={p.status === "stopped" ? "Start" : "Deploy"} onClick={() => deploy(p.id)} disabled={deploying === p.id}>
                          {deploying === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                          <span className="hidden sm:inline">{p.status === "stopped" ? "Start" : "Deploy"}</span>
                        </Button>
                      )
                    )}
                    {p.status === "running" && (
                      <>
                        <Button variant={isGrid ? "default" : "outline"} size="sm" className="gap-1.5 h-8 text-xs" title="Visit site" nativeButton={false} render={<a href={`https://${p.subdomain}.deployzy.app`} target="_blank" rel="noopener" />}>
                          <ExternalLink className="h-3 w-3" /><span className="hidden sm:inline">Visit</span>
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1 h-8 text-xs" title={p.deploy_source === "upload" ? "Redeploy the last uploaded build" : "Redeploy"} onClick={() => deploy(p.id)} disabled={deploying === p.id}>
                          {deploying === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                          <span className="hidden sm:inline"> Redeploy</span>
                        </Button>
                        {p.deploy_source === "upload" && (
                          <ReuploadButton projectId={p.id} onDeployed={() => router.push(`/projects/${p.id}/logs`)} />
                        )}
                        <Button variant="outline" size="sm" className="gap-1 h-8 text-xs" title="Stop" onClick={() => stop(p.id)}>
                          <Square className="h-3 w-3" /><span className="hidden sm:inline"> Stop</span>
                        </Button>
                      </>
                    )}
                    {p.status === "building" && <Badge className="text-[10px] animate-pulse">Building...</Badge>}
                    <Button
                      variant="ghost" size="sm"
                      className="h-8 px-2 text-muted-foreground hover:text-foreground"
                      title="Open project"
                      onClick={() => router.push(`/projects/${p.id}`)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          );
          })}
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

export default function ProjectsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground p-8">Loading...</div>}>
      <ProjectsContent />
    </Suspense>
  );
}
