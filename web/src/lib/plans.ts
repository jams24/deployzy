// Shared pricing model. The NUMBERS come live from plan_limits (via the public
// /api/v1/plans endpoint) so admin edits reflect on both the dashboard billing
// page and the landing page without a redeploy. The PROSE that isn't a column
// (price, name, tagline, CTA, curated extras) stays here as static metadata.
//
// Usable from both server and client components — pure fetch + string building.

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

export interface PlanLimits {
  plan: string;
  max_projects: number; max_databases: number; max_db_size_mb: number;
  max_services: number; max_custom_domains: number; max_subdomains: number;
  max_tunnels: number; max_byoc_servers: number; max_crons: number;
  max_preview_deploys: number; max_memory_mb: number; max_cpus: number;
  max_bandwidth_gb: number; max_build_minutes_monthly: number;
  analytics_retention_days: number; deploy_log_retention_days: number; backup_retention_days: number;
  allow_previews: boolean; allow_private_repos: boolean; allow_tcp_tunnels: boolean;
  allow_live_logs: boolean; allow_health_checks: boolean; allow_release_cmd: boolean;
  allow_telegram: boolean; allow_advanced_databases: boolean; allow_db_migration: boolean;
}

export interface PlanMeta {
  id: string; name: string; price: string; period: string;
  tagline: string; cta: string; accent: string; popular: boolean; order: number;
  extras: string[]; // curated bullets not derivable from limits
}

// Price/name/tagline/etc. are intentionally NOT driven from the DB: price must
// stay in lock-step with the checkout products, so it's changed deliberately
// here, not as a side effect of editing a limit.
export const PLAN_META: Record<string, PlanMeta> = {
  free:  { id: "free",  name: "Free",  price: "$0",  period: "",           tagline: "For hobby projects and learning",          cta: "Get started",      accent: "border-[#30363d]/40",   popular: false, order: 0, extras: [] },
  hobby: { id: "hobby", name: "Hobby", price: "$5",  period: "mo",         tagline: "Perfect for indie hackers and side projects", cta: "Start with Hobby", accent: "border-emerald-500/30", popular: false, order: 1, extras: [] },
  pro:   { id: "pro",   name: "Pro",   price: "$12", period: "mo",         tagline: "Built for production-ready applications",  cta: "Upgrade to Pro",   accent: "border-primary/30",     popular: true,  order: 2, extras: [] },
  team:  { id: "team",  name: "Team",  price: "$35", period: "mo per seat", tagline: "For small teams shipping in production",   cta: "Upgrade to Team",  accent: "border-emerald-500/30", popular: false, order: 3, extras: ["Multi-user collaboration (min 2 seats)", "Priority support"] },
};

const num = (v: number) => (v < 0 ? "Unlimited" : String(v));
function size(mb: number): string {
  if (mb < 0) return "Unlimited";
  if (mb >= 1024) return `${+(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`;
  return `${mb} MB`;
}

// buildFeatures turns the enforced limits into the display bullet list, so the
// numbers always match what the backend actually allows.
export function buildFeatures(l: PlanLimits): string[] {
  const feats: string[] = [
    `${num(l.max_projects)} projects · ${num(l.max_databases)} databases`,
    `${size(l.max_db_size_mb)} database storage`,
    `${size(l.max_memory_mb)} RAM / ${l.max_cpus < 0 ? "∞" : l.max_cpus} vCPU per project`,
    `${num(l.max_bandwidth_gb)} GB bandwidth · ${num(l.max_build_minutes_monthly)} build min/mo`,
    `${num(l.max_subdomains)} subdomains · ${num(l.max_tunnels)} tunnels · ${num(l.max_custom_domains)} custom domains`,
    `${num(l.max_byoc_servers)} BYOC servers · ${num(l.max_services)} services · ${num(l.max_crons)} cron jobs`,
  ];

  // Capabilities from boolean flags (only shown when enabled).
  const caps: string[] = [];
  if (l.max_preview_deploys !== 0) caps.push(`${num(l.max_preview_deploys)} PR previews`);
  if (l.allow_advanced_databases) caps.push("Redis, Mongo & MySQL");
  if (l.allow_db_migration) caps.push("Migrate existing DBs");
  if (l.allow_private_repos) caps.push("Private repos");
  if (l.allow_tcp_tunnels) caps.push("TCP/TLS tunnels");
  if (l.allow_live_logs) caps.push("Live logs");
  if (l.allow_health_checks) caps.push("Health checks");
  if (l.allow_release_cmd) caps.push("Release commands");
  if (l.allow_telegram) caps.push("Telegram alerts");
  for (let i = 0; i < caps.length; i += 3) feats.push(caps.slice(i, i + 3).join(" · "));

  // Retention.
  const ret = [`${num(l.analytics_retention_days)}-day analytics`, `${num(l.deploy_log_retention_days)}-day logs`];
  if (l.backup_retention_days > 0) ret.push(`${num(l.backup_retention_days)}-day backups`);
  feats.push(ret.join(" · "));
  return feats;
}

export interface PlanCard extends PlanMeta {
  limits: PlanLimits;
  features: string[];
}

// fetchPlanCards pulls live limits and merges them with the static metadata.
// Returns null on any failure so callers fall back to their static defaults
// (keeps the pages resilient if the API is briefly unreachable).
// revalidateSeconds enables ISR caching in server components (ignored on client).
export async function fetchPlanCards(revalidateSeconds?: number): Promise<PlanCard[] | null> {
  try {
    const opts = revalidateSeconds ? { next: { revalidate: revalidateSeconds } } : undefined;
    const res = await fetch(`${API}/api/v1/plans`, opts as RequestInit);
    if (!res.ok) return null;
    const limits: PlanLimits[] = await res.json();
    const cards: PlanCard[] = [];
    for (const l of limits) {
      const meta = PLAN_META[l.plan];
      if (!meta) continue; // ignore unknown/internal plans
      cards.push({ ...meta, limits: l, features: [...buildFeatures(l), ...meta.extras] });
    }
    cards.sort((a, b) => a.order - b.order);
    return cards.length ? cards : null;
  } catch {
    return null;
  }
}
