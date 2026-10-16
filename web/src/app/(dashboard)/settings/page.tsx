"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type User } from "@/lib/api";
import { ReferralsSection } from "@/components/dashboard/referrals-section";
import { WebhooksSection } from "@/components/dashboard/webhooks-section";
import {
  User as UserIcon, Mail, ShieldCheck, ShieldAlert, Calendar, Crown,
  Rocket, Database, Layers, Globe, Link2, Clock, Check, Loader2,
  Cpu, MemoryStick, Gauge, ArrowUpRight, AlertTriangle,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Settings — profile, usage, plan, danger zone. Rebuilt with the Deployzy
// dashboard card language: a profile hero, live usage meters, and real plan
// caps so the page reflects the account instead of feeling empty.
// ─────────────────────────────────────────────────────────────────────────────

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

function headers(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("sm_token") : null;
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

interface Limits {
  max_projects: number; max_databases: number; max_services: number;
  max_custom_domains: number; max_subdomains: number; max_crons: number;
  max_memory_mb: number; max_cpus: number; max_bandwidth_gb: number;
}
interface Usage {
  projects: number; databases: number; services: number;
  custom_domains: number; subdomains: number; crons: number;
}
interface LimitsResponse {
  plan: string; is_admin: boolean; limits: Limits; usage: Usage;
}

function Panel({
  title, icon, danger = false, action, children, className = "",
}: {
  title: string; icon?: React.ReactNode; danger?: boolean;
  action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`rounded-2xl border overflow-hidden ${danger ? "border-destructive/30" : "border-border/60"} bg-card/60 dark:bg-[#0c0d0f]/40 ${className}`}>
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          {icon}
          <p className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${danger ? "text-destructive" : "text-muted-foreground/70"}`}>{title}</p>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// One usage meter: label, used/cap, and a thin progress bar. cap <= 0 → ∞.
function UsageMeter({
  icon, label, used, cap, accent,
}: {
  icon: React.ReactNode; label: string; used: number; cap: number; accent: string;
}) {
  const unlimited = cap <= 0;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / cap) * 100));
  const near = !unlimited && pct >= 80;
  return (
    <div className="rounded-xl border border-border/60 bg-background/50 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          {icon}
          <span className="text-[11px] font-medium">{label}</span>
        </div>
        <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
          {used}<span className="text-muted-foreground/50"> / {unlimited ? "∞" : cap}</span>
        </span>
      </div>
      <div className="mt-2 text-lg font-bold tracking-tight tabular-nums">{used}</div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${near ? "bg-amber-500" : accent}`}
          style={{ width: unlimited ? "12%" : `${Math.max(pct, used > 0 ? 6 : 0)}%` }}
        />
      </div>
    </div>
  );
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [limits, setLimits] = useState<LimitsResponse | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  useEffect(() => {
    api.getMe().then((u) => {
      setUser(u);
      setName(u.name);
      setEmail(u.email);
    }).catch(() => {});
    fetch(`${API}/api/v1/users/me/limits`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.limits) setLimits(d); })
      .catch(() => {});
  }, []);

  async function saveProfile() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setSaved(false);
    try {
      const updated = await api.updateProfile(name.trim());
      setUser(updated);
      setName(updated.name);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      /* surfaced via disabled→enabled; keep silent */
    } finally {
      setSaving(false);
    }
  }

  const dirty = user ? name.trim() !== user.name : false;
  const initials = (user?.name?.[0] || user?.email?.[0] || "?").toUpperCase();
  const isPro = user?.plan && user.plan !== "free";
  const verified = user?.email_verified;

  return (
    <div className="animate-fade-in-up pb-16">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Account</p>
      <h1 className="mt-1 text-[22px] sm:text-[26px] font-bold tracking-[-0.02em]">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">Manage your profile, plan, and usage.</p>

      {/* Profile hero */}
      <div className="mt-6 rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 overflow-hidden">
        <div className="relative px-5 pt-6 pb-5">
          <div aria-hidden className="pointer-events-none absolute -top-24 right-10 h-40 w-[320px] rounded-full bg-emerald-500/[0.06] blur-[80px] dark:bg-emerald-400/[0.07]" />
          <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-foreground text-background text-2xl font-bold shadow-sm">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold tracking-tight truncate">{user?.name || "—"}</h2>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${isPro ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400" : "border-border/60 text-muted-foreground"}`}>
                  {isPro && <Crown className="h-3 w-3" />}
                  {user?.plan || "free"}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-3 flex-wrap text-[13px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 min-w-0">
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{email}</span>
                </span>
                {verified ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="h-3.5 w-3.5" /> Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <ShieldAlert className="h-3.5 w-3.5" /> Unverified
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" /> Joined {fmtDate(user?.created_at)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Editable profile fields */}
        <div className="border-t border-border/60 p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5 text-xs"><UserIcon className="h-3.5 w-3.5 text-muted-foreground" /> Display name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={80} />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5 text-xs"><Mail className="h-3.5 w-3.5 text-muted-foreground" /> Email</Label>
              <Input value={email} disabled />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={saveProfile} disabled={!dirty || saving} className="btn-shine rounded-lg gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
              {saved ? "Saved" : "Save changes"}
            </Button>
            {dirty && !saving && !saved && (
              <span className="text-xs text-muted-foreground">Unsaved changes</span>
            )}
          </div>
        </div>
      </div>

      {/* Live usage */}
      <Panel
        title="Usage"
        icon={<Gauge className="h-3.5 w-3.5 text-muted-foreground" />}
        action={limits?.is_admin ? <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Admin · unlimited</span> : null}
        className="mt-4"
      >
        {limits ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <UsageMeter icon={<Rocket className="h-3.5 w-3.5" />} label="Projects" used={limits.usage.projects} cap={limits.limits.max_projects} accent="bg-emerald-500" />
            <UsageMeter icon={<Database className="h-3.5 w-3.5" />} label="Databases" used={limits.usage.databases} cap={limits.limits.max_databases} accent="bg-blue-500" />
            <UsageMeter icon={<Layers className="h-3.5 w-3.5" />} label="Services" used={limits.usage.services} cap={limits.limits.max_services} accent="bg-violet-500" />
            <UsageMeter icon={<Globe className="h-3.5 w-3.5" />} label="Domains" used={limits.usage.custom_domains} cap={limits.limits.max_custom_domains} accent="bg-cyan-500" />
            <UsageMeter icon={<Link2 className="h-3.5 w-3.5" />} label="Subdomains" used={limits.usage.subdomains} cap={limits.limits.max_subdomains} accent="bg-fuchsia-500" />
            <UsageMeter icon={<Clock className="h-3.5 w-3.5" />} label="Cron jobs" used={limits.usage.crons} cap={limits.limits.max_crons} accent="bg-amber-500" />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[92px] rounded-xl border border-border/60 bg-background/40 animate-pulse" />
            ))}
          </div>
        )}
      </Panel>

      {/* Plan */}
      <Panel title="Plan" icon={<Crown className="h-3.5 w-3.5 text-muted-foreground" />} className="mt-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold capitalize">{user?.plan || "free"}</span>
              <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Current</span>
            </div>
            {limits && (
              <div className="mt-2.5 flex items-center gap-4 flex-wrap text-[13px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><MemoryStick className="h-3.5 w-3.5" /> {limits.limits.max_memory_mb <= 0 ? "∞" : `${limits.limits.max_memory_mb} MB`} RAM</span>
                <span className="inline-flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5" /> {limits.limits.max_cpus <= 0 ? "∞" : limits.limits.max_cpus} vCPU</span>
                <span className="inline-flex items-center gap-1.5"><Gauge className="h-3.5 w-3.5" /> {limits.limits.max_bandwidth_gb <= 0 ? "∞" : `${limits.limits.max_bandwidth_gb} GB`}/mo bandwidth</span>
              </div>
            )}
          </div>
          <Button variant={isPro ? "outline" : "default"} className={`rounded-lg gap-1 shrink-0 ${isPro ? "" : "btn-shine"}`} onClick={() => router.push("/billing")}>
            {isPro ? "Manage plan" : "Upgrade"} <ArrowUpRight className="h-4 w-4" />
          </Button>
        </div>
      </Panel>

      {/* Referrals */}
      <ReferralsSection />

      {/* Webhooks */}
      <WebhooksSection />

      {/* Danger Zone */}
      <Panel title="Danger Zone" icon={<AlertTriangle className="h-3.5 w-3.5 text-destructive" />} danger className="mt-4">
        {!confirmDelete ? (
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Delete account</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Permanently delete your account and all associated data.
              </p>
            </div>
            <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)} className="rounded-lg shrink-0">
              Delete account
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-destructive/10 p-4">
              <p className="text-sm font-medium text-destructive">This action cannot be undone.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                This will permanently delete your account, API keys, domains, team memberships, and all captured requests.
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-2">
                Type <strong className="text-foreground">delete my account</strong> to confirm:
              </p>
              <Input
                value={deleteText}
                onChange={(e) => setDeleteText(e.target.value)}
                placeholder="delete my account"
                className="max-w-xs"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteText !== "delete my account"}
                onClick={async () => {
                  const token = localStorage.getItem("sm_token");
                  await fetch(`${API}/api/v1/users/me`, {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${token}` },
                  });
                  api.logout();
                  router.push("/");
                }}
              >
                Permanently delete
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setConfirmDelete(false); setDeleteText(""); }}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
