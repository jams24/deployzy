"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  GitBranch, Database, Container, Layers, Search, Rocket,
  ChevronRight, ChevronDown, Loader2, Globe, Server, Check, ArrowLeft, Settings2,
} from "lucide-react";
import { getBuildPlaceholders } from "@/lib/placeholders";
import { autoFormatEnvText, parseEnvText } from "@/lib/parseEnvText";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface GitHubRepo {
  id: number; name: string; full_name: string; private: boolean;
  description: string; language: string; default_branch: string;
  html_url: string;
}

const langColor: Record<string, string> = {
  JavaScript: "bg-yellow-400", TypeScript: "bg-blue-400", Python: "bg-green-400",
  Go: "bg-cyan-400", Rust: "bg-orange-400", Java: "bg-red-400",
  Ruby: "bg-red-500", PHP: "bg-violet-400", HTML: "bg-orange-500",
};

const options = [
  { id: "github", title: "GitHub Repository", desc: "Deploy from a GitHub repo", icon: GitBranch, color: "text-violet-400 bg-violet-500/10", category: "deploy" },
  { id: "database", title: "Database", desc: "PostgreSQL instance with connection URL", icon: Database, color: "text-emerald-400 bg-emerald-500/10", category: "infra" },
  { id: "template", title: "Template", desc: "Start from a pre-built template", icon: Layers, color: "text-amber-400 bg-amber-500/10", category: "deploy" },
  { id: "docker", title: "Docker Image", desc: "Deploy a Docker Hub image", icon: Container, color: "text-blue-400 bg-blue-500/10", category: "deploy" },
  { id: "domain", title: "Custom Domain", desc: "Connect your own domain", icon: Globe, color: "text-pink-400 bg-pink-500/10", category: "infra" },
  { id: "server", title: "SSH Server (BYOC)", desc: "Add your own server", icon: Server, color: "text-orange-400 bg-orange-500/10", category: "infra" },
];

const templates = [
  { name: "Next.js Starter", desc: "Full-stack React with App Router", repo: "https://github.com/serverme/template-nextjs.git", framework: "nextjs", lang: "TypeScript" },
  { name: "Express API", desc: "Node.js REST API server", repo: "https://github.com/serverme/template-express.git", framework: "node", lang: "JavaScript" },
  { name: "Flask API", desc: "Python lightweight web framework", repo: "https://github.com/serverme/template-flask.git", framework: "python", lang: "Python" },
  { name: "Static Site", desc: "HTML/CSS/JS with nginx", repo: "https://github.com/serverme/template-static.git", framework: "static", lang: "HTML" },
];

function detectFramework(language: string | null): string {
  switch (language) {
    case "TypeScript": case "JavaScript": return "node";
    case "Python": return "python";
    case "Go": return "docker";
    case "HTML": case "CSS": return "static";
    default: return "node";
  }
}

