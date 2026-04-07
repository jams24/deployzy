"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Rocket, Plus, Play, Square, Trash2, ExternalLink, RefreshCw,
  Terminal, Globe, GitBranch, Search, Check, Loader2, Code, Database, Copy, Eye, EyeOff,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface Project {
  id: string; name: string; subdomain: string; framework: string;
  repo_url: string; github_repo: string; status: string;
  env_vars: Record<string, string>;
  last_deploy_at: string | null; created_at: string;
}
interface DeployLog {
  message: string; level: string; created_at: string;
}
interface GitHubRepo {
  id: number; name: string; full_name: string; private: boolean;
  description: string; language: string; default_branch: string;
  html_url: string; updated_at: string;
}

const statusColor: Record<string, string> = {
  running: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  building: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  stopped: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  failed: "bg-red-500/10 text-red-500 border-red-500/20",
  created: "bg-blue-500/10 text-blue-400 border-blue-500/20",
};

const langColor: Record<string, string> = {
  JavaScript: "bg-yellow-400", TypeScript: "bg-blue-400", Python: "bg-green-400",
  Go: "bg-cyan-400", Rust: "bg-orange-400", Java: "bg-red-400",
  Ruby: "bg-red-500", PHP: "bg-violet-400", HTML: "bg-orange-500",
};

