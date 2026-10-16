// Shared types, constants and helpers for the Projects area (list page +
// /projects/[id] detail routes). Extracted from the old monolithic
// projects/page.tsx so every tab can import one source of truth.

import { parseEnvText } from "@/lib/parseEnvText";

export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

export function headers(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("sm_token") : null;
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface Project {
  id: string; name: string; subdomain: string; framework: string;
  repo_url: string; branch: string; github_repo: string; github_branch: string;
  auto_deploy: boolean; status: string;
  env_vars: Record<string, string>;
  install_cmd?: string; build_cmd?: string; start_cmd?: string;
  root_dir?: string; node_version?: string;
  port_override?: number; memory_mb?: number; cpus?: number;
  health_check_path?: string; release_cmd?: string; commit_sha?: string;
  labels?: string[]; build_mode?: string; dockerfile_path?: string;
  services?: ProjectServiceData[];
  preview_enabled?: boolean;
  parent_project_id?: string | null; pr_number?: number; pr_title?: string;
  last_deploy_at: string | null; created_at: string;
  worker_server_id?: string | null;
  deploy_source?: string; // "git" | "upload" | "image"
}

export interface BuildConfig {
  install_cmd: string; build_cmd: string; start_cmd: string;
  root_dir: string; node_version: string;
  port_override: number; memory_mb: number; cpus: number;
  health_check_path: string; release_cmd: string;
  build_mode: string; dockerfile_path: string;
}

export const emptyBuildConfig: BuildConfig = {
  install_cmd: "", build_cmd: "", start_cmd: "",
  root_dir: "", node_version: "",
  port_override: 0, memory_mb: 0, cpus: 0,
  health_check_path: "", release_cmd: "",
  build_mode: "", dockerfile_path: "",
};

// ServiceCfg is one extra service as edited in the UI (env held as text,
// converted to a map on submit).
export interface ServiceCfg {
  name: string; root_dir: string; port: number; framework: string;
  install_cmd: string; build_cmd: string; start_cmd: string; env_text: string;
}
// ProjectServiceData is the persisted shape returned by the API (env as a map).
export interface ProjectServiceData {
  name: string; root_dir: string; port: number; framework: string;
  install_cmd: string; build_cmd: string; start_cmd: string;
  env_overrides?: Record<string, string>;
}

export interface Domain {
  id: string; domain: string; verified: boolean;
  target_type: string; target_subdomain: string;
  cname_target: string;
}
export interface Cron {
  id: string; project_id: string; name: string;
  schedule: string; command: string; enabled: boolean;
  last_run_at: string | null; last_status: string; last_output: string;
  created_at: string;
}
export interface LiveLog { t: string; line: string; }
export interface MetricSample {
  ts: string; cpu_pct: number;
  memory_mb: number; memory_limit_mb: number;
  net_rx_bytes: number; net_tx_bytes: number;
}
export interface SiteOverview {
  overview: { pageviews: number; visitors: number; bots: number };
  timeseries: { ts: string; pageviews: number; visitors: number }[];
  realtime: { visitors: number; pageviews: number };
}
export interface SiteTopRow { key: string; count: number }
export interface Commit { sha: string; message: string; author: string; date: string; }
export interface DeployLog { message: string; level: string; created_at: string; }
export interface GitHubRepo {
  id: number; name: string; full_name: string; private: boolean;
  description: string; language: string; default_branch: string;
  html_url: string; updated_at: string;
}
export interface MoveTarget { id: string; label: string; region: string; is_byoc: boolean; full: boolean }
export interface UserServer { id: string; label: string; host: string; status: string }
export interface Bandwidth {
  project_gb: number; account_gb: number; limit_gb: number;
  pct: number; exceeded: boolean; period_start: string;
}

// ── Display helpers ──────────────────────────────────────────────────────────

// Solid dot per status — a coloured dot next to the name reads faster than a
// pill badge, and frees the header row for the project name.
export const statusDot: Record<string, string> = {
  running: "bg-emerald-500",
  building: "bg-amber-500 animate-pulse",
  stopped: "bg-zinc-500",
  failed: "bg-red-500",
  crashed: "bg-red-500",
  created: "bg-blue-500",
};

export const statusColor: Record<string, string> = {
  running: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  building: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  stopped: "bg-zinc-500/10 text-muted-foreground border-zinc-500/20",
  failed: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",
  crashed: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",
  created: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
};

export function timeAgo(iso: string | null): string {
  if (!iso) return "never deployed";
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function detectFramework(language: string | null): string {
  switch (language) {
    case "TypeScript": case "JavaScript": return "node";
    case "Python": return "python";
    case "Go": return "docker";
    case "HTML": case "CSS": return "static";
    default: return "node";
  }
}

// previewSubdomainExample mirrors the server's previewSubdomain() helper —
// purely cosmetic so the UI hint shows the URL pattern users will get.
export function previewSubdomainExample(parent: string): string {
  const suffix = "-pr-123";
  const max = 63 - suffix.length;
  const p = parent.length > max ? parent.slice(0, max) : parent;
  return `${p}${suffix}.deployzy.app`;
}

// ── Multi-service helpers ────────────────────────────────────────────────────

// makeService builds a fresh service row pre-filled with sensible defaults.
export function makeService(existingCount: number): ServiceCfg {
  const idx = existingCount + 1;
  return { name: `service-${idx}`, root_dir: "", port: 3000 + idx, framework: "",
    install_cmd: "npm install", build_cmd: "npm run build", start_cmd: "npm run start", env_text: "" };
}
// serviceToCfg converts the persisted map shape to the text-based editing shape.
export function serviceToCfg(s: ProjectServiceData): ServiceCfg {
  const env = s.env_overrides || {};
  return {
    name: s.name, root_dir: s.root_dir, port: s.port, framework: s.framework || "",
    install_cmd: s.install_cmd, build_cmd: s.build_cmd, start_cmd: s.start_cmd,
    env_text: Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n"),
  };
}
// servicesPayload converts UI rows to the API shape (env text → map), dropping
// incomplete rows. Returns [] when multi-service is off.
export function servicesPayload(enabled: boolean, rows: ServiceCfg[]) {
  if (!enabled) return [];
  return rows
    .filter((s) => s.name && s.root_dir)
    .map((s) => ({
      name: s.name, root_dir: s.root_dir, port: s.port, framework: s.framework,
      install_cmd: s.install_cmd, build_cmd: s.build_cmd, start_cmd: s.start_cmd,
      env_overrides: s.env_text.trim() ? parseEnvText(s.env_text) : {},
    }));
}

// detectStackFor infers a directory's stack from its files (mirrors the
// server's framework detection), powering each service's Detected Stack field.
export async function detectStackFor(repo: string, branch: string, dir: string): Promise<string> {
  if (!repo) return "node";
  const token = localStorage.getItem("sm_token");
  const qs = new URLSearchParams({ repo, branch: branch || "main", path: dir });
  try {
    const r = await fetch(`${API}/api/v1/github/contents?${qs.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return "node";
    const entries: { name: string; type: string }[] = await r.json();
    const names = entries.map((e) => e.name);
    if (names.some((n) => n.startsWith("next.config"))) return "nextjs";
    if (names.includes("requirements.txt") || names.includes("pyproject.toml") || names.includes("Pipfile")) return "python";
    if (names.includes("package.json")) return "node";
    if (names.includes("index.html")) return "static";
    return "node";
  } catch {
    return "node";
  }
}

// ── Formatters ───────────────────────────────────────────────────────────────

export function fmtBytes(n: number): string {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(1)} kB` : `${n} B`;
}

export function fmtGB(n: number): string {
  const bytes = n * 1024 * 1024 * 1024;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${n.toFixed(2)} GB`;
}

export function fmtNum(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