export default function NewResourcePage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [step, setStep] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // GitHub
  const [ghConnected, setGhConnected] = useState(false);
  const [ghRepos, setGhRepos] = useState<GitHubRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);

  // Configure project (shared by github, template, docker)
  const [projectName, setProjectName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [envText, setEnvText] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [framework, setFramework] = useState("node");
  const [githubRepo, setGithubRepo] = useState("");

  // Advanced build settings (optional)
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [installCmd, setInstallCmd] = useState("");
  const [buildCmd, setBuildCmd] = useState("");
  const [startCmd, setStartCmd] = useState("");
  const [rootDir, setRootDir] = useState("");
  const [nodeVersion, setNodeVersion] = useState("");
  const [portOverride, setPortOverride] = useState(0);
  const [memoryMB, setMemoryMB] = useState(0);
  const [cpus, setCpus] = useState(0);
  const [healthCheckPath, setHealthCheckPath] = useState("");
  const [releaseCmd, setReleaseCmd] = useState("");

  // Docker image
  const [dockerImage, setDockerImage] = useState("");

  // Database
  const [dbName, setDbName] = useState("");
  const [dbType, setDbType] = useState("postgres"); // only postgres is provisionable today
  const [dbTargetServer, setDbTargetServer] = useState(""); // "" = platform, else worker_server_id

  // Servers
  const [userServers, setUserServers] = useState<{ id: string; label: string; host: string; status: string; total_memory_mb?: number; total_cpu?: number }[]>([]);
  const [selectedServer, setSelectedServer] = useState("");

  // Plan limits (used to show real resource caps in the advanced form)
  const [planLimits, setPlanLimits] = useState<{ max_memory_mb: number; max_cpus: number } | null>(null);

  const headers = () => {
    const token = localStorage.getItem("sm_token");
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };

  useEffect(() => {
    // Check GitHub connection
    fetch(`${API}/api/v1/github/status`, { headers: headers() })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setGhConnected(!!data.connected); })
      .catch(() => {});
    // Load BYOC servers
    fetch(`${API}/api/v1/servers`, { headers: headers() })
      .then(r => r.ok ? r.json() : [])
      .then(data => setUserServers(Array.isArray(data) ? data : []))
      .catch(() => {});
    // Load plan limits so the advanced form can show real caps
    fetch(`${API}/api/v1/users/me/limits`, { headers: headers() })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.limits) setPlanLimits({ max_memory_mb: data.limits.max_memory_mb, max_cpus: data.limits.max_cpus }); })
      .catch(() => {});
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

  function selectRepo(repo: GitHubRepo) {
    setSelectedRepo(repo);
    setProjectName(repo.name);
    setSubdomain(repo.name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-"));
    setRepoUrl(repo.html_url + ".git");
    setBranch(repo.default_branch || "main");
    setGithubRepo(repo.full_name);
    setFramework(detectFramework(repo.language));
    setEnvText("");
    setInstallCmd(""); setBuildCmd(""); setStartCmd("");
    setRootDir(""); setNodeVersion("");
    setPortOverride(0); setMemoryMB(0); setCpus(0);
    setHealthCheckPath(""); setReleaseCmd("");
    setShowAdvanced(false);
    setStep("configure");
  }

  function selectTemplate(t: typeof templates[0]) {
    setSelectedRepo(null);
    setProjectName(t.name.toLowerCase().replace(/\s+/g, "-"));
    setSubdomain(t.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""));
    setRepoUrl(t.repo);
    setBranch("main");
    setGithubRepo("");
    setFramework(t.framework);
    setEnvText("");
    setInstallCmd(""); setBuildCmd(""); setStartCmd("");
    setRootDir(""); setNodeVersion("");
    setPortOverride(0); setMemoryMB(0); setCpus(0);
    setHealthCheckPath(""); setReleaseCmd("");
    setShowAdvanced(false);
    setStep("configure");
  }

  function startDocker() {
    setSelectedRepo(null);
    setProjectName("");
    setSubdomain("");
    setRepoUrl("");
    setDockerImage("");
    setEnvText("");
    setInstallCmd(""); setBuildCmd(""); setStartCmd("");
    setRootDir(""); setNodeVersion("");
    setPortOverride(0); setMemoryMB(0); setCpus(0);
    setHealthCheckPath(""); setReleaseCmd("");
    setShowAdvanced(false);
    setStep("docker");
  }

  async function deployProject() {
    if (!projectName || !subdomain) return;
    setCreating(true);

    const body: Record<string, string | undefined> = {
      name: projectName,
      subdomain,
      framework,
      repo_url: repoUrl || undefined,
      branch: branch || "main",
      github_repo: githubRepo || undefined,
      worker_server_id: selectedServer || undefined,
    };

    const res = await fetch(`${API}/api/v1/projects`, {
      method: "POST", headers: headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed" }));
      alert(err.error || "Failed to create project");
      setCreating(false);
      return;
    }

    const project = await res.json();

    // Set env vars if provided
    if (envText.trim()) {
      const envVars = parseEnvText(envText);
      await fetch(`${API}/api/v1/projects/${project.id}`, {
        method: "PUT", headers: headers(),
        body: JSON.stringify({ env_vars: envVars }),
      });
    }

    // Set build config if any advanced setting was customized — must happen
    // before /deploy so the first build picks it up.
    if (installCmd || buildCmd || startCmd || rootDir || nodeVersion || portOverride || memoryMB || cpus || healthCheckPath || releaseCmd) {
      await fetch(`${API}/api/v1/projects/${project.id}/build-config`, {
        method: "PUT", headers: headers(),
        body: JSON.stringify({
          install_cmd: installCmd, build_cmd: buildCmd, start_cmd: startCmd,
          root_dir: rootDir, node_version: nodeVersion,
          port_override: portOverride, memory_mb: memoryMB, cpus,
          health_check_path: healthCheckPath, release_cmd: releaseCmd,
        }),
      });
    }

    // Deploy
    await fetch(`${API}/api/v1/projects/${project.id}/deploy`, {
      method: "POST", headers: headers(),
    });

    router.push("/projects");
  }

  async function createDatabase() {
    if (!dbName) return;
    setCreating(true);
    try {
      const res = await fetch(`${API}/api/v1/services`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ name: dbName, type: dbType, worker_server_id: dbTargetServer || undefined }),
      });
      if (res.ok) router.push("/services");
      else {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        alert(err.error || "Failed to create database");
      }
    } catch {}
    setCreating(false);
  }

  // Deep-link support: /new?type=database opens the database form directly
  // (used by the "New Database" button) instead of the resource picker.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("type");
    if (t === "database") { setDbName(""); setStep("database"); }
  }, []);

  function handleSelect(id: string) {
    switch (id) {
      case "github":
        if (!ghConnected) { window.location.href = `${API}/api/v1/github/connect`; return; }
        loadRepos();
        setRepoSearch("");
        setStep("github");
        break;
      case "database": setDbName(""); setStep("database"); break;
      case "template": setStep("template"); break;
      case "docker": startDocker(); break;
      case "domain": router.push("/domains"); break;
      case "server": router.push("/servers"); break;
    }
  }

  const filtered = options.filter(o =>
    !search || o.title.toLowerCase().includes(search.toLowerCase()) || o.desc.toLowerCase().includes(search.toLowerCase())
  );

  const filteredRepos = ghRepos.filter(r =>
    !repoSearch || r.name.toLowerCase().includes(repoSearch.toLowerCase()) || r.full_name.toLowerCase().includes(repoSearch.toLowerCase())
  );

  const BackButton = () => (
    <button onClick={() => setStep(null)} className="text-xs text-muted-foreground hover:text-foreground mb-4 flex items-center gap-1">
      <ArrowLeft className="h-3 w-3" /> Back
    </button>
  );

  // Effective resource caps for the advanced form: on a BYOC server the limit is
  // the server's own capacity (no plan cap — you're paying for that box);
  // otherwise the plan max (0 = unlimited, e.g. admin).
  const byocSrv = userServers.find((s) => s.id === selectedServer);
  const memCap = byocSrv?.total_memory_mb || (planLimits && planLimits.max_memory_mb > 0 ? planLimits.max_memory_mb : 0);
  const cpuCap = byocSrv?.total_cpu || (planLimits && planLimits.max_cpus > 0 ? planLimits.max_cpus : 0);
  const capLabel = byocSrv ? "server max" : "plan max";

  // ── Step: GitHub Repo Picker ──
  if (step === "github") {
    return (
      <div className="max-w-lg mx-auto mt-8">
        <BackButton />
        <h1 className="text-xl font-bold mb-1">Import GitHub Repository</h1>
        <p className="text-sm text-muted-foreground mb-4">Select a repository to deploy.</p>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search repos..." className="pl-9 h-9 text-sm" value={repoSearch} onChange={(e) => setRepoSearch(e.target.value)} />
        </div>

        {loadingRepos ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : filteredRepos.length === 0 ? (
          <div className="flex flex-col items-center py-12 space-y-3">
            <GitBranch className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No repos found</p>
            <p className="text-xs text-muted-foreground text-center max-w-xs">Your GitHub token may have expired. Reconnect to refresh access.</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => loadRepos()}>
                <Loader2 className="h-3 w-3" /> Retry
              </Button>
              <Button size="sm" className="gap-1 text-xs" onClick={() => { window.location.href = `${API}/api/v1/github/connect`; }}>
                <GitBranch className="h-3 w-3" /> Reconnect GitHub
              </Button>
            </div>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto space-y-1">
            {filteredRepos.map((repo) => (
              <button key={repo.id} onClick={() => selectRepo(repo)} className="flex w-full items-center justify-between rounded-lg border border-border/30 p-3 hover:bg-accent/20 transition-colors text-left">
                <div className="flex items-center gap-3 min-w-0">
                  {repo.language && <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${langColor[repo.language] || "bg-gray-400"}`} />}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{repo.name}</span>
                      {repo.private && <Badge variant="outline" className="text-[9px]">private</Badge>}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">{repo.description || repo.full_name}</p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Step: Configure Project (shared by GitHub, Template, Docker) ──
  if (step === "configure" || step === "docker") {
    const ph = getBuildPlaceholders(framework);
    return (
      <div className="max-w-lg mx-auto mt-8">
        <BackButton />
        <h1 className="text-xl font-bold mb-1">Configure Project</h1>
        <p className="text-sm text-muted-foreground mb-6">
          {selectedRepo ? `Deploying ${selectedRepo.full_name}` : repoUrl ? `From template` : "Configure your project"}
        </p>

        <div className="space-y-4">
          {/* Selected repo info */}
          {selectedRepo && (
            <div className="flex items-center gap-3 rounded-lg border border-border/30 p-3 bg-accent/10">
              {selectedRepo.language && <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${langColor[selectedRepo.language] || "bg-gray-400"}`} />}
              <div className="min-w-0">
                <span className="text-sm font-medium">{selectedRepo.full_name}</span>
                {selectedRepo.private && <Badge variant="outline" className="ml-2 text-[9px]">private</Badge>}
              </div>
            </div>
          )}

          {/* Docker image input */}
          {step === "docker" && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Docker Image</label>
              <Input placeholder="nginx:latest or myuser/myapp:v1" value={dockerImage} onChange={(e) => setDockerImage(e.target.value)} className="h-9 text-sm font-mono" />
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Project Name</label>
            <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="my-project" className="h-9 text-sm" />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Subdomain</label>
            <div className="flex items-center gap-0">
              <Input
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="my-project"
                className="h-9 text-sm rounded-r-none font-mono"
              />
              <span className="flex h-9 items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-xs text-muted-foreground">.deployzy.com</span>
            </div>
          </div>

          {/* Server selector */}
          {userServers.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Deploy to</label>
              <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={selectedServer} onChange={(e) => setSelectedServer(e.target.value)}>
                <option value="">Deployzy Cloud (default)</option>
                {userServers.filter(s => s.status === "active").map((s) => (
                  <option key={s.id} value={s.id}>{s.label} ({s.host})</option>
                ))}
              </select>
            </div>
          )}

          {/* Env vars */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">
                Environment Variables <span className="text-[10px] font-normal">(optional)</span>
              </label>
              <button
                type="button"
                onClick={() => setEnvText(autoFormatEnvText(envText))}
                disabled={!envText.trim()}
                className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Parse and rewrite as one KEY=VALUE per line. Recovers from pasted values with missing newlines."
              >
                Auto-format
              </button>
            </div>
            <textarea
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              placeholder={ph.env}
              className="w-full h-28 rounded-md border border-input bg-[#09090b] px-3 py-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-700 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="text-[10px] text-muted-foreground">KEY=VALUE format, one per line. Click Auto-format if a paste came out mangled.</p>
          </div>

          {/* Advanced Build & Runtime Settings */}
          <div className="rounded-lg border border-border/40 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
            >
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-medium">Advanced Build &amp; Runtime Settings</span>
                <span className="text-[10px] text-muted-foreground">(optional)</span>
              </div>
              {showAdvanced ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </button>
            {showAdvanced && (
              <div className="border-t border-border/40 p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">Root Directory <span className="text-zinc-600">(monorepos)</span></label>
                    <input type="text" placeholder="apps/web" value={rootDir} onChange={(e) => setRootDir(e.target.value)} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">Node Version</label>
                    <select value={nodeVersion} onChange={(e) => setNodeVersion(e.target.value)} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring">
                      <option value="">Default (20)</option>
                      <option value="18">Node 18</option>
                      <option value="20">Node 20</option>
                      <option value="22">Node 22</option>
                    </select>
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[10px] text-muted-foreground">Install Command</label>
                    <input type="text" placeholder={ph.install} value={installCmd} onChange={(e) => setInstallCmd(e.target.value)} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[10px] text-muted-foreground">Build Command</label>
                    <input type="text" placeholder={ph.build} value={buildCmd} onChange={(e) => setBuildCmd(e.target.value)} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[10px] text-muted-foreground">Start Command</label>
                    <input type="text" placeholder={ph.start} value={startCmd} onChange={(e) => setStartCmd(e.target.value)} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">Port <span className="text-zinc-600">(0 = auto)</span></label>
                    <input type="number" min="0" max="65535" value={portOverride || ""} onChange={(e) => setPortOverride(parseInt(e.target.value) || 0)} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">
                      Memory MB <span className="text-zinc-600">(0 = {memCap > 0 ? Math.min(512, memCap) : 512}{memCap > 0 ? `, ${capLabel} ${memCap}` : ""})</span>
                    </label>
                    <input type="number" min="0" max={memCap > 0 ? memCap : 16384} step="128" value={memoryMB || ""} onChange={(e) => setMemoryMB(parseInt(e.target.value) || 0)} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">
                      CPUs <span className="text-zinc-600">(0 = {cpuCap > 0 ? Math.min(0.5, cpuCap) : 0.5}{cpuCap > 0 ? `, ${capLabel} ${cpuCap}` : ""})</span>
                    </label>
                    <input type="number" min="0" max={cpuCap > 0 ? cpuCap : 8} step="0.25" value={cpus || ""} onChange={(e) => setCpus(parseFloat(e.target.value) || 0)} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[10px] text-muted-foreground">Health Check Path <span className="text-zinc-600">(e.g. /health; empty = skip)</span></label>
                    <input type="text" placeholder={ph.healthCheck} value={healthCheckPath} onChange={(e) => setHealthCheckPath(e.target.value)} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[10px] text-muted-foreground">Release Command <span className="text-zinc-600">(runs before start, e.g. migrations)</span></label>
                    <input type="text" placeholder={ph.release} value={releaseCmd} onChange={(e) => setReleaseCmd(e.target.value)} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">All fields optional — blank uses defaults. You can also change these later from the project settings.</p>
              </div>
            )}
          </div>

          <Button className="w-full gap-2" onClick={deployProject} disabled={creating || !projectName || !subdomain}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            Deploy Project
          </Button>
        </div>
      </div>
    );
  }

  // ── Step: Database ──
  if (step === "database") {
    return (
      <div className="max-w-lg mx-auto mt-8">
        <BackButton />
        <h1 className="text-xl font-bold mb-1">Create Database</h1>
        <p className="text-sm text-muted-foreground mb-6">Set up a new managed database instance. Use the connection URL in any project.</p>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium">Database Name</label>
            <Input placeholder="my-database" value={dbName} onChange={(e) => setDbName(e.target.value)} className="h-10" />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium">Database Type</label>
            <select value={dbType} onChange={(e) => setDbType(e.target.value)} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="postgres">PostgreSQL 16</option>
              <option value="mysql" disabled>MySQL — coming soon</option>
              <option value="redis" disabled>Redis — coming soon</option>
              <option value="mongodb" disabled>MongoDB — coming soon</option>
            </select>
          </div>

          <Card className="border-emerald-500/20">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium">PostgreSQL 16</p>
                <p className="text-[11px] text-muted-foreground">Managed instance — your plan size cap applies on platform; your full disk on BYOC</p>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2">
            <label className="text-xs font-medium">Deploy to</label>
            <select value={dbTargetServer} onChange={(e) => setDbTargetServer(e.target.value)} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Deployzy platform (shared Postgres)</option>
              {userServers.filter((s) => s.status === "active").map((s) => (
                <option key={s.id} value={s.id}>My server — {s.label} ({s.host})</option>
              ))}
            </select>
            {userServers.length > 0 && !dbTargetServer && (
              <p className="text-[11px] text-muted-foreground">Tip: deploy on your own VPS to use its full disk and skip plan DB-size caps.</p>
            )}
          </div>

          <Button className="w-full gap-2" onClick={createDatabase} disabled={creating || !dbName}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            Create Database
          </Button>
        </div>
      </div>
    );
  }

  // ── Step: Template Picker ──
  if (step === "template") {
    return (
      <div className="max-w-lg mx-auto mt-8">
        <BackButton />
        <h1 className="text-xl font-bold mb-1">Choose a Template</h1>
        <p className="text-sm text-muted-foreground mb-6">Start with a pre-configured project.</p>

        <div className="space-y-2">
          {templates.map((t) => (
            <button key={t.name} onClick={() => selectTemplate(t)} className="flex w-full items-center justify-between rounded-lg border border-border/30 p-4 hover:bg-accent/20 transition-colors text-left group">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 shrink-0 transition-transform group-hover:scale-110">
                  <Layers className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{t.name}</span>
                    <Badge variant="outline" className="text-[9px]">{t.lang}</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{t.desc}</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </div>

        <p className="mt-4 text-[11px] text-muted-foreground text-center">More templates coming soon</p>
      </div>
    );
  }

  // ── Main Command Palette ──
  return (
    <div className="max-w-lg mx-auto mt-8">
      <div className="rounded-xl border border-border/60 bg-card/50 overflow-hidden shadow-lg">
        <div className="relative border-b border-border/40">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="What would you like to create?"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-12 pl-11 border-0 rounded-none focus-visible:ring-0 text-sm"
            autoFocus
          />
        </div>

        <div className="p-2">
          {filtered.filter(o => o.category === "deploy").length > 0 && (
            <>
              <p className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Deploy</p>
              {filtered.filter(o => o.category === "deploy").map((opt) => (
                <button key={opt.id} onClick={() => handleSelect(opt.id)} className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left hover:bg-accent/50 transition-colors group">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${opt.color} shrink-0 transition-transform group-hover:scale-110`}>
                      <opt.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{opt.title}</p>
                      <p className="text-[11px] text-muted-foreground">{opt.desc}</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </>
          )}

          {filtered.filter(o => o.category === "infra").length > 0 && (
            <>
              <div className="border-t border-border/30 my-1" />
              <p className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Infrastructure</p>
              {filtered.filter(o => o.category === "infra").map((opt) => (
                <button key={opt.id} onClick={() => handleSelect(opt.id)} className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left hover:bg-accent/50 transition-colors group">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${opt.color} shrink-0 transition-transform group-hover:scale-110`}>
                      <opt.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{opt.title}</p>
                      <p className="text-[11px] text-muted-foreground">{opt.desc}</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </>
          )}

          {filtered.length === 0 && (
            <p className="px-3 py-6 text-sm text-muted-foreground text-center">No matching options</p>
          )}
        </div>
      </div>
    </div>
  );
}
