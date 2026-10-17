"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { REGION_PRESETS } from "@/lib/regions";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Pager, FilterChip, fmtBytes, timeAgo } from "@/components/admin/pager";
import { SuspendDialog, type SuspendRequest } from "@/components/admin/suspend-dialog";
import { WebsiteAnalytics } from "@/components/website-analytics";
import { OverviewDashboard } from "@/components/admin/overview-dashboard";
import {
  Users, Key, Globe, Activity, Search, Trash2, Shield, Crown,
  Server, Plus, Loader2, Rocket, BarChart3, Database, Link2,
  Radio, WifiOff, ExternalLink, RefreshCw, X, Zap, Square,
  RotateCcw, GitBranch, FolderOpen, FileText, TrendingUp,
  HardDrive, Cpu, MemoryStick, CheckCircle2, AlertCircle,
  Clock, UserCheck, Layers, ChevronUp, ChevronDown, LayoutTemplate,
  Eye, EyeOff, Copy, Ban, Moon, Flag, Sparkles,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

type Tab = "overview" | "analytics" | "density" | "website" | "seo" | "plans" | "users" | "projects" | "databases" | "orphans" | "sessions" | "infra" | "backups" | "broadcast" | "vpn" | "ai" | "bans" | "abuse" | "email";

// Grouped sidebar navigation — the 17 tabs organised into labelled sections so
// the console is scannable instead of a single long scroll of pills.
type NavIcon = React.ComponentType<{ className?: string }>;
const NAV_GROUPS: { group: string; items: { id: Tab; label: string; icon: NavIcon }[] }[] = [
  { group: "Monitor", items: [
    { id: "overview", label: "Overview", icon: Activity },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "sessions", label: "Tunnels", icon: Radio },
  ] },
  { group: "Growth", items: [
    { id: "website", label: "Website Traffic", icon: Globe },
    { id: "seo", label: "SEO & LLM", icon: TrendingUp },
    { id: "density", label: "Density", icon: Layers },
    { id: "email", label: "Email Validator", icon: CheckCircle2 },
  ] },
  { group: "Billing", items: [
    { id: "plans", label: "Plans", icon: Crown },
    { id: "ai", label: "AI Model", icon: Sparkles },
  ] },
  { group: "People", items: [
    { id: "users", label: "Users", icon: Users },
    { id: "bans", label: "IP Bans", icon: Ban },
    { id: "abuse", label: "Abuse Reports", icon: Flag },
  ] },
  { group: "Workloads", items: [
    { id: "projects", label: "Projects", icon: Rocket },
    { id: "databases", label: "Databases", icon: Database },
    { id: "orphans", label: "Orphans", icon: WifiOff },
  ] },
  { group: "Platform", items: [
    { id: "infra", label: "Infrastructure", icon: Server },
    { id: "backups", label: "Backups", icon: HardDrive },
    { id: "broadcast", label: "Broadcast", icon: Zap },
    { id: "vpn", label: "VPN Panel", icon: Globe },
  ] },
];

interface DensityServer {
  id: string; label: string; region: string; is_local: boolean; status: string;
  total_memory_mb: number; allocated_memory_mb: number; used_memory_mb: number;
  load_avg: number; current_projects: number; max_projects: number;
  reserved_pct: number; used_pct: number; reclaimable_mb: number; sleeping_count: number;
}
interface SleepingProject {
  id: string; subdomain: string; email: string; memory_mb: number;
  slept_at: string | null; last_request_at: string | null;
}
interface DensityStats {
  servers: DensityServer[];
  sleeping_count: number; sleeping_memory_mb: number; eligible_awake: number; total_running: number;
  sleeping_projects: SleepingProject[];
  total_memory_mb: number; allocated_memory_mb: number; used_memory_mb: number;
  reserved_pct: number; used_pct: number;
}

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
  id: string; email: string; name: string; plan: string; pro_until?: string | null;
  is_admin: boolean; email_verified: boolean;
  created_at: string; last_seen_at?: string | null; key_count: number;
  signup_ip?: string; signup_country?: string; last_login_ip?: string; last_country?: string;
  blocked?: boolean; blocked_reason?: string; blocked_at?: string | null;
  projects: number; running: number; sleeping: number; bandwidth_bytes: number; flagged: boolean;
}
interface UserFacets {
  total: number; by_plan: Record<string, number>;
  suspended: number; admins: number; flagged: number; unverified: number;
}
interface ProjectFacets {
  total: number; by_status: Record<string, number>; flagged: number;
  servers: { id: string; label: string; count: number }[];
}
interface IPBan { ip: string; reason: string; created_by: string; created_at: string; }
interface AbuseReport {
  id: string; target_url: string; category: string; details: string;
  reporter_email: string; reporter_ip: string; status: string; created_at: string;
  project_id?: string; project_name?: string; project_status?: string;
  owner_id?: string; owner_email?: string; owner_plan?: string;
  owner_blocked?: boolean; owner_is_admin?: boolean;
}
interface AbuseScanState {
  scan: {
    running: boolean; last_started?: string; last_finished?: string; next_run_at?: string;
    hosts: number; hits: number; new_reports: number; auto_suspended: number;
  };
  auto_suspend: boolean;
}

// Turn a 2-letter ISO country code into its flag emoji (regional indicators).
function countryFlag(code?: string): string {
  if (!code || code.length !== 2) return "";
  const A = 0x1f1e6;
  return String.fromCodePoint(A + code.charCodeAt(0) - 65, A + code.charCodeAt(1) - 65);
}

interface AdminProject {
  id: string; name: string; subdomain: string; status: string; sleeping: boolean;
  framework: string; deploy_source: string; repo_url: string; branch: string; memory_mb: number;
  created_at: string; last_deploy_at: string | null; last_request_at: string | null;
  user_id: string; user_email: string; user_plan: string; user_blocked: boolean;
  worker_server_id: string; server_label: string; server_byoc: boolean;
  bandwidth_bytes: number; flagged: boolean;
}

interface AdminDatabase {
  service: {
    id: string; user_id: string; name: string; type: string; status: string;
    size_mb: number; over_quota: boolean; worker_server_id: string | null;
    public_host: string | null; public_port: number | null; created_at: string;
  };
  user_email: string;
  server_label: string | null;
  connection_url: string;
  external_connection_url: string;
}

interface SEONameCount { name: string; channel: string; hits: number; recent: number; }
interface SEOInsight {
  days: number;
  has_data: boolean;
  data_since?: string;
  crawlers: SEONameCount[];
  referrals: SEONameCount[];
  probes: SEONameCount[];
  trend: { day: string; pageviews: number; ai_crawls: number; search_crawls: number; referrals: number }[];
  totals: {
    human_pageviews: number;
    ai_crawler_hits: number; search_crawler_hits: number;
    llm_referral_hits: number; search_referral_hits: number;
    probe_hits: number; script_hits: number;
  };
  tips: { tone: string; text: string }[];
}

interface OrphanContainer {
  server_id: string; server_label: string; host: string; is_local: boolean;
  name: string; state: string; status: string; created_at: string;
}
interface OrphanScan {
  orphans: OrphanContainer[];
  unreachable_hosts: string[];
  hosts_scanned: number;
  scanned_at: string;
}

interface PlanLimitRow {
  plan: string;
  max_subdomains: number; max_tunnels: number; max_rate: number;
  max_projects: number; max_custom_domains: number; max_databases: number;
  max_services: number; max_crons: number; max_byoc_servers: number;
  max_preview_deploys: number; max_memory_mb: number; max_cpus: number;
  max_bandwidth_gb: number; max_build_minutes_monthly: number; monthly_ai_credits: number;
  max_build_memory_mb: number;
  max_db_size_mb: number;
  analytics_retention_days: number; metrics_retention_days: number;
  deploy_log_retention_days: number; backup_retention_days: number;
  allow_previews: boolean; allow_release_cmd: boolean; allow_health_checks: boolean;
  allow_private_repos: boolean; allow_tcp_tunnels: boolean; allow_custom_events: boolean;
  allow_live_logs: boolean; allow_telegram: boolean; allow_advanced_databases: boolean;
  allow_db_migration: boolean;
}

interface PlatformAnalytics {
  period: string;
  overview: {
    pageviews: number; visitors: number; bot_hits: number;
    bytes_served: number; error_hits: number; active_sites: number;
  };
  timeseries: { ts: string; pageviews: number; visitors: number; bot_hits: number }[];
  top: Record<string, { key: string; count: number }[]>;
  crawlers: { name: string; category: string; hits: number; sites: number }[];
  source: string;
  visitors_exact: boolean;
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
  last_heartbeat?: string | null;
  status: string; docker_installed: boolean; priority?: number; is_local?: boolean; user_selectable?: boolean; backups_enabled?: boolean;
}

// Compact "measured Xs ago" for live-metric freshness (heartbeat timestamp).
function agoShort(iso?: string | null): string {
  if (!iso) return "—";
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 0) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface TrafficStats { requests: number; bytes_in: number; bytes_out: number; last_hit?: string | null; }
interface SessionTunnel {
  url: string; protocol: string; local_addr: string; name: string; inspect: boolean;
  active?: boolean; created_at?: string; stats?: TrafficStats;
}
interface Session {
  client_id: string; user_id: string; user_email: string;
  remote_addr: string; connected_at: string; tunnels: SessionTunnel[];
  client_version?: string; os?: string; stats?: TrafficStats;
}
interface TunnelPeriod { sessions: number; unique_users: number; requests: number; bytes: number; }
interface TunnelOverview {
  today: TunnelPeriod; week: TunnelPeriod;
  daily: { day: string; sessions: number; users: number; bytes: number }[];
  top_users: { user_id: string; email: string; sessions: number; requests: number; bytes: number; last_seen: string }[];
  recent: {
    id: number; user_id: string; email: string; remote_ip: string; client_version: string; os: string;
    connected_at: string; disconnected_at: string | null; tunnel_urls: string[];
    requests: number; bytes_in: number; bytes_out: number;
  }[];
}

interface EvPeriod { total: number; users: number; valid: number; risky: number; invalid: number; unknown: number; }
interface EmailAnalytics {
  today: EvPeriod; week: EvPeriod; month: EvPeriod;
  all_time: number; disposable_30d: number; role_based_30d: number; no_mx_30d: number;
  smtp_probed_30d: number; batch_share_30d: number;
  daily: { day: string; total: number; valid: number; invalid: number; risky: number }[];
  top_users: { user_id: string; email: string; total: number; invalid: number; last_used: string }[];
  top_domains: { key: string; count: number }[];
  top_reasons: { key: string; count: number }[];
}

