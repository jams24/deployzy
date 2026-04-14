"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Rocket, Plus, Play, Square, Trash2, ExternalLink, RefreshCw,
  Terminal, Globe, GitBranch, Search, Check, Loader2, Code, Database, Copy, Eye, EyeOff, Settings2, ChevronRight, ChevronDown, Clock, Activity, X, BarChart3,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface Project {
  id: string; name: string; subdomain: string; framework: string;
  repo_url: string; branch: string; github_repo: string; github_branch: string;
  auto_deploy: boolean; status: string;
  env_vars: Record<string, string>;
  install_cmd?: string; build_cmd?: string; start_cmd?: string;
  root_dir?: string; node_version?: string;
  port_override?: number; memory_mb?: number; cpus?: number;
  health_check_path?: string; release_cmd?: string; commit_sha?: string;
  labels?: string[]; build_mode?: string;
  last_deploy_at: string | null; created_at: string;
}
interface BuildConfig {
  install_cmd: string; build_cmd: string; start_cmd: string;
  root_dir: string; node_version: string;
  port_override: number; memory_mb: number; cpus: number;
  health_check_path: string; release_cmd: string;
  build_mode: string;
}
interface Domain {
  id: string; domain: string; verified: boolean;
  target_type: string; target_subdomain: string;
  cname_target: string;
}
interface Cron {
  id: string; project_id: string; name: string;
  schedule: string; command: string; enabled: boolean;
  last_run_at: string | null; last_status: string; last_output: string;
  created_at: string;
}
interface LiveLog { t: string; line: string; }
interface MetricSample {
  ts: string; cpu_pct: number;
  memory_mb: number; memory_limit_mb: number;
  net_rx_bytes: number; net_tx_bytes: number;
}
interface SiteOverview {
  overview: { pageviews: number; visitors: number; bots: number };
  timeseries: { ts: string; pageviews: number; visitors: number }[];
  realtime: { visitors: number; pageviews: number };
}
interface SiteTopRow { key: string; count: number }
interface Commit {
  sha: string; message: string; author: string; date: string;
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

// Sparkline renders a tiny inline SVG line chart. Keeps us free of a heavy
// charting dep for the dashboard — one file, zero deps.
function Sparkline({ values, color, height = 32 }: { values: number[]; color: string; height?: number }) {
  if (!values.length) return <div style={{ height }} className="w-full rounded bg-white/[0.02]" />;
  const w = 160;
  const max = Math.max(...values, 0.0001);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 0.0001);
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * (height - 2) - 1).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} />
    </svg>
  );
}

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
  const [importEnvText, setImportEnvText] = useState("");
  const [userServers, setUserServers] = useState<{ id: string; label: string; host: string; status: string }[]>([]);
  const [selectedServer, setSelectedServer] = useState("");
  const [togglingAutoDeploy, setTogglingAutoDeploy] = useState<string | null>(null);
  const [editingBuild, setEditingBuild] = useState<string | null>(null);
  const [buildCfg, setBuildCfg] = useState<BuildConfig>({
    install_cmd: "", build_cmd: "", start_cmd: "",
    root_dir: "", node_version: "",
    port_override: 0, memory_mb: 0, cpus: 0,
    health_check_path: "", release_cmd: "",
    build_mode: "",
  });
  const [savingBuild, setSavingBuild] = useState(false);
  // Commits dropdown (for rollback / pinned deploys) — per-project
  const [commits, setCommits] = useState<Record<string, Commit[]>>({});
  const [loadingCommits, setLoadingCommits] = useState<string | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<Record<string, string>>({});
  // Advanced build settings for the inline import-from-repo flow
  // Labels
  const [editingLabels, setEditingLabels] = useState<string | null>(null);
  const [labelsInput, setLabelsInput] = useState("");
  const [labelFilter, setLabelFilter] = useState<string>("");
  // Domains (inline per-project)
  const [allDomains, setAllDomains] = useState<Domain[]>([]);
  const [newDomain, setNewDomain] = useState<Record<string, string>>({});
  const [addingDomain, setAddingDomain] = useState<string | null>(null);
  // Live container logs (WebSocket)
  const [liveLogs, setLiveLogs] = useState<Record<string, LiveLog[]>>({});
  const [liveOn, setLiveOn] = useState<Record<string, boolean>>({});
  const [liveOpen, setLiveOpen] = useState<Record<string, boolean>>({}); // panel visibility
  const [liveMin, setLiveMin] = useState<Record<string, boolean>>({});   // minimized (header only)
  const [liveAutoscroll, setLiveAutoscroll] = useState<Record<string, boolean>>({});
  const wsRef = useRef<Record<string, WebSocket>>({});
  const liveScrollRef = useRef<Record<string, HTMLDivElement | null>>({});
  // Panel collapse states (metrics + crons + analytics) — default collapsed so
  // opening a project doesn't blast the user with every panel at once.
  const [showMetrics, setShowMetrics] = useState<Record<string, boolean>>({});
  const [showCrons, setShowCrons] = useState<Record<string, boolean>>({});
  const [showAnalytics, setShowAnalytics] = useState<Record<string, boolean>>({});
  // Website analytics
  const [siteData, setSiteData] = useState<Record<string, SiteOverview>>({});
  const [siteRange, setSiteRange] = useState<Record<string, string>>({});
  const [siteTop, setSiteTop] = useState<Record<string, Record<string, SiteTopRow[]>>>({}); // projectId → field → rows
  // Metrics
  const [metrics, setMetrics] = useState<Record<string, MetricSample[]>>({});
  const [metricsRange, setMetricsRange] = useState<Record<string, string>>({});
  // Cron jobs
  const [crons, setCrons] = useState<Record<string, Cron[]>>({});
  const [editingCron, setEditingCron] = useState<string | null>(null); // projectId currently editing
  const [cronForm, setCronForm] = useState<{ name: string; schedule: string; command: string }>({ name: "", schedule: "0 3 * * *", command: "" });
  const [importShowAdvanced, setImportShowAdvanced] = useState(false);
  const [importBuildCfg, setImportBuildCfg] = useState<BuildConfig>({
    install_cmd: "", build_cmd: "", start_cmd: "",
    root_dir: "", node_version: "",
    port_override: 0, memory_mb: 0, cpus: 0,
    health_check_path: "", release_cmd: "",
    build_mode: "",
  });

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
      alert(err.error || "Failed to create project");
      setImporting(false);
      return;
    }

    const project = await res.json();

    // Set env vars if provided
    if (importEnvText.trim()) {
      const envVars: Record<string, string> = {};
      importEnvText.split("\n").forEach((line) => {
        const eq = line.indexOf("=");
        if (eq > 0) envVars[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      });
      await fetch(`${API}/api/v1/projects/${project.id}`, {
        method: "PUT", headers: headers(),
        body: JSON.stringify({ env_vars: envVars }),
      });
    }

    // Apply build config before deploy if any advanced setting was customized
    const c = importBuildCfg;
    if (c.install_cmd || c.build_cmd || c.start_cmd || c.root_dir || c.node_version || c.port_override || c.memory_mb || c.cpus) {
      await fetch(`${API}/api/v1/projects/${project.id}/build-config`, {
        method: "PUT", headers: headers(),
        body: JSON.stringify(c),
      });
    }

    // Deploy
    await fetch(`${API}/api/v1/projects/${project.id}/deploy`, {
      method: "POST", headers: headers(),
    });
    // Reset advanced form for next import
    setImportBuildCfg({
      install_cmd: "", build_cmd: "", start_cmd: "",
      root_dir: "", node_version: "",
      port_override: 0, memory_mb: 0, cpus: 0,
      health_check_path: "", release_cmd: "",
      build_mode: "",
    });
    setImportShowAdvanced(false);
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

  function openBuildConfig(p: Project) {
    setBuildCfg({
      install_cmd: p.install_cmd || "",
      build_cmd: p.build_cmd || "",
      start_cmd: p.start_cmd || "",
      root_dir: p.root_dir || "",
      node_version: p.node_version || "",
      port_override: p.port_override || 0,
      memory_mb: p.memory_mb || 0,
      cpus: p.cpus || 0,
      health_check_path: p.health_check_path || "",
      release_cmd: p.release_cmd || "",
      build_mode: p.build_mode || "",
    });
    setEditingBuild(p.id);
  }

  async function loadCommits(p: Project) {
    if (!p.github_repo) return;
    setLoadingCommits(p.id);
    try {
      const branch = p.github_branch || p.branch || "main";
      const res = await fetch(`${API}/api/v1/github/commits?repo=${encodeURIComponent(p.github_repo)}&branch=${encodeURIComponent(branch)}`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setCommits((prev) => ({ ...prev, [p.id]: Array.isArray(data) ? data : [] }));
      }
    } catch {}
    setLoadingCommits(null);
  }

  async function deployCommit(projectId: string, sha: string) {
    setDeploying(projectId);
    await fetch(`${API}/api/v1/projects/${projectId}/deploy`, {
      method: "POST", headers: headers(),
      body: JSON.stringify({ commit_sha: sha }),
    });
    setTimeout(() => { setDeploying(null); load(); }, 3000);
  }

  async function saveLabels(projectId: string) {
    const labels = labelsInput.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    await fetch(`${API}/api/v1/projects/${projectId}/labels`, {
      method: "PUT", headers: headers(),
      body: JSON.stringify({ labels }),
    });
    setEditingLabels(null);
    setLabelsInput("");
    load();
  }

  async function loadDomains() {
    try {
      const res = await fetch(`${API}/api/v1/domains`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setAllDomains(Array.isArray(data) ? data : []);
      }
    } catch {}
  }

  async function addProjectDomain(p: Project) {
    const d = (newDomain[p.id] || "").trim().toLowerCase();
    if (!d) return;
    setAddingDomain(p.id);
    try {
      // 1) Register domain
      const regRes = await fetch(`${API}/api/v1/domains`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ domain: d }),
      });
      if (!regRes.ok && regRes.status !== 409) {
        const err = await regRes.json().catch(() => ({ error: "Failed to add domain" }));
        alert(err.error || "Failed to add domain");
        setAddingDomain(null);
        return;
      }
      // 2) Fetch domain list to find the one we just added (or existing)
      const listRes = await fetch(`${API}/api/v1/domains`, { headers: headers() });
      const list: Domain[] = listRes.ok ? await listRes.json() : [];
      const row = list.find((x) => x.domain === d);
      if (!row) {
        alert("Domain registered but couldn't find it in the list — try again.");
        setAddingDomain(null);
        return;
      }
      // 3) If not verified yet, tell user to set the CNAME and verify from /domains.
      if (!row.verified) {
        alert(`Domain added. Now set a CNAME record:\n\n  ${d}  →  ${row.cname_target}\n\nThen go to /domains to click Verify.`);
        setNewDomain((prev) => ({ ...prev, [p.id]: "" }));
        loadDomains();
        setAddingDomain(null);
        return;
      }
      // 4) Already verified — bind it to this project.
      await fetch(`${API}/api/v1/domains/${row.id}/bind`, {
        method: "PUT", headers: headers(),
        body: JSON.stringify({ target_type: "project", target_subdomain: p.subdomain }),
      });
      setNewDomain((prev) => ({ ...prev, [p.id]: "" }));
      loadDomains();
    } catch {
      alert("Failed to add domain");
    }
    setAddingDomain(null);
  }

  async function unbindDomain(domainId: string) {
    // Unbinding = clearing target_subdomain. We do this by binding to empty,
    // which the backend accepts as a clear (target_subdomain != '' is the routing filter).
    await fetch(`${API}/api/v1/domains/${domainId}/bind`, {
      method: "PUT", headers: headers(),
      body: JSON.stringify({ target_type: "project", target_subdomain: "" }),
    });
    loadDomains();
  }

  // ── Live logs (WebSocket) ──
  function startLiveLogs(projectId: string) {
    if (liveOn[projectId]) return;
    const token = localStorage.getItem("sm_token");
    if (!token) return;
    const base = (API || "").replace(/^http/, "ws");
    const ws = new WebSocket(`${base}/api/v1/ws/projects/${projectId}/logs?token=${encodeURIComponent(token)}`);
    wsRef.current[projectId] = ws;
    setLiveLogs((prev) => ({ ...prev, [projectId]: [] }));
    setLiveOn((prev) => ({ ...prev, [projectId]: true }));
    setLiveOpen((prev) => ({ ...prev, [projectId]: true }));
    setLiveMin((prev) => ({ ...prev, [projectId]: false }));
    if (liveAutoscroll[projectId] === undefined) {
      setLiveAutoscroll((prev) => ({ ...prev, [projectId]: true }));
    }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.line !== undefined) {
          setLiveLogs((prev) => {
            const cur = prev[projectId] || [];
            const next = cur.length >= 500 ? cur.slice(-499) : cur;
            return { ...prev, [projectId]: [...next, { t: msg.t, line: msg.line }] };
          });
        }
      } catch {}
    };
    ws.onclose = () => { setLiveOn((prev) => ({ ...prev, [projectId]: false })); delete wsRef.current[projectId]; };
    ws.onerror = () => { setLiveOn((prev) => ({ ...prev, [projectId]: false })); };
  }
  function stopLiveLogs(projectId: string) {
    const ws = wsRef.current[projectId];
    if (ws) ws.close();
    setLiveOn((prev) => ({ ...prev, [projectId]: false }));
  }
  // Clean up all sockets on unmount.
  useEffect(() => () => {
    Object.values(wsRef.current).forEach((ws) => { try { ws.close(); } catch {} });
  }, []);

  // Auto-scroll live log panes to bottom when new lines arrive (unless the
  // user has turned autoscroll off).
  useEffect(() => {
    Object.entries(liveLogs).forEach(([pid, lines]) => {
      if (!lines || !liveAutoscroll[pid]) return;
      const el = liveScrollRef.current[pid];
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [liveLogs, liveAutoscroll]);

  // ── Cron jobs ──
  async function loadCrons(projectId: string) {
    try {
      const res = await fetch(`${API}/api/v1/projects/${projectId}/crons`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setCrons((prev) => ({ ...prev, [projectId]: Array.isArray(data) ? data : [] }));
      }
    } catch {}
  }

  async function loadMetrics(projectId: string, range: string = "1h") {
    try {
      const res = await fetch(`${API}/api/v1/projects/${projectId}/metrics?range=${range}`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setMetrics((prev) => ({ ...prev, [projectId]: Array.isArray(data.samples) ? data.samples : [] }));
        setMetricsRange((prev) => ({ ...prev, [projectId]: range }));
      }
    } catch {}
  }

  async function loadSiteAnalytics(projectId: string, range: string = "24h") {
    try {
      const [oRes, ...topReses] = await Promise.all([
        fetch(`${API}/api/v1/projects/${projectId}/analytics?range=${range}`, { headers: headers() }),
        ...["path", "referrer", "country", "browser", "device"].map((f) =>
          fetch(`${API}/api/v1/projects/${projectId}/analytics/top?field=${f}&range=${range}`, { headers: headers() }),
        ),
      ]);
      if (oRes.ok) {
        const data = await oRes.json();
        setSiteData((prev) => ({ ...prev, [projectId]: data }));
        setSiteRange((prev) => ({ ...prev, [projectId]: range }));
      }
      const topByField: Record<string, SiteTopRow[]> = {};
      const fields = ["path", "referrer", "country", "browser", "device"];
      for (let i = 0; i < topReses.length; i++) {
        if (topReses[i].ok) {
          const rows = await topReses[i].json();
          topByField[fields[i]] = Array.isArray(rows) ? rows : [];
        }
      }
      setSiteTop((prev) => ({ ...prev, [projectId]: topByField }));
    } catch {}
  }
  async function addCron(projectId: string) {
    if (!cronForm.schedule || !cronForm.command) { alert("Schedule and command are required"); return; }
    const res = await fetch(`${API}/api/v1/projects/${projectId}/crons`, {
      method: "POST", headers: headers(),
      body: JSON.stringify(cronForm),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed" }));
      alert(err.error || "Failed to create cron");
      return;
    }
    setCronForm({ name: "", schedule: "0 3 * * *", command: "" });
    setEditingCron(null);
    loadCrons(projectId);
  }
  async function toggleCron(c: Cron) {
    await fetch(`${API}/api/v1/projects/${c.project_id}/crons/${c.id}`, {
      method: "PUT", headers: headers(),
      body: JSON.stringify({ name: c.name, schedule: c.schedule, command: c.command, enabled: !c.enabled }),
    });
    loadCrons(c.project_id);
  }
  async function deleteCron(c: Cron) {
    if (!confirm(`Delete cron "${c.name}"?`)) return;
    await fetch(`${API}/api/v1/projects/${c.project_id}/crons/${c.id}`, {
      method: "DELETE", headers: headers(),
    });
    loadCrons(c.project_id);
  }

  async function saveBuildConfig(id: string, redeploy: boolean) {
    setSavingBuild(true);
    try {
      const res = await fetch(`${API}/api/v1/projects/${id}/build-config`, {
        method: "PUT", headers: headers(),
        body: JSON.stringify(buildCfg),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        alert(err.error || "Failed to save build config");
        setSavingBuild(false);
        return;
      }
      setEditingBuild(null);
      if (redeploy) deploy(id);
      load();
    } catch {
      alert("Failed to save build config");
    }
    setSavingBuild(false);
  }

  // Database + backup helpers moved to /services page (one place to manage all
  // databases, whether project-linked or standalone).

  async function disconnectGH() {
    await fetch(`${API}/api/v1/github`, { method: "DELETE", headers: headers() });
    setGhConnected(false); setGhUsername(""); setGhRepos([]);
  }

  async function toggleAutoDeploy(id: string, enabled: boolean) {
    setTogglingAutoDeploy(id);
    try {
      await fetch(`${API}/api/v1/projects/${id}/auto-deploy`, {
        method: "PUT", headers: headers(),
        body: JSON.stringify({ enabled }),
      });
      setProjects((prev) => prev.map((p) => p.id === id ? { ...p, auto_deploy: enabled } : p));
    } catch {}
    setTogglingAutoDeploy(null);
  }

  useEffect(() => { load(); loadGHStatus(); loadDomains(); }, []);
  useEffect(() => {
    if (!selectedProject) return;
    loadLogs(selectedProject);
    loadCrons(selectedProject);
    loadMetrics(selectedProject, metricsRange[selectedProject] || "1h");
    loadSiteAnalytics(selectedProject, siteRange[selectedProject] || "24h");
    const t = setInterval(() => loadLogs(selectedProject), 5000);
    // Refresh metrics at 30s (matches scraper cadence).
    const m = setInterval(() => loadMetrics(selectedProject, metricsRange[selectedProject] || "1h"), 30000);
    // Refresh analytics every 30s too — realtime counter should feel live.
    const a = setInterval(() => loadSiteAnalytics(selectedProject, siteRange[selectedProject] || "24h"), 30000);
    return () => { clearInterval(t); clearInterval(m); clearInterval(a); };
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
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Environment Variables <span className="text-[10px] text-muted-foreground font-normal">(optional)</span></label>
              <textarea
                value={importEnvText}
                onChange={(e) => setImportEnvText(e.target.value)}
                placeholder={"DATABASE_URL=postgresql://...\nAPI_KEY=sk_live_...\nNODE_ENV=production"}
                className="w-full h-24 rounded-md border border-input bg-[#09090b] px-3 py-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-700 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <p className="text-[10px] text-muted-foreground">KEY=VALUE format, one per line. You can edit these anytime after deployment.</p>
            </div>

            {/* Advanced Build & Runtime Settings */}
            <div className="rounded-lg border border-border/40 overflow-hidden">
              <button type="button" onClick={() => setImportShowAdvanced(!importShowAdvanced)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors">
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
                      <label className="text-[10px] text-muted-foreground">Root Directory <span className="text-zinc-600">(monorepos)</span></label>
                      <input type="text" placeholder="apps/web" value={importBuildCfg.root_dir} onChange={(e) => setImportBuildCfg({ ...importBuildCfg, root_dir: e.target.value })} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">Node Version</label>
                      <select value={importBuildCfg.node_version} onChange={(e) => setImportBuildCfg({ ...importBuildCfg, node_version: e.target.value })} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring">
                        <option value="">Default (20)</option>
                        <option value="18">Node 18</option>
                        <option value="20">Node 20</option>
                        <option value="22">Node 22</option>
                      </select>
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-[10px] text-muted-foreground">Install Command</label>
                      <input type="text" placeholder="npm ci" value={importBuildCfg.install_cmd} onChange={(e) => setImportBuildCfg({ ...importBuildCfg, install_cmd: e.target.value })} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring" />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-[10px] text-muted-foreground">Build Command</label>
                      <input type="text" placeholder="npm run build" value={importBuildCfg.build_cmd} onChange={(e) => setImportBuildCfg({ ...importBuildCfg, build_cmd: e.target.value })} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring" />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-[10px] text-muted-foreground">Start Command</label>
                      <input type="text" placeholder="npm start" value={importBuildCfg.start_cmd} onChange={(e) => setImportBuildCfg({ ...importBuildCfg, start_cmd: e.target.value })} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">Port <span className="text-zinc-600">(0 = auto)</span></label>
                      <input type="number" min="0" max="65535" value={importBuildCfg.port_override || ""} onChange={(e) => setImportBuildCfg({ ...importBuildCfg, port_override: parseInt(e.target.value) || 0 })} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">Memory MB <span className="text-zinc-600">(0 = 512)</span></label>
                      <input type="number" min="0" max="16384" step="128" value={importBuildCfg.memory_mb || ""} onChange={(e) => setImportBuildCfg({ ...importBuildCfg, memory_mb: parseInt(e.target.value) || 0 })} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">CPUs <span className="text-zinc-600">(0 = 0.5)</span></label>
                      <input type="number" min="0" max="8" step="0.25" value={importBuildCfg.cpus || ""} onChange={(e) => setImportBuildCfg({ ...importBuildCfg, cpus: parseFloat(e.target.value) || 0 })} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring" />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-[10px] text-muted-foreground">Health Check Path <span className="text-zinc-600">(e.g. /health; empty = skip)</span></label>
                      <input type="text" placeholder="/health" value={importBuildCfg.health_check_path} onChange={(e) => setImportBuildCfg({ ...importBuildCfg, health_check_path: e.target.value })} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring" />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-[10px] text-muted-foreground">Release Command <span className="text-zinc-600">(runs before start, e.g. migrations)</span></label>
                      <input type="text" placeholder="npx prisma migrate deploy" value={importBuildCfg.release_cmd} onChange={(e) => setImportBuildCfg({ ...importBuildCfg, release_cmd: e.target.value })} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring" />
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
          {/* Label filter bar — only show once there are any labels across projects */}
          {(() => {
            const allLabels = Array.from(new Set(projects.flatMap((p) => p.labels || []))).sort();
            if (allLabels.length === 0) return null;
            return (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-muted-foreground">Filter:</span>
                <button onClick={() => setLabelFilter("")} className={`text-[10px] px-2 py-0.5 rounded-full border ${labelFilter === "" ? "border-foreground/40 bg-white/[0.05]" : "border-border/40 text-muted-foreground"}`}>All</button>
                {allLabels.map((l) => (
                  <button key={l} onClick={() => setLabelFilter(labelFilter === l ? "" : l)} className={`text-[10px] px-2 py-0.5 rounded-full border ${labelFilter === l ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-border/40 text-muted-foreground hover:text-foreground"}`}>{l}</button>
                ))}
              </div>
            );
          })()}
          {projects.filter((p) => labelFilter === "" || (p.labels || []).includes(labelFilter)).map((p) => (
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
                        {(p.labels || []).map((l) => (
                          <Badge key={l} variant="outline" className="text-[10px] text-blue-400 border-blue-500/20 bg-blue-500/5">{l}</Badge>
                        ))}
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

                {/* Auto-Deploy Toggle */}
                {selectedProject === p.id && p.github_repo && (
                  <div className="mt-4 flex items-center justify-between rounded-lg border border-border/40 bg-card/30 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <RefreshCw className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <span className="text-sm font-medium">Auto-Deploy</span>
                        <p className="text-[11px] text-muted-foreground">
                          Automatically redeploy when you push to <span className="font-mono font-medium text-foreground">{p.github_branch || p.branch || "main"}</span>
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => toggleAutoDeploy(p.id, !p.auto_deploy)}
                      disabled={togglingAutoDeploy === p.id}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ${
                        p.auto_deploy ? "bg-emerald-500" : "bg-zinc-700"
                      } ${togglingAutoDeploy === p.id ? "opacity-50" : ""}`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-200 ${
                          p.auto_deploy ? "translate-x-[18px]" : "translate-x-[3px]"
                        }`}
                      />
                    </button>
                  </div>
                )}

                {/* Labels editor */}
                {selectedProject === p.id && (
                  <div className="mt-4">
                    {editingLabels === p.id ? (
                      <div className="rounded-lg border border-border/40 p-3 space-y-2">
                        <label className="text-[10px] text-muted-foreground">Labels <span className="text-zinc-600">(comma-separated, max 10)</span></label>
                        <input type="text" value={labelsInput} onChange={(e) => setLabelsInput(e.target.value)} placeholder="prod, api, client-work" className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring" />
                        <div className="flex gap-2">
                          <Button size="sm" className="h-7 text-xs" onClick={() => saveLabels(p.id)}>Save</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingLabels(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => { setEditingLabels(p.id); setLabelsInput((p.labels || []).join(", ")); }}>
                        <Code className="h-3 w-3" /> Labels
                        {(p.labels || []).length > 0 && <Badge variant="outline" className="ml-1 text-[9px]">{(p.labels || []).length}</Badge>}
                      </Button>
                    )}
                  </div>
                )}

                {/* Custom Domains (inline) */}
                {selectedProject === p.id && (
                  <div className="mt-3 rounded-lg border border-border/40 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium">Custom Domains</span>
                    </div>
                    {allDomains.filter((d) => d.target_type === "project" && d.target_subdomain === p.subdomain).map((d) => (
                      <div key={d.id} className="flex items-center justify-between text-xs rounded-md bg-[#09090b] px-2.5 py-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <a href={`https://${d.domain}`} target="_blank" rel="noopener" className="font-mono text-zinc-300 hover:text-foreground truncate">{d.domain}</a>
                          {d.verified ? (
                            <Badge variant="outline" className="text-[9px] text-emerald-500 border-emerald-500/20">verified</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px] text-amber-500 border-amber-500/20">needs CNAME</Badge>
                          )}
                        </div>
                        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] text-destructive hover:text-destructive" onClick={() => unbindDomain(d.id)}>Unbind</Button>
                      </div>
                    ))}
                    {/* Unverified domains owned by user, not yet bound — show as options to verify */}
                    {allDomains.filter((d) => !d.verified && !d.target_subdomain).length > 0 && (
                      <div className="text-[10px] text-muted-foreground">
                        <span>Pending verification — set CNAME, then verify at <a href="/domains" className="text-blue-400 hover:underline">/domains</a></span>
                      </div>
                    )}
                    <div className="flex gap-1">
                      <input
                        type="text"
                        placeholder="app.yourdomain.com"
                        value={newDomain[p.id] || ""}
                        onChange={(e) => setNewDomain((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        className="flex-1 h-7 rounded-md border border-input bg-[#09090b] px-2 font-mono text-[11px] text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <Button size="sm" className="h-7 px-2 text-xs" onClick={() => addProjectDomain(p)} disabled={addingDomain === p.id || !newDomain[p.id]}>
                        {addingDomain === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
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

                {/* Build Config */}
                {selectedProject === p.id && (
                  <div className="mt-3">
                    {editingBuild === p.id ? (
                      <div className="rounded-lg border border-border/40 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium flex items-center gap-1.5"><Settings2 className="h-3.5 w-3.5" /> Build &amp; Runtime Settings</span>
                          <span className="text-[10px] text-muted-foreground">Leave blank to use defaults</span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-[10px] text-muted-foreground">Root Directory <span className="text-zinc-600">(monorepos)</span></label>
                            <input type="text" placeholder="apps/web" value={buildCfg.root_dir} onChange={(e) => setBuildCfg({ ...buildCfg, root_dir: e.target.value })} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-muted-foreground">Node Version</label>
                            <select value={buildCfg.node_version} onChange={(e) => setBuildCfg({ ...buildCfg, node_version: e.target.value })} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring">
                              <option value="">Default (20)</option>
                              <option value="18">Node 18</option>
                              <option value="20">Node 20</option>
                              <option value="22">Node 22</option>
                            </select>
                          </div>
                          <div className="space-y-1 md:col-span-2">
                            <label className="text-[10px] text-muted-foreground">Install Command</label>
                            <input type="text" placeholder="npm ci" value={buildCfg.install_cmd} onChange={(e) => setBuildCfg({ ...buildCfg, install_cmd: e.target.value })} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring" />
                          </div>
                          <div className="space-y-1 md:col-span-2">
                            <label className="text-[10px] text-muted-foreground">Build Command</label>
                            <input type="text" placeholder="npm run build" value={buildCfg.build_cmd} onChange={(e) => setBuildCfg({ ...buildCfg, build_cmd: e.target.value })} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring" />
                          </div>
                          <div className="space-y-1 md:col-span-2">
                            <label className="text-[10px] text-muted-foreground">Start Command</label>
                            <input type="text" placeholder="npm start" value={buildCfg.start_cmd} onChange={(e) => setBuildCfg({ ...buildCfg, start_cmd: e.target.value })} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-muted-foreground">Port Override <span className="text-zinc-600">(0 = auto)</span></label>
                            <input type="number" min="0" max="65535" value={buildCfg.port_override || ""} onChange={(e) => setBuildCfg({ ...buildCfg, port_override: parseInt(e.target.value) || 0 })} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-muted-foreground">Memory MB <span className="text-zinc-600">(0 = 512)</span></label>
                            <input type="number" min="0" max="16384" step="128" value={buildCfg.memory_mb || ""} onChange={(e) => setBuildCfg({ ...buildCfg, memory_mb: parseInt(e.target.value) || 0 })} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-muted-foreground">CPUs <span className="text-zinc-600">(0 = 0.5)</span></label>
                            <input type="number" min="0" max="8" step="0.25" value={buildCfg.cpus || ""} onChange={(e) => setBuildCfg({ ...buildCfg, cpus: parseFloat(e.target.value) || 0 })} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring" />
                          </div>
                          <div className="space-y-1 md:col-span-2">
                            <label className="text-[10px] text-muted-foreground">Health Check Path <span className="text-zinc-600">(e.g. /health; empty = skip)</span></label>
                            <input type="text" placeholder="/health" value={buildCfg.health_check_path} onChange={(e) => setBuildCfg({ ...buildCfg, health_check_path: e.target.value })} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring" />
                          </div>
                          <div className="space-y-1 md:col-span-2">
                            <label className="text-[10px] text-muted-foreground">Release Command <span className="text-zinc-600">(runs before start, e.g. migrations)</span></label>
                            <input type="text" placeholder="npx prisma migrate deploy" value={buildCfg.release_cmd} onChange={(e) => setBuildCfg({ ...buildCfg, release_cmd: e.target.value })} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 font-mono text-xs text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring" />
                          </div>
                          <div className="space-y-1 md:col-span-2">
                            <label className="text-[10px] text-muted-foreground">Build Mode</label>
                            <select value={buildCfg.build_mode} onChange={(e) => setBuildCfg({ ...buildCfg, build_mode: e.target.value })} className="w-full h-8 rounded-md border border-input bg-[#09090b] px-2 text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring">
                              <option value="">Auto (use repo Dockerfile if present)</option>
                              <option value="ignore_dockerfile">Ignore repo Dockerfile — always auto-generate</option>
                            </select>
                          </div>
                        </div>

                        <div className="flex gap-2 pt-1">
                          <Button size="sm" className="h-7 text-xs" onClick={() => saveBuildConfig(p.id, true)} disabled={savingBuild}>
                            {savingBuild ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                            Save &amp; Redeploy
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => saveBuildConfig(p.id, false)} disabled={savingBuild}>Save Only</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingBuild(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => openBuildConfig(p)}>
                          <Settings2 className="h-3 w-3" /> Build &amp; Runtime
                          {(p.install_cmd || p.build_cmd || p.start_cmd || p.root_dir || p.node_version || p.port_override || p.memory_mb || p.cpus || p.health_check_path || p.release_cmd) ? (
                            <Badge variant="outline" className="ml-1 text-[9px] text-emerald-500 border-emerald-500/20">customized</Badge>
                          ) : null}
                        </Button>
                        {p.github_repo && (
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => loadCommits(p)} disabled={loadingCommits === p.id}>
                            <GitBranch className="h-3 w-3" />
                            {loadingCommits === p.id ? "Loading..." : "Deploy Commit"}
                          </Button>
                        )}
                        {p.commit_sha && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            @ {p.commit_sha.slice(0, 7)}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Commits dropdown (rollback / pinned deploy) */}
                    {selectedProject === p.id && commits[p.id] && commits[p.id].length > 0 && editingBuild !== p.id && (
                      <div className="mt-2 rounded-lg border border-border/40 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium">Recent commits on {p.github_branch || p.branch || "main"}</span>
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setCommits((prev) => { const n = { ...prev }; delete n[p.id]; return n; })}>Close</Button>
                        </div>
                        <div className="space-y-1 max-h-64 overflow-y-auto">
                          {commits[p.id].map((c) => (
                            <label key={c.sha} className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs cursor-pointer hover:bg-white/[0.03] ${selectedCommit[p.id] === c.sha ? "bg-white/[0.05]" : ""}`}>
                              <input type="radio" name={`commit-${p.id}`} checked={selectedCommit[p.id] === c.sha} onChange={() => setSelectedCommit((prev) => ({ ...prev, [p.id]: c.sha }))} className="accent-emerald-500" />
                              <code className="text-[10px] text-emerald-500">{c.sha.slice(0, 7)}</code>
                              <span className="flex-1 truncate">{c.message}</span>
                              <span className="text-[10px] text-muted-foreground hidden md:inline">{c.author}</span>
                              {p.commit_sha === c.sha && <Badge variant="outline" className="text-[9px] text-emerald-500 border-emerald-500/20">current</Badge>}
                            </label>
                          ))}
                        </div>
                        <div className="flex gap-2 pt-1">
                          <Button size="sm" className="h-7 text-xs" disabled={!selectedCommit[p.id] || deploying === p.id} onClick={() => { deployCommit(p.id, selectedCommit[p.id]); setCommits((prev) => { const n = { ...prev }; delete n[p.id]; return n; }); }}>
                            {deploying === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                            Deploy selected
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Database UI moved to /services — a project's DB now shows up there
                    with a "linked to {project}" badge. If you still want to view or
                    manage it, head to /services. */}

                {/* Metrics */}
                {selectedProject === p.id && p.status === "running" && !showMetrics[p.id] && (
                  <div className="mt-4">
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowMetrics((prev) => ({ ...prev, [p.id]: true }))}>
                      <Activity className="h-3 w-3" /> Resource Metrics
                    </Button>
                  </div>
                )}
                {selectedProject === p.id && p.status === "running" && showMetrics[p.id] && (() => {
                  const samples = metrics[p.id] || [];
                  const range = metricsRange[p.id] || "1h";
                  const latest = samples.length ? samples[samples.length - 1] : null;
                  const cpuArr = samples.map((s) => s.cpu_pct);
                  const memArr = samples.map((s) => s.memory_mb);
                  const netInArr = samples.map((s) => s.net_rx_bytes);
                  const netOutArr = samples.map((s) => s.net_tx_bytes);
                  const fmtBytes = (n: number) => n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(1)} kB` : `${n} B`;
                  return (
                    <div className="mt-4 rounded-lg border border-border/40 p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs font-medium">Resource Metrics</span>
                          {samples.length === 0 && <span className="text-[10px] text-zinc-600">(collecting...)</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            {(["1h", "6h", "24h", "7d"] as const).map((r) => (
                              <button key={r} onClick={() => loadMetrics(p.id, r)} className={`text-[10px] px-2 py-0.5 rounded-full border ${range === r ? "border-foreground/40 bg-white/[0.05]" : "border-border/40 text-muted-foreground hover:text-foreground"}`}>{r}</button>
                            ))}
                          </div>
                          <Button variant="ghost" size="sm" className="h-5 w-5 p-0 hover:text-destructive" onClick={() => setShowMetrics((prev) => ({ ...prev, [p.id]: false }))} title="Close">
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <div className="flex items-baseline justify-between">
                            <span className="text-[10px] text-muted-foreground">CPU</span>
                            <span className="text-xs font-mono text-emerald-400">{latest ? `${latest.cpu_pct.toFixed(1)}%` : "—"}</span>
                          </div>
                          <Sparkline values={cpuArr} color="#10b981" />
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-baseline justify-between">
                            <span className="text-[10px] text-muted-foreground">Memory</span>
                            <span className="text-xs font-mono text-blue-400">{latest ? `${latest.memory_mb} / ${latest.memory_limit_mb} MB` : "—"}</span>
                          </div>
                          <Sparkline values={memArr} color="#60a5fa" />
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-baseline justify-between">
                            <span className="text-[10px] text-muted-foreground">Network</span>
                            <span className="text-xs font-mono text-amber-400">{latest ? `↓ ${fmtBytes(latest.net_rx_bytes)}` : "—"}</span>
                          </div>
                          <Sparkline values={netInArr} color="#fbbf24" />
                          <div className="flex items-baseline justify-between pt-1">
                            <span className="text-[10px] text-muted-foreground">Out</span>
                            <span className="text-xs font-mono text-orange-400">{latest ? `↑ ${fmtBytes(latest.net_tx_bytes)}` : "—"}</span>
                          </div>
                          <Sparkline values={netOutArr} color="#fb923c" height={20} />
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Website Analytics */}
                {selectedProject === p.id && !showAnalytics[p.id] && (
                  <div className="mt-3">
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowAnalytics((prev) => ({ ...prev, [p.id]: true }))}>
                      <BarChart3 className="h-3 w-3" /> Website Analytics
                      {siteData[p.id]?.realtime?.visitors ? (
                        <Badge variant="outline" className="ml-1 text-[9px] text-emerald-500 border-emerald-500/20">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse mr-1" />
                          {siteData[p.id].realtime.visitors} live
                        </Badge>
                      ) : null}
                    </Button>
                  </div>
                )}
                {selectedProject === p.id && showAnalytics[p.id] && (() => {
                  const data = siteData[p.id];
                  const range = siteRange[p.id] || "24h";
                  const top = siteTop[p.id] || {};
                  const tsPoints = data?.timeseries || [];
                  const pvArr = tsPoints.map((t) => t.pageviews);
                  const vArr = tsPoints.map((t) => t.visitors);
                  const fmtNum = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
                  return (
                    <div className="mt-4 rounded-lg border border-border/40 p-3 space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs font-medium">Website Analytics</span>
                          {data?.realtime?.visitors ? (
                            <span className="flex items-center gap-1 text-[10px] text-emerald-500">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              {data.realtime.visitors} visitor{data.realtime.visitors === 1 ? "" : "s"} right now
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            {(["24h", "7d", "30d"] as const).map((r) => (
                              <button key={r} onClick={() => loadSiteAnalytics(p.id, r)} className={`text-[10px] px-2 py-0.5 rounded-full border ${range === r ? "border-foreground/40 bg-white/[0.05]" : "border-border/40 text-muted-foreground hover:text-foreground"}`}>{r}</button>
                            ))}
                          </div>
                          <Button variant="ghost" size="sm" className="h-5 w-5 p-0 hover:text-destructive" onClick={() => setShowAnalytics((prev) => ({ ...prev, [p.id]: false }))} title="Close">
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>

                      {/* Headline metrics */}
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-md bg-[#09090b] px-3 py-2">
                          <div className="text-[10px] text-muted-foreground">Pageviews</div>
                          <div className="text-lg font-semibold font-mono">{fmtNum(data?.overview?.pageviews || 0)}</div>
                        </div>
                        <div className="rounded-md bg-[#09090b] px-3 py-2">
                          <div className="text-[10px] text-muted-foreground">Unique visitors</div>
                          <div className="text-lg font-semibold font-mono text-emerald-400">{fmtNum(data?.overview?.visitors || 0)}</div>
                        </div>
                        <div className="rounded-md bg-[#09090b] px-3 py-2">
                          <div className="text-[10px] text-muted-foreground">Bots filtered</div>
                          <div className="text-lg font-semibold font-mono text-zinc-500">{fmtNum(data?.overview?.bots || 0)}</div>
                        </div>
                      </div>

                      {/* Time series */}
                      <div className="rounded-md bg-[#09090b] px-3 py-2 space-y-1">
                        <div className="flex items-baseline justify-between">
                          <span className="text-[10px] text-muted-foreground">Traffic over time</span>
                          <span className="text-[10px] text-zinc-600">pageviews · visitors</span>
                        </div>
                        <Sparkline values={pvArr} color="#60a5fa" height={40} />
                        <Sparkline values={vArr} color="#10b981" height={24} />
                      </div>

                      {/* Top tables */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {[
                          { field: "path", label: "Top pages" },
                          { field: "referrer", label: "Top referrers" },
                          { field: "country", label: "Top countries" },
                          { field: "browser", label: "Browsers" },
                          { field: "device", label: "Devices" },
                        ].map(({ field, label }) => {
                          const rows = top[field] || [];
                          const maxC = rows.length ? Math.max(...rows.map((r) => r.count)) : 1;
                          return (
                            <div key={field} className="rounded-md bg-[#09090b] px-3 py-2 space-y-1">
                              <div className="text-[10px] text-muted-foreground">{label}</div>
                              {rows.length === 0 && <div className="text-[10px] text-zinc-600 py-1">No data yet</div>}
                              {rows.slice(0, 6).map((row) => (
                                <div key={row.key} className="relative text-[11px] py-0.5">
                                  <div className="absolute inset-y-0 left-0 bg-emerald-500/10 rounded" style={{ width: `${(row.count / maxC) * 100}%` }} />
                                  <div className="relative flex justify-between items-baseline px-1.5 font-mono">
                                    <span className="truncate pr-2 text-zinc-300">{row.key || "(direct)"}</span>
                                    <span className="text-zinc-500 tabular-nums">{row.count}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-[10px] text-zinc-600">Cookieless, privacy-first. Visitor IDs rotate daily and can&apos;t be linked across days. Asset requests (CSS/JS/images) are excluded from pageview counts.</p>

                      {/* Optional JS snippet for SPA route changes + custom events */}
                      <details className="text-[10px] text-zinc-500">
                        <summary className="cursor-pointer hover:text-zinc-300 py-1">Track SPA routes &amp; custom events (optional JS snippet)</summary>
                        <div className="mt-1 space-y-2 pl-2 border-l border-zinc-800">
                          <p>Server-side capture covers every HTTP request automatically. For client-side routing (SPAs) and custom events, add this tag to your site:</p>
                          <code className="block rounded bg-black px-2 py-1.5 font-mono text-[10px] text-zinc-400 break-all">
                            &lt;script defer src=&quot;/__sm/analytics.js&quot;&gt;&lt;/script&gt;
                          </code>
                          <p>Then call <code className="text-emerald-400">window.sm.track(&quot;signup&quot;, {"{ plan: \"pro\" }"})</code> for custom events.</p>
                        </div>
                      </details>
                    </div>
                  );
                })()}

                {/* Cron Jobs */}
                {selectedProject === p.id && !showCrons[p.id] && (
                  <div className="mt-3">
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowCrons((prev) => ({ ...prev, [p.id]: true }))}>
                      <Clock className="h-3 w-3" /> Scheduled Jobs
                      {(crons[p.id] || []).length > 0 && <Badge variant="outline" className="ml-1 text-[9px]">{(crons[p.id] || []).length}</Badge>}
                    </Button>
                  </div>
                )}
                {selectedProject === p.id && showCrons[p.id] && (
                  <div className="mt-4 rounded-lg border border-border/40 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium">Scheduled Jobs</span>
                        {(crons[p.id] || []).length > 0 && <Badge variant="outline" className="text-[9px]">{(crons[p.id] || []).length}</Badge>}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1" onClick={() => setEditingCron(editingCron === p.id ? null : p.id)}>
                          <Plus className="h-3 w-3" /> New job
                        </Button>
                        <Button variant="ghost" size="sm" className="h-5 w-5 p-0 hover:text-destructive" onClick={() => setShowCrons((prev) => ({ ...prev, [p.id]: false }))} title="Close">
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    {(crons[p.id] || []).map((c) => (
                      <div key={c.id} className="rounded-md bg-[#09090b] px-2.5 py-2 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${c.enabled ? "bg-emerald-500/10 text-emerald-500" : "bg-zinc-700/30 text-zinc-500"}`}>{c.enabled ? "on" : "off"}</span>
                            <span className="text-xs font-medium truncate">{c.name}</span>
                            <code className="text-[10px] text-blue-400 font-mono">{c.schedule}</code>
                            {c.last_status === "success" && <Badge variant="outline" className="text-[9px] text-emerald-500 border-emerald-500/20">success</Badge>}
                            {c.last_status === "failed" && <Badge variant="outline" className="text-[9px] text-red-500 border-red-500/20">failed</Badge>}
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => toggleCron(c)}>{c.enabled ? "Pause" : "Resume"}</Button>
                            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-destructive hover:text-destructive" onClick={() => deleteCron(c)}>Delete</Button>
                          </div>
                        </div>
                        <code className="block text-[10px] text-zinc-400 font-mono truncate">$ {c.command}</code>
                        {c.last_run_at && (
                          <div className="text-[10px] text-zinc-600">Last run: {new Date(c.last_run_at).toLocaleString()}</div>
                        )}
                      </div>
                    ))}
                    {editingCron === p.id && (
                      <div className="rounded-md border border-border/40 bg-[#09090b] p-2.5 space-y-2">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="text-[10px] text-muted-foreground">Name</label>
                            <input type="text" placeholder="nightly-backup" value={cronForm.name} onChange={(e) => setCronForm({ ...cronForm, name: e.target.value })} className="w-full h-7 rounded-md border border-input bg-black px-2 font-mono text-[11px] text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] text-muted-foreground">Schedule <span className="text-zinc-600">(cron: min hour day month dow)</span></label>
                            <input type="text" placeholder="0 3 * * *" value={cronForm.schedule} onChange={(e) => setCronForm({ ...cronForm, schedule: e.target.value })} className="w-full h-7 rounded-md border border-input bg-black px-2 font-mono text-[11px] text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring" />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-muted-foreground">Command</label>
                          <input type="text" placeholder="node scripts/cleanup.js" value={cronForm.command} onChange={(e) => setCronForm({ ...cronForm, command: e.target.value })} className="w-full h-7 rounded-md border border-input bg-black px-2 font-mono text-[11px] text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring" />
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" className="h-7 text-xs" onClick={() => addCron(p.id)}>Create</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingCron(null)}>Cancel</Button>
                        </div>
                        <p className="text-[10px] text-zinc-600">Runs in a fresh container built from this project&apos;s image, with the same env vars. Stdout/stderr is captured and shown above.</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Live Container Logs — show only when user opens it. */}
                {selectedProject === p.id && p.status === "running" && !liveOpen[p.id] && (
                  <div className="mt-4">
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => startLiveLogs(p.id)}>
                      <Terminal className="h-3 w-3" /> Live Logs
                    </Button>
                  </div>
                )}
                {selectedProject === p.id && p.status === "running" && liveOpen[p.id] && (
                  <div className="mt-4 rounded-lg border border-border/40 bg-[#09090b] overflow-hidden">
                    <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-white/[0.04] text-[10px] text-zinc-600 font-mono">
                      <div className="flex items-center gap-2 min-w-0">
                        <Terminal className="h-3 w-3 shrink-0" /> <span className="shrink-0">Live Container Logs</span>
                        {liveOn[p.id] && <span className="flex items-center gap-1 text-emerald-500 shrink-0"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> streaming</span>}
                        <span className="text-zinc-700 shrink-0">• {(liveLogs[p.id] || []).length} lines</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {liveOn[p.id] ? (
                          <Button variant="ghost" size="sm" className="h-5 px-2 text-[10px]" onClick={() => stopLiveLogs(p.id)} title="Stop streaming (keeps buffer)">Pause</Button>
                        ) : (
                          <Button variant="ghost" size="sm" className="h-5 px-2 text-[10px]" onClick={() => startLiveLogs(p.id)} title="Resume streaming">Resume</Button>
                        )}
                        <Button variant="ghost" size="sm" className="h-5 px-2 text-[10px]" onClick={() => setLiveLogs((prev) => ({ ...prev, [p.id]: [] }))} title="Clear buffer">Clear</Button>
                        <label className="flex items-center gap-1 text-[10px] text-zinc-500 select-none cursor-pointer" title="Auto-scroll to bottom on new output">
                          <input type="checkbox" checked={!!liveAutoscroll[p.id]} onChange={(e) => setLiveAutoscroll((prev) => ({ ...prev, [p.id]: e.target.checked }))} className="accent-emerald-500 h-3 w-3" />
                          auto
                        </label>
                        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setLiveMin((prev) => ({ ...prev, [p.id]: !prev[p.id] }))} title={liveMin[p.id] ? "Expand" : "Minimize"}>
                          {liveMin[p.id] ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3 rotate-90" />}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-5 w-5 p-0 hover:text-destructive" onClick={() => { stopLiveLogs(p.id); setLiveOpen((prev) => ({ ...prev, [p.id]: false })); }} title="Close (stops stream)">
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    {!liveMin[p.id] && (
                      <div
                        ref={(el) => { liveScrollRef.current[p.id] = el; }}
                        className="p-2 font-mono text-[11px] space-y-0.5 max-h-80 overflow-y-auto"
                        onScroll={(e) => {
                          const el = e.currentTarget;
                          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
                          if (liveAutoscroll[p.id] !== atBottom) {
                            setLiveAutoscroll((prev) => ({ ...prev, [p.id]: atBottom }));
                          }
                        }}
                      >
                        {(liveLogs[p.id] || []).map((l, i) => (
                          <div key={i} className="px-2 py-0.5 text-zinc-300">
                            <span className="text-zinc-700">{l.t ? new Date(l.t).toLocaleTimeString() : ""}</span> {l.line}
                          </div>
                        ))}
                        {(liveLogs[p.id] || []).length === 0 && liveOn[p.id] && (
                          <div className="px-2 py-1 text-zinc-600">Waiting for output...</div>
                        )}
                        {(liveLogs[p.id] || []).length === 0 && !liveOn[p.id] && (
                          <div className="px-2 py-1 text-zinc-600">Stream paused. Click Resume to start again.</div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Deploy Logs */}
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