function ProjectsContent() {
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [ghConnected, setGhConnected] = useState(false);
  const [ghUsername, setGhUsername] = useState("");
  const [ghRepos, setGhRepos] = useState<GitHubRepo[]>([]);
  const [repoSearch, setRepoSearch] = useState("");
  const [showRepoPicker, setShowRepoPicker] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [logs, setLogs] = useState<DeployLog[]>([]);
  const [deploying, setDeploying] = useState<string | null>(null);
  const [editingEnv, setEditingEnv] = useState<string | null>(null);
  const [envText, setEnvText] = useState("");
  const [projectDetail, setProjectDetail] = useState<Project | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteText, setDeleteText] = useState("");
  const [importRepo, setImportRepo] = useState<GitHubRepo | null>(null);
  const [importName, setImportName] = useState("");
  const [importSubdomain, setImportSubdomain] = useState("");
  const [importing, setImporting] = useState(false);
  const [userServers, setUserServers] = useState<{ id: string; label: string; host: string; status: string }[]>([]);
  const [selectedServer, setSelectedServer] = useState("");
  const [dbInfo, setDbInfo] = useState<Record<string, { db_name: string; db_user: string; db_password: string; host: string; port: number; connection_url: string } | null>>({});
  const [creatingDB, setCreatingDB] = useState<string | null>(null);
  const [showDBPass, setShowDBPass] = useState<Record<string, boolean>>({});
  const [backups, setBackups] = useState<Record<string, { id: string; file_name: string; file_size: number; created_at: string }[]>>({});
  const [backingUp, setBackingUp] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<{ enabled: boolean; schedule: string; time: string; retention: number }>({ enabled: false, schedule: "daily", time: "03:00", retention: 7 });

  const headers = () => {
    const token = localStorage.getItem("sm_token");
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };

  // Handle GitHub OAuth callback
  useEffect(() => {
    const ghToken = searchParams.get("github_token");
    const ghUser = searchParams.get("github_user");
    if (ghToken && ghUser) {
      fetch(`${API}/api/v1/github/connect`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ access_token: ghToken, github_username: ghUser, installation_id: parseInt(searchParams.get("installation_id") || "0") }),
      }).then(() => {
        setGhConnected(true);
        setGhUsername(ghUser);
        window.history.replaceState({}, "", "/projects");
      });
    }
  }, [searchParams]);

  async function loadGHStatus() {
    try {
      const res = await fetch(`${API}/api/v1/github/status`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setGhConnected(data.connected);
        if (data.username) setGhUsername(data.username);
      }
    } catch {}
  }

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

  async function load() {
    try {
      const res = await fetch(`${API}/api/v1/projects`, { headers: headers() });
      if (res.ok) setProjects(await res.json());
    } catch {}
    setLoading(false);
  }

  function selectRepoForImport(repo: GitHubRepo) {
    setImportRepo(repo);
    setImportName(repo.name);
    setImportSubdomain(repo.name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-"));
    setSelectedServer("");
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
      alert(err.error || "Failed to create project");
      setImporting(false);
      return;
    }

    const project = await res.json();

    // Deploy immediately
    await fetch(`${API}/api/v1/projects/${project.id}/deploy`, {
      method: "POST", headers: headers(),
    });
    setShowRepoPicker(false);
    setImportRepo(null);
    setDeploying(project.id);
    setTimeout(() => setDeploying(null), 5000);
    load();
    setImporting(false);
  }

  async function deploy(id: string) {
    setDeploying(id);
    await fetch(`${API}/api/v1/projects/${id}/deploy`, { method: "POST", headers: headers() });
    load();
    loadLogs(id);
    setTimeout(() => setDeploying(null), 3000);
  }

  async function stop(id: string) {
    await fetch(`${API}/api/v1/projects/${id}/stop`, { method: "POST", headers: headers() });
    load();
  }

  async function remove(id: string) {
    await fetch(`${API}/api/v1/projects/${id}`, { method: "DELETE", headers: headers() });
    setSelectedProject(null);
    setConfirmDelete(null);
    setDeleteText("");
    load();
  }

  async function loadLogs(id: string) {
    const res = await fetch(`${API}/api/v1/projects/${id}/logs`, { headers: headers() });
    if (res.ok) setLogs(await res.json());
  }

  async function loadProjectDetail(id: string) {
    const res = await fetch(`${API}/api/v1/projects/${id}`, { headers: headers() });
    if (res.ok) {
      const data = await res.json();
      setProjectDetail(data.project);
      // Convert env_vars object to KEY=VALUE text
      const envObj = data.project.env_vars || {};
      setEnvText(Object.entries(envObj).map(([k, v]) => `${k}=${v}`).join("\n"));
    }
  }

  async function saveEnvVars(id: string) {
    // Parse KEY=VALUE lines into object
    const envVars: Record<string, string> = {};
    envText.split("\n").forEach((line) => {
      const eq = line.indexOf("=");
      if (eq > 0) {
        envVars[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
    });

    await fetch(`${API}/api/v1/projects/${id}`, {
      method: "PUT", headers: headers(),
      body: JSON.stringify({ env_vars: envVars }),
    });
    setEditingEnv(null);
    load();
  }

  async function loadDatabase(id: string) {
    try {
      const res = await fetch(`${API}/api/v1/projects/${id}/database`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setDbInfo((prev) => ({ ...prev, [id]: data.database ? { ...data.database, connection_url: data.connection_url } : null }));
      }
    } catch {}
  }

  async function createDatabase(id: string) {
    setCreatingDB(id);
    try {
      const res = await fetch(`${API}/api/v1/projects/${id}/database`, { method: "POST", headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setDbInfo((prev) => ({ ...prev, [id]: { ...data.database, connection_url: data.connection_url } }));
      } else {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        alert(err.error || "Failed to create database");
      }
    } catch {}
    setCreatingDB(null);
  }

  async function deleteDatabase(id: string) {
    if (!confirm("Delete this database? All data will be permanently lost.")) return;
    try {
      await fetch(`${API}/api/v1/projects/${id}/database`, { method: "DELETE", headers: headers() });
      setDbInfo((prev) => ({ ...prev, [id]: null }));
    } catch {}
  }

  async function loadBackups(id: string) {
    try {
      const res = await fetch(`${API}/api/v1/projects/${id}/backups`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setBackups((prev) => ({ ...prev, [id]: Array.isArray(data) ? data : [] }));
      }
    } catch {}
  }

  async function createBackup(id: string) {
    setBackingUp(id);
    try {
      const res = await fetch(`${API}/api/v1/projects/${id}/backups`, { method: "POST", headers: headers() });
      if (res.ok) loadBackups(id);
      else alert("Backup failed");
    } catch {}
    setBackingUp(null);
  }

  async function deleteBackup(projectId: string, backupId: string) {
    await fetch(`${API}/api/v1/projects/${projectId}/backups/${backupId}`, { method: "DELETE", headers: headers() });
    loadBackups(projectId);
  }

  async function restoreBackup(projectId: string, backupId: string) {
    if (!confirm("Restore this backup? Current data will be overwritten.")) return;
    const res = await fetch(`${API}/api/v1/projects/${projectId}/backups/${backupId}/restore`, { method: "POST", headers: headers() });
    if (res.ok) alert("Database restored successfully");
    else alert("Restore failed");
  }

  async function loadSchedule(id: string) {
    try {
      const res = await fetch(`${API}/api/v1/projects/${id}/backup-schedule`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        if (data) setSchedule({ enabled: data.enabled, schedule: data.schedule, time: data.time, retention: data.retention });
      }
    } catch {}
    setShowSchedule(id);
  }

  async function saveSchedule(id: string) {
    await fetch(`${API}/api/v1/projects/${id}/backup-schedule`, { method: "PUT", headers: headers(), body: JSON.stringify(schedule) });
    setShowSchedule(null);
  }

  async function disconnectGH() {
    await fetch(`${API}/api/v1/github`, { method: "DELETE", headers: headers() });
    setGhConnected(false); setGhUsername(""); setGhRepos([]);
  }

  useEffect(() => { load(); loadGHStatus(); }, []);
  useEffect(() => {
    if (!selectedProject) return;
    loadLogs(selectedProject);
    loadDatabase(selectedProject);
    loadBackups(selectedProject);
    const t = setInterval(() => loadLogs(selectedProject), 5000);
    return () => clearInterval(t);
  }, [selectedProject]);

  const filteredRepos = (ghRepos || []).filter((r) =>
    !repoSearch || r.name.toLowerCase().includes(repoSearch.toLowerCase()) || r.full_name.toLowerCase().includes(repoSearch.toLowerCase())
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">Deploy apps from your GitHub repos.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} className="gap-1"><RefreshCw className="h-3.5 w-3.5" /></Button>
          {ghConnected ? (
            <Button size="sm" onClick={() => { setShowRepoPicker(true); loadRepos(); }} className="gap-1"><Plus className="h-3.5 w-3.5" /> Import Repo</Button>
          ) : (
            <Button size="sm" nativeButton={false} render={<a href={`${API}/api/v1/github/connect`} />} className="gap-1">
              <GitBranch className="h-3.5 w-3.5" /> Connect GitHub
            </Button>
          )}
        </div>
      </div>

      {/* GitHub status */}
      {ghConnected && (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-border/40 bg-card/30 px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Connected to GitHub as</span>
            <span className="font-medium">@{ghUsername}</span>
            <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/20"><Check className="h-2.5 w-2.5 mr-0.5" /> Connected</Badge>
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
                  <div key={repo.id} className="flex items-center justify-between rounded-lg border border-border/30 p-3 hover:bg-accent/20 transition-colors">
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
            <div className="flex items-center gap-3 rounded-lg border border-border/30 p-3 bg-accent/10">
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
                <span className="flex h-9 items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-xs text-muted-foreground">.serverme.site</span>
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
                  <option value="">ServerMe Cloud (default)</option>
                  {userServers.filter(s => s.status === "active").map((s) => (
                    <option key={s.id} value={s.id}>{s.label} ({s.host})</option>
                  ))}
                </select>
              </div>
            )}
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
        <p className="mt-8 text-sm text-muted-foreground">Loading...</p>
      ) : projects.length === 0 && !showRepoPicker ? (
        <Card className="mt-8">
          <CardContent className="flex flex-col items-center py-16">
            <Rocket className="h-12 w-12 text-muted-foreground/30" />
            <h3 className="mt-4 font-semibold">No projects yet</h3>
            <p className="mt-2 text-sm text-muted-foreground text-center max-w-sm">
              {ghConnected ? "Import a repo from GitHub to deploy your first app." : "Connect your GitHub account to import and deploy repos."}
            </p>
            {ghConnected ? (
              <Button onClick={() => { setShowRepoPicker(true); loadRepos(); }} className="mt-4 gap-1"><Plus className="h-4 w-4" /> Import Repo</Button>
            ) : (
              <Button nativeButton={false} render={<a href={`${API}/api/v1/github/connect`} />} className="mt-4 gap-1">
                <GitBranch className="h-4 w-4" /> Connect GitHub
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="mt-6 space-y-3">
          {projects.map((p) => (
            <Card key={p.id} className={`transition-colors ${selectedProject === p.id ? "border-foreground/20" : ""}`}>
              <CardContent className="pt-4 pb-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 cursor-pointer" onClick={() => setSelectedProject(selectedProject === p.id ? null : p.id)}>
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                      <Rocket className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{p.name}</span>
                        <Badge variant="outline" className={`text-[10px] ${statusColor[p.status] || ""}`}>{p.status}</Badge>
                        <Badge variant="outline" className="text-[10px]">{p.framework}</Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Globe className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground font-mono">{p.subdomain}.serverme.site</span>
                        {p.github_repo && (
                          <>
                            <GitBranch className="h-3 w-3 text-muted-foreground ml-1" />
                            <span className="text-xs text-muted-foreground">{p.github_repo}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {p.status !== "running" && p.status !== "building" && (
                      <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={() => deploy(p.id)} disabled={deploying === p.id}>
                        {deploying === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Deploy
                      </Button>
                    )}
                    {p.status === "running" && (
                      <>
                        <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" nativeButton={false} render={<a href={`https://${p.subdomain}.serverme.site`} target="_blank" rel="noopener" />}>
                          <ExternalLink className="h-3 w-3" /> Visit
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={() => deploy(p.id)} disabled={deploying === p.id}>
                          {deploying === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Redeploy
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={() => stop(p.id)}>
                          <Square className="h-3 w-3" /> Stop
                        </Button>
                      </>
                    )}
                    {p.status === "building" && <Badge className="text-[10px] animate-pulse">Building...</Badge>}
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:text-destructive" onClick={() => { setConfirmDelete(p.id); setDeleteText(""); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Delete confirmation */}
                {confirmDelete === p.id && (
                  <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Trash2 className="h-4 w-4 text-red-500" />
                      <span className="text-sm font-medium text-red-500">Delete Project</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This will permanently delete <span className="font-semibold text-foreground">{p.name}</span> and its container. This action cannot be undone.
                    </p>
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">
                        Type <span className="font-mono font-semibold text-foreground">{p.name}</span> to confirm:
                      </label>
                      <Input
                        value={deleteText}
                        onChange={(e) => setDeleteText(e.target.value)}
                        placeholder={p.name}
                        className="h-8 text-sm font-mono"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-red-500/30 text-red-500 hover:bg-red-500/10 hover:text-red-500"
                        disabled={deleteText !== p.name}
                        onClick={() => remove(p.id)}
                      >
                        <Trash2 className="h-3 w-3 mr-1" /> Delete Forever
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setConfirmDelete(null); setDeleteText(""); }}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {/* Env Vars */}
                {selectedProject === p.id && (
                  <div className="mt-4">
                    {editingEnv === p.id ? (
                      <div className="rounded-lg border border-border/40 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium">Environment Variables</span>
                          <span className="text-[10px] text-muted-foreground">KEY=VALUE format, one per line</span>
                        </div>
                        <textarea
                          value={envText}
                          onChange={(e) => setEnvText(e.target.value)}
                          placeholder={"BOT_TOKEN=123456:ABC...\nDATABASE_URL=postgres://...\nPORT=3000"}
                          className="w-full h-32 rounded-md border border-input bg-[#09090b] px-3 py-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-700 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" className="h-7 text-xs" onClick={async () => { await saveEnvVars(p.id); deploy(p.id); }}>Save & Redeploy</Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingEnv(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => { setEditingEnv(p.id); loadProjectDetail(p.id); }}>
                        <Code className="h-3 w-3" /> Environment Variables
                        {p.env_vars && Object.keys(p.env_vars).length > 0 && (
                          <Badge variant="outline" className="ml-1 text-[9px]">{Object.keys(p.env_vars).length}</Badge>
                        )}
                      </Button>
                    )}
                  </div>
                )}

                {/* Database */}
                {selectedProject === p.id && (
                  <div className="mt-4">
                    {dbInfo[p.id] ? (
                      <div className="rounded-lg border border-border/40 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Database className="h-4 w-4 text-blue-400" />
                            <span className="text-xs font-medium">PostgreSQL Database</span>
                            <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/20">Active</Badge>
                          </div>
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-destructive hover:text-destructive" onClick={() => deleteDatabase(p.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div><span className="text-muted-foreground">Database:</span> <span className="font-mono">{dbInfo[p.id]!.db_name}</span></div>
                          <div><span className="text-muted-foreground">User:</span> <span className="font-mono">{dbInfo[p.id]!.db_user}</span></div>
                          <div><span className="text-muted-foreground">Host:</span> <span className="font-mono">{dbInfo[p.id]!.host}</span></div>
                          <div><span className="text-muted-foreground">Port:</span> <span className="font-mono">{dbInfo[p.id]!.port}</span></div>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[10px] text-muted-foreground">Connection URL</span>
                          <div className="flex items-center gap-1">
                            <code className="flex-1 rounded-md border border-input bg-[#09090b] px-2 py-1.5 font-mono text-[10px] text-zinc-400 overflow-x-auto">
                              {showDBPass[p.id]
                                ? dbInfo[p.id]!.connection_url
                                : dbInfo[p.id]!.connection_url.replace(`:${dbInfo[p.id]!.db_password}@`, ":****@")}
                            </code>
                            <Button variant="ghost" size="sm" className="h-7 px-1.5" onClick={() => setShowDBPass((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}>
                              {showDBPass[p.id] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 px-1.5" onClick={() => { navigator.clipboard.writeText(dbInfo[p.id]!.connection_url); }}>
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>

                        {/* Backups */}
                        <div className="border-t border-border/30 pt-3 mt-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-medium text-muted-foreground">Backups</span>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => loadSchedule(p.id)}>Schedule</Button>
                              <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1" onClick={() => createBackup(p.id)} disabled={backingUp === p.id}>
                                {backingUp === p.id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Database className="h-2.5 w-2.5" />} Backup Now
                              </Button>
                            </div>
                          </div>

                          {/* Schedule editor */}
                          {showSchedule === p.id && (
                            <div className="rounded-md border border-border/30 bg-[#09090b] p-3 space-y-2">
                              <div className="flex items-center gap-3">
                                <label className="flex items-center gap-1.5 text-[10px]">
                                  <input type="checkbox" checked={schedule.enabled} onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })} className="rounded" />
                                  Enabled
                                </label>
                                <select className="h-6 rounded border border-input bg-background px-1.5 text-[10px]" value={schedule.schedule} onChange={(e) => setSchedule({ ...schedule, schedule: e.target.value })}>
                                  <option value="every6h">Every 6 hours</option>
                                  <option value="every12h">Every 12 hours</option>
                                  <option value="daily">Daily</option>
                                  <option value="weekly">Weekly</option>
                                </select>
                                <input type="time" className="h-6 rounded border border-input bg-background px-1.5 text-[10px]" value={schedule.time} onChange={(e) => setSchedule({ ...schedule, time: e.target.value })} />
                                <select className="h-6 rounded border border-input bg-background px-1.5 text-[10px]" value={schedule.retention} onChange={(e) => setSchedule({ ...schedule, retention: parseInt(e.target.value) })}>
                                  {[3, 7, 14, 30].map((d) => <option key={d} value={d}>Keep {d} days</option>)}
                                </select>
                              </div>
                              <div className="flex gap-1">
                                <Button size="sm" className="h-6 px-2 text-[10px]" onClick={() => saveSchedule(p.id)}>Save</Button>
                                <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setShowSchedule(null)}>Cancel</Button>
                              </div>
                            </div>
                          )}

                          {/* Backup list */}
                          {(backups[p.id] || []).length > 0 ? (
                            <div className="space-y-1">
                              {(backups[p.id] || []).map((b) => (
                                <div key={b.id} className="flex items-center justify-between rounded-md bg-[#09090b] px-2.5 py-1.5 text-[10px]">
                                  <div className="flex items-center gap-2 font-mono text-zinc-400">
                                    <Database className="h-3 w-3 text-zinc-600" />
                                    <span>{new Date(b.created_at).toLocaleString()}</span>
                                    <span className="text-zinc-600">{(b.file_size / 1024).toFixed(1)} KB</span>
                                  </div>
                                  <div className="flex gap-1">
                                    <Button variant="ghost" size="sm" className="h-5 px-1 text-[9px]" onClick={async () => {
                                      const res = await fetch(`${API}/api/v1/projects/${p.id}/backups/${b.id}/download`, { headers: headers() });
                                      if (res.ok) {
                                        const blob = await res.blob();
                                        const url = URL.createObjectURL(blob);
                                        const a = document.createElement("a"); a.href = url; a.download = b.file_name; a.click(); URL.revokeObjectURL(url);
                                      }
                                    }}>Download</Button>
                                    <Button variant="ghost" size="sm" className="h-5 px-1 text-[9px] text-blue-400" onClick={() => restoreBackup(p.id, b.id)}>Restore</Button>
                                    <Button variant="ghost" size="sm" className="h-5 px-1 text-[9px] text-destructive" onClick={() => deleteBackup(p.id, b.id)}>Delete</Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[10px] text-zinc-600">No backups yet</p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => createDatabase(p.id)} disabled={creatingDB === p.id}>
                        {creatingDB === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Database className="h-3 w-3" />}
                        Add PostgreSQL Database
                      </Button>
                    )}
                  </div>
                )}

                {/* Logs */}
                {selectedProject === p.id && logs.length > 0 && (
                  <div className="mt-4 rounded-lg border border-border/40 bg-[#09090b] overflow-hidden max-h-64 overflow-y-auto">
                    <div className="border-b border-white/[0.04] px-3 py-1.5 text-[10px] text-zinc-600 font-mono flex items-center gap-2">
                      <Terminal className="h-3 w-3" /> Deploy Logs
                    </div>
                    <div className="p-2 font-mono text-[11px] space-y-0.5">
                      {logs.map((l, i) => (
                        <div key={i} className={`px-2 py-0.5 rounded ${l.level === "error" ? "text-red-400" : l.level === "build" ? "text-amber-400" : l.level === "deploy" ? "text-emerald-400" : "text-zinc-500"}`}>
                          <span className="text-zinc-700">{new Date(l.created_at).toLocaleTimeString()}</span> {l.message}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function detectFramework(language: string | null): string {
  switch (language) {
    case "TypeScript": case "JavaScript": return "node";
    case "Python": return "python";
    case "Go": return "docker";
    case "HTML": case "CSS": return "static";
    default: return "node";
  }
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground p-8">Loading...</div>}>
      <ProjectsContent />
    </Suspense>
  );
}
