"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Users, Key, Globe, Activity, Search, Trash2, Shield, Crown,
  Server, Plus, Loader2, Rocket, BarChart3, Database, Link2,
  Radio, WifiOff, ExternalLink, RefreshCw, X, Zap, Square,
  RotateCcw, GitBranch, FolderOpen, FileText, TrendingUp,
  HardDrive, Cpu, MemoryStick, CheckCircle2, AlertCircle,
  Clock, UserCheck, Layers, ChevronUp, ChevronDown, LayoutTemplate,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

type Tab = "overview" | "analytics" | "users" | "projects" | "sessions" | "infra" | "backups" | "broadcast";

interface Stats {
  total_users: number; total_keys: number; total_domains: number;
  total_teams: number; total_requests: number;
  users_today: number; users_this_week: number; users_this_month: number;
  requests_today: number; projects_total: number;
  projects_by_status: Record<string, number>;
  projects_by_stack: Record<string, number>;
  deploys_today: number; deploys_this_week: number;
  services_total: number; tunnels_total: number;
  subdomains_total: number; worker_servers_total: number;
}

interface AdminUser {
  id: string; email: string; name: string; plan: string; is_admin: boolean;
  created_at: string; key_count: number; tunnel_requests: number;
  project_count?: number;
}

interface AdminProject {
  id: string; user_id: string; user_email: string; name: string;
  subdomain: string; repo_url: string; branch: string; framework: string;
  status: string; created_at: string; last_deploy_at: string | null; commit_sha: string;
}

interface PlatformAnalytics {
  period: string;
  overview: {
    pageviews: number; visitors: number; bot_hits: number;
    bytes_served: number; error_hits: number; active_sites: number;
  };
  timeseries: { ts: string; pageviews: number; visitors: number; bot_hits: number }[];
  top: Record<string, { key: string; count: number }[]>;
  projects: {
    project_id: string; name: string; subdomain: string; owner_email: string;
    pageviews: number; visitors: number; bot_hits: number; bytes: number; error_hits: number;
  }[];
  retention_note: string;
}

interface ProjectDiagnostics {
  project: {
    id: string; name: string; subdomain: string; status: string; framework: string;
    repo_url: string; branch: string; memory_mb: number; cpus: number;
    container_port: number; last_deploy_at: string | null;
    owner_email: string; owner_id: string;
  };
  container: {
    container_name: string; host: string; state: string; health: string;
    exit_code: number; oom_killed: boolean; restart_count: number;
    started_at: string; finished_at: string;
    memory_usage_mb: number; memory_limit_mb: number; cpu_percent: string;
    logs: string; error: string;
  };
  deploy_logs: { id?: string; message: string; stage?: string; created_at: string }[];
}

interface WorkerServer {
  id: string; label: string; host: string; region: string;
  total_cpu: number; total_memory_mb: number; allocated_cpu: number;
  allocated_memory_mb: number; max_projects: number; current_projects: number;
  used_memory_mb: number; load_avg: number;
  user_id: string | null;
  status: string; docker_installed: boolean; priority?: number; is_local?: boolean;
}

interface SessionTunnel { url: string; protocol: string; local_addr: string; name: string; inspect: boolean; }
interface Session {
  client_id: string; user_id: string; user_email: string;
  remote_addr: string; connected_at: string; tunnels: SessionTunnel[];
}

interface BackupRun {
  timestamp: string; total_bytes: number;
  files: { name: string; kind: string; size_bytes: number }[];
}

const STATUS_COLORS: Record<string, string> = {
  running:  "bg-emerald-500/20 text-emerald-500 border-emerald-500/50",
  building: "bg-sky-500/20 text-sky-500 border-sky-500/50",
  stopped:  "bg-zinc-500/20 text-muted-foreground border-zinc-500/30",
  failed:   "bg-red-500/20 text-red-500 border-red-500/40",
  created:  "bg-amber-500/20 text-amber-500 border-amber-500/50",
};

