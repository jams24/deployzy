// Shared billing types + formatting helpers. The backend meters AI/email usage
// in internal units (1 unit = $0.01) — users only ever see dollars, never
// "credits". Subscription + plan-limit types mirror the API responses.

export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

export interface Subscription {
  id: string;
  plan: string;
  status: string;
  amount: number;
  currency: string;
  period_start: string | null;
  period_end: string | null;
  created_at: string;
}

export interface BillingStatus {
  active_subscription: Subscription | null;
  history: Subscription[];
  grace?: { plan: string; access_ends: string } | null;
}

export interface PlanLimits {
  // Also returned by /users/me/limits (used by the usage view):
  max_db_size_mb: number;
  max_build_memory_mb: number;
  allow_telegram: boolean;
  allow_advanced_databases: boolean;
  plan: string;
  max_subdomains: number; max_tunnels: number;
  max_projects: number; max_databases: number; max_services: number;
  max_custom_domains: number; max_crons: number; max_byoc_servers: number;
  max_preview_deploys: number;
  max_memory_mb: number; max_cpus: number;
  max_bandwidth_gb: number; max_build_minutes_monthly: number;
  allow_previews: boolean; allow_release_cmd: boolean; allow_health_checks: boolean;
  allow_private_repos: boolean; allow_tcp_tunnels: boolean; allow_live_logs: boolean;
}

export interface UsageResponse {
  plan: string;
  is_admin: boolean;
  limits: PlanLimits;
  usage: Record<string, number>; // projects, databases, services, custom_domains, crons, byoc_servers, subdomains, preview_deploys
  build_usage?: { minutes_used: number; minutes_limit: number; builds: number; exceeded: boolean };
  consumption?: { bandwidth_bytes: number; largest_db_mb: number }; // this calendar month
}

export interface PlanCardData {
  id: string;
  name: string;
  price: string;
  tagline: string;
  features: string[];
}

// ── AI credits (pay-as-you-go balance) ──────────────────────────────────────

export interface CreditsStatus {
  free_allotment: number; free_used: number; free_remaining: number;
  wallet: number; available: number; unlimited: boolean;
}
export interface LedgerRow {
  delta: number; reason: string; source: string; project_id: string;
  model: string; tokens_in: number; tokens_out: number; created_at: string;
}
export interface UsageProduct { product: string; label: string; credits: number; count: number; tokens: number; }
export interface UsageDay { day: string; credits: number; }
export interface CreditsUsage {
  products: UsageProduct[]; daily: UsageDay[];
  spent_today: number; spent_month: number; spent_window: number; days: number;
}
export interface CreditsResp {
  enabled: boolean; unlimited: boolean; status: CreditsStatus; ledger: LedgerRow[];
  methods?: { crypto: boolean; card: boolean };
  credits_per_dollar?: number; presets?: number[]; min_usd?: number; max_usd?: number;
  usage?: CreditsUsage; free_allotment?: number;
}

// ── Formatters ──────────────────────────────────────────────────────────────

export const fmtInt = (n: number) => Math.round(n).toLocaleString();

// units → dollars, with extra precision for sub-cent amounts.
export const usd = (units: number) => {
  const d = units / 100;
  const dp = d !== 0 && Math.abs(d) < 1 ? (Math.abs(d) < 0.1 ? 4 : 3) : 2;
  return "$" + d.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: dp });
};

export const timeAgo = (iso: string, now: number | null) => {
  if (now === null) return "";
  const d = (now - new Date(iso).getTime()) / 1000;
  if (d < 45) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
};

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export const reasonLabel: Record<string, string> = {
  build: "App build", edit: "App edit", agent: "Agent chat",
  email_verify: "Email verify", email_verify_batch: "Email verify (batch)",
  topup: "Funds added", monthly_free: "Included usage", refund: "Refund", admin: "Adjustment",
};

export const authHeaders = () => {
  const token = typeof window !== "undefined" ? localStorage.getItem("sm_token") : "";
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
};
