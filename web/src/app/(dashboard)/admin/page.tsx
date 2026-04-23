"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Key,
  Globe,
  Activity,
  Search,
  Trash2,
  Shield,
  Crown,
  ChevronLeft,
  ChevronRight,
  UserPlus,
  Server,
  Plus,
  Loader2,
  Rocket,
  BarChart3,
  Database,
  Link2,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface Stats {
  total_users: number;
  total_keys: number;
  total_domains: number;
  total_teams: number;
  total_requests: number;
  users_today: number;
  users_this_week: number;
  users_this_month: number;
  requests_today: number;
  projects_total: number;
  projects_by_status: Record<string, number>;
  projects_by_stack: Record<string, number>;
  deploys_today: number;
  deploys_this_week: number;
  services_total: number;
  tunnels_total: number;
  subdomains_total: number;
  worker_servers_total: number;
}

interface AdminUser {
  id: string;
  email: string;
  name: string;
  plan: string;
  is_admin: boolean;
  created_at: string;
  key_count: number;
  tunnel_requests: number;
}

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const limit = 20;
  const [servers, setServers] = useState<{ id: string; label: string; host: string; region: string; total_cpu: number; total_memory_mb: number; allocated_memory_mb: number; max_projects: number; current_projects: number; status: string; docker_installed: boolean; priority?: number; is_local?: boolean }[]>([]);
  const [showAddServer, setShowAddServer] = useState(false);
  const [serverForm, setServerForm] = useState({ label: "", host: "", ssh_user: "root", ssh_password: "", total_cpu: "2", total_memory_mb: "4096", max_projects: "10", region: "default" });

  // Platform backups
  const [backups, setBackups] = useState<{
    runs: { timestamp: string; total_bytes: number; files: { name: string; kind: string; size_bytes: number }[] }[];
    last_run: string | null;
    timer_active: boolean;
    local_dir: string;
    offsite_remote: string;
  } | null>(null);
  const [backupRunning, setBackupRunning] = useState(false);

  async function loadBackups() {
    try {
      const res = await fetch(`${API}/api/v1/admin/backups`, { headers: headers() });
      if (res.ok) setBackups(await res.json());
    } catch {}
  }
  async function runBackupNow() {
    setBackupRunning(true);
    try {
      await fetch(`${API}/api/v1/admin/backups/run`, { method: "POST", headers: headers() });
      // Backup is async; poll for ~30s for the new run to land.
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        await loadBackups();
      }
    } catch {}
    setBackupRunning(false);
  }
  async function deleteBackupRun(ts: string) {
    if (!confirm(`Delete backup run ${ts}? This removes all 4 files locally — off-site copies are kept until R2 lifecycle expires them.`)) return;
    await fetch(`${API}/api/v1/admin/backups/${ts}`, { method: "DELETE", headers: headers() });
    loadBackups();
  }
  function formatBytes(n: number) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }
  async function downloadBackupFile(name: string) {
    const res = await fetch(`${API}/api/v1/admin/backups/file/${name}`, { headers: headers() });
    if (!res.ok) { alert("Download failed"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }
  function formatTimestamp(ts: string) {
    // 20260415-220844 → 2026-04-15 22:08:44 UTC
    if (ts.length !== 15) return ts;
    return `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)} ${ts.slice(9,11)}:${ts.slice(11,13)}:${ts.slice(13,15)} UTC`;
  }

  const headers = () => {
    const token = localStorage.getItem("sm_token");
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };

  async function loadStats() {
    try {
      const res = await fetch(`${API}/api/v1/admin/stats`, { headers: headers() });
      if (res.status === 403) {
        setError("admin");
        return;
      }
      if (res.ok) setStats(await res.json());
    } catch {}
  }

  async function loadUsers() {
    setLoading(true);
    try {
      const q = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
      if (search) q.set("search", search);
      const res = await fetch(`${API}/api/v1/admin/users?${q}`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
        setTotal(data.total);
      }
    } catch {}
    setLoading(false);
  }

  async function updateUser(userId: string, updates: { plan?: string; is_admin?: boolean }) {
    await fetch(`${API}/api/v1/admin/users/${userId}`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify(updates),
    });
    loadUsers();
    loadStats();
  }

  async function deleteUser(userId: string, email: string) {
    if (!confirm(`Delete ${email}? This cannot be undone.`)) return;
    await fetch(`${API}/api/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: headers(),
    });
    loadUsers();
    loadStats();
  }

  async function loadServers() {
    try {
      const res = await fetch(`${API}/api/v1/admin/servers`, { headers: headers() });
      if (res.ok) setServers(await res.json());
    } catch {}
  }

  async function addServer() {
    const res = await fetch(`${API}/api/v1/admin/servers`, {
      method: "POST", headers: headers(),
      body: JSON.stringify({ ...serverForm, port: 22, total_cpu: parseFloat(serverForm.total_cpu), total_memory_mb: parseInt(serverForm.total_memory_mb), max_projects: parseInt(serverForm.max_projects) }),
    });
    if (res.ok) { setShowAddServer(false); loadServers(); }
    else { const e = await res.json().catch(() => ({})); alert(e.error || "Failed"); }
  }

  async function removeServer(id: string) {
    if (!confirm("Remove this server?")) return;
    await fetch(`${API}/api/v1/admin/servers/${id}`, { method: "DELETE", headers: headers() });
    loadServers();
  }

  const [redeploying, setRedeploying] = useState(false);
  const [redeployResult, setRedeployResult] = useState<{ queued: number; total: number; skipped: number } | null>(null);
  async function redeployAll(statusFilter?: string) {
    const msg = statusFilter
      ? `Redeploy every project currently in '${statusFilter}' status? This clones each repo from GitHub and rebuilds the container.`
      : `Redeploy EVERY project that has a GitHub repo? Use this after a disaster-recovery restore. This can take a while if you have many projects.`;
    if (!confirm(msg)) return;
    setRedeploying(true);
    setRedeployResult(null);
    try {
      const res = await fetch(`${API}/api/v1/admin/redeploy-all`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(statusFilter ? { status: statusFilter } : {}),
      });
      if (res.ok) {
        const data = await res.json();
        setRedeployResult({ queued: data.queued, total: data.total, skipped: data.skipped });
      } else {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "Failed to queue redeploys");
      }
    } finally {
      setRedeploying(false);
    }
  }

  async function setServerStatus(id: string, status: string) {
    await fetch(`${API}/api/v1/admin/servers/${id}/status`, { method: "PUT", headers: headers(), body: JSON.stringify({ status }) });
    loadServers();
  }

  useEffect(() => {
    loadStats();
    loadUsers();
    loadServers();
    loadBackups();
  }, [page]);

  if (error === "admin") {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Shield className="h-12 w-12 text-muted-foreground/30" />
        <h2 className="mt-4 text-xl font-bold">Admin Access Required</h2>
        <p className="mt-2 text-sm text-muted-foreground">You don&apos;t have permission to view this page.</p>
      </div>
    );
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <h1 className="text-2xl font-bold">Admin Panel</h1>
      <p className="mt-1 text-sm text-muted-foreground">Platform overview and user management.</p>

      {/* Stats */}
      {stats && (
        <div className="mt-6 grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard icon={<Users className="h-4 w-4" />} label="Total Users" value={stats.total_users} color="text-blue-500" />
          <StatCard icon={<UserPlus className="h-4 w-4" />} label="Today" value={stats.users_today} sub={`${stats.users_this_week} this week`} color="text-green-500" />
          <StatCard icon={<Activity className="h-4 w-4" />} label="Requests" value={stats.total_requests} sub={`${stats.requests_today} today`} color="text-violet-500" />
          <StatCard icon={<Key className="h-4 w-4" />} label="API Keys" value={stats.total_keys} color="text-yellow-500" />
          <StatCard icon={<Globe className="h-4 w-4" />} label="Domains" value={stats.total_domains} sub={`${stats.total_teams} teams`} color="text-cyan-500" />
        </div>
      )}

      {/* Platform analytics — projects, stacks, deploys */}
      {stats && (
        <Card className="mt-6">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                Deployments &amp; Stacks
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                  onClick={() => redeployAll("running")} disabled={redeploying}>
                  {redeploying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                  Redeploy running
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                  onClick={() => redeployAll()} disabled={redeploying}
                  title="Use after DR restore — rebuilds every project's container from GitHub">
                  {redeploying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                  Redeploy all
                </Button>
              </div>
            </div>
            {redeployResult && (
              <p className="mt-2 text-[11px] text-emerald-500">
                Queued {redeployResult.queued} of {redeployResult.total} projects
                {redeployResult.skipped > 0 ? ` (skipped ${redeployResult.skipped})` : ""}
                {" "}— deploys are staggered 2s apart; watch live logs on each project page.
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Top-level counts */}
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard icon={<Rocket className="h-4 w-4" />} label="Projects" value={stats.projects_total} color="text-emerald-500" />
              <StatCard icon={<Activity className="h-4 w-4" />} label="Deploys today" value={stats.deploys_today} sub={`${stats.deploys_this_week} this week`} color="text-emerald-500" />
              <StatCard icon={<Database className="h-4 w-4" />} label="Databases" value={stats.services_total} color="text-blue-500" />
              <StatCard icon={<Link2 className="h-4 w-4" />} label="Subdomains" value={stats.subdomains_total} color="text-violet-500" />
              <StatCard icon={<Activity className="h-4 w-4" />} label="Active tunnels" value={stats.tunnels_total} sub="last 7d" color="text-cyan-500" />
              <StatCard icon={<Server className="h-4 w-4" />} label="Worker servers" value={stats.worker_servers_total} color="text-amber-500" />
            </div>

            {/* Stack breakdown */}
            {stats.projects_by_stack && Object.keys(stats.projects_by_stack).length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">By stack</div>
                <StackBar
                  counts={stats.projects_by_stack}
                  colors={{
                    nextjs: "bg-white",
                    node: "bg-emerald-500",
                    python: "bg-blue-500",
                    static: "bg-amber-500",
                    docker: "bg-violet-500",
                    unknown: "bg-muted",
                  }}
                />
              </div>
            )}

            {/* Status breakdown */}
            {stats.projects_by_status && Object.keys(stats.projects_by_status).length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">By status</div>
                <StackBar
                  counts={stats.projects_by_status}
                  colors={{
                    running: "bg-emerald-500",
                    building: "bg-sky-500",
                    stopped: "bg-zinc-500",
                    failed: "bg-red-500",
                    created: "bg-amber-500",
                    unknown: "bg-muted",
                  }}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* User Management */}
      <Card className="mt-6">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-base">Users ({total})</CardTitle>
            <div className="relative max-w-xs w-full">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by email or name..."
                className="pl-9 h-8 text-xs"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setPage(0); loadUsers(); } }}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading && users.length === 0 ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <>
              <div className="space-y-2">
                {users.map((u) => (
                  <div key={u.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-border/50 p-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{u.name || u.email}</span>
                        {u.is_admin && (
                          <Badge className="gap-1 text-[10px] bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
                            <Crown className="h-2.5 w-2.5" /> Admin
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px]">{u.plan}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{u.email}</p>
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                        <span>{u.key_count} keys</span>
                        <span>{u.tunnel_requests.toLocaleString()} requests</span>
                        <span>Joined {new Date(u.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <select
                        value={u.plan}
                        onChange={(e) => updateUser(u.id, { plan: e.target.value })}
                        className="h-7 rounded border border-input bg-background px-2 text-[10px]"
                      >
                        <option value="free">Free</option>
                        <option value="pro">Pro</option>
                        <option value="team">Team</option>
                      </select>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => updateUser(u.id, { is_admin: !u.is_admin })}
                        title={u.is_admin ? "Remove admin" : "Make admin"}
                      >
                        <Shield className={`h-3.5 w-3.5 ${u.is_admin ? "text-yellow-500" : "text-muted-foreground"}`} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-destructive hover:text-destructive"
                        onClick={() => deleteUser(u.id, u.email)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-border/40">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage(page - 1)}
                    className="gap-1"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Previous
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Page {page + 1} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage(page + 1)}
                    className="gap-1"
                  >
                    Next <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Infrastructure */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Infrastructure</CardTitle>
            <Button size="sm" onClick={() => setShowAddServer(!showAddServer)} className="gap-1 text-xs">
              <UserPlus className="h-3 w-3" /> Add Server
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {showAddServer && (
            <div className="mb-4 rounded-lg border border-border/40 p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Input placeholder="Label" value={serverForm.label} onChange={(e) => setServerForm({...serverForm, label: e.target.value})} className="h-8 text-xs" />
                <Input placeholder="Host / IP" value={serverForm.host} onChange={(e) => setServerForm({...serverForm, host: e.target.value})} className="h-8 text-xs" />
                <Input placeholder="SSH User" value={serverForm.ssh_user} onChange={(e) => setServerForm({...serverForm, ssh_user: e.target.value})} className="h-8 text-xs" />
                <Input placeholder="SSH Password" type="password" value={serverForm.ssh_password} onChange={(e) => setServerForm({...serverForm, ssh_password: e.target.value})} className="h-8 text-xs" />
                <Input placeholder="CPU cores" value={serverForm.total_cpu} onChange={(e) => setServerForm({...serverForm, total_cpu: e.target.value})} className="h-8 text-xs" />
                <Input placeholder="Memory (MB)" value={serverForm.total_memory_mb} onChange={(e) => setServerForm({...serverForm, total_memory_mb: e.target.value})} className="h-8 text-xs" />
                <Input placeholder="Max projects" value={serverForm.max_projects} onChange={(e) => setServerForm({...serverForm, max_projects: e.target.value})} className="h-8 text-xs" />
                <Input placeholder="Region" value={serverForm.region} onChange={(e) => setServerForm({...serverForm, region: e.target.value})} className="h-8 text-xs" />
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs" onClick={addServer}>Add & Test</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAddServer(false)}>Cancel</Button>
              </div>
            </div>
          )}

          {servers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No platform servers configured. Projects deploy locally.</p>
          ) : (
            <div className="space-y-2">
              {servers.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg border border-border/40 p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 text-xs font-mono shrink-0">
                      {s.region.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{s.label}</span>
                        <Badge variant="outline" className={`text-[9px] ${s.status === "active" ? "bg-emerald-500/10 text-emerald-500" : s.status === "draining" ? "bg-amber-500/10 text-amber-500" : "bg-red-500/10 text-red-500"}`}>{s.status}</Badge>
                        {s.is_local && <Badge variant="outline" className="text-[9px] bg-blue-500/10 text-blue-400 border-blue-500/30">primary · local</Badge>}
                        {!s.is_local && typeof s.priority === "number" && <Badge variant="outline" className="text-[9px]">priority {s.priority}</Badge>}
                        {s.docker_installed && <Badge variant="outline" className="text-[9px]">Docker</Badge>}
                      </div>
                      <p className="text-[11px] text-muted-foreground font-mono">{s.host}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right text-[10px] text-muted-foreground">
                      <div>{s.current_projects}/{s.max_projects} projects</div>
                      <div>{s.allocated_memory_mb}/{s.total_memory_mb} MB</div>
                    </div>
                    <div className="flex gap-1">
                      {s.status === "active" && <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[9px]" onClick={() => setServerStatus(s.id, "draining")}>Drain</Button>}
                      {s.status === "draining" && <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[9px]" onClick={() => setServerStatus(s.id, "active")}>Activate</Button>}
                      {s.status === "offline" && <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[9px]" onClick={() => setServerStatus(s.id, "active")}>Activate</Button>}
                      {!s.is_local && <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[9px] text-destructive" onClick={() => removeServer(s.id)}><Trash2 className="h-3 w-3" /></Button>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Platform Backups */}
      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Platform Backups</CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Nightly Postgres dump + project data tarball + config. Local 7-day retention; off-site to {backups?.offsite_remote || "—"}.
            </p>
          </div>
          <Button size="sm" disabled={backupRunning} onClick={runBackupNow} className="gap-1">
            {backupRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Run Backup Now
          </Button>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 mb-4 text-[11px] text-muted-foreground">
            <Badge variant="outline" className={backups?.timer_active ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30" : "bg-red-500/10 text-red-500 border-red-500/30"}>
              Timer: {backups?.timer_active ? "active" : "inactive"}
            </Badge>
            <Badge variant="outline">Last run: {backups?.last_run ? formatTimestamp(backups.last_run) : "never"}</Badge>
            <Badge variant="outline">Off-site: {backups?.offsite_remote || "disabled"}</Badge>
          </div>

          {!backups || backups.runs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No backups yet — run one now or wait for tonight at 02:00 UTC.</p>
          ) : (
            <div className="space-y-2">
              {backups.runs.slice(0, 10).map((run) => (
                <div key={run.timestamp} className="flex items-center justify-between rounded-lg border border-border/40 p-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono">{formatTimestamp(run.timestamp)}</span>
                      <Badge variant="outline" className="text-[9px]">{formatBytes(run.total_bytes)}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-1 text-[10px] text-muted-foreground">
                      {run.files.map((f) => (
                        <button
                          key={f.name}
                          onClick={() => downloadBackupFile(f.name)}
                          className="underline hover:text-foreground"
                        >
                          {f.kind} ({formatBytes(f.size_bytes)})
                        </button>
                      ))}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" onClick={() => deleteBackupRun(run.timestamp)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: number; sub?: string; color: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
          <span className={color}>{icon}</span>
        </div>
        <p className="mt-1 text-xl font-bold">{value.toLocaleString()}</p>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// Simple horizontal stacked bar + legend. Used for project-by-stack and
// project-by-status breakdowns on the admin page. Pass a counts map and a
// matching colors map (each value is a Tailwind `bg-*` class).
function StackBar({
  counts,
  colors,
}: {
  counts: Record<string, number>;
  colors: Record<string, string>;
}) {
  const entries = Object.entries(counts).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  if (total === 0) {
    return <p className="text-[11px] text-muted-foreground">No data yet.</p>;
  }
  return (
    <div className="space-y-2">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted/40">
        {entries.map(([k, v]) => (
          <div
            key={k}
            className={colors[k] || "bg-muted"}
            style={{ width: `${(v / total) * 100}%` }}
            title={`${k}: ${v}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5 text-[11px]">
            <span className={`h-2 w-2 rounded-full ${colors[k] || "bg-muted"}`} />
            <span className="text-foreground font-medium">{k}</span>
            <span className="text-muted-foreground">
              {v} <span className="text-muted-foreground/60">({Math.round((v / total) * 100)}%)</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