// Human duration between two instants (end defaults to now): "3h 12m", "45s".
function fmtDuration(fromIso: string, toIso?: string | null): string {
  const secs = Math.max(0, Math.floor(((toIso ? new Date(toIso).getTime() : Date.now()) - new Date(fromIso).getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

interface BackupRun {
  timestamp: string; total_bytes: number;
  files: { name: string; kind: string; size_bytes: number }[];
}

const STATUS_COLORS: Record<string, string> = {
  running:  "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/50",
  building: "bg-sky-500/20 text-sky-600 dark:text-sky-400 border-sky-500/50",
  stopped:  "bg-zinc-500/20 text-muted-foreground border-zinc-500/30",
  failed:   "bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/40",
  created:  "bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/50",
};

const PLAN_COLORS: Record<string, string> = {
  free: "bg-zinc-500/20 text-muted-foreground border-zinc-500/30",
  pro:  "bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/50",
  team: "bg-violet-500/20 text-violet-600 dark:text-violet-400 border-violet-500/50",
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
  const [navSearch, setNavSearch] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Users state
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [userPlanFilter, setUserPlanFilter] = useState("all");
  const [userStatus, setUserStatus] = useState("all");
  const [userSort, setUserSort] = useState("newest");
  const [usersPage, setUsersPage] = useState(1);
  const [usersPageSize, setUsersPageSize] = useState(25);
  const [userFacets, setUserFacets] = useState<UserFacets | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());

  // Projects state
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [projectsTotal, setProjectsTotal] = useState(0);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectStatus, setProjectStatus] = useState("all");
  const [projectServer, setProjectServer] = useState("all");
  const [projectPlan, setProjectPlan] = useState("all");
  const [projectSort, setProjectSort] = useState("newest");
  const [projectFlagged, setProjectFlagged] = useState(false);
  const [projectsPage, setProjectsPage] = useState(1);
  const [projectsPageSize, setProjectsPageSize] = useState(25);
  const [projectFacets, setProjectFacets] = useState<ProjectFacets | null>(null);
  const [databases, setDatabases] = useState<AdminDatabase[]>([]);
  const [databasesTotal, setDatabasesTotal] = useState(0);
  const [databasesLoading, setDatabasesLoading] = useState(false);
  const [dbSearch, setDbSearch] = useState("");
  const [dbType, setDbType] = useState("all");
  const [dbReveal, setDbReveal] = useState<string | null>(null);
  const [orphanScan, setOrphanScan] = useState<OrphanScan | null>(null);
  const [orphanLoading, setOrphanLoading] = useState(false);
  const [reaping, setReaping] = useState<string | null>(null);
  const [seo, setSeo] = useState<SEOInsight | null>(null);
  const [seoLoading, setSeoLoading] = useState(false);
  const [density, setDensity] = useState<DensityStats | null>(null);
  const [densityLoading, setDensityLoading] = useState(false);
  const [ipBans, setIpBans] = useState<IPBan[]>([]);
  const [banForm, setBanForm] = useState({ ip: "", reason: "" });
  const [abuseReports, setAbuseReports] = useState<AbuseReport[]>([]);
  const [abuseLoading, setAbuseLoading] = useState(false);
  const [abuseFilter, setAbuseFilter] = useState<"open" | "actioned" | "dismissed" | "all">("open");
  const [abuseScan, setAbuseScan] = useState<AbuseScanState | null>(null);
  const [abuseBusy, setAbuseBusy] = useState<string | null>(null);
  // Pending suspension awaiting the dialog's reason + notify choice.
  const [suspendAsk, setSuspendAsk] = useState<{ req: SuspendRequest; run: (reason: string, notify: boolean) => Promise<void> } | null>(null);
  const [redeploying, setRedeploying] = useState(false);
  const [actionError, setActionError] = useState("");
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [analyticsPeriod, setAnalyticsPeriod] = useState("week");
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [plans, setPlans] = useState<PlanLimitRow[]>([]);
  const [planDraft, setPlanDraft] = useState<Record<string, PlanLimitRow>>({});
  const [planSaving, setPlanSaving] = useState<string | null>(null);
  const [planSaved, setPlanSaved] = useState<string | null>(null);
  const [diagOpen, setDiagOpen] = useState<string | null>(null);
  // Move-project-to-server
  interface MoveServer { id: string; label: string; host: string; region: string; status: string; is_local: boolean; user_id?: string | null; current_projects: number; max_projects: number; docker_installed?: boolean; }
  const [moveOpen, setMoveOpen] = useState<string | null>(null);
  const [moveServers, setMoveServers] = useState<MoveServer[]>([]);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveDbOpen, setMoveDbOpen] = useState<string | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diag, setDiag] = useState<ProjectDiagnostics | null>(null);
  const [redeployResult, setRedeployResult] = useState<{ queued: number; total: number; skipped: number } | null>(null);

  // Sessions state
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");
  const [sessionsRefresh, setSessionsRefresh] = useState<Date | null>(null);
  const [tunnelOverview, setTunnelOverview] = useState<TunnelOverview | null>(null);
  const [historyFilter, setHistoryFilter] = useState("");
  const [emailAnalytics, setEmailAnalytics] = useState<EmailAnalytics | null>(null);

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

  // ── VPN panel (TuTBot reseller) config ────────────────────────────────────
  interface VpnCfg { base_url: string; api_key_set: boolean; api_key_preview: string; master_key_set: boolean; master_key_preview: string; shared_server_id: string; free_days: string; free_max_logins: string; }
  const [vpnCfg, setVpnCfg] = useState<VpnCfg | null>(null);
  const [vpnForm, setVpnForm] = useState({ base_url: "", api_key: "", master_key: "", shared_server_id: "", free_days: "", free_max_logins: "" });
  const [vpnSaving, setVpnSaving] = useState(false);
  const [vpnTest, setVpnTest] = useState<{ ok: boolean; msg: string } | null>(null);

  // ── AI model provider config ───────────────────────────────────────────────
  interface AiPreset { id: string; label: string; base_url: string; model: string; key_hint: string; }
  interface AiCfg {
    provider: string; base_url: string; model: string; api_key_set: boolean; api_key_preview: string;
    credits_enabled: boolean; price_in_per_m: string; price_out_per_m: string;
    card_configured?: boolean;
    polar_credits_product?: string;
    effective: { provider: string; base_url: string; model: string; key_configured: boolean; using_env_fallback: boolean };
    presets: AiPreset[];
  }
  const [aiCfg, setAiCfg] = useState<AiCfg | null>(null);
  const [aiForm, setAiForm] = useState({ provider: "deepseek", base_url: "", model: "", api_key: "", credits_enabled: false, price_in_per_m: "", price_out_per_m: "", polar_credits_product: "" });
  const [aiSaving, setAiSaving] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTest, setAiTest] = useState<{ ok: boolean; msg: string } | null>(null);

  // ── Platform build concurrency ────────────────────────────────────────────
  const [buildConc, setBuildConc] = useState<number | null>(null);
  const [buildConcInput, setBuildConcInput] = useState("1");
  const [buildConcSaving, setBuildConcSaving] = useState(false);

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
  // Server-side filter/sort/page. Facets (chip counts) refresh with each load.
  const usersReq = useRef(0);
  const loadUsers = useCallback(async () => {
    const id = ++usersReq.current;
    setUsersLoading(true);
    try {
      const q = new URLSearchParams({
        limit: String(usersPageSize), offset: String((usersPage - 1) * usersPageSize),
        sort: userSort, facets: "1",
      });
      if (userSearch.trim()) q.set("search", userSearch.trim());
      if (userPlanFilter !== "all") q.set("plan", userPlanFilter);
      if (userStatus !== "all") q.set("status", userStatus);
      const res = await fetch(`${API}/api/v1/admin/users?${q}`, { headers: headers() });
      if (id !== usersReq.current) return; // a newer request superseded this one
      if (res.ok) {
        const data = await res.json();
        const rows: AdminUser[] = data.users || [];
        if (rows.length === 0 && usersPage > 1) { setUsersPage(1); return; }
        setUsers(rows);
        setUsersTotal(data.total || 0);
        if (data.facets) setUserFacets(data.facets);
      } else setActionError(`Loading users failed: HTTP ${res.status}`);
    } catch {}
    if (id === usersReq.current) setUsersLoading(false);
  }, [headers, usersPage, usersPageSize, userSort, userSearch, userPlanFilter, userStatus]);

  // Filters/search reset to page 1; the load itself is debounced for typing.
  useEffect(() => { setUsersPage(1); setSelectedUsers(new Set()); }, [userSearch, userPlanFilter, userStatus, userSort, usersPageSize]);
  useEffect(() => {
    if (tab !== "users") return;
    const t = setTimeout(loadUsers, 250);
    return () => clearTimeout(t);
  }, [tab, loadUsers]);
  const reloadUsers = () => { loadUsers(); };

  const updateUser = async (userId: string, updates: { plan?: string; is_admin?: boolean; blocked?: boolean; blocked_reason?: string; notify?: boolean }) => {
    if (await adminFetch(`${API}/api/v1/admin/users/${userId}`, {
      method: "PUT", body: JSON.stringify(updates),
    }, "Updating user")) {
      reloadUsers();
      loadStats();
    }
  };

  const deleteUser = async (userId: string, email: string) => {
    if (!confirm(`Delete ${email}? This cannot be undone.`)) return;
    if (await adminFetch(`${API}/api/v1/admin/users/${userId}`, { method: "DELETE" }, "Deleting user")) {
      reloadUsers();
      loadStats();
    }
  };

  // ── Per-user AI credits (admin view + manual adjust) ─────────────────────────
  interface UserCreditData {
    user_id: string; plan: string; free_allotment: number; credits_enabled: boolean;
    status: { free_used: number; free_remaining: number; wallet: number; available: number; unlimited: boolean };
    ledger: { delta: number; reason: string; source: string; model: string; tokens_in: number; tokens_out: number; created_at: string }[];
    usage?: {
      products: { product: string; label: string; credits: number; count: number; tokens: number }[];
      daily: { day: string; credits: number }[];
      spent_today: number; spent_month: number; spent_window: number; days: number;
    };
  }
  const [creditUser, setCreditUser] = useState<{ id: string; email: string } | null>(null);
  const [creditData, setCreditData] = useState<UserCreditData | null>(null);
  const [creditGrant, setCreditGrant] = useState("");
  const [creditBusy, setCreditBusy] = useState(false);

  const openUserCredits = async (userId: string, email: string) => {
    setCreditUser({ id: userId, email }); setCreditData(null); setCreditGrant("");
    try {
      const res = await fetch(`${API}/api/v1/admin/users/${userId}/credits`, { headers: headers() });
      if (res.ok) setCreditData(await res.json());
    } catch {}
  };
  const adjustUserCredits = async (delta: number) => {
    if (!creditUser || !delta) return;
    setCreditBusy(true);
    try {
      const res = await fetch(`${API}/api/v1/admin/users/${creditUser.id}/credits`, {
        method: "POST", headers: headers(), body: JSON.stringify({ credits: delta, reason: "admin adjustment" }),
      });
      if (res.ok) { setCreditGrant(""); await openUserCredits(creditUser.id, creditUser.email); }
    } catch {}
    setCreditBusy(false);
  };

  // ── Projects ───────────────────────────────────────────────────────────────
  const projectsReq = useRef(0);
  const loadProjects = useCallback(async () => {
    const id = ++projectsReq.current;
    setProjectsLoading(true);
    try {
      const q = new URLSearchParams({
        limit: String(projectsPageSize), offset: String((projectsPage - 1) * projectsPageSize),
        sort: projectSort, facets: "1",
      });
      if (projectSearch.trim()) q.set("search", projectSearch.trim());
      if (projectStatus !== "all") q.set("status", projectStatus);
      if (projectServer !== "all") q.set("server", projectServer);
      if (projectPlan !== "all") q.set("plan", projectPlan);
      if (projectFlagged) q.set("flagged", "1");
      const res = await fetch(`${API}/api/v1/admin/projects?${q}`, { headers: headers() });
      if (id !== projectsReq.current) return;
      if (res.ok) {
        const data = await res.json();
        const rows: AdminProject[] = data.projects || [];
        if (rows.length === 0 && projectsPage > 1) { setProjectsPage(1); return; }
        setProjects(rows);
        setProjectsTotal(data.total || 0);
        if (data.facets) setProjectFacets(data.facets);
      } else setActionError(`Loading projects failed: HTTP ${res.status}`);
    } catch {}
    if (id === projectsReq.current) setProjectsLoading(false);
  }, [headers, projectsPage, projectsPageSize, projectSort, projectSearch, projectStatus, projectServer, projectPlan, projectFlagged]);

  useEffect(() => { setProjectsPage(1); }, [projectSearch, projectStatus, projectServer, projectPlan, projectFlagged, projectSort, projectsPageSize]);
  useEffect(() => {
    if (tab !== "projects") return;
    const t = setTimeout(loadProjects, 250);
    return () => clearTimeout(t);
  }, [tab, loadProjects]);
  const reloadProjects = () => { loadProjects(); };

  // ── Databases (standalone services) ────────────────────────────────────────
  const loadDatabases = useCallback(async (search: string, typ: string) => {
    setDatabasesLoading(true);
    try {
      const q = new URLSearchParams({ limit: "200" });
      if (search) q.set("search", search);
      if (typ && typ !== "all") q.set("type", typ);
      const res = await fetch(`${API}/api/v1/admin/databases?${q}`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setDatabases(data.databases || []);
        setDatabasesTotal(data.total || 0);
      }
    } catch {}
    setDatabasesLoading(false);
  }, [headers]);

  useEffect(() => {
    if (tab !== "databases") return;
    const t = setTimeout(() => loadDatabases(dbSearch, dbType), 300);
    return () => clearTimeout(t);
  }, [tab, dbSearch, dbType, loadDatabases]);

  // ── Orphan containers ──────────────────────────────────────────────────────
  const scanOrphans = useCallback(async () => {
    setOrphanLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/admin/orphans`, { headers: headers() });
      if (res.ok) setOrphanScan(await res.json());
    } catch {}
    setOrphanLoading(false);
  }, [headers]);

  // Auto-scan on first open of the tab (the scan SSHes to every host, so we
  // don't re-run it on every re-render — only when there's no result yet).
  useEffect(() => {
    if (tab === "orphans" && !orphanScan && !orphanLoading) scanOrphans();
  }, [tab, orphanScan, orphanLoading, scanOrphans]);

  // ── SEO & LLM insight ──────────────────────────────────────────────────────
  const loadSEO = useCallback(async () => {
    setSeoLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/admin/seo?days=30`, { headers: headers() });
      if (res.ok) setSeo(await res.json());
    } catch {}
    setSeoLoading(false);
  }, [headers]);

  useEffect(() => {
    if (tab === "seo" && !seo && !seoLoading) loadSEO();
  }, [tab, seo, seoLoading, loadSEO]);

  // ── Density / idle-sleep analytics ─────────────────────────────────────────
  const loadDensity = useCallback(async () => {
    setDensityLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/admin/density`, { headers: headers() });
      if (res.ok) setDensity(await res.json());
    } catch {}
    setDensityLoading(false);
  }, [headers]);

  useEffect(() => {
    if (tab === "density") loadDensity();
  }, [tab, loadDensity]);

  // ── IP bans ────────────────────────────────────────────────────────────────
  const loadIPBans = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/admin/ip-bans`, { headers: headers() });
      if (res.ok) { const d = await res.json(); setIpBans(Array.isArray(d.bans) ? d.bans : []); }
    } catch {}
  }, [headers]);

  useEffect(() => {
    if (tab === "bans") loadIPBans();
  }, [tab, loadIPBans]);

  async function banIP(ip: string, reason: string) {
    if (!confirm(`Ban ${ip}?\n\nThey'll be blocked from signing up, signing in, and all proxied traffic. Use a trailing dot (e.g. "203.0.113.") to ban a range.`)) return;
    try {
      const res = await fetch(`${API}/api/v1/admin/ip-bans`, {
        method: "POST", headers: headers(), body: JSON.stringify({ ip, reason }),
      });
      if (res.ok) { setActionError(""); loadIPBans(); }
      else { const d = await res.json().catch(() => ({})); setActionError(d.error || "Ban failed"); }
    } catch { setActionError("Ban failed"); }
  }

  async function unbanIP(ip: string) {
    try {
      const res = await fetch(`${API}/api/v1/admin/ip-bans/${encodeURIComponent(ip)}`, { method: "DELETE", headers: headers() });
      if (res.ok) loadIPBans();
    } catch {}
  }

  // ── Abuse reports ────────────────────────────────────────────────────────────
  // Load the full set (status=all) once and filter client-side, so the tab badge
  // can show an accurate open count regardless of the on-screen filter.
  const loadAbuseReports = useCallback(async () => {
    setAbuseLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/admin/abuse-reports?status=all`, { headers: headers() });
      if (res.ok) { const d = await res.json(); setAbuseReports(Array.isArray(d.reports) ? d.reports : []); }
    } catch {}
    setAbuseLoading(false);
  }, [headers]);

  useEffect(() => {
    if (tab === "abuse") loadAbuseReports();
  }, [tab, loadAbuseReports]);

  // Load once on mount too, so the "Abuse Reports" tab badge reflects pending
  // open reports without the operator having to open the tab first.
  useEffect(() => { loadAbuseReports(); }, [loadAbuseReports]);

  // Proxy-node scanner status + auto-suspend setting. Polls while a scan runs.
  const loadAbuseScan = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/admin/abuse/scan`, { headers: headers() });
      if (res.ok) setAbuseScan(await res.json());
    } catch {}
  }, [headers]);
  useEffect(() => { if (tab === "abuse") loadAbuseScan(); }, [tab, loadAbuseScan]);
  useEffect(() => {
    if (tab !== "abuse" || !abuseScan?.scan.running) return;
    const t = setInterval(async () => { await loadAbuseScan(); }, 3000);
    return () => clearInterval(t);
  }, [tab, abuseScan?.scan.running, loadAbuseScan]);
  // When a scan finishes, pull the reports it filed.
  const prevScanRunning = useRef(false);
  useEffect(() => {
    const running = !!abuseScan?.scan.running;
    if (prevScanRunning.current && !running) loadAbuseReports();
    prevScanRunning.current = running;
  }, [abuseScan?.scan.running, loadAbuseReports]);

  async function runAbuseScan() {
    setAbuseBusy("scan");
    if (await adminFetch(`${API}/api/v1/admin/abuse/scan`, { method: "POST" }, "Starting scan")) await loadAbuseScan();
    setAbuseBusy(null);
  }
  async function setAutoSuspend(enabled: boolean) {
    if (enabled && !confirm("Turn on auto-suspend?\n\nEvery scan will immediately suspend FREE accounts whose running app contains a proxy server (Xray / V2Ray / sing-box / Hysteria) or a Nezha agent, identified by binary fingerprint. Paid accounts are never auto-suspended — they get a report instead.")) return;
    setAbuseBusy("auto");
    if (await adminFetch(`${API}/api/v1/admin/abuse/auto-suspend`, { method: "PUT", body: JSON.stringify({ enabled }) }, "Saving setting")) await loadAbuseScan();
    setAbuseBusy(null);
  }
  function suspendFromReport(r: AbuseReport) {
    setSuspendAsk({
      req: {
        title: `Suspend ${r.owner_email} and stop "${r.project_name}"?`,
        description: "The owner can't sign in or deploy until unsuspended (Users tab), the app is stopped, and the report is marked actioned.",
        defaultReason: "", defaultNotify: false, showReason: false,
        confirmLabel: "Suspend & stop",
      },
      run: async (_reason, notify) => {
        setAbuseBusy(r.id);
        if (await adminFetch(`${API}/api/v1/admin/abuse-reports/${r.id}/suspend`, { method: "POST", body: JSON.stringify({ notify }) }, "Suspending")) loadAbuseReports();
        setAbuseBusy(null);
      },
    });
  }

  async function setAbuseStatus(id: string, status: "open" | "actioned" | "dismissed") {
    try {
      const res = await fetch(`${API}/api/v1/admin/abuse-reports/${id}/status`, {
        method: "POST", headers: headers(), body: JSON.stringify({ status }),
      });
      if (res.ok) { setActionError(""); loadAbuseReports(); }
      else { const d = await res.json().catch(() => ({})); setActionError(d.error || "Update failed"); }
    } catch { setActionError("Update failed"); }
  }

  // ── VPN panel config ───────────────────────────────────────────────────────
  const loadVpn = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/admin/vpn/config`, { headers: headers() });
      if (res.ok) {
        const c: VpnCfg = await res.json();
        setVpnCfg(c);
        setVpnForm({ base_url: c.base_url || "", api_key: "", master_key: "", shared_server_id: c.shared_server_id || "", free_days: c.free_days || "", free_max_logins: c.free_max_logins || "" });
      }
    } catch {}
  }, [headers]);

  useEffect(() => {
    if (tab === "vpn" && !vpnCfg) loadVpn();
  }, [tab, vpnCfg, loadVpn]);

  const saveVpn = async () => {
    setVpnSaving(true); setVpnTest(null);
    try {
      const body: Record<string, string> = {
        base_url: vpnForm.base_url, shared_server_id: vpnForm.shared_server_id,
        free_days: vpnForm.free_days, free_max_logins: vpnForm.free_max_logins,
      };
      if (vpnForm.api_key.trim()) body.api_key = vpnForm.api_key.trim();
      if (vpnForm.master_key.trim()) body.master_key = vpnForm.master_key.trim();
      const res = await fetch(`${API}/api/v1/admin/vpn/config`, { method: "PUT", headers: headers(), body: JSON.stringify(body) });
      if (res.ok) { setVpnCfg(null); await loadVpn(); }
    } catch {}
    setVpnSaving(false);
  };

  const testVpn = async () => {
    setVpnTest(null);
    try {
      const res = await fetch(`${API}/api/v1/admin/vpn/test`, { method: "POST", headers: headers() });
      const d = await res.json();
      setVpnTest(d.ok ? { ok: true, msg: `Connected — upstream user #${d.upstream_user_id}` } : { ok: false, msg: d.error || "Connection failed" });
    } catch { setVpnTest({ ok: false, msg: "Network error" }); }
  };

  // ── AI model provider (pluggable LLM for the AI builder / agent) ─────────────
  const loadAi = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/admin/ai/config`, { headers: headers() });
      if (res.ok) {
        const c: AiCfg = await res.json();
        setAiCfg(c);
        setAiForm({ provider: c.provider || "deepseek", base_url: c.base_url || "", model: c.model || "", api_key: "", credits_enabled: !!c.credits_enabled, price_in_per_m: c.price_in_per_m || "", price_out_per_m: c.price_out_per_m || "", polar_credits_product: c.polar_credits_product || "" });
      }
    } catch {}
  }, [headers]);

  useEffect(() => {
    if (tab === "ai" && !aiCfg) loadAi();
  }, [tab, aiCfg, loadAi]);

  const applyPreset = (id: string) => {
    const p = aiCfg?.presets.find((x) => x.id === id);
    setAiForm((f) => ({
      ...f,
      provider: id,
      // Keep custom's existing values; otherwise auto-fill from the preset.
      base_url: id === "custom" ? f.base_url : (p?.base_url ?? f.base_url),
      model: id === "custom" ? f.model : (p?.model ?? f.model),
    }));
    setAiTest(null);
  };

  const saveAi = async () => {
    setAiSaving(true); setAiTest(null);
    try {
      const body: Record<string, unknown> = {
        provider: aiForm.provider, base_url: aiForm.base_url.trim(), model: aiForm.model.trim(),
        credits_enabled: aiForm.credits_enabled,
        price_in_per_m: aiForm.price_in_per_m.trim(), price_out_per_m: aiForm.price_out_per_m.trim(),
        polar_credits_product: aiForm.polar_credits_product.trim(),
      };
      if (aiForm.api_key.trim()) body.api_key = aiForm.api_key.trim();
      const res = await fetch(`${API}/api/v1/admin/ai/config`, { method: "PUT", headers: headers(), body: JSON.stringify(body) });
      if (res.ok) { setAiCfg(null); await loadAi(); }
    } catch {}
    setAiSaving(false);
  };

  const testAi = async () => {
    setAiTesting(true); setAiTest(null);
    try {
      // Send current form values so the admin can test BEFORE saving.
      const body: Record<string, string> = { base_url: aiForm.base_url.trim(), model: aiForm.model.trim() };
      if (aiForm.api_key.trim()) body.api_key = aiForm.api_key.trim();
      const res = await fetch(`${API}/api/v1/admin/ai/test`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
      const d = await res.json();
      setAiTest(d.ok ? { ok: true, msg: `Works — responded as "${d.model}"` } : { ok: false, msg: d.error || "Request failed" });
    } catch { setAiTest({ ok: false, msg: "Network error" }); }
    setAiTesting(false);
  };

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

  // ── Plan limits ────────────────────────────────────────────────────────────
  const loadPlans = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/admin/plans`, { headers: headers() });
      if (res.ok) {
        const rows: PlanLimitRow[] = await res.json();
        setPlans(rows);
        setPlanDraft(Object.fromEntries(rows.map(r => [r.plan, { ...r }])));
      } else setActionError(`Loading plans failed: HTTP ${res.status}`);
    } catch (e) {
      setActionError(`Loading plans failed: ${e instanceof Error ? e.message : "network error"}`);
    }
  }, [headers]);

  useEffect(() => { if (tab === "plans") loadPlans(); }, [tab, loadPlans]);

  const loadBuildConc = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/admin/build-config`, { headers: headers() });
      if (res.ok) { const d = await res.json(); setBuildConc(d.max_concurrent_builds); setBuildConcInput(String(d.max_concurrent_builds)); }
    } catch {}
  }, [headers]);
  useEffect(() => { if (tab === "plans" && buildConc === null) loadBuildConc(); }, [tab, buildConc, loadBuildConc]);

  const saveBuildConc = async () => {
    setBuildConcSaving(true);
    try {
      const res = await fetch(`${API}/api/v1/admin/build-config`, {
        method: "PUT", headers: headers(),
        body: JSON.stringify({ max_concurrent_builds: parseInt(buildConcInput) || 1 }),
      });
      if (res.ok) { const d = await res.json(); setBuildConc(d.max_concurrent_builds); setBuildConcInput(String(d.max_concurrent_builds)); }
    } catch {}
    setBuildConcSaving(false);
  };

  const savePlan = async (plan: string) => {
    const draft = planDraft[plan];
    if (!draft) return;
    setPlanSaving(plan);
    setPlanSaved(null);
    try {
      const res = await fetch(`${API}/api/v1/admin/plans/${plan}`, {
        method: "PUT", headers: headers(), body: JSON.stringify(draft),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { msg = (await res.json()).error || msg; } catch {}
        setActionError(`Saving ${plan} failed: ${msg}`);
        return;
      }
      setPlanSaved(plan);
      setTimeout(() => setPlanSaved(null), 2500);
      loadPlans();
    } catch (e) {
      setActionError(`Saving ${plan} failed: ${e instanceof Error ? e.message : "network error"}`);
    } finally {
      setPlanSaving(null);
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
      reloadProjects();
  };
  const redeployProject = async (id: string, name: string) => {
    if (!confirm(`Redeploy "${name}" from source?`)) return;
    if (await adminFetch(`${API}/api/v1/admin/projects/${id}/redeploy`, { method: "POST" }, `Redeploying ${name}`))
      setTimeout(() => reloadProjects(), 1500);
  };
  const sleepProject = async (id: string, name: string) => {
    if (!confirm(`Sleep "${name}" now?\n\nStops its container to free resources; it wakes automatically on the next HTTP request. Platform-local projects only.`)) return;
    if (await adminFetch(`${API}/api/v1/admin/projects/${id}/sleep`, { method: "POST" }, `Sleeping ${name}`))
      setTimeout(() => { reloadProjects(); loadDensity(); }, 1000);
  };
  const wakeProject = async (id: string, name: string) => {
    if (await adminFetch(`${API}/api/v1/admin/projects/${id}/wake`, { method: "POST" }, `Waking ${name}`))
      setTimeout(() => { reloadProjects(); loadDensity(); }, 1000);
  };
  const openMove = async (id: string) => {
    if (moveOpen === id) { setMoveOpen(null); return; }
    setMoveOpen(id);
    if (moveServers.length === 0) {
      try {
        const res = await fetch(`${API}/api/v1/admin/servers`, { headers: headers() });
        if (res.ok) setMoveServers(await res.json());
      } catch {}
    }
  };
  const moveProject = async (id: string, name: string, serverId: string, label: string) => {
    if (!confirm(`Move "${name}" to ${label}? It rebuilds on the new server — expect a brief downtime window while it does.`)) return;
    setMoveBusy(true);
    const ok = await adminFetch(`${API}/api/v1/admin/projects/${id}/move`, {
      method: "POST", body: JSON.stringify({ worker_server_id: serverId }),
    }, `Moving ${name} to ${label}`);
    setMoveBusy(false);
    if (ok) { setMoveOpen(null); setTimeout(() => reloadProjects(), 1500); }
  };
  const openMoveDb = async (id: string) => {
    if (moveDbOpen === id) { setMoveDbOpen(null); return; }
    setMoveDbOpen(id);
    if (moveServers.length === 0) {
      try {
        const res = await fetch(`${API}/api/v1/admin/servers`, { headers: headers() });
        if (res.ok) setMoveServers(await res.json());
      } catch {}
    }
  };
  const migrateDatabase = async (id: string, name: string, serverId: string, label: string) => {
    if (!confirm(`Migrate a copy of "${name}" to ${label}?\n\nThis provisions the database on ${label} and copies the data. Your ORIGINAL is left untouched — repoint your app to the new connection string, then delete the source once verified.`)) return;
    setMoveBusy(true);
    const ok = await adminFetch(`${API}/api/v1/admin/databases/${id}/move`, {
      method: "POST", body: JSON.stringify({ worker_server_id: serverId }),
    }, `Migrating ${name} to ${label}`);
    setMoveBusy(false);
    if (ok) { setMoveDbOpen(null); setActionError(`Migrating "${name}" to ${label} — copying data now. The original is untouched; find the new copy in this list once it finishes, repoint your app, then delete the source.`); }
  };
  const deleteProject = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? Cannot be undone.`)) return;
    setActionError("");
    try {
      const res = await fetch(`${API}/api/v1/admin/projects/${id}`, { method: "DELETE", headers: headers() });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { msg = (await res.json()).error || msg; } catch {}
        setActionError(`Deleting ${name} failed: ${msg}`);
        return;
      }
      // Delete still succeeded, but the container teardown may be unconfirmed
      // (unreachable BYOC host) — surface that so the admin can check.
      try { const d = await res.json(); if (d?.warning) alert(d.warning); } catch {}
      reloadProjects();
      loadStats();
    } catch (e) {
      setActionError(`Deleting ${name} failed: ${e instanceof Error ? e.message : "network error"}`);
    }
  };
  const deleteDatabase = async (id: string, name: string, email: string) => {
    if (!confirm(`Delete database "${name}" owned by ${email || "unknown"}?\n\nThis drops the database and its data permanently. Cannot be undone.`)) return;
    if (await adminFetch(`${API}/api/v1/admin/databases/${id}`, { method: "DELETE" }, `Deleting ${name}`)) {
      loadDatabases(dbSearch, dbType);
      loadStats();
    }
  };
  const reapOrphan = async (o: OrphanContainer) => {
    if (!confirm(`Force-remove orphan container "${o.name}" on ${o.server_label}?\n\nThis runs docker rm -f. Only do this if you're sure it has no owner.`)) return;
    setReaping(o.name);
    const ok = await adminFetch(`${API}/api/v1/admin/orphans/reap`,
      { method: "POST", body: JSON.stringify({ server_id: o.server_id, name: o.name }) },
      `Reaping ${o.name}`);
    setReaping(null);
    if (ok) { scanOrphans(); loadStats(); }
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

  const loadTunnelOverview = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/admin/tunnels/overview`, { headers: headers() });
      if (res.ok) setTunnelOverview(await res.json());
    } catch {}
  }, [headers]);
  // History aggregates are DB-backed: load when the tab opens, then every 30s
  // while it stays open (live sessions already refresh on the 15s cycle).
  useEffect(() => {
    if (tab !== "sessions") return;
    loadTunnelOverview();
    const t = setInterval(loadTunnelOverview, 30000);
    return () => clearInterval(t);
  }, [tab, loadTunnelOverview]);

  const loadEmailAnalytics = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/admin/email-verify/analytics`, { headers: headers() });
      if (res.ok) setEmailAnalytics(await res.json());
    } catch {}
  }, [headers]);
  useEffect(() => {
    if (tab !== "email") return;
    loadEmailAnalytics();
    const t = setInterval(loadEmailAnalytics, 30000);
    return () => clearInterval(t);
  }, [tab, loadEmailAnalytics]);

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

  const [editingServer, setEditingServer] = useState<string | null>(null);
  const [srvLabel, setSrvLabel] = useState("");
  const [srvRegion, setSrvRegion] = useState("");
  const [srvMaxProj, setSrvMaxProj] = useState("");
  const [srvMaxProjOrig, setSrvMaxProjOrig] = useState("");

  const saveServerMeta = async (id: string) => {
    if (await adminFetch(`${API}/api/v1/admin/servers/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        label: srvLabel, region: srvRegion,
        ...(srvMaxProj.trim() !== "" && srvMaxProj !== srvMaxProjOrig ? { max_projects: Math.max(0, parseInt(srvMaxProj, 10) || 0) } : {}),
      }),
    }, "Updating server")) {
      setEditingServer(null);
      loadServers();
    }
  };

  const setSelectable = async (id: string, selectable: boolean) => {
    if (await adminFetch(`${API}/api/v1/admin/servers/${id}/selectable`, {
      method: "PUT", body: JSON.stringify({ selectable }),
    }, "Updating server visibility"))
      loadServers();
  };

  const toggleServerBackups = async (id: string, enabled: boolean) => {
    if (await adminFetch(`${API}/api/v1/admin/servers/${id}/backups`, {
      method: "PUT", body: JSON.stringify({ enabled }),
    }, "Updating server backups"))
      loadServers();
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
    { id: "density", label: "Density" },
    { id: "seo", label: "SEO & LLM" },
    { id: "plans", label: "Plans" },
    { id: "users", label: "Users", badge: usersTotal },
    { id: "bans", label: "IP Bans", badge: ipBans.length || undefined },
    { id: "abuse", label: "Abuse Reports", badge: abuseReports.filter(r => r.status === "open").length || undefined },
    { id: "projects", label: "Projects", badge: projectsTotal },
    { id: "databases", label: "Databases" },
    { id: "orphans", label: "Orphans", badge: orphanScan?.orphans.length || undefined },
    { id: "sessions", label: "Tunnels", badge: sessions.length },
    { id: "infra", label: "Infrastructure" },
    { id: "backups", label: "Backups" },
    { id: "broadcast", label: "Broadcast" },
    { id: "vpn", label: "VPN Panel" },
    { id: "ai", label: "AI Model" },
  ];
  const badgeOf = (id: Tab): number | undefined => TABS.find(t => t.id === id)?.badge;

  return (
    <div>
      {/* Page Header */}
      <div className="flex items-start justify-between gap-3 mb-6 animate-fade-in-up">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">System</p>
          <h1 className="mt-1 text-[22px] sm:text-[26px] font-bold tracking-[-0.02em] flex items-center gap-2">
            <Shield className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
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
            className={`h-8 gap-1.5 text-xs ${autoRefresh ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400" : ""}`}
            onClick={() => setAutoRefresh(v => !v)}
            title={autoRefresh ? "Auto-refresh is on: stats update every 15 seconds. Click to pause." : "Auto-refresh is paused. Click to update stats every 15 seconds."}
            aria-pressed={autoRefresh}
          >
            <Radio className={`h-3 w-3 ${autoRefresh ? "animate-pulse" : ""}`} />
            <span className="hidden sm:inline">{autoRefresh ? "Live" : "Paused"}</span>
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" title="Refresh now" aria-label="Refresh now" onClick={() => { loadStats(); loadSessions(); }}>
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
      <SuspendDialog request={suspendAsk?.req ?? null} onCancel={() => setSuspendAsk(null)}
        onConfirm={async (reason, notify) => { const a = suspendAsk; if (!a) return; await a.run(reason, notify); setSuspendAsk(null); }} />
      {actionError && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          <span className="flex-1">{actionError}</span>
          <button onClick={() => setActionError("")} className="text-xs text-muted-foreground hover:text-foreground">
            Dismiss
          </button>
        </div>
      )}

      {/* Mobile tab bar — horizontal scroll of chips (sidebar is desktop-only) */}
      <div className="lg:hidden flex gap-1 mb-4 overflow-x-auto pb-1 border-b border-border/50">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t whitespace-nowrap transition-colors ${
              tab === t.id
                ? "text-foreground border-b-2 border-emerald-500 -mb-px"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            {t.badge !== undefined && t.badge > 0 && (
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                t.id === "sessions" && t.badge > 0
                  ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground"
              }`}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Two-column shell: grouped sidebar nav + content */}
      <div className="flex gap-6 items-start">
        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside className="hidden lg:block w-56 shrink-0 sticky top-4 self-start">
          <div className="relative mb-3">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
            <input
              value={navSearch}
              onChange={(e) => setNavSearch(e.target.value)}
              placeholder="Jump to…"
              className="w-full rounded-lg border border-border/60 bg-background/60 pl-8 pr-2 py-1.5 text-[13px] outline-none focus:border-foreground/30"
            />
          </div>
          <nav className="space-y-4 max-h-[calc(100vh-7rem)] overflow-y-auto pr-1">
            {NAV_GROUPS.map(group => {
              const q = navSearch.trim().toLowerCase();
              const items = q ? group.items.filter(it => it.label.toLowerCase().includes(q) || group.group.toLowerCase().includes(q)) : group.items;
              if (!items.length) return null;
              return (
                <div key={group.group}>
                  <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/50">{group.group}</p>
                  <div className="space-y-0.5">
                    {items.map(it => {
                      const Icon = it.icon;
                      const active = tab === it.id;
                      const badge = badgeOf(it.id);
                      return (
                        <button
                          key={it.id}
                          onClick={() => setTab(it.id)}
                          className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                            active
                              ? "bg-accent text-foreground"
                              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                          }`}
                        >
                          <Icon className={`h-4 w-4 shrink-0 ${active ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/70 group-hover:text-foreground"}`} />
                          <span className="flex-1 text-left truncate">{it.label}</span>
                          {badge !== undefined && badge > 0 && (
                            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                              it.id === "sessions"
                                ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                                : active ? "bg-background text-muted-foreground" : "bg-muted text-muted-foreground"
                            }`}>
                              {badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          {/* Live platform pulse — uses already-loaded stats, no extra fetch */}
          <div className="mt-4 rounded-xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/50">Pulse</p>
              <span className={`inline-flex items-center gap-1 text-[10px] ${autoRefresh ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                <Radio className={`h-2.5 w-2.5 ${autoRefresh ? "animate-pulse" : ""}`} />
                {autoRefresh ? "live" : "paused"}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-center">
              <div className="rounded-lg bg-background/50 py-1.5">
                <div className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{runningCount}</div>
                <div className="text-[9px] uppercase tracking-wide text-muted-foreground/70">running</div>
              </div>
              <div className="rounded-lg bg-background/50 py-1.5">
                <div className={`text-sm font-bold tabular-nums ${failedCount > 0 ? "text-red-500" : "text-muted-foreground"}`}>{failedCount}</div>
                <div className="text-[9px] uppercase tracking-wide text-muted-foreground/70">failed</div>
              </div>
              <div className="rounded-lg bg-background/50 py-1.5">
                <div className="text-sm font-bold tabular-nums">{sessions.length}</div>
                <div className="text-[9px] uppercase tracking-wide text-muted-foreground/70">live</div>
              </div>
            </div>
            {deploySuccessRate !== null && (
              <div className="mt-2">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                  <span>Deploy health</span><span className="tabular-nums">{deploySuccessRate}%</span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div className={`h-full rounded-full ${deploySuccessRate >= 90 ? "bg-emerald-500" : deploySuccessRate >= 70 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${deploySuccessRate}%` }} />
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* ── Content ──────────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">

      {/* ── OVERVIEW TAB ─────────────────────────────────────────────────── */}
      {tab === "overview" && (
        <div className="space-y-6">
          <OverviewDashboard apiBase={API} headers={headers} refreshKey={lastRefresh?.getTime()} onNavigate={(t) => setTab(t as Tab)} />

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
                            s.status === "active" ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/50"
                            : s.status === "draining" ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                            : "bg-red-500/20 text-red-600 dark:text-red-400"
                          }`}>{s.status}</Badge>
                          {s.is_local && <Badge variant="outline" className="text-[9px]">primary</Badge>}
                          {s.user_id && <Badge variant="outline" className="text-[9px] text-violet-600 dark:text-violet-400 border-violet-500/30">BYOC</Badge>}
                        </div>
                        <div className="text-right">
                          <span className="block text-[10px] text-muted-foreground font-mono">{s.host}</span>
                          <span className="block text-[9px] text-muted-foreground/60" title="Live metrics are probed from each host's /proc every 60s via heartbeat">
                            {s.status === "active" ? `measured ${agoShort(s.last_heartbeat)}` : "no recent probe"}
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <UtilBar label="RAM used" used={s.used_memory_mb} total={s.total_memory_mb} pct={memPct} unit="MB" />
                        <UtilBar label="Load (1m avg)" used={parseFloat(s.load_avg.toFixed(1))} total={s.total_cpu} pct={cpuPct} unit="cores" />
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
      {tab === "users" && (() => {
        const allOnPage = users.length > 0 && users.every(u => selectedUsers.has(u.id));
        const toggleAll = () => setSelectedUsers(allOnPage ? new Set() : new Set(users.map(u => u.id)));
        const toggleOne = (id: string) => setSelectedUsers(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
        const bulkBlock = async (blocked: boolean) => {
          const ids = [...selectedUsers].filter(id => { const u = users.find(x => x.id === id); return u && !u.is_admin && !!u.blocked !== blocked; });
          if (ids.length === 0) return;
          const apply = async (reason: string, notify: boolean) => {
            for (const id of ids) {
              await adminFetch(`${API}/api/v1/admin/users/${id}`, { method: "PUT", body: JSON.stringify({ blocked, blocked_reason: reason, notify }) }, blocked ? "Suspending" : "Unsuspending");
            }
            setSelectedUsers(new Set());
            reloadUsers();
          };
          if (!blocked) { if (confirm(`Unsuspend ${ids.length} account(s)?`)) await apply("", false); return; }
          setSuspendAsk({
            req: {
              title: `Suspend ${ids.length} account${ids.length === 1 ? "" : "s"}?`,
              description: "They won't be able to sign in or deploy. Their apps keep running — stop them from the Projects tab if needed.",
              defaultReason: "abuse", defaultNotify: true,
              confirmLabel: `Suspend ${ids.length}`,
            },
            run: apply,
          });
        };
        const f = userFacets;
        return (
        <div className="space-y-3">
          <div className="flex flex-col lg:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search email, name, IP, project or user ID…" className="pl-9 h-9 text-sm"
                value={userSearch} onChange={e => setUserSearch(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <select value={userPlanFilter} onChange={e => setUserPlanFilter(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Plan">
                <option value="all">All plans{f ? ` (${f.total})` : ""}</option>
                {["free", "hobby", "pro", "team"].map(pl => (
                  <option key={pl} value={pl}>{pl[0].toUpperCase() + pl.slice(1)}{f ? ` (${f.by_plan[pl] || 0})` : ""}</option>
                ))}
              </select>
              <select value={userSort} onChange={e => setUserSort(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Sort">
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="last_seen">Last seen</option>
                <option value="projects">Most projects</option>
                <option value="bandwidth">Most bandwidth</option>
                <option value="email">Email A–Z</option>
              </select>
            </div>
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            <FilterChip active={userStatus === "all"} onClick={() => setUserStatus("all")} count={f?.total}>All</FilterChip>
            <FilterChip active={userStatus === "active"} onClick={() => setUserStatus("active")} count={f ? f.total - f.suspended : undefined}>Active</FilterChip>
            <FilterChip active={userStatus === "flagged"} onClick={() => setUserStatus("flagged")} count={f?.flagged} tone="danger">Flagged</FilterChip>
            <FilterChip active={userStatus === "suspended"} onClick={() => setUserStatus("suspended")} count={f?.suspended} tone="warn">Suspended</FilterChip>
            <FilterChip active={userStatus === "unverified"} onClick={() => setUserStatus("unverified")} count={f?.unverified}>Unverified</FilterChip>
            <FilterChip active={userStatus === "admin"} onClick={() => setUserStatus("admin")} count={f?.admins}>Admins</FilterChip>
          </div>

          {selectedUsers.size > 0 && (
            <div className="flex items-center gap-2 flex-wrap rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
              <span className="font-medium">{selectedUsers.size} selected</span>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-amber-600 dark:text-amber-400" onClick={() => bulkBlock(true)}>
                <Ban className="h-3 w-3" /> Suspend
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-emerald-600 dark:text-emerald-400" onClick={() => bulkBlock(false)}>
                <UserCheck className="h-3 w-3" /> Unsuspend
              </Button>
              <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setSelectedUsers(new Set())}>Clear</button>
            </div>
          )}

          <div className="rounded-xl border border-border/60 overflow-hidden">
            <div className="hidden md:grid grid-cols-[28px_minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] gap-3 items-center px-3 py-2 bg-muted/30 border-b border-border/60 text-[10px] uppercase tracking-wide text-muted-foreground">
              <input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label="Select page" className="h-3.5 w-3.5" />
              <span>User</span><span>Projects</span><span>Usage</span><span>Location · seen</span><span className="text-right pr-1">Actions</span>
            </div>
            {usersLoading && users.length === 0 ? (
              <div className="flex items-center justify-center py-14 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : users.length === 0 ? (
              <div className="flex flex-col items-center py-14">
                <Users className="h-8 w-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">No users match these filters.</p>
              </div>
            ) : (
              <div className={`divide-y divide-border/50 transition-opacity ${usersLoading ? "opacity-60" : ""}`}>
                {users.map(u => (
                  <div key={u.id} className={`grid grid-cols-[28px_minmax(0,1fr)] md:grid-cols-[28px_minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] gap-x-3 gap-y-2 items-center px-3 py-2.5 ${selectedUsers.has(u.id) ? "bg-primary/5" : "hover:bg-muted/20"}`}>
                    <input type="checkbox" checked={selectedUsers.has(u.id)} onChange={() => toggleOne(u.id)} aria-label={`Select ${u.email}`} className="h-3.5 w-3.5 self-start mt-1 md:self-center md:mt-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium truncate max-w-[16rem]">{u.name || u.email.split("@")[0]}</span>
                        <Badge variant="outline" className={`text-[10px] ${PLAN_COLORS[u.plan] || ""}`}>{u.plan}</Badge>
                        {u.is_admin && <Badge className="text-[10px] gap-0.5 bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/50"><Crown className="h-2.5 w-2.5" /> Admin</Badge>}
                        {u.flagged && <Badge variant="outline" className="text-[10px] border-red-500/50 text-red-600 dark:text-red-400 gap-0.5"><Flag className="h-2.5 w-2.5" /> flagged</Badge>}
                        {u.blocked && <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-600 dark:text-amber-400" title={u.blocked_reason || ""}>suspended</Badge>}
                        {!u.email_verified && <Badge variant="outline" className="text-[10px] text-muted-foreground">unverified</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      {u.blocked && u.blocked_reason && <p className="text-[10px] text-amber-600/90 dark:text-amber-400/90 truncate" title={u.blocked_reason}>{u.blocked_reason}</p>}
                    </div>
                    <div className="col-start-2 md:col-start-auto text-xs text-muted-foreground flex md:block gap-3">
                      <span className="text-foreground tabular-nums">{u.projects}</span> project{u.projects === 1 ? "" : "s"}
                      <span className="md:block text-[10px]">{u.running} up{u.sleeping ? ` · ${u.sleeping} asleep` : ""}</span>
                    </div>
                    <div className="col-start-2 md:col-start-auto text-xs text-muted-foreground flex md:block gap-3">
                      <span className="tabular-nums text-foreground">{fmtBytes(u.bandwidth_bytes)}</span> <span className="text-[10px]">this month</span>
                      <span className="md:block text-[10px]">{u.key_count} API key{u.key_count === 1 ? "" : "s"}</span>
                    </div>
                    <div className="col-start-2 md:col-start-auto text-[11px] text-muted-foreground min-w-0">
                      <p className="truncate font-mono" title={`signup ${u.signup_ip || "?"}${u.last_login_ip ? ` · last ${u.last_login_ip}` : ""}`}>
                        {countryFlag(u.last_country || u.signup_country)} {u.last_login_ip || u.signup_ip || "—"}
                      </p>
                      <p className="text-[10px]">seen {timeAgo(u.last_seen_at)} · joined {new Date(u.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="col-start-2 md:col-start-auto flex items-center gap-0.5 md:justify-end">
                      <select value={u.plan} onChange={e => updateUser(u.id, { plan: e.target.value })}
                        className="h-7 rounded border border-input bg-background px-1.5 text-[11px]" aria-label="Plan">
                        <option value="free">Free</option><option value="hobby">Hobby</option>
                        <option value="pro">Pro</option><option value="team">Team</option>
                      </select>
                      <Button variant="ghost" size="sm" className="h-7 px-2" title="Show their projects"
                        onClick={() => { setProjectSearch(u.email); setProjectStatus("all"); setProjectServer("all"); setProjectPlan("all"); setProjectFlagged(false); setTab("projects"); }}>
                        <Rocket className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => updateUser(u.id, { is_admin: !u.is_admin })} title={u.is_admin ? "Remove admin" : "Make admin"}>
                        <Shield className={`h-3.5 w-3.5 ${u.is_admin ? "text-yellow-600 dark:text-yellow-400" : "text-muted-foreground"}`} />
                      </Button>
                      <Button variant="ghost" size="sm" className={`h-7 px-2 ${u.blocked ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}
                        title={u.blocked ? "Unsuspend account" : "Suspend account (block login + deploys)"}
                        onClick={() => {
                          if (u.blocked) { updateUser(u.id, { blocked: false }); return; }
                          setSuspendAsk({
                            req: {
                              title: `Suspend ${u.email}?`,
                              description: "They won't be able to sign in or deploy. Their apps keep running — stop them from the Projects tab if needed.",
                              defaultReason: "abuse", defaultNotify: true,
                            },
                            run: async (reason, notify) => { await updateUser(u.id, { blocked: true, blocked_reason: reason, notify }); },
                          });
                        }}>
                        {u.blocked ? <UserCheck className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                      </Button>
                      {u.signup_ip && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-orange-600 dark:text-orange-400" title={`Ban IP ${u.signup_ip}`}
                          onClick={() => banIP(u.signup_ip!, `abuse — user ${u.email}`)}>
                          <WifiOff className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground" title="AI credits & usage" onClick={() => openUserCredits(u.id, u.email)}>
                        <Sparkles className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:text-destructive" title="Delete user" onClick={() => deleteUser(u.id, u.email)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <Pager total={usersTotal} page={usersPage} pageSize={usersPageSize} onPage={setUsersPage} onPageSize={setUsersPageSize} loading={usersLoading} />
        </div>
        );
      })()}

      {/* ── PROJECTS TAB ─────────────────────────────────────────────────── */}
      {tab === "projects" && (
        <div className="space-y-3">
          {/* Controls */}
          <div className="flex flex-col lg:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search name, subdomain, repo, owner email or ID…" className="pl-9 h-9 text-sm"
                value={projectSearch} onChange={e => setProjectSearch(e.target.value)} />
            </div>
            <div className="flex gap-2 flex-wrap">
              <select value={projectServer} onChange={e => setProjectServer(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Server">
                <option value="all">All servers</option>
                {(projectFacets?.servers || []).map(sv => <option key={sv.id} value={sv.id}>{sv.label} ({sv.count})</option>)}
              </select>
              <select value={projectPlan} onChange={e => setProjectPlan(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Owner plan">
                <option value="all">All plans</option>
                <option value="free">Free</option><option value="hobby">Hobby</option>
                <option value="pro">Pro</option><option value="team">Team</option>
              </select>
              <select value={projectSort} onChange={e => setProjectSort(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Sort">
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="last_deploy">Last deployed</option>
                <option value="last_request">Last visited</option>
                <option value="bandwidth">Most bandwidth</option>
                <option value="name">Name A–Z</option>
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
          </div>

          {redeployResult && (
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-3 py-2">
              Queued {redeployResult.queued} of {redeployResult.total} projects
              {redeployResult.skipped > 0 ? ` (skipped ${redeployResult.skipped})` : ""}
              {" "}— deploys staggered 2s apart.
            </p>
          )}

          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            {([
              ["all", "All"], ["running", "Running"], ["sleeping", "Sleeping"], ["building", "Building"],
              ["crashed", "Crashed"], ["failed", "Failed"], ["stopped", "Stopped"], ["created", "Created"],
            ] as const).map(([k, label]) => {
              const n = k === "all" ? projectFacets?.total : projectFacets?.by_status[k] || 0;
              if (k !== "all" && k !== projectStatus && projectFacets && !n) return null;
              return (
                <FilterChip key={k} active={projectStatus === k} onClick={() => setProjectStatus(k)} count={n}
                  tone={k === "crashed" || k === "failed" ? "warn" : undefined}>{label}</FilterChip>
              );
            })}
            <FilterChip active={projectFlagged} onClick={() => setProjectFlagged(v => !v)} count={projectFacets?.flagged} tone="danger">
              <Flag className="h-3 w-3" /> Flagged
            </FilterChip>
          </div>

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
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium truncate max-w-[14rem]">{p.name}</span>
                        <Badge variant="outline" className={`text-[9px] shrink-0 ${p.status === "sleeping" ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/40" : STATUS_COLORS[p.status] || "bg-muted text-muted-foreground"}`}>
                          {p.status === "building" && <span className="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse inline-block mr-1" />}
                          {p.status}
                        </Badge>
                        {p.framework && <Badge variant="outline" className="text-[9px] shrink-0">{p.framework}</Badge>}
                        {p.deploy_source && p.deploy_source !== "git" && <Badge variant="outline" className="text-[9px] shrink-0">{p.deploy_source}</Badge>}
                        {p.flagged && <Badge variant="outline" className="text-[9px] shrink-0 border-red-500/50 text-red-600 dark:text-red-400 gap-0.5"><Flag className="h-2.5 w-2.5" /> flagged</Badge>}
                      </div>
                      <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[10px] text-muted-foreground">
                        <span className="font-mono">{p.subdomain}.deployzy.app</span>
                        <button className="hover:text-foreground hover:underline truncate max-w-[14rem]" title="Show this owner in Users"
                          onClick={() => { setUserSearch(p.user_email); setUserStatus("all"); setUserPlanFilter("all"); setTab("users"); }}>
                          {p.user_email || p.user_id.slice(0, 8)}
                        </button>
                        <span className={`inline-flex items-center rounded px-1 border text-[9px] ${PLAN_COLORS[p.user_plan] || "border-border/60"}`}>{p.user_plan}</span>
                        {p.user_blocked && <span className="text-amber-600 dark:text-amber-400">owner suspended</span>}
                        <span className="flex items-center gap-1"><Server className="h-2.5 w-2.5" />{p.server_label}{p.server_byoc ? " (BYOC)" : ""}</span>
                        {p.repo_url && (
                          <span className="flex items-center gap-1 truncate max-w-[16rem]">
                            <GitBranch className="h-2.5 w-2.5 shrink-0" />
                            {p.repo_url.replace(/^https?:\/\/[^/]+\//, "").replace(/\.git$/, "")}{p.branch ? `@${p.branch}` : ""}
                          </span>
                        )}
                        <span className="tabular-nums" title="Bandwidth this month">{fmtBytes(p.bandwidth_bytes)}</span>
                        <span title={p.last_request_at ? new Date(p.last_request_at).toLocaleString() : ""}>visited {timeAgo(p.last_request_at)}</span>
                        {p.last_deploy_at && (
                          <span className="flex items-center gap-1" title={new Date(p.last_deploy_at).toLocaleString()}>
                            <Clock className="h-2.5 w-2.5" />deployed {timeAgo(p.last_deploy_at)}
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
                      {p.status === "sleeping" && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-emerald-600 dark:text-emerald-400 hover:text-emerald-600"
                          onClick={() => wakeProject(p.id, p.name)} title="Wake now">
                          <Zap className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {p.status === "running" && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-indigo-500 hover:text-indigo-500"
                          onClick={() => sleepProject(p.id, p.name)} title="Sleep now (frees RAM; wakes on the next request)">
                          <Moon className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {p.status === "running" && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-amber-600 dark:text-amber-400 hover:text-amber-600 dark:hover:text-amber-600 dark:text-amber-400"
                          onClick={() => stopProject(p.id, p.name)} title="Stop">
                          <Square className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-foreground"
                        onClick={() => redeployProject(p.id, p.name)} title="Redeploy">
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm"
                        className={`h-7 px-2 ${moveOpen === p.id ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                        onClick={() => openMove(p.id)} title="Move to another server">
                        <Server className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:text-destructive"
                        onClick={() => deleteProject(p.id, p.name)} title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Move-to-server panel */}
                  {moveOpen === p.id && (
                    <div className="border-t border-border/50 bg-muted/20 px-3 py-3">
                      <p className="text-[11px] text-muted-foreground mb-2">Move <span className="font-medium text-foreground">{p.name}</span> to another server. It rebuilds on the target (brief downtime while it does).</p>
                      <div className="flex flex-wrap gap-1.5">
                        <button onClick={() => moveProject(p.id, p.name, "auto", "auto-select")} disabled={moveBusy}
                          className="text-[11px] px-2.5 py-1 rounded-md border border-input hover:border-foreground/30 disabled:opacity-50">
                          Auto-select
                        </button>
                        {moveServers.filter(s => s.status === "active").map(s => (
                          <button key={s.id} onClick={() => moveProject(p.id, p.name, s.id, s.label)} disabled={moveBusy}
                            className="text-[11px] px-2.5 py-1 rounded-md border border-input hover:border-foreground/30 disabled:opacity-50 flex items-center gap-1.5">
                            <span>{s.is_local ? "🖥️" : s.user_id ? "🔧" : "☁️"}</span>
                            {s.label} <span className="text-muted-foreground">({s.current_projects}/{s.max_projects})</span>
                          </button>
                        ))}
                        {moveServers.length === 0 && <span className="text-[11px] text-muted-foreground">Loading servers…</span>}
                      </div>
                    </div>
                  )}

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
                            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
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
              <Pager total={projectsTotal} page={projectsPage} pageSize={projectsPageSize} onPage={setProjectsPage} onPageSize={setProjectsPageSize} loading={projectsLoading} />
            </>
          )}
        </div>
      )}

      {/* ── IP BANS TAB ──────────────────────────────────────────────────── */}
      {tab === "bans" && (
        <div className="space-y-5 max-w-3xl">
          <div>
            <h2 className="text-lg font-semibold">IP Bans</h2>
            <p className="text-sm text-muted-foreground">Blocked IPs can&apos;t sign up, sign in, or reach any deployed app through the proxy. Use a trailing dot to ban a range (e.g. <span className="font-mono">203.0.113.</span>).</p>
          </div>

          <div className="flex gap-2 flex-wrap">
            <input
              value={banForm.ip}
              onChange={(e) => setBanForm((f) => ({ ...f, ip: e.target.value }))}
              placeholder="IP or prefix (203.0.113.45 or 203.0.113.)"
              className="h-9 flex-1 min-w-[220px] rounded-md border border-input bg-background px-3 text-sm font-mono"
            />
            <input
              value={banForm.reason}
              onChange={(e) => setBanForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="reason (optional)"
              className="h-9 flex-1 min-w-[160px] rounded-md border border-input bg-background px-3 text-sm"
            />
            <Button size="sm" className="h-9 gap-1.5" disabled={!banForm.ip.trim()}
              onClick={() => { const ip = banForm.ip.trim(); banIP(ip, banForm.reason.trim()); setBanForm({ ip: "", reason: "" }); }}>
              <Ban className="h-3.5 w-3.5" /> Ban
            </Button>
          </div>

          <div className="rounded-xl border border-border/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/50 bg-muted/30 flex items-center justify-between">
              <p className="text-sm font-medium">Banned ({ipBans.length})</p>
              <Button variant="ghost" size="sm" onClick={loadIPBans} className="h-7 gap-1 text-xs"><RefreshCw className="h-3 w-3" /> Refresh</Button>
            </div>
            {ipBans.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No IPs are banned.</p>
            ) : (
              <div className="divide-y divide-border/40">
                {ipBans.map((b) => (
                  <div key={b.ip} className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <span className="text-sm font-mono font-medium">{b.ip}</span>
                      {b.reason && <span className="text-[11px] text-muted-foreground ml-2">{b.reason}</span>}
                      <div className="text-[10px] text-muted-foreground">by {b.created_by || "—"} · {new Date(b.created_at).toLocaleString()}</div>
                    </div>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-emerald-600 dark:text-emerald-400 hover:text-emerald-600 text-xs" onClick={() => unbanIP(b.ip)}>
                      Unban
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ABUSE REPORTS TAB ────────────────────────────────────────────── */}
      {tab === "abuse" && (() => {
        const catColor: Record<string, string> = {
          phishing: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/40",
          illegal:  "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/40",
          malware:  "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/40",
          spam:     "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40",
          "proxy-node": "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/40",
          other:    "bg-zinc-500/15 text-muted-foreground border-zinc-500/40",
        };
        const statusColor: Record<string, string> = {
          open:      "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40",
          actioned:  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40",
          dismissed: "bg-zinc-500/15 text-muted-foreground border-zinc-500/40",
        };
        const shown = abuseReports.filter(r => abuseFilter === "all" || r.status === abuseFilter);
        const openCount = abuseReports.filter(r => r.status === "open").length;
        return (
        <div className="space-y-5 max-w-3xl">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2"><Flag className="h-4 w-4 text-red-600 dark:text-red-400" /> Abuse Reports</h2>
              <p className="text-sm text-muted-foreground">Public reports (via <span className="font-mono">/report</span>) plus automatic proxy-node detections from the scanner.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => { loadAbuseReports(); loadAbuseScan(); }} disabled={abuseLoading} className="gap-1.5">
              {abuseLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
            </Button>
          </div>

          {/* Proxy-node scanner */}
          <div className="rounded-xl border border-border/60 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Shield className="h-4 w-4 text-fuchsia-600 dark:text-fuchsia-400" /> Proxy-node scanner
                  {abuseScan?.scan.running && <Badge variant="outline" className="text-[10px] gap-1"><Loader2 className="h-2.5 w-2.5 animate-spin" /> scanning</Badge>}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Fingerprints running apps on every platform server for VPN/proxy kits (Xray, V2Ray, sing-box, Hysteria, cloudflared, Nezha). Runs every 6 hours.
                </p>
              </div>
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={runAbuseScan} disabled={abuseBusy === "scan" || !!abuseScan?.scan.running}>
                {abuseBusy === "scan" || abuseScan?.scan.running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Scan now
              </Button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="rounded-lg bg-muted/30 px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Last scan</p><p className="font-medium">{abuseScan?.scan.last_finished ? timeAgo(abuseScan.scan.last_finished) : "not yet"}</p></div>
              <div className="rounded-lg bg-muted/30 px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Hits</p><p className="font-medium tabular-nums">{abuseScan?.scan.hits ?? "—"} <span className="text-muted-foreground font-normal">on {abuseScan?.scan.hosts ?? "—"} hosts</span></p></div>
              <div className="rounded-lg bg-muted/30 px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">New reports</p><p className="font-medium tabular-nums">{abuseScan?.scan.new_reports ?? "—"}</p></div>
              <div className="rounded-lg bg-muted/30 px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Auto-suspended</p><p className="font-medium tabular-nums">{abuseScan?.scan.auto_suspended ?? "—"}</p></div>
            </div>
            <label className="flex items-start gap-3 rounded-lg border border-border/60 px-3 py-2.5 cursor-pointer">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={!!abuseScan?.auto_suspend} disabled={abuseBusy === "auto" || !abuseScan}
                onChange={e => setAutoSuspend(e.target.checked)} />
              <span className="text-xs">
                <span className="font-medium text-foreground">Auto-suspend confirmed proxy nodes</span>
                <span className="block text-muted-foreground">Free accounts whose app contains a proxy server or Nezha agent (by binary fingerprint) are suspended and stopped automatically. Tunnel-only hits and paid accounts always wait for review.</span>
              </span>
            </label>
          </div>

          <div className="flex gap-1.5 flex-wrap">
            {(["open", "actioned", "dismissed", "all"] as const).map((f) => (
              <button key={f} onClick={() => setAbuseFilter(f)}
                className={`h-7 px-3 rounded-full text-xs capitalize border transition-colors ${
                  abuseFilter === f ? "bg-primary text-primary-foreground border-primary" : "border-border/60 text-muted-foreground hover:bg-muted/40"
                }`}>
                {f}{f === "open" && openCount > 0 ? ` (${openCount})` : ""}
              </button>
            ))}
          </div>

          {abuseLoading && abuseReports.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : shown.length === 0 ? (
            <div className="rounded-xl border border-border/60 px-4 py-12 text-center text-sm text-muted-foreground">
              {abuseFilter === "open" ? "No open reports. 🎉" : `No ${abuseFilter} reports.`}
            </div>
          ) : (
            <div className="space-y-3">
              {shown.map((r) => (
                <div key={r.id} className="rounded-xl border border-border/60 p-4 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={`text-[10px] capitalize ${catColor[r.category] || catColor.other}`}>{r.category}</Badge>
                    <Badge variant="outline" className={`text-[10px] capitalize ${statusColor[r.status] || statusColor.open}`}>{r.status}</Badge>
                    <span className="text-[11px] text-muted-foreground ml-auto">{new Date(r.created_at).toLocaleString()}</span>
                  </div>
                  {/* Reported URL is shown as plain selectable text, never a link —
                      it may point to a live phishing/malware page. */}
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Reported URL</p>
                    <p className="text-sm font-mono break-all select-all">{r.target_url || "—"}</p>
                  </div>
                  {r.details && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Details</p>
                      <p className="text-sm whitespace-pre-wrap break-words">{r.details}</p>
                    </div>
                  )}
                  {r.project_id && (
                    <div className="flex items-center gap-2 flex-wrap rounded-lg bg-muted/30 px-3 py-2 text-xs">
                      <Rocket className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium">{r.project_name}</span>
                      {r.project_status && <Badge variant="outline" className={`text-[9px] ${STATUS_COLORS[r.project_status] || ""}`}>{r.project_status}</Badge>}
                      <span className="text-muted-foreground">owned by</span>
                      <span className="font-medium truncate max-w-[16rem]">{r.owner_email}</span>
                      {r.owner_plan && <Badge variant="outline" className={`text-[9px] ${PLAN_COLORS[r.owner_plan] || ""}`}>{r.owner_plan}</Badge>}
                      {r.owner_blocked && <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-600 dark:text-amber-400">suspended</Badge>}
                      {r.owner_is_admin && <Badge variant="outline" className="text-[9px]">admin</Badge>}
                    </div>
                  )}
                  <div className="text-[11px] text-muted-foreground">
                    Reporter: {r.reporter_email || "anonymous"}{r.reporter_ip ? <> · <span className="font-mono">{r.reporter_ip}</span></> : null}
                  </div>
                  <div className="flex gap-2 flex-wrap pt-1">
                    {r.project_id && !r.owner_is_admin && !(r.owner_blocked && r.project_status === "stopped") && (
                      <Button size="sm" variant="destructive" className="h-8 gap-1.5 text-xs" disabled={abuseBusy === r.id} onClick={() => suspendFromReport(r)}>
                        {abuseBusy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} Suspend owner &amp; stop app
                      </Button>
                    )}
                    {r.status !== "actioned" && (
                      <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setAbuseStatus(r.id, "actioned")}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Mark actioned
                      </Button>
                    )}
                    {r.status !== "dismissed" && (
                      <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setAbuseStatus(r.id, "dismissed")}>
                        <X className="h-3.5 w-3.5" /> Dismiss
                      </Button>
                    )}
                    {r.status !== "open" && (
                      <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={() => setAbuseStatus(r.id, "open")}>
                        <RotateCcw className="h-3.5 w-3.5" /> Reopen
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        );
      })()}

      {/* ── DENSITY TAB ──────────────────────────────────────────────────── */}
      {tab === "density" && (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold">Density &amp; Idle Sleep</h2>
              <p className="text-sm text-muted-foreground">Real vs reserved memory per box, and idle sleep/wake activity.</p>
            </div>
            <Button variant="outline" size="sm" onClick={loadDensity} disabled={densityLoading} className="gap-1.5">
              {densityLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
            </Button>
          </div>

          {!density ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {(() => {
                  const savedGB = (density.sleeping_memory_mb / 1024).toFixed(1);
                  const cards = [
                    { label: "Sleeping now", value: density.sleeping_count, sub: `${savedGB} GB reserved freed`, accent: "text-indigo-500" },
                    { label: "Reserved (platform)", value: `${density.reserved_pct}%`, sub: `${(density.allocated_memory_mb/1024).toFixed(1)} / ${(density.total_memory_mb/1024).toFixed(1)} GB`, accent: density.reserved_pct > 90 ? "text-amber-600 dark:text-amber-400" : "text-foreground" },
                    { label: "Actually used", value: `${density.used_pct}%`, sub: `${(density.used_memory_mb/1024).toFixed(1)} GB real RAM`, accent: density.used_pct > 80 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400" },
                    { label: "Idle & awake", value: density.eligible_awake, sub: "free/local, >30m idle", accent: "text-muted-foreground" },
                  ];
                  return cards.map((c) => (
                    <div key={c.label} className="rounded-xl border border-border/60 bg-card/40 p-4">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{c.label}</p>
                      <p className={`mt-1 text-2xl font-semibold ${c.accent}`}>{c.value}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{c.sub}</p>
                    </div>
                  ));
                })()}
              </div>

              {/* Per-server memory: reserved vs actually used */}
              <div className="rounded-xl border border-border/60 overflow-hidden">
                <div className="px-4 py-3 border-b border-border/50 bg-muted/30">
                  <p className="text-sm font-medium">Memory: reserved vs actually used</p>
                  <p className="text-[11px] text-muted-foreground">The gap (grey→green) is idle headroom the usage-aware scheduler can pack into.</p>
                </div>
                <div className="divide-y divide-border/40">
                  {density.servers.map((s) => (
                    <div key={s.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <Server className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-sm font-medium truncate">{s.label}</span>
                          {s.is_local && <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">primary</span>}
                          <span className={`text-[9px] px-1.5 py-0.5 rounded ${s.status === "active" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>{s.status}</span>
                          {s.sleeping_count > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-500">{s.sleeping_count} asleep</span>}
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono">
                          {s.current_projects}/{s.max_projects || "∞"} proj · load {s.load_avg.toFixed(2)}
                        </div>
                      </div>
                      {/* stacked bar: used (green) within reserved (grey) within total */}
                      <div className="relative h-3 w-full rounded-full bg-muted/50 overflow-hidden">
                        <div className="absolute inset-y-0 left-0 bg-muted-foreground/25" style={{ width: `${Math.min(100, s.reserved_pct)}%` }} title={`reserved ${s.reserved_pct}%`} />
                        <div className={`absolute inset-y-0 left-0 ${s.used_pct > 80 ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, s.used_pct)}%` }} title={`used ${s.used_pct}%`} />
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span><span className="text-emerald-600 dark:text-emerald-400 font-medium">{s.used_pct}%</span> used · <span className="text-foreground">{s.reserved_pct}%</span> reserved</span>
                        <span>{(s.reclaimable_mb/1024).toFixed(1)} GB reserved-but-idle · {(s.total_memory_mb/1024).toFixed(1)} GB total</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sleeping projects */}
              <div className="rounded-xl border border-border/60 overflow-hidden">
                <div className="px-4 py-3 border-b border-border/50 bg-muted/30 flex items-center justify-between">
                  <p className="text-sm font-medium">Currently sleeping ({density.sleeping_count})</p>
                  <p className="text-[11px] text-muted-foreground">Wakes on next request</p>
                </div>
                {density.sleeping_projects.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">No projects are asleep right now.</p>
                ) : (
                  <div className="divide-y divide-border/40">
                    {density.sleeping_projects.map((p) => (
                      <div key={p.id} className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <span className="text-sm font-medium">{p.subdomain}</span>
                          <span className="text-[11px] text-muted-foreground ml-2">{p.email}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[11px] text-muted-foreground font-mono">
                            {p.memory_mb} MB freed · slept {p.slept_at ? new Date(p.slept_at).toLocaleString() : "—"}
                          </span>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-emerald-600 dark:text-emerald-400 hover:text-emerald-600 text-xs gap-1"
                            onClick={() => wakeProject(p.id, p.subdomain)} title="Wake now">
                            <Zap className="h-3 w-3" /> Wake
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── SEO & LLM TAB ────────────────────────────────────────────────── */}
      {tab === "website" && <WebsiteAnalytics />}

      {tab === "seo" && (
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <p className="text-xs text-muted-foreground max-w-2xl">
              How <span className="font-medium text-foreground">deployzy.com</span> is doing on search engines and with AI
              assistants — which crawlers read our pages and where human visitors come from. From the web server log,
              counting <span className="font-medium text-foreground">successful page views only</span> (no assets, redirects or 404s);
              scanners and scripts are kept separate. Last 30 days{seo?.data_since ? <> · accurate data since {new Date(seo.data_since + "T00:00:00").toLocaleDateString()}</> : null}.
            </p>
            <Button size="sm" variant="outline" className="h-9 text-xs gap-1 shrink-0"
              onClick={loadSEO} disabled={seoLoading}>
              {seoLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Refresh
            </Button>
          </div>

          {seoLoading && !seo ? (
            <p className="text-sm text-muted-foreground py-10 text-center">Loading…</p>
          ) : !seo ? null : !seo.has_data ? (
            <div className="flex flex-col items-center py-12 text-center">
              <Globe className="h-8 w-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground max-w-md">No data yet. Tracking just started — crawler hits and
                referrals will appear here as traffic comes in (usually within a day).</p>
            </div>
          ) : (
            <>
              {/* Headline cards */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                {[
                  { label: "Human page views", value: seo.totals.human_pageviews, hint: "real visitors, all sources", color: "text-foreground bg-muted" },
                  { label: "AI crawler page reads", value: seo.totals.ai_crawler_hits, hint: "GPTBot, ClaudeBot, PerplexityBot…", color: "text-violet-600 dark:text-violet-400 bg-violet-500/15" },
                  { label: "Search crawler page reads", value: seo.totals.search_crawler_hits, hint: "Googlebot, Bingbot…", color: "text-sky-600 dark:text-sky-400 bg-sky-500/15" },
                  { label: "Visits from AI answers", value: seo.totals.llm_referral_hits, hint: "ChatGPT, Perplexity, Claude…", color: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/15" },
                  { label: "Visits from search", value: seo.totals.search_referral_hits, hint: "Google, Bing, DuckDuckGo…", color: "text-amber-600 dark:text-amber-400 bg-amber-500/15" },
                ].map(c => (
                  <div key={c.label} className="rounded-xl border border-border/60 p-4">
                    <div className={`inline-flex h-7 w-7 items-center justify-center rounded-lg mb-2 ${c.color}`}>
                      <TrendingUp className="h-3.5 w-3.5" />
                    </div>
                    <div className="text-2xl font-bold">{c.value.toLocaleString()}</div>
                    <div className="text-xs font-medium mt-0.5">{c.label}</div>
                    <div className="text-[10px] text-muted-foreground">{c.hint}</div>
                  </div>
                ))}
              </div>

              {/* Daily trend: human page views vs crawler reads */}
              {seo.trend.length > 1 && (() => {
                const max = Math.max(1, ...seo.trend.map(d => Math.max(d.pageviews, d.ai_crawls + d.search_crawls)));
                return (
                  <div className="rounded-xl border border-border/60 p-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                      <p className="text-xs font-semibold">Daily activity</p>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-foreground/70" /> human page views</span>
                        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-violet-500/70" /> AI crawls</span>
                        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-sky-500/70" /> search crawls</span>
                      </div>
                    </div>
                    <div className="flex h-28 items-end gap-1">
                      {seo.trend.map(d => (
                        <div key={d.day} className="flex h-full flex-1 items-end gap-px" title={`${d.day}: ${d.pageviews} page views · ${d.ai_crawls} AI · ${d.search_crawls} search crawls · ${d.referrals} referrals`}>
                          <div className="flex-1 rounded-t bg-foreground/70" style={{ height: `${Math.max(d.pageviews ? 3 : 1, (d.pageviews / max) * 100)}%` }} />
                          <div className="flex-1 flex flex-col justify-end h-full">
                            <div className="rounded-t bg-violet-500/70" style={{ height: `${(d.ai_crawls / max) * 100}%` }} />
                            <div className="bg-sky-500/70" style={{ height: `${(d.search_crawls / max) * 100}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground tabular-nums">
                      <span>{new Date(seo.trend[0].day + "T00:00:00").toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                      <span>{new Date(seo.trend[seo.trend.length - 1].day + "T00:00:00").toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                    </div>
                  </div>
                );
              })()}

              {/* Tips */}
              {seo.tips.length > 0 && (
                <div className="space-y-1.5">
                  {seo.tips.map((t, i) => {
                    const tone = t.tone === "good" ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300"
                      : t.tone === "warn" ? "border-amber-500/30 bg-amber-500/[0.06] text-amber-700 dark:text-amber-300"
                      : "border-border/60 bg-muted/30 text-muted-foreground";
                    const Icon = t.tone === "good" ? CheckCircle2 : t.tone === "warn" ? AlertCircle : Zap;
                    return (
                      <div key={i} className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs ${tone}`}>
                        <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>{t.text}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Two columns: crawlers + referrals */}
              <div className="grid md:grid-cols-2 gap-4">
                {[
                  { title: "Crawlers reading our pages", rows: seo.crawlers, empty: "No crawlers recorded yet." },
                  { title: "Where human visitors come from", rows: seo.referrals, empty: "No referral traffic recorded yet." },
                ].map(col => (
                  <div key={col.title} className="rounded-xl border border-border/60 overflow-hidden">
                    <div className="px-3 py-2.5 border-b border-border/60 text-xs font-semibold">{col.title}</div>
                    {col.rows.length === 0 ? (
                      <p className="px-3 py-6 text-center text-xs text-muted-foreground">{col.empty}</p>
                    ) : (
                      <div className="divide-y divide-border/40">
                        {col.rows.map(row => (
                          <div key={row.channel + row.name} className="flex items-center gap-2 px-3 py-2">
                            <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-medium shrink-0 ${
                              row.channel === "ai" || row.channel === "llm" ? "bg-violet-500/15 text-violet-600 dark:text-violet-400"
                              : row.channel === "search" ? "bg-sky-500/15 text-sky-600 dark:text-sky-400"
                              : row.channel === "social" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                              : "bg-muted text-muted-foreground"}`}>
                              {row.channel === "llm" ? "AI" : row.channel}
                            </span>
                            <span className="text-sm flex-1 min-w-0 truncate">{row.name}</span>
                            {row.recent > 0 && <span className="text-[10px] text-emerald-600 dark:text-emerald-400" title="last 7 days">+{row.recent.toLocaleString()} · 7d</span>}
                            <span className="text-sm font-medium tabular-nums">{row.hits.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {/* Scanners & scripts — excluded from everything above */}
              {(seo.probes?.length ?? 0) > 0 && (
                <details className="rounded-xl border border-border/60 overflow-hidden group">
                  <summary className="flex items-center justify-between gap-3 px-3 py-2.5 cursor-pointer text-xs">
                    <span className="font-semibold">Scanners &amp; scripts <span className="font-normal text-muted-foreground">— excluded from the numbers above</span></span>
                    <span className="text-muted-foreground tabular-nums">{(seo.totals.probe_hits + seo.totals.script_hits).toLocaleString()} requests</span>
                  </summary>
                  <div className="divide-y divide-border/40 border-t border-border/60">
                    {seo.probes.slice(0, 12).map(row => (
                      <div key={row.channel + row.name} className="flex items-center gap-2 px-3 py-2">
                        <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-medium shrink-0 ${row.channel === "scanner" ? "bg-red-500/10 text-red-600 dark:text-red-400" : "bg-muted text-muted-foreground"}`}>
                          {row.channel === "scanner" ? "404 probe" : "script"}
                        </span>
                        <span className="text-sm flex-1 min-w-0 truncate">{row.name}</span>
                        <span className="text-sm font-medium tabular-nums">{row.hits.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      )}

      {/* ── DATABASES TAB ────────────────────────────────────────────────── */}
      {tab === "databases" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, type, owner email..."
                className="pl-9 h-9 text-sm"
                value={dbSearch}
                onChange={e => setDbSearch(e.target.value)}
              />
            </div>
            <select
              value={dbType}
              onChange={e => setDbType(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">All engines</option>
              <option value="postgres">PostgreSQL</option>
              <option value="redis">Redis</option>
              <option value="mongodb">MongoDB</option>
              <option value="mysql">MySQL</option>
            </select>
          </div>

          <div className="text-xs text-muted-foreground">
            {databasesTotal} databases total
            {databases.length > 0 && (() => {
              const mb = databases.reduce((n, d) => n + (d.service.size_mb || 0), 0);
              return <> · {mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb} MB`} on this page · sizes refresh every 5 min</>;
            })()}
          </div>

          {databasesLoading && databases.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
          ) : databases.length === 0 ? (
            <div className="flex flex-col items-center py-12">
              <Database className="h-8 w-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No databases found.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {databases.map(d => {
                const svc = d.service;
                const location = d.server_label
                  ? d.server_label
                  : svc.worker_server_id ? "BYOC server" : "Deployzy platform";
                const revealed = dbReveal === svc.id;
                return (
                  <div key={svc.id} className="rounded-lg border border-border/50">
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{svc.name}</span>
                          <Badge variant="outline" className="text-[9px] shrink-0 uppercase">{svc.type}</Badge>
                          <Badge variant="outline" className={`text-[9px] shrink-0 ${STATUS_COLORS[svc.status] || "bg-muted text-muted-foreground"}`}>
                            {svc.status}
                          </Badge>
                          {svc.over_quota && <Badge variant="outline" className="text-[9px] shrink-0 bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30">over quota</Badge>}
                        </div>
                        <div className="flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground">
                          <span className="text-muted-foreground/80">{d.user_email || svc.user_id.slice(0, 8)}</span>
                          <span className="flex items-center gap-1"><Server className="h-2.5 w-2.5" />{location}</span>
                          <span className="flex items-center gap-1"><HardDrive className="h-2.5 w-2.5" />{svc.size_mb} MB</span>
                          <span className="flex items-center gap-1"><Clock className="h-2.5 w-2.5" />{new Date(svc.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <Button variant="ghost" size="sm"
                          className={`h-7 px-2 ${revealed ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                          onClick={() => setDbReveal(revealed ? null : svc.id)}
                          title={revealed ? "Hide connection string" : "Reveal connection string"}>
                          {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </Button>
                        <a
                          href={svc.type === "redis" ? `/redis/${svc.id}` : svc.type === "mongodb" ? `/mongo/${svc.id}` : `/database/${svc.id}?type=${svc.type}`}
                          target="_blank" rel="noopener noreferrer"
                          className="flex h-7 items-center rounded-md px-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                          title="Open data browser (admin)">
                          <FolderOpen className="h-3.5 w-3.5" />
                        </a>

                        {svc.type !== "redis" && (
                          <Button variant="ghost" size="sm"
                            className={`h-7 px-2 ${moveDbOpen === svc.id ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                            onClick={() => openMoveDb(svc.id)} title="Migrate to another server">
                            <Server className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:text-destructive"
                          onClick={() => deleteDatabase(svc.id, svc.name, d.user_email)} title="Delete">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {moveDbOpen === svc.id && (
                      <div className="border-t border-border/50 bg-muted/20 px-3 py-3">
                        <p className="text-[11px] text-muted-foreground mb-2">Migrate <span className="font-medium text-foreground">{svc.name}</span> to another server. It provisions the DB there and copies the data — your <span className="font-medium">original stays untouched</span> (repoint your app, then delete the source when verified).</p>
                        <div className="flex flex-wrap gap-1.5">
                          {moveServers.filter(s => s.status === "active" && s.docker_installed !== false).map(s => (
                            <button key={s.id} onClick={() => migrateDatabase(svc.id, svc.name, s.id, s.label)} disabled={moveBusy}
                              className="text-[11px] px-2.5 py-1 rounded-md border border-input hover:border-foreground/30 disabled:opacity-50 flex items-center gap-1.5">
                              <span>{s.is_local ? "🖥️" : s.user_id ? "🔧" : "☁️"}</span>{s.label}
                            </button>
                          ))}
                          {moveServers.length === 0 && <span className="text-[11px] text-muted-foreground">Loading servers…</span>}
                        </div>
                      </div>
                    )}

                    {revealed && (
                      <div className="border-t border-border/50 bg-muted/20 px-3 py-2.5 space-y-1.5">
                        {[["Internal", d.connection_url], ["External", d.external_connection_url]].map(([label, url]) => (
                          <div key={label} className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground w-14 shrink-0">{label}</span>
                            <code className="flex-1 min-w-0 truncate text-[11px] font-mono bg-background rounded px-2 py-1 border border-border/50">{url || "—"}</code>
                            {url && (
                              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-muted-foreground hover:text-foreground"
                                onClick={() => navigator.clipboard.writeText(url)} title="Copy">
                                <Copy className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── ORPHANS TAB ──────────────────────────────────────────────────── */}
      {tab === "orphans" && (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <p className="text-xs text-muted-foreground max-w-2xl">
              Containers named <code className="font-mono">sm-*</code> that exist on a host but have no owning
              project or database in the database — usually left behind when something was deleted while its
              server was unreachable. They quietly consume resources until removed here.
            </p>
            <Button size="sm" variant="outline" className="h-9 text-xs gap-1 shrink-0"
              onClick={scanOrphans} disabled={orphanLoading}>
              {orphanLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Rescan hosts
            </Button>
          </div>

          {orphanScan && (
            <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
              <span>{orphanScan.hosts_scanned} host{orphanScan.hosts_scanned === 1 ? "" : "s"} scanned</span>
              {orphanScan.scanned_at && <span>· {new Date(orphanScan.scanned_at).toLocaleTimeString()}</span>}
              {orphanScan.unreachable_hosts.length > 0 && (
                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-3 w-3" />
                  Unreachable: {orphanScan.unreachable_hosts.join(", ")} (scan may be incomplete)
                </span>
              )}
            </div>
          )}

          {orphanLoading && !orphanScan ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Scanning every host for orphan containers…
            </div>
          ) : !orphanScan || orphanScan.orphans.length === 0 ? (
            <div className="flex flex-col items-center py-12">
              <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400/50 mb-2" />
              <p className="text-sm text-muted-foreground">No orphan containers found. Every running container has an owner.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {orphanScan.orphans.map(o => (
                <div key={`${o.server_id}-${o.name}`} className="rounded-lg border border-amber-500/30 bg-amber-500/[0.04]">
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-sm font-mono font-medium">{o.name}</code>
                        <Badge variant="outline" className={`text-[9px] shrink-0 ${o.state === "running" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" : "bg-muted text-muted-foreground"}`}>
                          {o.state || "unknown"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1"><Server className="h-2.5 w-2.5" />{o.server_label}</span>
                        {o.status && <span>{o.status}</span>}
                        {o.created_at && <span className="flex items-center gap-1"><Clock className="h-2.5 w-2.5" />{o.created_at}</span>}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:text-destructive shrink-0"
                      onClick={() => reapOrphan(o)} disabled={reaping === o.name} title="Force remove">
                      {reaping === o.name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── LIVE SESSIONS TAB ────────────────────────────────────────────── */}
      {tab === "sessions" && (() => {
        const liveTunnels = sessions.reduce((n, s) => n + s.tunnels.filter(t => t.active !== false).length, 0);
        const liveUsers = new Set(sessions.map(s => s.user_id || s.client_id)).size;
        const liveBytes = sessions.reduce((n, s) => n + (s.stats ? s.stats.bytes_in + s.stats.bytes_out : 0), 0);
        const liveReqs = sessions.reduce((n, s) => n + (s.stats?.requests ?? 0), 0);
        const ov = tunnelOverview;
        const maxDay = Math.max(1, ...(ov?.daily ?? []).map(d => d.sessions));
        const hq = historyFilter.trim().toLowerCase();
        const recent = (ov?.recent ?? []).filter(r => !hq ||
          r.email.toLowerCase().includes(hq) || r.remote_ip.includes(hq) ||
          r.tunnel_urls.some(u => u.toLowerCase().includes(hq)));
        const protoCls = (p: string) =>
          p === "http" ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/40"
          : p === "tcp" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40"
          : "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/40";
        return (
        <div className="space-y-5">
          {/* KPI row: live now + history */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiCard label="Live clients" value={sessions.length} sub={`${liveUsers} user${liveUsers !== 1 ? "s" : ""}`}
              icon={<Radio className="h-4 w-4" />} color="text-emerald-600 dark:text-emerald-400 bg-emerald-500/20" bar="bg-emerald-500" />
            <KpiCard label="Live tunnels" value={liveTunnels} sub="open right now"
              icon={<Link2 className="h-4 w-4" />} color="text-blue-600 dark:text-blue-400 bg-blue-500/20" bar="bg-blue-500" delay={40} />
            <KpiCard label="Live traffic" value={formatBytes(liveBytes)} sub={`${liveReqs.toLocaleString()} requests`}
              icon={<Activity className="h-4 w-4" />} color="text-violet-600 dark:text-violet-400 bg-violet-500/20" bar="bg-violet-500" delay={80} />
            <KpiCard label="Sessions today" value={ov?.today.sessions ?? "—"} sub={ov ? `${ov.today.unique_users} unique user${ov.today.unique_users !== 1 ? "s" : ""}` : undefined}
              icon={<Clock className="h-4 w-4" />} color="text-amber-600 dark:text-amber-400 bg-amber-500/20" bar="bg-amber-500" delay={120} />
            <KpiCard label="Users (7d)" value={ov?.week.unique_users ?? "—"} sub={ov ? `${ov.week.sessions} sessions` : undefined}
              icon={<UserCheck className="h-4 w-4" />} color="text-cyan-600 dark:text-cyan-400 bg-cyan-500/20" bar="bg-cyan-500" delay={160} />
            <KpiCard label="Traffic (7d)" value={ov ? formatBytes(ov.week.bytes) : "—"} sub={ov ? `${ov.week.requests.toLocaleString()} requests` : undefined}
              icon={<BarChart3 className="h-4 w-4" />} color="text-pink-600 dark:text-pink-400 bg-pink-500/20" bar="bg-pink-500" delay={200} />
          </div>

          {/* 14-day activity */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" /> Tunnel sessions · last 14 days
              </CardTitle>
            </CardHeader>
            <CardContent>
              {ov ? (
                <div className="flex h-28 items-end gap-1.5">
                  {ov.daily.map(d => (
                    <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end">
                      <div
                        className="w-full rounded-t bg-emerald-500/70 transition-colors group-hover:bg-emerald-500"
                        style={{ height: `${d.sessions === 0 ? 2 : Math.max(6, (d.sessions / maxDay) * 100)}%`, opacity: d.sessions === 0 ? 0.25 : 1 }}
                      />
                      <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border/60 bg-background px-2 py-1 text-[10px] shadow-sm group-hover:block">
                        <div className="font-medium">{new Date(d.day + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
                        <div className="text-muted-foreground">{d.sessions} sessions · {d.users} users · {formatBytes(d.bytes)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <div className="h-28 animate-pulse rounded-md bg-muted/20" />}
              {ov && (
                <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground/70">
                  <span>{new Date(ov.daily[0]?.day + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                  <span>today</span>
                </div>
              )}
              <p className="mt-2 text-[10px] text-muted-foreground/60">History starts from when session tracking was enabled.</p>
            </CardContent>
          </Card>

          {/* Live sessions */}
          <div className="space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <h3 className="text-sm font-semibold flex items-center gap-2 mr-auto">
                <span className={`h-2 w-2 rounded-full ${sessions.length > 0 ? "bg-emerald-500 animate-pulse" : "bg-zinc-500"}`} />
                Live now
                <span className="text-xs font-normal text-muted-foreground">
                  {sessionsRefresh && <>· refreshed {sessionsRefresh.toLocaleTimeString()}</>}
                  {autoRefresh && <> · every 15s</>}
                </span>
              </h3>
              <div className="relative sm:w-72">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Filter by email, client ID, or URL..." className="pl-9 h-9 text-sm"
                  value={sessionSearch} onChange={e => setSessionSearch(e.target.value)} />
              </div>
              <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => { loadSessions(); loadTunnelOverview(); }} disabled={sessionsLoading}>
                <RefreshCw className={`h-3.5 w-3.5 ${sessionsLoading ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>

            {filteredSessions.length === 0 ? (
              <div className="flex flex-col items-center rounded-xl border border-dashed border-border/60 py-10">
                <WifiOff className="h-8 w-8 text-muted-foreground/25 mb-2" />
                <p className="text-sm text-muted-foreground">
                  {sessionSearch ? "No sessions match your filter." : "No one has a tunnel open right now."}
                </p>
              </div>
            ) : filteredSessions.map(session => (
              <div key={session.client_id} className="rounded-xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> connected {fmtDuration(session.connected_at)}
                      </span>
                      <span className="text-sm font-medium truncate">
                        {session.user_email || <span className="font-mono text-xs text-muted-foreground">static token</span>}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[11px] text-muted-foreground">
                      <span className="font-mono">{session.remote_addr.replace(/:\d+$/, "")}</span>
                      {session.client_version && <span>CLI v{session.client_version}{session.os ? ` · ${session.os}` : ""}</span>}
                      <span className="font-mono text-muted-foreground/60">{session.client_id.slice(0, 12)}…</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {session.stats && (
                      <div className="text-right">
                        <div className="text-sm font-semibold tabular-nums">{formatBytes(session.stats.bytes_in + session.stats.bytes_out)}</div>
                        <div className="text-[10px] text-muted-foreground tabular-nums">{session.stats.requests.toLocaleString()} req</div>
                      </div>
                    )}
                    <Button variant="outline" size="sm" className="h-8 px-2.5 text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={() => killSession(session.client_id)} title="Force disconnect">
                      <WifiOff className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {session.tunnels.length > 0 && (
                  <div className="divide-y divide-border/40 rounded-lg border border-border/50">
                    {session.tunnels.map(t => (
                      <div key={t.url} className={`flex items-center justify-between gap-3 px-3 py-2 ${t.active === false ? "opacity-50" : ""}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          {t.protocol ? (
                            <Badge variant="outline" className={`text-[9px] shrink-0 ${protoCls(t.protocol)}`}>{t.protocol.toUpperCase()}</Badge>
                          ) : <Badge variant="outline" className="text-[9px] shrink-0">closed</Badge>}
                          <span className="text-[11px] font-mono truncate">{t.url}</span>
                          {t.local_addr && <span className="text-[10px] text-muted-foreground/60 shrink-0">→ {t.local_addr}</span>}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {t.stats && (
                            <span className="hidden sm:inline text-[10px] text-muted-foreground tabular-nums">
                              {t.stats.requests.toLocaleString()} req · {formatBytes(t.stats.bytes_in + t.stats.bytes_out)}
                              {t.stats.last_hit ? ` · hit ${agoShort(t.stats.last_hit)}` : " · no traffic yet"}
                            </span>
                          )}
                          {t.protocol === "http" && t.active !== false && (
                            <a href={t.url} target="_blank" rel="noopener noreferrer"
                              className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent text-muted-foreground" title="Open">
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          {t.active !== false && (
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                              onClick={() => killTunnel(t.url)} title="Close this tunnel">
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-5">
            {/* Top users */}
            <Card className="xl:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4 text-muted-foreground" /> Top tunnel users · 7 days</CardTitle>
              </CardHeader>
              <CardContent>
                {!ov ? <div className="h-40 animate-pulse rounded-md bg-muted/20" />
                : ov.top_users.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No tunnel sessions in the last 7 days.</p>
                : (
                  <div className="space-y-1">
                    {ov.top_users.map((u, i) => {
                      const maxB = Math.max(1, ov.top_users[0]?.bytes ?? 1);
                      return (
                        <div key={(u.user_id || "anon") + i} className="relative overflow-hidden rounded-md">
                          <div className="absolute inset-y-0 left-0 bg-emerald-500/10" style={{ width: `${(u.bytes / maxB) * 100}%` }} />
                          <div className="relative flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
                            <div className="min-w-0">
                              <div className="truncate font-medium">{u.email || "static token"}</div>
                              <div className="text-[10px] text-muted-foreground">{u.sessions} session{u.sessions !== 1 ? "s" : ""} · last {agoShort(u.last_seen)}</div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-mono tabular-nums">{formatBytes(u.bytes)}</div>
                              <div className="text-[10px] text-muted-foreground tabular-nums">{u.requests.toLocaleString()} req</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* History */}
            <Card className="xl:col-span-3">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" /> Session history</CardTitle>
                  <Input placeholder="Filter email, IP, URL…" className="h-8 w-48 text-xs" value={historyFilter} onChange={e => setHistoryFilter(e.target.value)} />
                </div>
              </CardHeader>
              <CardContent>
                {!ov ? <div className="h-40 animate-pulse rounded-md bg-muted/20" />
                : recent.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">{hq ? "No sessions match." : "No sessions recorded yet."}</p>
                : (
                  <div className="max-h-[420px] overflow-auto rounded-md border border-border/50">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-background/95 text-[10px] uppercase tracking-wide text-muted-foreground backdrop-blur">
                        <tr className="text-left">
                          <th className="px-2.5 py-2 font-medium">User</th>
                          <th className="px-2.5 py-2 font-medium">Started</th>
                          <th className="px-2.5 py-2 font-medium">Duration</th>
                          <th className="px-2.5 py-2 font-medium">Tunnels</th>
                          <th className="px-2.5 py-2 font-medium text-right">Traffic</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {recent.map(r => (
                          <tr key={r.id} className="align-top hover:bg-accent/30">
                            <td className="px-2.5 py-2">
                              <div className="truncate max-w-[180px] font-medium">{r.email || "static token"}</div>
                              <div className="text-[10px] text-muted-foreground font-mono">{r.remote_ip}{r.client_version ? ` · v${r.client_version}` : ""}{r.os ? ` · ${r.os}` : ""}</div>
                            </td>
                            <td className="px-2.5 py-2 whitespace-nowrap text-muted-foreground" title={new Date(r.connected_at).toLocaleString()}>{agoShort(r.connected_at)}</td>
                            <td className="px-2.5 py-2 whitespace-nowrap">
                              {r.disconnected_at ? fmtDuration(r.connected_at, r.disconnected_at)
                                : <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />live</span>}
                            </td>
                            <td className="px-2.5 py-2">
                              {r.tunnel_urls.length === 0 ? <span className="text-muted-foreground/60">none</span> : (
                                <div className="space-y-0.5">
                                  {r.tunnel_urls.slice(0, 2).map(u => <div key={u} className="truncate max-w-[200px] font-mono text-[10px]">{u.replace(/^https?:\/\//, "")}</div>)}
                                  {r.tunnel_urls.length > 2 && <div className="text-[10px] text-muted-foreground">+{r.tunnel_urls.length - 2} more</div>}
                                </div>
                              )}
                            </td>
                            <td className="px-2.5 py-2 text-right whitespace-nowrap">
                              <div className="font-mono tabular-nums">{formatBytes(r.bytes_in + r.bytes_out)}</div>
                              <div className="text-[10px] text-muted-foreground tabular-nums">{r.requests.toLocaleString()} req</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
        );
      })()}

      {tab === "email" && (() => {
        const ev = emailAnalytics;
        const maxDay = Math.max(1, ...(ev?.daily ?? []).map(d => d.total));
        const pct = (part: number, whole: number) => whole > 0 ? Math.round((part / whole) * 100) : 0;
        const scoreCls: Record<string, string> = {
          valid: "bg-emerald-500", risky: "bg-amber-500", invalid: "bg-red-500", unknown: "bg-zinc-400",
        };
        return (
        <div className="space-y-5">
          {/* KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiCard label="Verified today" value={ev?.today.total ?? "—"} sub={ev ? `${ev.today.users} user${ev.today.users !== 1 ? "s" : ""}` : undefined}
              icon={<CheckCircle2 className="h-4 w-4" />} color="text-emerald-600 dark:text-emerald-400 bg-emerald-500/20" bar="bg-emerald-500" />
            <KpiCard label="Verified (7d)" value={ev?.week.total ?? "—"} sub={ev ? `${ev.week.users} unique user${ev.week.users !== 1 ? "s" : ""}` : undefined}
              icon={<BarChart3 className="h-4 w-4" />} color="text-blue-600 dark:text-blue-400 bg-blue-500/20" bar="bg-blue-500" delay={40} />
            <KpiCard label="Verified (30d)" value={ev?.month.total ?? "—"} sub={ev ? `${pct(ev.month.valid, ev.month.total)}% valid` : undefined}
              icon={<Activity className="h-4 w-4" />} color="text-violet-600 dark:text-violet-400 bg-violet-500/20" bar="bg-violet-500" delay={80} />
            <KpiCard label="Disposable (30d)" value={ev?.disposable_30d ?? "—"} sub={ev ? `${pct(ev.disposable_30d, ev.month.total)}% of checks` : undefined}
              icon={<Ban className="h-4 w-4" />} color="text-amber-600 dark:text-amber-400 bg-amber-500/20" bar="bg-amber-500" delay={120} />
            <KpiCard label="No MX (30d)" value={ev?.no_mx_30d ?? "—"} sub={ev ? `${pct(ev.no_mx_30d, ev.month.total)}% dead domains` : undefined}
              icon={<WifiOff className="h-4 w-4" />} color="text-red-600 dark:text-red-400 bg-red-500/20" bar="bg-red-500" delay={160} />
            <KpiCard label="SMTP probed (30d)" value={ev?.smtp_probed_30d ?? "—"} sub={ev ? `${ev.batch_share_30d}% via batch` : undefined}
              icon={<Radio className="h-4 w-4" />} color="text-cyan-600 dark:text-cyan-400 bg-cyan-500/20" bar="bg-cyan-500" delay={200} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* 30-day volume */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4 text-muted-foreground" /> Verifications · last 30 days</CardTitle>
              </CardHeader>
              <CardContent>
                {ev ? (
                  <div className="flex h-32 items-end gap-1">
                    {ev.daily.map(d => (
                      <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end gap-px">
                        <div className="w-full rounded-t-sm bg-red-500/70" style={{ height: `${d.total ? (d.invalid / maxDay) * 100 : 0}%` }} />
                        <div className="w-full bg-amber-500/70" style={{ height: `${d.total ? (d.risky / maxDay) * 100 : 0}%` }} />
                        <div className="w-full rounded-b-sm bg-emerald-500/70" style={{ height: `${d.total ? (d.valid / maxDay) * 100 : (d.total === 0 ? 0 : 2)}%`, minHeight: d.total ? 2 : 0 }} />
                        <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border/60 bg-background px-2 py-1 text-[10px] shadow-sm group-hover:block">
                          <div className="font-medium">{new Date(d.day + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
                          <div className="text-muted-foreground">{d.total} checks · {d.valid} valid · {d.risky} risky · {d.invalid} invalid</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <div className="h-32 animate-pulse rounded-md bg-muted/20" />}
                <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500/70" /> valid</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-500/70" /> risky</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-red-500/70" /> invalid</span>
                </div>
              </CardContent>
            </Card>

            {/* Quality breakdown (30d) */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4 text-muted-foreground" /> Result mix · 30 days</CardTitle>
              </CardHeader>
              <CardContent>
                {!ev ? <div className="h-40 animate-pulse rounded-md bg-muted/20" /> : ev.month.total === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">No verifications in the last 30 days.</p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex h-3 w-full overflow-hidden rounded-full">
                      {(["valid", "risky", "invalid", "unknown"] as const).map(k => {
                        const v = ev.month[k]; const p = pct(v, ev.month.total);
                        return p > 0 ? <div key={k} className={scoreCls[k]} style={{ width: `${p}%` }} title={`${k}: ${v} (${p}%)`} /> : null;
                      })}
                    </div>
                    <div className="space-y-1.5">
                      {(["valid", "risky", "invalid", "unknown"] as const).map(k => (
                        <div key={k} className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5 capitalize"><span className={`h-2 w-2 rounded-full ${scoreCls[k]}`} />{k}</span>
                          <span className="font-mono tabular-nums text-muted-foreground">{ev.month[k].toLocaleString()} · {pct(ev.month[k], ev.month.total)}%</span>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-border/50 pt-2 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between"><span className="text-muted-foreground">Role-based</span><span className="font-mono tabular-nums">{ev.role_based_30d.toLocaleString()} · {pct(ev.role_based_30d, ev.month.total)}%</span></div>
                      <div className="flex items-center justify-between"><span className="text-muted-foreground">Disposable</span><span className="font-mono tabular-nums">{ev.disposable_30d.toLocaleString()} · {pct(ev.disposable_30d, ev.month.total)}%</span></div>
                      <div className="flex items-center justify-between"><span className="text-muted-foreground">All-time checks</span><span className="font-mono tabular-nums">{ev.all_time.toLocaleString()}</span></div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            {/* Top users */}
            <Card className="xl:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4 text-muted-foreground" /> Top users · 30 days</CardTitle>
              </CardHeader>
              <CardContent>
                {!ev ? <div className="h-40 animate-pulse rounded-md bg-muted/20" />
                : ev.top_users.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No one has used the validator in the last 30 days.</p>
                : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        <tr className="text-left"><th className="px-2 py-1.5 font-medium">User</th><th className="px-2 py-1.5 font-medium text-right">Checks</th><th className="px-2 py-1.5 font-medium text-right">Invalid</th><th className="px-2 py-1.5 font-medium text-right">Last used</th></tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {ev.top_users.map((u, i) => (
                          <tr key={(u.user_id || "anon") + i} className="hover:bg-accent/30">
                            <td className="px-2 py-1.5 truncate max-w-[220px] font-medium">{u.email || "anonymous"}</td>
                            <td className="px-2 py-1.5 text-right font-mono tabular-nums">{u.total.toLocaleString()}</td>
                            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-red-600 dark:text-red-400">{u.invalid.toLocaleString()}</td>
                            <td className="px-2 py-1.5 text-right text-muted-foreground whitespace-nowrap" title={new Date(u.last_used).toLocaleString()}>{agoShort(u.last_used)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top domains */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Globe className="h-4 w-4 text-muted-foreground" /> Top domains · 30 days</CardTitle>
              </CardHeader>
              <CardContent>
                {!ev ? <div className="h-40 animate-pulse rounded-md bg-muted/20" />
                : ev.top_domains.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No data yet.</p>
                : (
                  <div className="space-y-1">
                    {ev.top_domains.map(d => {
                      const maxC = Math.max(1, ev.top_domains[0]?.count ?? 1);
                      return (
                        <div key={d.key} className="relative overflow-hidden rounded-md">
                          <div className="absolute inset-y-0 left-0 bg-blue-500/10" style={{ width: `${(d.count / maxC) * 100}%` }} />
                          <div className="relative flex items-center justify-between gap-2 px-2 py-1 text-xs">
                            <span className="truncate font-mono">{d.key}</span>
                            <span className="font-mono tabular-nums text-muted-foreground shrink-0">{d.count.toLocaleString()}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <p className="text-[10px] text-muted-foreground/60">Privacy: only the email domain and verdict are logged, never the full address. History starts when logging was enabled.</p>
        </div>
        );
      })()}

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
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/20 text-blue-600 dark:text-blue-400 text-xs font-mono shrink-0">
                            {s.region.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{s.label}</span>
                              <Badge variant="outline" className={`text-[9px] ${
                                s.status === "active" ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/50"
                                : s.status === "draining" ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/50"
                                : "bg-red-500/20 text-red-600 dark:text-red-400"
                              }`}>{s.status}</Badge>
                              {s.is_local && <Badge variant="outline" className="text-[9px] bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30">primary · local</Badge>}
                              {s.user_id && <Badge variant="outline" className="text-[9px] bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30">BYOC</Badge>}
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
                          {!s.user_id && (
                            <Button
                              variant="outline" size="sm" className="h-7 text-xs"
                              title="Rename, set region & project limit"
                              onClick={() => {
                                setEditingServer(editingServer === s.id ? null : s.id);
                                setSrvLabel(s.label || "");
                                setSrvRegion(s.region || "");
                                setSrvMaxProj(String(s.max_projects ?? ""));
                                setSrvMaxProjOrig(String(s.max_projects ?? ""));
                              }}
                            >
                              Edit
                            </Button>
                          )}
                          {!s.user_id && (
                            <Button
                              variant="outline"
                              size="sm"
                              className={`h-7 text-xs ${s.user_selectable ? "text-emerald-600 dark:text-emerald-400 border-emerald-500/40" : "text-muted-foreground"}`}
                              title={s.user_selectable ? "Shown in the user region picker — click to hide" : "Hidden from the user region picker — click to offer"}
                              onClick={() => setSelectable(s.id, !s.user_selectable)}
                            >
                              {s.user_selectable ? "Offered" : "Hidden"}
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className={`h-7 text-xs ${s.backups_enabled !== false ? "text-emerald-600 dark:text-emerald-400 border-emerald-500/40" : "text-amber-600 dark:text-amber-400 border-amber-500/40"}`}
                            title={s.backups_enabled !== false ? "Nightly backups ON for databases on this server — click to disable" : "Backups DISABLED for this server — click to enable"}
                            onClick={() => toggleServerBackups(s.id, s.backups_enabled === false)}
                          >
                            {s.backups_enabled !== false ? "Backups on" : "Backups off"}
                          </Button>
                          {!s.is_local && (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:text-destructive" onClick={() => removeServer(s.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                      {editingServer === s.id && (
                        <div className="mb-3 rounded-lg border border-border bg-muted/20 p-3 space-y-2.5">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                            <div>
                              <label className="mb-1 block text-[11px] text-muted-foreground">Display name</label>
                              <input
                                value={srvLabel}
                                onChange={(e) => setSrvLabel(e.target.value)}
                                placeholder="e.g. Deployzy Cloud"
                                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-[11px] text-muted-foreground">Region (flag shown to users)</label>
                              <select
                                value={srvRegion}
                                onChange={(e) => setSrvRegion(e.target.value)}
                                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                              >
                                <option value="">— none —</option>
                                {REGION_PRESETS.map((rp) => (
                                  <option key={rp.slug} value={rp.slug}>{rp.flag} {rp.name}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="mb-1 block text-[11px] text-muted-foreground">Max projects (0 = auto)</label>
                              <input
                                type="number" min={0} max={10000} inputMode="numeric"
                                value={srvMaxProj}
                                onChange={(e) => setSrvMaxProj(e.target.value)}
                                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs tabular-nums"
                              />
                            </div>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            Counts awake projects only — idle-sleeping apps hold no RAM and don&apos;t use a slot. RAM headroom is still checked separately at placement.
                          </p>
                          <div className="flex gap-2">
                            <Button size="sm" className="h-7 text-xs" onClick={() => saveServerMeta(s.id)}>Save</Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingServer(null)}>Cancel</Button>
                          </div>
                        </div>
                      )}
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
                <Badge variant="outline" className={backups?.timer_active ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/50" : "bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/40"}>
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
                      <Badge variant="outline" className="text-[10px] bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/50">
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
      {/* ── PLANS TAB ─────────────────────────────────────────────────────── */}
      {tab === "plans" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Edit what each plan allows. Changes apply on the next check — no restart or
            redeploy needed. Use <span className="font-mono text-foreground">-1</span> for unlimited.
          </p>

          <div className="rounded-xl border border-border/60 p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Concurrent builds (platform-wide)</p>
              <p className="text-xs text-muted-foreground">How many Docker builds run at once across all users. Keep at <span className="font-mono">1</span> on a single-core VPS so builds don&apos;t starve live apps. Raise it after moving to a bigger server.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <input type="number" min={1} max={16} value={buildConcInput}
                onChange={e => setBuildConcInput(e.target.value)}
                className="w-16 h-9 rounded-lg border border-input bg-background px-3 text-sm text-center outline-none focus:border-foreground/30" />
              <button onClick={saveBuildConc} disabled={buildConcSaving || buildConcInput === String(buildConc)}
                className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
                {buildConcSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          {plans.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading plans…
            </div>
          )}

          {plans.map((p) => {
            const d = planDraft[p.plan];
            if (!d) return null;
            const isAdminPlan = p.plan === "admin";
            const setField = (k: keyof PlanLimitRow, v: number | boolean) =>
              setPlanDraft(prev => ({ ...prev, [p.plan]: { ...prev[p.plan], [k]: v } }));
            const dirty = JSON.stringify(d) !== JSON.stringify(p);

            const numField = (label: string, key: keyof PlanLimitRow, hint?: string, step = 1) => (
              <div key={key}>
                <label className="block text-[11px] text-muted-foreground mb-1">{label}</label>
                <input
                  type="number" step={step}
                  disabled={isAdminPlan}
                  value={d[key] as number}
                  onChange={(e) => setField(key, parseFloat(e.target.value))}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs font-mono disabled:opacity-50"
                />
                {hint && <p className="mt-0.5 text-[10px] text-muted-foreground/70">{hint}</p>}
              </div>
            );

            // Dollar-denominated field: stores internal units (1 unit = $0.01) but
            // shows/edits in $. -1 = unlimited (typed as -1).
            const usdField = (label: string, key: keyof PlanLimitRow, hint?: string) => {
              const raw = d[key] as number;
              const shown = raw < 0 ? "-1" : (raw / 100).toString();
              return (
                <div key={key}>
                  <label className="block text-[11px] text-muted-foreground mb-1">{label}</label>
                  <div className="flex items-center h-8 rounded-md border border-input bg-background px-2 focus-within:border-foreground/40 disabled:opacity-50">
                    <span className="text-xs text-muted-foreground mr-1">$</span>
                    <input
                      type="text" inputMode="decimal" disabled={isAdminPlan}
                      value={shown}
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        if (v === "-1") { setField(key, -1); return; }
                        const n = parseFloat(v.replace(/[^0-9.]/g, ""));
                        setField(key, isNaN(n) ? 0 : Math.round(n * 100));
                      }}
                      className="h-full w-full bg-transparent text-xs font-mono outline-none disabled:opacity-50"
                    />
                  </div>
                  {hint && <p className="mt-0.5 text-[10px] text-muted-foreground/70">{hint}</p>}
                </div>
              );
            };

            return (
              <Card key={p.plan}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <span className="capitalize">{p.plan}</span>
                      {isAdminPlan && (
                        <Badge variant="outline" className="text-[9px] text-muted-foreground">
                          unlimited by design — read only
                        </Badge>
                      )}
                    </span>
                    {!isAdminPlan && (
                      <span className="flex items-center gap-2">
                        {planSaved === p.plan && (
                          <span className="text-[11px] text-emerald-600 dark:text-emerald-400">Saved</span>
                        )}
                        <Button size="sm" className="h-7 text-xs" disabled={!dirty || planSaving === p.plan}
                          onClick={() => savePlan(p.plan)}>
                          {planSaving === p.plan ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                        </Button>
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Build + runtime resources — the levers that actually cost money */}
                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Build &amp; runtime
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {numField("Runtime RAM (MB)", "max_memory_mb")}
                      {numField("Runtime vCPU", "max_cpus", undefined, 0.25)}
                      {numField("Build memory (MB)", "max_build_memory_mb", "Ceiling — still clamped to free host RAM")}
                      {numField("Build minutes / mo", "max_build_minutes_monthly", "Counts failed builds too")}
                      {usdField("AI & email usage / mo", "monthly_ai_credits", "Included AI builder + email-verify usage per month; -1 = unlimited")}
                    </div>
                  </div>

                  {/* Quotas */}
                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Quotas</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {numField("Projects", "max_projects")}
                      {numField("Databases", "max_databases")}
                      {numField("DB storage (MB)", "max_db_size_mb", "Per-database size cap; -1 = unlimited")}
                      {numField("Services", "max_services")}
                      {numField("BYOC servers", "max_byoc_servers")}
                      {numField("Subdomains", "max_subdomains")}
                      {numField("Tunnels", "max_tunnels")}
                      {numField("Custom domains", "max_custom_domains")}
                      {numField("Cron jobs", "max_crons")}
                      {numField("PR previews", "max_preview_deploys")}
                      {numField("Bandwidth (GB)", "max_bandwidth_gb")}
                      {numField("Rate limit (req/s)", "max_rate")}
                    </div>
                  </div>

                  {/* Retention */}
                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Retention (days)</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {numField("Analytics", "analytics_retention_days")}
                      {numField("Deploy logs", "deploy_log_retention_days")}
                      {numField("Metrics", "metrics_retention_days")}
                      {numField("Backups", "backup_retention_days")}
                    </div>
                  </div>

                  {/* Feature flags */}
                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Features</p>
                    <div className="flex flex-wrap gap-1.5">
                      {([
                        ["allow_previews", "PR previews"],
                        ["allow_release_cmd", "Release cmds"],
                        ["allow_health_checks", "Health checks"],
                        ["allow_private_repos", "Private repos"],
                        ["allow_tcp_tunnels", "TCP tunnels"],
                        ["allow_live_logs", "Live logs"],
                        ["allow_custom_events", "Custom events"],
                        ["allow_telegram", "Telegram"],
                        ["allow_advanced_databases", "Redis/Mongo/MySQL"],
                        ["allow_db_migration", "DB migration"],
                      ] as [keyof PlanLimitRow, string][]).map(([key, label]) => (
                        <button
                          key={key}
                          disabled={isAdminPlan}
                          onClick={() => setField(key, !d[key])}
                          className={`rounded-md border px-2 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                            d[key]
                              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "border-border text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {d[key] ? "✓" : "✕"} {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

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
                  <StatTile label="Pageviews" value={fmtNum(o.pageviews)}
                    sub={analytics.visitors_exact
                      ? `${fmtNum(o.visitors)} unique visitors`
                      : `${fmtNum(o.visitors)} visits (daily uniques summed)`} />
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
                                <div className="text-emerald-600 dark:text-emerald-400">{pt.pageviews} views · {pt.visitors} visitors</div>
                                <div className="text-amber-600 dark:text-amber-400">{pt.bot_hits} bot hits</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Crawler identity — who is actually hitting these sites */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span>Crawlers &amp; bots</span>
                      <span className="text-[10px] font-normal text-muted-foreground">
                        {fmtNum(o.bot_hits)} bot hits · {botPct.toFixed(1)}% of all traffic
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {(analytics.crawlers || []).length === 0 ? (
                      <p className="py-6 text-center text-xs text-muted-foreground">No bot traffic in this period.</p>
                    ) : (() => {
                      const rows = analytics.crawlers;
                      const max = Math.max(1, ...rows.map(c => c.hits));
                      const tone: Record<string, string> = {
                        ai: "bg-violet-500/20 text-violet-600 dark:text-violet-400 border-violet-500/40",
                        search: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/40",
                        social: "bg-sky-500/20 text-sky-600 dark:text-sky-400 border-sky-500/40",
                        seo: "bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/40",
                        monitoring: "bg-zinc-500/20 text-muted-foreground border-zinc-500/40",
                      };
                      return (
                        <div className="space-y-1.5">
                          {rows.map(c => (
                            <div key={c.name} className="relative">
                              <div className="absolute inset-y-0 left-0 rounded bg-amber-500/10"
                                style={{ width: `${(c.hits / max) * 100}%` }} />
                              <div className="relative flex items-center gap-2 px-2 py-1.5 text-[11px]">
                                <span className="font-medium truncate">{c.name}</span>
                                <Badge variant="outline"
                                  className={`text-[9px] shrink-0 ${tone[c.category] || "text-muted-foreground"}`}>
                                  {c.category}
                                </Badge>
                                <span className="ml-auto shrink-0 text-muted-foreground">
                                  {c.sites} site{c.sites !== 1 ? "s" : ""}
                                </span>
                                <span className="shrink-0 font-mono w-16 text-right">{c.hits.toLocaleString()}</span>
                              </div>
                            </div>
                          ))}
                          {rows.some(c => c.name === "Unclassified") && (
                            <p className="pt-1 text-[10px] text-muted-foreground">
                              &ldquo;Unclassified&rdquo; is traffic recorded before crawler identification shipped —
                              user agents aren&apos;t stored, so it can&apos;t be labelled retroactively.
                            </p>
                          )}
                        </div>
                      );
                    })()}
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
                                <td className="text-right font-mono text-amber-600 dark:text-amber-400">{fmtNum(pr.bot_hits)}</td>
                                <td className="text-right font-mono">{fmtBytes(pr.bytes)}</td>
                                <td className={`text-right font-mono ${pr.error_hits > 0 ? "text-red-600 dark:text-red-400" : ""}`}>{fmtNum(pr.error_hits)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <p className="text-[10px] text-muted-foreground">
                  {analytics.retention_note}
                  {analytics.source === "rollup" && " Breakdown lists below the chart cover the last 30 days only."}
                </p>
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
                <svg className="h-4 w-4 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </div>
              <div>
                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Broadcast sent</p>
                <p className="text-xs text-muted-foreground">{bcResult.sent} delivered · {bcResult.failed} failed · {bcResult.total} total recipients</p>
              </div>
              <button onClick={() => setBcResult(null)} className="ml-auto text-muted-foreground hover:text-foreground text-xs">Dismiss</button>
            </div>
          )}

          {bcError && (
            <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">{bcError}</div>
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

      {tab === "vpn" && (
        <div className="max-w-2xl space-y-6">
          <div>
            <h3 className="text-sm font-semibold mb-1">VPN Panel — TunnelTweak API</h3>
            <p className="text-xs text-muted-foreground">
              Deployzy resells the TunnelTweak (TuTBot) installer as a white-label VPN panel. Paste the reseller
              API key here — it authenticates every VPN install and SSH/V2Ray account created on the site.
            </p>
          </div>

          <div className="space-y-4 rounded-xl border border-border/60 p-5">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">API Base URL</label>
              <input value={vpnForm.base_url} onChange={e => setVpnForm(f => ({ ...f, base_url: e.target.value }))}
                placeholder="https://tunneltweak.deployzy.com"
                className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-foreground/30" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Reseller API Key {vpnCfg?.api_key_set && <span className="text-emerald-600 dark:text-emerald-400">· currently set ({vpnCfg.api_key_preview})</span>}
              </label>
              <input type="password" value={vpnForm.api_key} onChange={e => setVpnForm(f => ({ ...f, api_key: e.target.value }))}
                placeholder={vpnCfg?.api_key_set ? "•••••••• (leave blank to keep current)" : "ttk_…"}
                className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-foreground/30 font-mono" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Reseller Master Key {vpnCfg?.master_key_set && <span className="text-emerald-600 dark:text-emerald-400">· currently set ({vpnCfg.master_key_preview})</span>}
              </label>
              <input type="password" value={vpnForm.master_key} onChange={e => setVpnForm(f => ({ ...f, master_key: e.target.value }))}
                placeholder={vpnCfg?.master_key_set ? "•••••••• (leave blank to keep current)" : "dzy_master_…"}
                className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-foreground/30 font-mono" />
              <p className="text-[11px] text-muted-foreground">Used to auto-mint a fresh TunnelTweak key for each deployed VPN Panel template. This is the <code className="font-mono">RESELLER_MASTER_KEY</code> set on the TunnelTweak bot.</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Shared server ID</label>
                <input value={vpnForm.shared_server_id} onChange={e => setVpnForm(f => ({ ...f, shared_server_id: e.target.value }))}
                  placeholder="e.g. 12" title="TuTBot server_id used for the free public account pool"
                  className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-foreground/30" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Free acct days</label>
                <input value={vpnForm.free_days} onChange={e => setVpnForm(f => ({ ...f, free_days: e.target.value }))}
                  placeholder="7"
                  className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-foreground/30" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Free max logins</label>
                <input value={vpnForm.free_max_logins} onChange={e => setVpnForm(f => ({ ...f, free_max_logins: e.target.value }))}
                  placeholder="1"
                  className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-foreground/30" />
              </div>
            </div>

            {vpnTest && (
              <div className={`rounded-lg border px-3 py-2 text-xs ${vpnTest.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"}`}>
                {vpnTest.msg}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" onClick={saveVpn} disabled={vpnSaving}>
                {vpnSaving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : "Save"}
              </Button>
              <Button size="sm" variant="outline" onClick={testVpn} disabled={!vpnCfg?.api_key_set && !vpnForm.api_key}>
                Test connection
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Get the key from the TuTBot Telegram bot with <code className="font-mono">/apikey</code>, or from its admin panel.
              Save first, then Test — the test uses the stored key.
            </p>
          </div>
        </div>
      )}

      {tab === "ai" && (
        <div className="max-w-2xl space-y-6">
          <div>
            <h3 className="text-sm font-semibold mb-1">AI Model — Builder &amp; Agent</h3>
            <p className="text-xs text-muted-foreground">
              The AI builder and agent talk to any OpenAI-compatible provider. Pick a provider, paste its API key,
              and choose a model — this replaces the default DeepSeek model everywhere the AI generates or edits code.
            </p>
          </div>

          {aiCfg?.effective && (
            <div className="rounded-lg border border-border/60 px-3 py-2 text-xs text-muted-foreground">
              Currently active:{" "}
              <span className="font-medium text-foreground">{aiCfg.effective.provider}</span>
              {" · "}<span className="font-mono">{aiCfg.effective.model}</span>
              {aiCfg.effective.using_env_fallback && <span className="text-amber-600 dark:text-amber-400"> · using DEEPSEEK_API_KEY env fallback</span>}
              {!aiCfg.effective.key_configured && <span className="text-red-600 dark:text-red-400"> · no API key set — AI is disabled</span>}
            </div>
          )}

          <div className="space-y-4 rounded-xl border border-border/60 p-5">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Provider</label>
              <select value={aiForm.provider} onChange={e => applyPreset(e.target.value)}
                className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-foreground/30">
                {(aiCfg?.presets || []).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">API Base URL</label>
              <input value={aiForm.base_url} onChange={e => setAiForm(f => ({ ...f, base_url: e.target.value }))}
                placeholder="https://api.deepseek.com"
                className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-foreground/30 font-mono" />
              <p className="text-[11px] text-muted-foreground">The OpenAI-compatible root, without <code className="font-mono">/chat/completions</code>.</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Model</label>
              <input value={aiForm.model} onChange={e => setAiForm(f => ({ ...f, model: e.target.value }))}
                placeholder="deepseek-chat"
                className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-foreground/30 font-mono" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                API Key {aiCfg?.api_key_set && <span className="text-emerald-600 dark:text-emerald-400">· currently set ({aiCfg.api_key_preview})</span>}
              </label>
              <input type="password" value={aiForm.api_key} onChange={e => setAiForm(f => ({ ...f, api_key: e.target.value }))}
                placeholder={aiCfg?.api_key_set ? "•••••••• (leave blank to keep current)" : (aiCfg?.presets.find(p => p.id === aiForm.provider)?.key_hint || "bearer token")}
                className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-foreground/30 font-mono" />
            </div>

            {aiTest && (
              <div className={`rounded-lg border px-3 py-2 text-xs ${aiTest.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"}`}>
                {aiTest.msg}
              </div>
            )}

            <div className="border-t border-border/60 pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold">Credit metering</div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    When ON, AI builder/agent usage spends credits (free monthly allotment → top-up wallet).
                    When OFF, AI is unlimited for everyone. Admins are always unlimited.
                  </p>
                </div>
                <button type="button" onClick={() => setAiForm(f => ({ ...f, credits_enabled: !f.credits_enabled }))}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${aiForm.credits_enabled ? "bg-foreground" : "bg-input"}`}>
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-background transition-transform ${aiForm.credits_enabled ? "translate-x-[22px]" : "translate-x-0.5"}`} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Input price ($/1M tokens)</label>
                  <input value={aiForm.price_in_per_m} onChange={e => setAiForm(f => ({ ...f, price_in_per_m: e.target.value }))}
                    placeholder="0.30" inputMode="decimal"
                    className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-foreground/30 font-mono" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Output price ($/1M tokens)</label>
                  <input value={aiForm.price_out_per_m} onChange={e => setAiForm(f => ({ ...f, price_out_per_m: e.target.value }))}
                    placeholder="1.20" inputMode="decimal"
                    className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-foreground/30 font-mono" />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Set these to the current model&apos;s real rates (e.g. Claude Opus ≈ 5 / 25, DeepSeek ≈ 0.30 / 1.20).
                1 credit = $0.01 of usage. Blank = defaults ($0.30 / $1.20). Per-plan free allotments are on the Plans tab.
              </p>

              <div className="pt-2 space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Polar credits product ID (card top-ups)</label>
                <input value={aiForm.polar_credits_product} onChange={e => setAiForm(f => ({ ...f, polar_credits_product: e.target.value }))}
                  placeholder="prod_…"
                  className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-foreground/30 font-mono" />
                <p className="text-[11px] text-muted-foreground">
                  Create ONE <span className="font-medium">&quot;pay what you want&quot;</span> product in Polar (e.g. &quot;AI Credits&quot;) and paste its ID here to
                  enable card top-ups for any amount. Leave blank to keep top-ups crypto-only (USDT).
                  {aiCfg && aiCfg.card_configured === false && <span className="text-amber-600 dark:text-amber-400"> Polar isn&apos;t configured on this server.</span>}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" onClick={saveAi} disabled={aiSaving}>
                {aiSaving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : "Save"}
              </Button>
              <Button size="sm" variant="outline" onClick={testAi} disabled={aiTesting || (!aiCfg?.api_key_set && !aiForm.api_key)}>
                {aiTesting ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Testing…</> : "Test model"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Test sends a 1-token request using the values above (no need to save first). If a provider rejects
              JSON mode or tool calls, the builder may error — pick another model. Anthropic uses its OpenAI-compatible endpoint.
            </p>
          </div>
        </div>
      )}

      {/* Per-user AI credits modal */}
      {creditUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm px-4"
          onClick={() => setCreditUser(null)}>
          <Card className="w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> AI Credits — {creditUser.email}</span>
                <button onClick={() => setCreditUser(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!creditData ? (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="rounded-full border border-border/60 px-2 py-0.5 capitalize">{creditData.plan} plan</span>
                    <span className={`rounded-full px-2 py-0.5 ${creditData.credits_enabled ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                      metering {creditData.credits_enabled ? "ON" : "OFF"}
                    </span>
                    {creditData.status.unlimited && <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">unlimited</span>}
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { l: "Included/mo", v: creditData.free_allotment < 0 ? "∞" : `$${(creditData.free_allotment/100).toFixed(2)}` },
                      { l: "Used", v: `$${(creditData.status.free_used/100).toFixed(2)}` },
                      { l: "Added funds", v: `$${(creditData.status.wallet/100).toFixed(2)}` },
                      { l: "Balance", v: creditData.status.unlimited ? "∞" : `$${(creditData.status.available/100).toFixed(2)}` },
                    ].map(s => (
                      <div key={s.l} className="rounded-lg border border-border/60 p-2 text-center">
                        <div className="text-[10px] text-muted-foreground">{s.l}</div>
                        <div className="text-lg font-semibold tracking-tight">{s.v}</div>
                      </div>
                    ))}
                  </div>
                  {/* Usage analytics (last 30 days) */}
                  {creditData.usage && (creditData.usage.products.length > 0 || (creditData.usage.spent_window ?? 0) > 0) && (
                    <div className="rounded-lg border border-border/60 p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-[11px] font-medium text-muted-foreground">Usage · last {creditData.usage.days}d</div>
                        <div className="text-[11px] tabular-nums text-muted-foreground">
                          today ${(creditData.usage.spent_today/100).toFixed(2)} · month ${(creditData.usage.spent_month/100).toFixed(2)}
                        </div>
                      </div>
                      {(() => {
                        const total = Math.max(0.001, creditData.usage!.products.reduce((s, p) => s + p.credits, 0));
                        return creditData.usage!.products.slice().sort((a, b) => b.credits - a.credits).map(p => (
                          <div key={p.product}>
                            <div className="flex items-center justify-between text-[11px] mb-1">
                              <span className="font-medium">{p.label}</span>
                              <span className="tabular-nums text-muted-foreground">${(p.credits/100).toFixed(2)} · {p.count} calls</span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                              <div className={`h-full rounded-full ${p.product === "email_verify" ? "bg-sky-500" : "bg-foreground"}`} style={{ width: `${Math.max(3, (p.credits / total) * 100)}%` }} />
                            </div>
                          </div>
                        ));
                      })()}
                      {/* mini trend */}
                      {creditData.usage.daily.length > 0 && (() => {
                        const max = Math.max(0.001, ...creditData.usage!.daily.map(d => d.credits));
                        return (
                          <div className="flex items-end gap-[2px] h-10 pt-1">
                            {creditData.usage!.daily.map(d => (
                              <div key={d.day} title={`${d.day}: $${(d.credits/100).toFixed(2)}`}
                                className="flex-1 rounded-sm bg-foreground/30" style={{ height: `${Math.max(6, (d.credits / max) * 100)}%` }} />
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className="text-[11px] text-muted-foreground">Adjust balance ($; negative to deduct)</label>
                      <input value={creditGrant} onChange={e => setCreditGrant(e.target.value)} inputMode="numeric"
                        placeholder="e.g. 10 or -5"
                        className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-foreground/30 font-mono" />
                    </div>
                    <Button size="sm" disabled={creditBusy || !creditGrant.trim()} onClick={() => adjustUserCredits(Math.round(Number(creditGrant) * 100))}>
                      {creditBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Apply"}
                    </Button>
                  </div>
                  <div>
                    <div className="text-[11px] font-medium text-muted-foreground mb-1">History ({creditData.ledger.length})</div>
                    <div className="max-h-56 overflow-y-auto rounded-lg border border-border/60 divide-y divide-border/40">
                      {creditData.ledger.length === 0 && <div className="px-3 py-4 text-xs text-muted-foreground text-center">No activity yet</div>}
                      {creditData.ledger.map((row, i) => (
                        <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs">
                          <span className="text-muted-foreground truncate">
                            <span className="capitalize">{row.reason}</span>{row.model ? ` · ${row.model}` : ""}
                            {(row.tokens_in > 0 || row.tokens_out > 0) ? ` · ${row.tokens_in}/${row.tokens_out} tok` : ""}
                          </span>
                          <span className={row.delta >= 0 ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-foreground"}>
                            {row.delta >= 0 ? "+" : "−"}${(Math.abs(row.delta)/100).toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

        </div>{/* /content */}
      </div>{/* /two-column shell */}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, sub, trend, color, bar, delay = 0 }: {
  icon: React.ReactNode; label: string; value: number | string;
  sub?: string; trend?: "up" | "down"; color: string; bar?: string; delay?: number;
}) {
  return (
    <Card
      className="group relative overflow-hidden animate-fade-in-up transition-all duration-200 hover:border-foreground/15 hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/5"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* accent bar + soft glow on hover */}
      {bar && <span className={`absolute inset-x-0 top-0 h-[2px] ${bar} opacity-60 group-hover:opacity-100 transition-opacity`} />}
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2.5">
          <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${color} ring-1 ring-inset ring-white/10`}>{icon}</span>
          {trend && (
            <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${trend === "up" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400"}`}>
              {trend === "up" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </span>
          )}
        </div>
        <p className="text-2xl font-bold tracking-tight tabular-nums">{typeof value === "number" ? value.toLocaleString() : value}</p>
        <p className="text-[11px] font-medium text-muted-foreground mt-0.5">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground/70 mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// Ring — a thin SVG donut used for success-rate / percentage stats. Reliable in
// both themes (no conic-gradient quirks) and animates on value change.
function Ring({ pct, cls, children }: { pct: number; cls: string; children?: React.ReactNode }) {
  const r = 26, c = 2 * Math.PI * r;
  const off = c - (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <div className="relative h-[72px] w-[72px] shrink-0">
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-muted/60" />
        <circle
          cx="32" cy="32" r={r} fill="none" strokeWidth="6" strokeLinecap="round"
          className={cls}
          style={{ strokeDasharray: c, strokeDashoffset: off, transition: "stroke-dashoffset .7s cubic-bezier(.4,0,.2,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" | "bad" }) {
  const color = tone === "warn" ? "text-amber-600 dark:text-amber-400" : tone === "bad" ? "text-red-600 dark:text-red-400" : "text-foreground";
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
  const color = tone === "good" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "warn" ? "text-amber-600 dark:text-amber-400"
    : tone === "bad" ? "text-red-600 dark:text-red-400"
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
      <p className={`text-[10px] mt-0.5 ${pct > 85 ? "text-red-600 dark:text-red-400" : pct > 65 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground/60"}`}>
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