const PLAN_COLORS: Record<string, string> = {
  free: "bg-zinc-500/20 text-muted-foreground border-zinc-500/30",
  pro:  "bg-blue-500/20 text-blue-400 border-blue-500/50",
  team: "bg-violet-500/20 text-violet-400 border-violet-500/50",
};

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function formatTs(ts: string) {
  if (ts.length !== 15) return ts;
  return `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)} ${ts.slice(9,11)}:${ts.slice(11,13)}:${ts.slice(13,15)} UTC`;
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Users state
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersOffset, setUsersOffset] = useState(0);
  const [usersHasMore, setUsersHasMore] = useState(true);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [userPlanFilter, setUserPlanFilter] = useState("all");
  const userSentinelRef = useRef<HTMLDivElement>(null);

  // Projects state
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [projectsTotal, setProjectsTotal] = useState(0);
  const [projectsOffset, setProjectsOffset] = useState(0);
  const [projectsHasMore, setProjectsHasMore] = useState(true);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectStatus, setProjectStatus] = useState("all");
  const projectSentinelRef = useRef<HTMLDivElement>(null);
  const [redeploying, setRedeploying] = useState(false);
  const [actionError, setActionError] = useState("");
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [analyticsPeriod, setAnalyticsPeriod] = useState("week");
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [diagOpen, setDiagOpen] = useState<string | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diag, setDiag] = useState<ProjectDiagnostics | null>(null);
  const [redeployResult, setRedeployResult] = useState<{ queued: number; total: number; skipped: number } | null>(null);

  // Sessions state
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");
  const [sessionsRefresh, setSessionsRefresh] = useState<Date | null>(null);

  // Infrastructure state
  const [servers, setServers] = useState<WorkerServer[]>([]);
  const [showAddServer, setShowAddServer] = useState(false);
  const [serverForm, setServerForm] = useState({
    label: "", host: "", ssh_user: "root", ssh_password: "",
    total_cpu: "2", total_memory_mb: "4096", max_projects: "10", region: "default",
  });

  // Backups state
  const [backups, setBackups] = useState<{
    runs: BackupRun[]; last_run: string | null;
    timer_active: boolean; local_dir: string; offsite_remote: string;
  } | null>(null);
  const [backupRunning, setBackupRunning] = useState(false);

  // ── Broadcast state ─────────────────────────────────────────────────────────
  const [bcSubject, setBcSubject] = useState("");
  const [bcBody, setBcBody] = useState("");
  const [bcAudience, setBcAudience] = useState("all");
  const [bcPreviewCount, setBcPreviewCount] = useState<number | null>(null);
  const [bcSending, setBcSending] = useState(false);
  const [bcResult, setBcResult] = useState<{ sent: number; failed: number; total: number } | null>(null);
  const [bcError, setBcError] = useState("");

  const headers = useCallback(() => {
    const token = localStorage.getItem("sm_token");
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }, []);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/admin/stats`, { headers: headers() });
      if (res.status === 403) { setError("admin"); return; }
      if (res.ok) { setStats(await res.json()); setLastRefresh(new Date()); }
    } catch {}
    setStatsLoading(false);
  }, [headers]);

  // ── Users ──────────────────────────────────────────────────────────────────
  const fetchUsers = useCallback(async (offset: number, search: string, plan: string, append: boolean) => {
    setUsersLoading(true);
    try {
      const q = new URLSearchParams({ limit: "30", offset: String(offset) });
      if (search) q.set("search", search);
      if (plan && plan !== "all") q.set("plan", plan);
      const res = await fetch(`${API}/api/v1/admin/users?${q}`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        const rows = data.users || [];
        setUsersTotal(data.total || 0);
        setUsers(prev => append ? [...prev, ...rows] : rows);
        setUsersHasMore(offset + rows.length < (data.total || 0));
        setUsersOffset(offset + rows.length);
      }
    } catch {}
    setUsersLoading(false);
  }, [headers]);

  const resetUsers = useCallback((search: string, plan: string) => {
    setUsers([]); setUsersOffset(0); setUsersHasMore(true);
    fetchUsers(0, search, plan, false);
  }, [fetchUsers]);

  // Auto-search users on search/plan change (debounced 300ms)
  useEffect(() => {
    const t = setTimeout(() => resetUsers(userSearch, userPlanFilter), 300);
    return () => clearTimeout(t);
  }, [userSearch, userPlanFilter]);

  useEffect(() => {
    const el = userSentinelRef.current; if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && usersHasMore && !usersLoading)
        fetchUsers(usersOffset, userSearch, userPlanFilter, true);
    }, { threshold: 0.1 });
    obs.observe(el); return () => obs.disconnect();
  }, [usersHasMore, usersLoading, usersOffset, userSearch, userPlanFilter, fetchUsers]);

  const updateUser = async (userId: string, updates: { plan?: string; is_admin?: boolean }) => {
    if (await adminFetch(`${API}/api/v1/admin/users/${userId}`, {
      method: "PUT", body: JSON.stringify(updates),
    }, "Updating user")) {
      resetUsers(userSearch, userPlanFilter);
      loadStats();
    }
  };

  const deleteUser = async (userId: string, email: string) => {
    if (!confirm(`Delete ${email}? This cannot be undone.`)) return;
    if (await adminFetch(`${API}/api/v1/admin/users/${userId}`, { method: "DELETE" }, "Deleting user")) {
      resetUsers(userSearch, userPlanFilter);
      loadStats();
    }
  };

  // ── Projects ───────────────────────────────────────────────────────────────
  const fetchProjects = useCallback(async (offset: number, search: string, status: string, append: boolean) => {
    setProjectsLoading(true);
    try {
      const q = new URLSearchParams({ limit: "25", offset: String(offset) });
      if (search) q.set("search", search);
      if (status && status !== "all") q.set("status", status);
      const res = await fetch(`${API}/api/v1/admin/projects?${q}`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        const rows = data.projects || [];
        setProjectsTotal(data.total || 0);
        setProjects(prev => append ? [...prev, ...rows] : rows);
        setProjectsHasMore(offset + rows.length < (data.total || 0));
        setProjectsOffset(offset + rows.length);
      }
    } catch {}
    setProjectsLoading(false);
  }, [headers]);

  const resetProjects = useCallback((search: string, status: string) => {
    setProjects([]); setProjectsOffset(0); setProjectsHasMore(true);
    fetchProjects(0, search, status, false);
  }, [fetchProjects]);

  // Auto-search projects on search/status change (debounced 300ms)
  useEffect(() => {
    const t = setTimeout(() => resetProjects(projectSearch, projectStatus), 300);
    return () => clearTimeout(t);
  }, [projectSearch, projectStatus]);

  useEffect(() => {
    const el = projectSentinelRef.current; if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && projectsHasMore && !projectsLoading)
        fetchProjects(projectsOffset, projectSearch, projectStatus, true);
    }, { threshold: 0.1 });
    obs.observe(el); return () => obs.disconnect();
  }, [projectsHasMore, projectsLoading, projectsOffset, projectSearch, projectStatus, fetchProjects]);

  // Every admin mutation goes through this so a failing request surfaces
  // instead of looking like a dead button (the old code ignored res.ok).
  const adminFetch = async (url: string, init: RequestInit, action: string): Promise<boolean> => {
    setActionError("");
    try {
      const res = await fetch(url, { ...init, headers: headers() });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { msg = (await res.json()).error || msg; } catch {}
        setActionError(`${action} failed: ${msg}`);
        return false;
      }
      return true;
    } catch (e) {
      setActionError(`${action} failed: ${e instanceof Error ? e.message : "network error"}`);
      return false;
    }
  };

  // ── Platform analytics ─────────────────────────────────────────────────────
  const loadAnalytics = useCallback(async (period: string) => {
    setAnalyticsLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/admin/analytics?period=${period}`, { headers: headers() });
      if (res.ok) setAnalytics(await res.json());
      else setActionError(`Analytics failed: HTTP ${res.status}`);
    } catch (e) {
      setActionError(`Analytics failed: ${e instanceof Error ? e.message : "network error"}`);
    } finally {
      setAnalyticsLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    if (tab === "analytics") loadAnalytics(analyticsPeriod);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, analyticsPeriod]);

  // ── Project diagnostics ────────────────────────────────────────────────────
  // Answers "why did this user's project die?" without SSHing into the host.
  const loadDiagnostics = async (projectId: string) => {
    if (diagOpen === projectId) { setDiagOpen(null); return; }
    setDiagOpen(projectId);
    setDiag(null);
    setDiagLoading(true);
    setActionError("");
    try {
      const res = await fetch(`${API}/api/v1/admin/projects/${projectId}/diagnostics`, { headers: headers() });
      if (res.ok) setDiag(await res.json());
      else {
        let msg = `HTTP ${res.status}`;
        try { msg = (await res.json()).error || msg; } catch {}
        setActionError(`Diagnostics failed: ${msg}`);
        setDiagOpen(null);
      }
    } catch (e) {
      setActionError(`Diagnostics failed: ${e instanceof Error ? e.message : "network error"}`);
      setDiagOpen(null);
    } finally {
      setDiagLoading(false);
    }
  };

  const stopProject = async (id: string, name: string) => {
    if (!confirm(`Stop "${name}"?`)) return;
    if (await adminFetch(`${API}/api/v1/admin/projects/${id}/stop`, { method: "POST" }, `Stopping ${name}`))
      resetProjects(projectSearch, projectStatus);
  };
  const redeployProject = async (id: string, name: string) => {
    if (!confirm(`Redeploy "${name}" from source?`)) return;
    if (await adminFetch(`${API}/api/v1/admin/projects/${id}/redeploy`, { method: "POST" }, `Redeploying ${name}`))
      setTimeout(() => resetProjects(projectSearch, projectStatus), 1500);
  };
  const deleteProject = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? Cannot be undone.`)) return;
    if (await adminFetch(`${API}/api/v1/admin/projects/${id}`, { method: "DELETE" }, `Deleting ${name}`)) {
      resetProjects(projectSearch, projectStatus);
      loadStats();
    }
  };
  const redeployAll = async (statusFilter?: string) => {
    const msg = statusFilter
      ? `Redeploy all projects currently in '${statusFilter}' status?`
      : "Redeploy EVERY project that has a GitHub repo? This can take a while.";
    if (!confirm(msg)) return;
    setRedeploying(true); setRedeployResult(null);
    try {
      const res = await fetch(`${API}/api/v1/admin/redeploy-all`, {
        method: "POST", headers: headers(),
        body: JSON.stringify(statusFilter ? { status: statusFilter } : {}),
      });
      if (res.ok) setRedeployResult(await res.json());
    } finally { setRedeploying(false); }
  };

  // ── Sessions ───────────────────────────────────────────────────────────────
  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/admin/sessions`, { headers: headers() });
      if (res.ok) { setSessions(await res.json()); setSessionsRefresh(new Date()); }
    } catch {}
    setSessionsLoading(false);
  }, [headers]);

  const killSession = async (clientId: string) => {
    if (!confirm("Force-disconnect this client?")) return;
    if (await adminFetch(`${API}/api/v1/admin/sessions/${clientId}`, { method: "DELETE" }, "Disconnect"))
      loadSessions();
  };
  const killTunnel = async (url: string) => {
    if (!confirm(`Remove tunnel ${url}?`)) return;
    const enc = btoa(url).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    if (await adminFetch(`${API}/api/v1/admin/tunnels/${enc}`, { method: "DELETE" }, "Remove tunnel"))
      loadSessions();
  };

  // ── Infrastructure ─────────────────────────────────────────────────────────
  const loadServers = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/admin/servers`, { headers: headers() });
      if (res.ok) setServers(await res.json());
    } catch {}
  }, [headers]);

  const addServer = async () => {
    const res = await fetch(`${API}/api/v1/admin/servers`, {
      method: "POST", headers: headers(),
      body: JSON.stringify({
        ...serverForm, port: 22,
        total_cpu: parseFloat(serverForm.total_cpu),
        total_memory_mb: parseInt(serverForm.total_memory_mb),
        max_projects: parseInt(serverForm.max_projects),
      }),
    });
    if (res.ok) { setShowAddServer(false); loadServers(); }
    else { const e = await res.json().catch(() => ({})); alert(e.error || "Failed"); }
  };

  const setServerStatus = async (id: string, status: string) => {
    if (await adminFetch(`${API}/api/v1/admin/servers/${id}/status`, {
      method: "PUT", body: JSON.stringify({ status }),
    }, `Setting server ${status}`))
      loadServers();
  };

  const removeServer = async (id: string) => {
    if (!confirm("Remove this server?")) return;
    setActionError("");
    try {
      const res = await fetch(`${API}/api/v1/admin/servers/${id}`, { method: "DELETE", headers: headers() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(`Removing server failed: ${data.error || `HTTP ${res.status}`}`);
        return;
      }
      // Host was unreachable — say so rather than implying a clean teardown.
      if (data.warning) setActionError(data.warning);
      loadServers();
    } catch (e) {
      setActionError(`Removing server failed: ${e instanceof Error ? e.message : "network error"}`);
    }
  };

  // ── Backups ────────────────────────────────────────────────────────────────
  const loadBackups = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/admin/backups`, { headers: headers() });
      if (res.ok) setBackups(await res.json());
    } catch {}
  }, [headers]);

  const runBackupNow = async () => {
    setBackupRunning(true);
    try {
      await fetch(`${API}/api/v1/admin/backups/run`, { method: "POST", headers: headers() });
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 3000));
        await loadBackups();
      }
    } catch {}
    setBackupRunning(false);
  };

  const deleteBackupRun = async (ts: string) => {
    if (!confirm(`Delete backup run ${ts}?`)) return;
    await fetch(`${API}/api/v1/admin/backups/${ts}`, { method: "DELETE", headers: headers() });
    loadBackups();
  };

  const downloadBackupFile = async (name: string) => {
    const res = await fetch(`${API}/api/v1/admin/backups/file/${name}`, { headers: headers() });
    if (!res.ok) { alert("Download failed"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Boot ───────────────────────────────────────────────────────────────────
  // Users and projects are loaded by their own debounce effects on mount.
  useEffect(() => {
    loadStats();
    loadSessions();
    loadServers();
    loadBackups();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => { loadStats(); loadSessions(); }, 15000);
    return () => clearInterval(t);
  }, [autoRefresh, loadStats, loadSessions]);

  const loadBroadcastPreview = useCallback(async (audience: string) => {
    try {
      const res = await fetch(`${API}/api/v1/admin/broadcast/preview?audience=${audience}`, { headers: headers() });
      if (res.ok) { const d = await res.json(); setBcPreviewCount(d.count); }
    } catch {}
  }, [headers]);

  const sendBroadcast = async () => {
    if (!bcSubject.trim() || !bcBody.trim()) return;
    setBcSending(true); setBcError(""); setBcResult(null);
    try {
      const res = await fetch(`${API}/api/v1/admin/broadcast`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ subject: bcSubject, html_body: bcBody, audience: bcAudience }),
      });
      const data = await res.json();
      if (!res.ok) { setBcError(data.error || "Broadcast failed"); }
      else { setBcResult(data); setBcSubject(""); setBcBody(""); }
    } catch { setBcError("Network error"); }
    setBcSending(false);
  };

  if (error === "admin") {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Shield className="h-12 w-12 text-muted-foreground/30" />
        <h2 className="mt-4 text-xl font-bold">Admin Access Required</h2>
        <p className="mt-2 text-sm text-muted-foreground">You don&apos;t have permission to view this page.</p>
      </div>
    );
  }

  const filteredSessions = sessions.filter(s =>
    !sessionSearch ||
    s.user_email?.toLowerCase().includes(sessionSearch.toLowerCase()) ||
    s.client_id.includes(sessionSearch) ||
    s.tunnels.some(t => t.url.includes(sessionSearch))
  );

  const runningCount = stats?.projects_by_status?.["running"] ?? 0;
  const failedCount = stats?.projects_by_status?.["failed"] ?? 0;
  const buildingCount = stats?.projects_by_status?.["building"] ?? 0;
  const deploySuccessRate = stats && stats.projects_total > 0
    ? Math.round((runningCount / Math.max(runningCount + failedCount, 1)) * 100)
    : null;

  const TABS: { id: Tab; label: string; badge?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "analytics", label: "Analytics" },
    { id: "users", label: "Users", badge: usersTotal },
    { id: "projects", label: "Projects", badge: projectsTotal },
    { id: "sessions", label: "Live Sessions", badge: sessions.length },
    { id: "infra", label: "Infrastructure" },
    { id: "backups", label: "Backups" },
    { id: "broadcast", label: "Broadcast" },
  ];

  return (
    <div>
      {/* Page Header */}
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Admin Console
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Platform operations center
            {lastRefresh && (
              <span className="ml-2 text-[11px] text-muted-foreground/60">
                · refreshed {lastRefresh.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className={`h-8 gap-1.5 text-xs ${autoRefresh ? "border-emerald-500/50 text-emerald-500" : ""}`}
            onClick={() => setAutoRefresh(v => !v)}
          >
            <Radio className={`h-3 w-3 ${autoRefresh ? "animate-pulse" : ""}`} />
            <span className="hidden sm:inline">{autoRefresh ? "Live" : "Paused"}</span>
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => { loadStats(); loadSessions(); }}>
            <RefreshCw className={`h-3.5 w-3.5 ${statsLoading ? "animate-spin" : ""}`} />
          </Button>
          <Link href="/admin/blog">
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
              <FileText className="h-3.5 w-3.5" /><span className="hidden sm:inline">Blog</span>
            </Button>
          </Link>
          <Link href="/admin/templates">
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
              <LayoutTemplate className="h-3.5 w-3.5" /><span className="hidden sm:inline">Templates</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Action errors — mutations used to fail silently, which read as
          "the button does nothing". */}
      {actionError && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <span className="flex-1">{actionError}</span>
          <button onClick={() => setActionError("")} className="text-xs text-muted-foreground hover:text-foreground">
            Dismiss
          </button>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 overflow-x-auto pb-1 border-b border-border/50">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t whitespace-nowrap transition-colors ${
              tab === t.id
                ? "text-foreground border-b-2 border-primary -mb-px"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            {t.badge !== undefined && t.badge > 0 && (
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                t.id === "sessions" && t.badge > 0
                  ? "bg-emerald-500/20 text-emerald-500"
                  : "bg-muted text-muted-foreground"
              }`}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ─────────────────────────────────────────────────── */}
      {tab === "overview" && (
        <div className="space-y-6">
          {/* KPI row */}
          {stats ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <KpiCard
                label="Total Users" value={stats.total_users}
                sub={`+${stats.users_today} today`} trend="up"
                icon={<Users className="h-4 w-4" />} color="text-blue-400 bg-blue-500/20"
              />
              <KpiCard
                label="New This Week" value={stats.users_this_week}
                sub={`${stats.users_this_month} this month`}
                icon={<TrendingUp className="h-4 w-4" />} color="text-emerald-400 bg-emerald-500/20"
              />
              <KpiCard
                label="Projects" value={stats.projects_total}
                sub={`${runningCount} running`}
                icon={<Rocket className="h-4 w-4" />} color="text-violet-400 bg-violet-500/20"
              />
              <KpiCard
                label="Deploys Today" value={stats.deploys_today}
                sub={`${stats.deploys_this_week} this week`}
                icon={<Zap className="h-4 w-4" />} color="text-amber-400 bg-amber-500/20"
              />
              <KpiCard
                label="Databases" value={stats.services_total}
                sub={`${stats.tunnels_total} tunnels`}
                icon={<Database className="h-4 w-4" />} color="text-cyan-400 bg-cyan-500/20"
              />
              <KpiCard
                label="API Keys" value={stats.total_keys}
                sub={`${stats.total_domains} domains`}
                icon={<Key className="h-4 w-4" />} color="text-pink-400 bg-pink-500/20"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i}><CardContent className="p-4 h-[84px] animate-pulse bg-muted/20" /></Card>
              ))}
            </div>
          )}

          {/* Deploy health + status + stack */}
          {stats && (
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Deploy health */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    Platform Health
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {deploySuccessRate !== null && (
                    <div>
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="text-muted-foreground">Deploy success rate</span>
                        <span className={`font-mono font-medium ${deploySuccessRate >= 90 ? "text-emerald-500" : deploySuccessRate >= 70 ? "text-amber-500" : "text-red-500"}`}>
                          {deploySuccessRate}%
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${deploySuccessRate >= 90 ? "bg-emerald-500" : deploySuccessRate >= 70 ? "bg-amber-500" : "bg-red-500"}`}
                          style={{ width: `${deploySuccessRate}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {[
                      { label: "Running", count: runningCount, cls: "text-emerald-500" },
                      { label: "Building", count: buildingCount, cls: "text-sky-500" },
                      { label: "Failed", count: failedCount, cls: "text-red-500" },
                      { label: "Stopped", count: stats.projects_by_status?.["stopped"] ?? 0, cls: "text-zinc-400" },
                    ].map(({ label, count, cls }) => (
                      <div key={label} className="flex items-center justify-between rounded-md bg-muted/20 px-2.5 py-1.5">
                        <span className="text-muted-foreground">{label}</span>
                        <span className={`font-mono font-semibold ${cls}`}>{count}</span>
                      </div>
                    ))}
                  </div>

                  {sessions.length > 0 && (
                    <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-xs text-emerald-500 font-medium">
                        {sessions.length} active tunnel session{sessions.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Stack breakdown */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Layers className="h-4 w-4 text-muted-foreground" />
                    Stack Distribution
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {stats.projects_by_stack && Object.keys(stats.projects_by_stack).length > 0 ? (
                    <StackBar
                      counts={stats.projects_by_stack}
                      colors={{
                        nextjs: "bg-white", node: "bg-emerald-500", python: "bg-blue-500",
                        static: "bg-amber-500", docker: "bg-violet-500", unknown: "bg-muted",
                      }}
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">No projects yet.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Server utilization */}
          {servers.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  Infrastructure Utilization
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {servers.map(s => {
                  const memPct = s.total_memory_mb > 0 ? (s.used_memory_mb / s.total_memory_mb) * 100 : 0;
                  const cpuPct = s.total_cpu > 0 ? (s.load_avg / s.total_cpu) * 100 : 0;
                  const projPct = s.max_projects > 0 ? (s.current_projects / s.max_projects) * 100 : 0;
                  return (
                    <div key={s.id} className="rounded-lg border border-border/50 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{s.label}</span>
                          <Badge variant="outline" className={`text-[9px] ${
                            s.status === "active" ? "bg-emerald-500/20 text-emerald-500 border-emerald-500/50"
                            : s.status === "draining" ? "bg-amber-500/20 text-amber-500"
                            : "bg-red-500/20 text-red-500"
                          }`}>{s.status}</Badge>
                          {s.is_local && <Badge variant="outline" className="text-[9px]">primary</Badge>}
                          {s.user_id && <Badge variant="outline" className="text-[9px] text-violet-400 border-violet-500/30">BYOC</Badge>}
                        </div>
                        <span className="text-[10px] text-muted-foreground font-mono">{s.host}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <UtilBar label="RAM used" used={s.used_memory_mb} total={s.total_memory_mb} pct={memPct} unit="MB" />
                        <UtilBar label="Load" used={parseFloat(s.load_avg.toFixed(1))} total={s.total_cpu} pct={cpuPct} unit="cores" />
                        <UtilBar label="Projects" used={s.current_projects} total={s.max_projects} pct={projPct} unit="" />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Quick actions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                onClick={() => { setTab("projects"); redeployAll("running"); }} disabled={redeploying}>
                {redeploying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                Redeploy running
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                onClick={() => { setTab("projects"); redeployAll(); }} disabled={redeploying}>
                <RotateCcw className="h-3 w-3" /> Redeploy all
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
                onClick={() => { setTab("backups"); runBackupNow(); }} disabled={backupRunning}>
                {backupRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <HardDrive className="h-3 w-3" />}
                Run backup now
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── USERS TAB ────────────────────────────────────────────────────── */}
      {tab === "users" && (
        <div className="space-y-4">
          {/* Controls */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by email or name..."
                className="pl-9 h-9 text-sm"
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
              />
            </div>
            <select
              value={userPlanFilter}
              onChange={e => setUserPlanFilter(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">All plans</option>
              <option value="free">Free</option>
              <option value="hobby">Hobby</option>
              <option value="pro">Pro</option>
              <option value="team">Team</option>
            </select>
          </div>

          <div className="text-xs text-muted-foreground">{usersTotal} users total</div>

          {usersLoading && users.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center py-12">
              <Users className="h-8 w-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No users found.</p>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                {users.map(u => (
                  <div key={u.id} className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-border/50 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{u.name || u.email}</span>
                        {u.is_admin && (
                          <Badge className="text-[10px] gap-0.5 bg-yellow-500/20 text-yellow-500 border-yellow-500/50">
                            <Crown className="h-2.5 w-2.5" /> Admin
                          </Badge>
                        )}
                        <Badge variant="outline" className={`text-[10px] ${PLAN_COLORS[u.plan] || ""}`}>{u.plan}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{u.email}</p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 mt-1 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1"><Key className="h-2.5 w-2.5" />{u.key_count} keys</span>
                        <span className="flex items-center gap-1"><Activity className="h-2.5 w-2.5" />{u.tunnel_requests.toLocaleString()} requests</span>
                        <span className="flex items-center gap-1"><Clock className="h-2.5 w-2.5" />Joined {new Date(u.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <select
                        value={u.plan}
                        onChange={e => updateUser(u.id, { plan: e.target.value })}
                        className="h-7 rounded border border-input bg-background px-2 text-[11px]"
                      >
                        <option value="free">Free</option>
                        <option value="hobby">Hobby</option>
                        <option value="pro">Pro</option>
                        <option value="team">Team</option>
                      </select>
                      <Button variant="ghost" size="sm" className="h-7 px-2"
                        onClick={() => updateUser(u.id, { is_admin: !u.is_admin })}
                        title={u.is_admin ? "Remove admin" : "Make admin"}>
                        <Shield className={`h-3.5 w-3.5 ${u.is_admin ? "text-yellow-500" : "text-muted-foreground"}`} />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:text-destructive"
                        onClick={() => deleteUser(u.id, u.email)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <div ref={userSentinelRef} className="py-2 flex justify-center">
                {usersLoading && users.length > 0 && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                {!usersHasMore && users.length > 0 && <p className="text-[11px] text-muted-foreground">All {usersTotal} users loaded</p>}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── PROJECTS TAB ─────────────────────────────────────────────────── */}
      {tab === "projects" && (
        <div className="space-y-4">
          {/* Controls */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, repo..."
                className="pl-9 h-9 text-sm"
                value={projectSearch}
                onChange={e => setProjectSearch(e.target.value)}
              />
            </div>
            <select
              value={projectStatus}
              onChange={e => setProjectStatus(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">All statuses</option>
              <option value="running">Running</option>
              <option value="building">Building</option>
              <option value="stopped">Stopped</option>
              <option value="failed">Failed</option>
              <option value="created">Created</option>
            </select>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" className="h-9 text-xs gap-1"
                onClick={() => redeployAll("running")} disabled={redeploying}>
                {redeploying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                Redeploy running
              </Button>
              <Button size="sm" variant="outline" className="h-9 text-xs gap-1"
                onClick={() => redeployAll()} disabled={redeploying}>
                <RotateCcw className="h-3 w-3" /> All
              </Button>
            </div>
          </div>

          {redeployResult && (
            <p className="text-[11px] text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2">
              Queued {redeployResult.queued} of {redeployResult.total} projects
              {redeployResult.skipped > 0 ? ` (skipped ${redeployResult.skipped})` : ""}
              {" "}— deploys staggered 2s apart.
            </p>
          )}

          <div className="text-xs text-muted-foreground">{projectsTotal} projects total</div>

          {projectsLoading && projects.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center py-12">
              <Rocket className="h-8 w-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No projects found.</p>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                {projects.map(p => (
                  <div key={p.id} className="rounded-lg border border-border/50">
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{p.name}</span>
                        <Badge variant="outline" className={`text-[9px] shrink-0 ${STATUS_COLORS[p.status] || "bg-muted text-muted-foreground"}`}>
                          {p.status === "building" && <span className="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse inline-block mr-1" />}
                          {p.status}
                        </Badge>
                        {p.framework && <Badge variant="outline" className="text-[9px] shrink-0">{p.framework}</Badge>}
                      </div>
                      <div className="flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground">
                        <span className="font-mono">{p.subdomain}.deployzy.com</span>
                        <span className="text-muted-foreground/80">{p.user_email || p.user_id.slice(0, 8)}</span>
                        {p.repo_url && (
                          <span className="flex items-center gap-1">
                            <GitBranch className="h-2.5 w-2.5" />
                            {p.repo_url.replace(/^https?:\/\/[^/]+\//, "").replace(/\.git$/, "")}
                            {p.branch ? `@${p.branch}` : ""}
                          </span>
                        )}
                        {p.last_deploy_at && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-2.5 w-2.5" />
                            {new Date(p.last_deploy_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <Button variant="ghost" size="sm"
                        className={`h-7 px-2 ${diagOpen === p.id ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                        onClick={() => loadDiagnostics(p.id)} title="Logs & diagnostics">
                        <Activity className="h-3.5 w-3.5" />
                      </Button>
                      {p.status === "running" && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-amber-500 hover:text-amber-500"
                          onClick={() => stopProject(p.id, p.name)} title="Stop">
                          <Square className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-foreground"
                        onClick={() => redeployProject(p.id, p.name)} title="Redeploy">
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:text-destructive"
                        onClick={() => deleteProject(p.id, p.name)} title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Diagnostics panel */}
                  {diagOpen === p.id && (
                    <div className="border-t border-border/50 bg-muted/20 px-3 py-3 space-y-3">
                      {diagLoading && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 justify-center">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Probing container on host…
                        </div>
                      )}
                      {!diagLoading && diag && diag.project.id === p.id && (
                        <>
                          {/* Container state */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <DiagStat label="Container" value={diag.container.state}
                              tone={diag.container.state === "running" ? "good"
                                : diag.container.state === "missing" ? "bad"
                                : diag.container.state === "restarting" ? "warn" : "bad"} />
                            <DiagStat label="Host" value={diag.container.host} />
                            <DiagStat label="Restarts" value={String(diag.container.restart_count)}
                              tone={diag.container.restart_count > 5 ? "warn" : undefined} />
                            <DiagStat label="Exit code"
                              value={diag.container.state === "running" ? "—" : String(diag.container.exit_code)}
                              tone={diag.container.exit_code !== 0 && diag.container.state !== "running" ? "bad" : undefined} />
                          </div>

                          {/* Why it died — only shown when there's something to say */}
                          {(diag.container.oom_killed || diag.container.error ||
                            (diag.container.state !== "running" && diag.container.state !== "missing")) && (
                            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                              {diag.container.oom_killed
                                ? `Killed by the kernel for exceeding its memory limit (${diag.container.memory_limit_mb} MB). The app needs more RAM than its plan allows.`
                                : diag.container.error
                                  ? diag.container.error
                                  : `Container ${diag.container.state} with exit code ${diag.container.exit_code}${
                                      diag.container.finished_at ? ` at ${new Date(diag.container.finished_at).toLocaleString()}` : ""
                                    }.`}
                            </div>
                          )}

                          {diag.container.state === "running" && (
                            <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                              {diag.container.health && <span>health: <span className="text-foreground">{diag.container.health}</span></span>}
                              {diag.container.cpu_percent && <span>cpu: <span className="text-foreground">{diag.container.cpu_percent}</span></span>}
                              {diag.container.memory_limit_mb > 0 && (
                                <span>mem: <span className="text-foreground">
                                  {diag.container.memory_usage_mb}/{diag.container.memory_limit_mb} MB
                                </span></span>
                              )}
                              {diag.container.started_at && (
                                <span>up since <span className="text-foreground">{new Date(diag.container.started_at).toLocaleString()}</span></span>
                              )}
                            </div>
                          )}

                          {/* Container output */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Container logs</span>
                              <button onClick={() => { setDiagOpen(null); loadDiagnostics(p.id); }}
                                className="text-[10px] text-muted-foreground hover:text-foreground">refresh</button>
                            </div>
                            <pre className="max-h-64 overflow-auto rounded-md bg-[#0d1117] p-3 text-[11px] leading-relaxed text-[#e6edf3] font-mono whitespace-pre-wrap break-all">
                              {diag.container.logs || "(no output)"}
                            </pre>
                          </div>

                          {/* Deploy history */}
                          {diag.deploy_logs.length > 0 && (
                            <div>
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Recent deploy log</span>
                              <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-[#0d1117] p-3 text-[11px] leading-relaxed text-[#e6edf3] font-mono whitespace-pre-wrap break-all">
                                {diag.deploy_logs.map(l =>
                                  `${new Date(l.created_at).toLocaleTimeString()}  ${l.message}`).join("\n")}
                              </pre>
                            </div>
                          )}

                          <div className="text-[10px] text-muted-foreground">
                            owner: <span className="text-foreground">{diag.project.owner_email}</span>
                            {" · "}limits: {diag.project.memory_mb || 512} MB / {diag.project.cpus || 0.5} vCPU
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  </div>
                ))}
              </div>
              <div ref={projectSentinelRef} className="py-2 flex justify-center">
                {projectsLoading && projects.length > 0 && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                {!projectsHasMore && projects.length > 0 && <p className="text-[11px] text-muted-foreground">All {projectsTotal} projects loaded</p>}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── LIVE SESSIONS TAB ────────────────────────────────────────────── */}
      {tab === "sessions" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Filter by email, client ID, or URL..."
                className="pl-9 h-9 text-sm"
                value={sessionSearch}
                onChange={e => setSessionSearch(e.target.value)}
              />
            </div>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={loadSessions} disabled={sessionsLoading}>
              <RefreshCw className={`h-3.5 w-3.5 ${sessionsLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${sessions.length > 0 ? "bg-emerald-500 animate-pulse" : "bg-zinc-500"}`} />
              {sessions.length} active session{sessions.length !== 1 ? "s" : ""}
            </span>
            {sessionsRefresh && <span>· last refreshed {sessionsRefresh.toLocaleTimeString()}</span>}
            {autoRefresh && <span className="text-emerald-500/70">· auto-refresh every 15s</span>}
          </div>

          {filteredSessions.length === 0 ? (
            <div className="flex flex-col items-center py-16">
              <WifiOff className="h-10 w-10 text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground">
                {sessionSearch ? "No sessions match your filter." : "No active tunnel sessions right now."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredSessions.map(session => (
                <div key={session.client_id} className="rounded-lg border border-border/50 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-500/20 text-emerald-500 border border-emerald-500/50 rounded px-1.5 py-0.5 font-medium">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          connected
                        </span>
                        <span className="text-sm font-medium">
                          {session.user_email || <span className="text-muted-foreground font-mono text-xs">anonymous</span>}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono">{session.remote_addr}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                        <span className="font-mono">{session.client_id.slice(0, 14)}…</span>
                        <span>connected {new Date(session.connected_at).toLocaleTimeString()}</span>
                        <span>{session.tunnels.length} tunnel{session.tunnels.length !== 1 ? "s" : ""}</span>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" className="h-8 px-2.5 text-destructive border-destructive/30 hover:bg-destructive/10 shrink-0"
                      onClick={() => killSession(session.client_id)} title="Force disconnect">
                      <WifiOff className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {session.tunnels.length > 0 && (
                    <div className="space-y-1.5 pl-3 border-l-2 border-border/40">
                      {session.tunnels.map(t => (
                        <div key={t.url} className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge variant="outline" className={`text-[9px] shrink-0 ${
                              t.protocol === "http"  ? "bg-blue-500/20 text-blue-400 border-blue-500/50" :
                              t.protocol === "tcp"   ? "bg-amber-500/20 text-amber-400 border-amber-500/50" :
                              "bg-violet-500/20 text-violet-400 border-violet-500/50"
                            }`}>
                              {t.protocol.toUpperCase()}
                            </Badge>
                            <span className="text-[11px] font-mono text-muted-foreground truncate">{t.url}</span>
                            {t.local_addr && <span className="text-[10px] text-muted-foreground/60 shrink-0">→ {t.local_addr}</span>}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {t.protocol === "http" && (
                              <a href={t.url} target="_blank" rel="noopener noreferrer"
                                className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent text-muted-foreground">
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                              onClick={() => killTunnel(t.url)}>
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── INFRASTRUCTURE TAB ───────────────────────────────────────────── */}
      {tab === "infra" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{servers.length} server{servers.length !== 1 ? "s" : ""} configured</p>
            <Button size="sm" className="h-8 gap-1.5 text-sm" onClick={() => setShowAddServer(v => !v)}>
              <Plus className="h-3.5 w-3.5" /> Add Server
            </Button>
          </div>

          {showAddServer && (
            <Card>
              <CardHeader><CardTitle className="text-base">Add Platform Server</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { k: "label", ph: "Label" }, { k: "host", ph: "Host / IP" },
                    { k: "ssh_user", ph: "SSH User" }, { k: "ssh_password", ph: "SSH Password", type: "password" },
                    { k: "total_cpu", ph: "CPU cores" }, { k: "total_memory_mb", ph: "Memory (MB)" },
                    { k: "max_projects", ph: "Max projects" }, { k: "region", ph: "Region" },
                  ].map(({ k, ph, type }) => (
                    <div key={k} className="space-y-1">
                      <label className="text-xs text-muted-foreground">{ph}</label>
                      <Input
                        type={type || "text"} placeholder={ph}
                        value={(serverForm as never)[k]}
                        onChange={e => setServerForm(f => ({ ...f, [k]: e.target.value }))}
                        className="h-9 text-sm"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={addServer}>Add & Test Connection</Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowAddServer(false)}>Cancel</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {servers.length === 0 ? (
            <div className="flex flex-col items-center py-16">
              <Server className="h-10 w-10 text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground">No platform servers configured. Projects deploy locally.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {servers.map(s => {
                const memPct = s.total_memory_mb > 0 ? (s.used_memory_mb / s.total_memory_mb) * 100 : 0;
                const cpuPct = s.total_cpu > 0 ? (s.load_avg / s.total_cpu) * 100 : 0;
                const projPct = s.max_projects > 0 ? (s.current_projects / s.max_projects) * 100 : 0;
                return (
                  <Card key={s.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3 mb-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400 text-xs font-mono shrink-0">
                            {s.region.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{s.label}</span>
                              <Badge variant="outline" className={`text-[9px] ${
                                s.status === "active" ? "bg-emerald-500/20 text-emerald-500 border-emerald-500/50"
                                : s.status === "draining" ? "bg-amber-500/20 text-amber-500 border-amber-500/50"
                                : "bg-red-500/20 text-red-500"
                              }`}>{s.status}</Badge>
                              {s.is_local && <Badge variant="outline" className="text-[9px] bg-blue-500/20 text-blue-400 border-blue-500/30">primary · local</Badge>}
                              {s.user_id && <Badge variant="outline" className="text-[9px] bg-violet-500/15 text-violet-400 border-violet-500/30">BYOC</Badge>}
                              {s.docker_installed && <Badge variant="outline" className="text-[9px]">Docker</Badge>}
                            </div>
                            <p className="text-xs text-muted-foreground font-mono mt-0.5">{s.host}</p>
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {s.status === "active" && (
                            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setServerStatus(s.id, "draining")}>
                              Drain
                            </Button>
                          )}
                          {(s.status === "draining" || s.status === "offline") && (
                            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setServerStatus(s.id, "active")}>
                              Activate
                            </Button>
                          )}
                          {!s.is_local && (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:text-destructive" onClick={() => removeServer(s.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <UtilBar label="RAM used" used={s.used_memory_mb} total={s.total_memory_mb} pct={memPct} unit="MB" large />
                        <UtilBar label="Load" used={parseFloat(s.load_avg.toFixed(1))} total={s.total_cpu} pct={cpuPct} unit="cores" large />
                        <UtilBar label="Projects" used={s.current_projects} total={s.max_projects} pct={projPct} unit="" large />
                      </div>
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        Measured live (refreshed every 2 min). Allocated limits: {s.allocated_memory_mb} MB RAM · {s.allocated_cpu.toFixed(1)} vCPU across {s.current_projects} projects — limits are caps, not reservations, so they may exceed the hardware.
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── BACKUPS TAB ──────────────────────────────────────────────────── */}
      {tab === "backups" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                Nightly Postgres dump + project data tarball. Local 7-day retention.
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className={backups?.timer_active ? "bg-emerald-500/20 text-emerald-500 border-emerald-500/50" : "bg-red-500/20 text-red-500 border-red-500/40"}>
                  Timer: {backups?.timer_active ? "active" : "inactive"}
                </Badge>
                <Badge variant="outline">Last: {backups?.last_run ? formatTs(backups.last_run) : "never"}</Badge>
                <Badge variant="outline">Off-site: {backups?.offsite_remote || "disabled"}</Badge>
              </div>
            </div>
            <Button size="sm" disabled={backupRunning} onClick={runBackupNow} className="gap-1.5 shrink-0">
              {backupRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <HardDrive className="h-3.5 w-3.5" />}
              Run Now
            </Button>
          </div>

          {!backups || backups.runs.length === 0 ? (
            <div className="flex flex-col items-center py-16">
              <HardDrive className="h-10 w-10 text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground">No backups yet — run one now or wait for the nightly job at 02:00 UTC.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {backups.runs.slice(0, 10).map(run => (
                <div key={run.timestamp} className="flex items-center justify-between rounded-lg border border-border/50 px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono">{formatTs(run.timestamp)}</span>
                      <Badge variant="outline" className="text-[10px] bg-emerald-500/20 text-emerald-500 border-emerald-500/50">
                        {formatBytes(run.total_bytes)}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-3 mt-1.5 text-[11px] text-muted-foreground">
                      {run.files.map(f => (
                        <button key={f.name} onClick={() => downloadBackupFile(f.name)}
                          className="underline hover:text-foreground transition-colors">
                          {f.kind} ({formatBytes(f.size_bytes)})
                        </button>
                      ))}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-destructive hover:text-destructive shrink-0"
                    onClick={() => deleteBackupRun(run.timestamp)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {/* ── BROADCAST TAB ───────────────────────────────────────────────────── */}
      {/* ── ANALYTICS TAB ─────────────────────────────────────────────────── */}
      {tab === "analytics" && (
        <div className="space-y-4">
          {/* Period selector */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Period</span>
            <div className="flex rounded-md border border-border overflow-hidden">
              {["day", "week", "month", "year", "all"].map(pd => (
                <button key={pd} onClick={() => setAnalyticsPeriod(pd)}
                  className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    analyticsPeriod === pd ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}>{pd === "all" ? "All time" : pd}</button>
              ))}
            </div>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs ml-auto"
              onClick={() => loadAnalytics(analyticsPeriod)} disabled={analyticsLoading}>
              <RefreshCw className={`h-3.5 w-3.5 ${analyticsLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>

          {analyticsLoading && !analytics && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Aggregating traffic…
            </div>
          )}

          {analytics && (() => {
            const o = analytics.overview;
            const totalHits = o.pageviews + o.bot_hits;
            const botPct = totalHits > 0 ? (o.bot_hits / totalHits) * 100 : 0;
            const fmtBytes = (b: number) =>
              b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${(b / 1e3).toFixed(0)} KB`;
            const fmtNum = (n: number) =>
              n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);
            const peak = Math.max(1, ...analytics.timeseries.map(t => t.pageviews + t.bot_hits));

            return (
              <>
                {/* Headline tiles */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <StatTile label="Pageviews" value={fmtNum(o.pageviews)} sub={`${fmtNum(o.visitors)} unique visitors`} />
                  <StatTile label="Bot traffic" value={`${botPct.toFixed(1)}%`} sub={`${fmtNum(o.bot_hits)} crawler hits`}
                    tone={botPct > 60 ? "warn" : undefined} />
                  <StatTile label="Bandwidth served" value={fmtBytes(o.bytes_served)} sub={`${o.active_sites} sites with traffic`} />
                  <StatTile label="Errors" value={fmtNum(o.error_hits)}
                    sub={totalHits > 0 ? `${((o.error_hits / totalHits) * 100).toFixed(1)}% of requests` : "—"}
                    tone={o.error_hits > 0 && totalHits > 0 && (o.error_hits / totalHits) > 0.05 ? "bad" : undefined} />
                </div>

                {/* Traffic chart — human vs bot, stacked bars (no chart lib, matches
                    the hand-rolled SVG style used elsewhere) */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span>Traffic over time</span>
                      <span className="flex items-center gap-3 text-[10px] font-normal text-muted-foreground">
                        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500" />humans</span>
                        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-500/70" />bots</span>
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {analytics.timeseries.length === 0 ? (
                      <p className="py-10 text-center text-xs text-muted-foreground">No traffic in this period.</p>
                    ) : (
                      <div className="flex items-end gap-[2px] h-40">
                        {analytics.timeseries.map((pt, i) => {
                          const total = pt.pageviews + pt.bot_hits;
                          const h = (total / peak) * 100;
                          const botShare = total > 0 ? (pt.bot_hits / total) * 100 : 0;
                          return (
                            <div key={i} className="flex-1 flex flex-col justify-end group relative" style={{ height: "100%" }}>
                              <div className="w-full rounded-t-sm overflow-hidden flex flex-col justify-end" style={{ height: `${h}%` }}>
                                <div className="w-full bg-amber-500/70" style={{ height: `${botShare}%` }} />
                                <div className="w-full bg-emerald-500" style={{ height: `${100 - botShare}%` }} />
                              </div>
                              <div className="pointer-events-none absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 whitespace-nowrap rounded bg-popover border border-border px-2 py-1 text-[10px] shadow">
                                <div className="font-medium">{new Date(pt.ts).toLocaleString()}</div>
                                <div className="text-emerald-500">{pt.pageviews} views · {pt.visitors} visitors</div>
                                <div className="text-amber-500">{pt.bot_hits} bot hits</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Breakdowns */}
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  <TopList title="Traffic sources" rows={analytics.top.referrers} empty="No referrers — traffic is direct." />
                  <TopList title="Top pages" rows={analytics.top.paths} />
                  <TopList title="Countries" rows={analytics.top.countries} />
                  <TopList title="Devices" rows={analytics.top.devices} />
                  <TopList title="Browsers" rows={analytics.top.browsers} />
                </div>

                {/* Busiest projects */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Busiest projects</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {analytics.projects.length === 0 ? (
                      <p className="py-8 text-center text-xs text-muted-foreground">No traffic recorded in this period.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-muted-foreground border-b border-border/50">
                              <th className="text-left font-medium py-1.5">Project</th>
                              <th className="text-right font-medium">Views</th>
                              <th className="text-right font-medium">Visitors</th>
                              <th className="text-right font-medium">Bots</th>
                              <th className="text-right font-medium">Bandwidth</th>
                              <th className="text-right font-medium">Errors</th>
                            </tr>
                          </thead>
                          <tbody>
                            {analytics.projects.map(pr => (
                              <tr key={pr.project_id} className="border-b border-border/30 last:border-0">
                                <td className="py-1.5">
                                  <div className="font-medium">{pr.name}</div>
                                  <div className="text-[10px] text-muted-foreground">{pr.owner_email || "—"}</div>
                                </td>
                                <td className="text-right font-mono">{fmtNum(pr.pageviews)}</td>
                                <td className="text-right font-mono">{fmtNum(pr.visitors)}</td>
                                <td className="text-right font-mono text-amber-500">{fmtNum(pr.bot_hits)}</td>
                                <td className="text-right font-mono">{fmtBytes(pr.bytes)}</td>
                                <td className={`text-right font-mono ${pr.error_hits > 0 ? "text-red-500" : ""}`}>{fmtNum(pr.error_hits)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <p className="text-[10px] text-muted-foreground">{analytics.retention_note}</p>
              </>
            );
          })()}
        </div>
      )}

      {tab === "broadcast" && (
        <div className="max-w-2xl space-y-6">
          <div>
            <h3 className="text-sm font-semibold mb-1">Email Broadcast</h3>
            <p className="text-xs text-muted-foreground">Send an HTML email to your users via Brevo. Delivered from noreply@deployzy.com.</p>
          </div>

          {bcResult && (
            <div className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-4 py-3 flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </div>
              <div>
                <p className="text-sm font-medium text-emerald-500">Broadcast sent</p>
                <p className="text-xs text-muted-foreground">{bcResult.sent} delivered · {bcResult.failed} failed · {bcResult.total} total recipients</p>
              </div>
              <button onClick={() => setBcResult(null)} className="ml-auto text-muted-foreground hover:text-foreground text-xs">Dismiss</button>
            </div>
          )}

          {bcError && (
            <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-400">{bcError}</div>
          )}

          {/* Audience */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Audience</label>
            <div className="flex gap-2">
              {(["all", "free", "hobby", "pro", "team"] as const).map(a => (
                <button key={a} onClick={() => { setBcAudience(a); loadBroadcastPreview(a); }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors capitalize ${
                    bcAudience === a
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                  }`}>
                  {a === "all" ? "All users" : `${a} plan`}
                </button>
              ))}
              {bcPreviewCount !== null && (
                <span className="ml-auto text-xs text-muted-foreground self-center">
                  ~{bcPreviewCount.toLocaleString()} recipient{bcPreviewCount !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>

          {/* Subject */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Subject line</label>
            <input
              type="text"
              value={bcSubject}
              onChange={e => setBcSubject(e.target.value)}
              placeholder="e.g. Introducing custom domains on Deployzy 🚀"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
            />
          </div>

          {/* Body */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">HTML body</label>
              <span className="text-[10px] text-muted-foreground">Full HTML email. Use inline styles for email clients.</span>
            </div>
            <textarea
              value={bcBody}
              onChange={e => setBcBody(e.target.value)}
              rows={12}
              placeholder={"<!DOCTYPE html>\n<html>\n<body>\n  <h1>Hello!</h1>\n  <p>Your announcement here...</p>\n</body>\n</html>"}
              className="w-full rounded-md border border-input bg-muted px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground resize-y"
              spellCheck={false}
            />
          </div>

          {/* Send */}
          <div className="flex items-center gap-3">
            <Button
              disabled={bcSending || !bcSubject.trim() || !bcBody.trim()}
              onClick={sendBroadcast}
              className="gap-2"
            >
              {bcSending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending…</>
                : <><svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg> Send broadcast</>
              }
            </Button>
            <p className="text-xs text-muted-foreground">This sends immediately to all selected recipients.</p>
          </div>
        </div>
      )}

    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, sub, trend, color }: {
  icon: React.ReactNode; label: string; value: number | string;
  sub?: string; trend?: "up" | "down"; color: string;
}) {
  return (
    <Card className="hover:border-foreground/10 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>{icon}</span>
          {trend && (
            <span className={`text-[10px] flex items-center gap-0.5 ${trend === "up" ? "text-emerald-500" : "text-red-500"}`}>
              {trend === "up" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </span>
          )}
        </div>
        <p className="text-xl font-bold tracking-tight">{typeof value === "number" ? value.toLocaleString() : value}</p>
        <p className="text-[11px] font-medium text-muted-foreground mt-0.5">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" | "bad" }) {
  const color = tone === "warn" ? "text-amber-500" : tone === "bad" ? "text-red-500" : "text-foreground";
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-2xl font-semibold tracking-tight ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function TopList({ title, rows, empty }: { title: string; rows?: { key: string; count: number }[]; empty?: string }) {
  const data = rows || [];
  const max = Math.max(1, ...data.map(r => r.count));
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-4 text-center text-[11px] text-muted-foreground">{empty || "No data yet."}</p>
        ) : (
          <div className="space-y-1.5">
            {data.map(r => (
              <div key={r.key} className="relative">
                <div className="absolute inset-y-0 left-0 rounded bg-primary/10" style={{ width: `${(r.count / max) * 100}%` }} />
                <div className="relative flex justify-between px-2 py-1 text-[11px]">
                  <span className="truncate pr-2" title={r.key}>{r.key}</span>
                  <span className="font-mono text-muted-foreground shrink-0">{r.count.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DiagStat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-emerald-500"
    : tone === "warn" ? "text-amber-500"
    : tone === "bad" ? "text-red-500"
    : "text-foreground";
  return (
    <div className="rounded-md bg-background/60 border border-border/50 px-2.5 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-xs font-medium font-mono ${color}`}>{value}</div>
    </div>
  );
}

function UtilBar({ label, used, total, pct, unit, large }: {
  label: string; used: number; total: number; pct: number; unit: string; large?: boolean;
}) {
  const color = pct > 85 ? "bg-red-500" : pct > 65 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div>
      <div className="flex justify-between text-[10px] mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-foreground">{used}/{total}{unit ? ` ${unit}` : ""}</span>
      </div>
      <div className={`rounded-full bg-muted/40 overflow-hidden ${large ? "h-2" : "h-1.5"}`}>
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <p className={`text-[10px] mt-0.5 ${pct > 85 ? "text-red-500" : pct > 65 ? "text-amber-500" : "text-muted-foreground/60"}`}>
        {Math.round(pct)}%
      </p>
    </div>
  );
}

function StackBar({ counts, colors }: { counts: Record<string, number>; colors: Record<string, string> }) {
  const entries = Object.entries(counts).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return <p className="text-xs text-muted-foreground">No data.</p>;
  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted/40">
        {entries.map(([k, v]) => (
          <div key={k} className={colors[k] || "bg-muted"} style={{ width: `${(v / total) * 100}%` }} title={`${k}: ${v}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5 text-[11px]">
            <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${colors[k] || "bg-muted"}`} />
            <span className="font-medium">{k}</span>
            <span className="text-muted-foreground">{v} <span className="text-muted-foreground/60">({Math.round((v / total) * 100)}%)</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}
