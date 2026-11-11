"use client";

// Account settings — profile, password, appearance, developer access, plan and
// account deletion. Same section kit and sticky nav as project settings.

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  AlertTriangle, ArrowRight, BadgeCheck, Bell, CalendarDays, Check, Copy, Crown, Eye, EyeOff, KeyRound,
  Loader2, Mail, Monitor, Moon, Palette, Shield, Sun, Terminal, User as UserIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, type User } from "@/lib/api";
import { PageHeader } from "@/components/dashboard/kit";
import {
  Field, FooterNote, SettingsNav, SettingsSection, inputCls, type Note, type SettingsNavItem,
} from "@/components/dashboard/settings-kit";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";
const headers = () => ({ Authorization: `Bearer ${localStorage.getItem("sm_token")}`, "Content-Type": "application/json" });

interface Limits {
  plan: string; is_admin: boolean;
  limits: { max_projects: number; max_databases: number; max_bandwidth_gb: number };
  usage: { projects: number; databases: number };
}

const NAV: SettingsNavItem[] = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "security", label: "Password", icon: Shield },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "developer", label: "Developer access", icon: Terminal },
  { id: "plan", label: "Plan", icon: Crown },
  { id: "danger", label: "Danger zone", icon: AlertTriangle, tone: "danger" },
];

function PasswordInput({ id, value, onChange, placeholder, autoComplete }: { id: string; value: string; onChange: (v: string) => void; placeholder: string; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input id={id} type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete={autoComplete} className={cn(inputCls, "pr-10")} />
      <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"}
        className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function CopyLine({ cmd }: { cmd: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl bg-white/[0.04] py-1.5 pl-3 pr-1.5 ring-1 ring-white/[0.07]">
      <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-white/85"><span className="text-brand">$</span> {cmd}</code>
      <button type="button" onClick={() => navigator.clipboard?.writeText(cmd).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }).catch(() => {})} aria-label="Copy command"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/55 hover:bg-white/10 hover:text-white">
        {done ? <Check className="h-3.5 w-3.5 text-brand" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [keyCount, setKeyCount] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [profileNote, setProfileNote] = useState<Note>(null);

  const [pwCur, setPwCur] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwNote, setPwNote] = useState<Note>(null);

  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 0);
    api.getMe().then((u) => { setUser(u); setName(u.name); }).catch(() => {});
    fetch(`${API}/api/v1/users/me/limits`, { headers: headers() }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setLimits(d)).catch(() => {});
    fetch(`${API}/api/v1/api-keys`, { headers: headers() }).then((r) => (r.ok ? r.json() : null))
      .then((d) => setKeyCount(Array.isArray(d) ? d.length : Array.isArray(d?.keys) ? d.keys.length : null)).catch(() => {});
    return () => clearTimeout(t);
  }, []);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true); setProfileNote(null);
    try {
      const u = await api.updateProfile(name.trim());
      setUser(u); setName(u.name); setProfileNote({ kind: "ok", text: "Saved" });
    } catch { setProfileNote({ kind: "err", text: "Couldn't save your name." }); }
    setSaving(false);
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwNote(null);
    if (pwNew.length < 8) { setPwNote({ kind: "err", text: "Use at least 8 characters." }); return; }
    if (pwNew !== pwConfirm) { setPwNote({ kind: "err", text: "The new passwords don't match." }); return; }
    setPwBusy(true);
    try {
      const res = await fetch(`${API}/api/v1/users/me/password`, { method: "POST", headers: headers(), body: JSON.stringify({ current_password: pwCur, new_password: pwNew }) });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { setPwNote({ kind: "ok", text: "Password updated. We emailed you a confirmation." }); setPwCur(""); setPwNew(""); setPwConfirm(""); }
      else setPwNote({ kind: "err", text: d.error || "Couldn't update the password." });
    } catch { setPwNote({ kind: "err", text: "Network error." }); }
    setPwBusy(false);
  }

  async function deleteAccount() {
    setDeleting(true);
    try {
      await fetch(`${API}/api/v1/users/me`, { method: "DELETE", headers: headers() });
      api.logout();
      router.push("/");
    } catch { setDeleting(false); }
  }

  const initials = (user?.name || user?.email || "?").split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  const joined = user?.created_at ? new Date(user.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";
  const dirty = !!user && name.trim() !== user.name;
  const plan = limits?.is_admin ? "admin" : limits?.plan ?? user?.plan ?? "free";
  const fmtLimit = (n?: number) => (n === undefined ? "…" : n < 0 ? "Unlimited" : String(n));
  const pwStrength = pwNew.length === 0 ? 0 : pwNew.length < 8 ? 1 : (/[A-Z]/.test(pwNew) && /[0-9]/.test(pwNew) && pwNew.length >= 12) ? 3 : 2;
  const nav = useMemo(() => NAV, []);

  return (
    <div className="animate-fade-in-up">
      <PageHeader eyebrow="Account" title="Settings" description="Your profile, password, appearance and developer access." />

      {/* Identity */}
      <section className="dark grain relative isolate mt-6 overflow-hidden rounded-[24px] bg-[#0b0c10] p-5 text-white sm:p-6">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-28 -z-10 h-72 w-72 rounded-full bg-brand/15 blur-3xl" />
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-brand-cyan text-[20px] font-semibold text-[#06281d] shadow-lg shadow-brand/20">{initials}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-[22px] font-semibold tracking-[-0.03em]">{user?.name || "…"}</h2>
              <Link href="/billing" className="inline-flex h-[22px] items-center gap-1 rounded-full border border-white/15 bg-white/[0.06] px-2 text-[12px] font-medium capitalize text-white/85 hover:bg-white/[0.11]">
                <Crown className="h-3 w-3 text-amber-300" />{plan}
              </Link>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-white/55">
              <span className="flex min-w-0 items-center gap-1.5"><Mail className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{user?.email}</span></span>
              {user && user.email_verified !== false && <span className="flex items-center gap-1 text-brand"><BadgeCheck className="h-3.5 w-3.5" />Verified</span>}
              {joined && <span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />Joined {joined}</span>}
            </div>
          </div>
        </div>
      </section>

      <div className="mt-6 lg:grid lg:grid-cols-[188px_minmax(0,1fr)] lg:gap-8">
        <aside className="hidden lg:block">
          <div className="sticky top-20">
            <SettingsNav items={nav} />
          </div>
        </aside>

        <div className="min-w-0 max-w-3xl space-y-4">
          <form onSubmit={saveProfile}>
            <SettingsSection
              id="profile"
              icon={UserIcon}
              title="Profile"
              description="How you appear across Deployzy and in team invites."
              footer={
                <>
                  <FooterNote note={profileNote} />
                  <button type="submit" disabled={!dirty || saving || !name.trim()} className="pill pill-ink pill-sm disabled:opacity-50">
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
                  </button>
                </>
              }
            >
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="Display name" htmlFor="s-name">
                  <input id="s-name" value={name} onChange={(e) => { setName(e.target.value); setProfileNote(null); }} maxLength={80} className={inputCls} />
                </Field>
                <Field label="Email" htmlFor="s-email" hint="Contact support to change it.">
                  <input id="s-email" value={user?.email ?? ""} disabled className={inputCls} />
                </Field>
              </div>
            </SettingsSection>
          </form>

          <form onSubmit={changePassword}>
            <SettingsSection
              id="security"
              icon={Shield}
              title="Password"
              description="For signing in with email. Google accounts don't have a separate password."
              footer={
                <>
                  <FooterNote note={pwNote} />
                  <button type="submit" disabled={pwBusy || !pwCur || !pwNew || !pwConfirm} className="pill pill-ink pill-sm disabled:opacity-50">
                    {pwBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Update password
                  </button>
                </>
              }
            >
              <div className="grid gap-3.5 sm:grid-cols-3">
                <Field label="Current password" htmlFor="pw-cur">
                  <PasswordInput id="pw-cur" value={pwCur} onChange={setPwCur} placeholder="Your current password" autoComplete="current-password" />
                </Field>
                <Field label="New password" htmlFor="pw-new">
                  <PasswordInput id="pw-new" value={pwNew} onChange={(v) => { setPwNew(v); setPwNote(null); }} placeholder="8+ characters" autoComplete="new-password" />
                  <div className="mt-2 flex gap-1" aria-hidden>
                    {[1, 2, 3].map((i) => (
                      <span key={i} className={cn("h-1 flex-1 rounded-full transition-colors", pwStrength >= i ? (pwStrength === 1 ? "bg-red-500" : pwStrength === 2 ? "bg-amber-500" : "bg-brand") : "bg-foreground/[0.08]")} />
                    ))}
                  </div>
                </Field>
                <Field label="Confirm new password" htmlFor="pw-confirm">
                  <PasswordInput id="pw-confirm" value={pwConfirm} onChange={(v) => { setPwConfirm(v); setPwNote(null); }} placeholder="Repeat it" autoComplete="new-password" />
                  {pwConfirm && pwNew && (
                    <p className={cn("mt-1.5 text-[12.5px]", pwConfirm === pwNew ? "text-[var(--dz-green-strong)] dark:text-brand" : "text-muted-foreground")}>
                      {pwConfirm === pwNew ? "Matches" : "Doesn't match yet"}
                    </p>
                  )}
                </Field>
              </div>
            </SettingsSection>
          </form>

          <SettingsSection id="appearance" icon={Palette} title="Appearance" description="How the dashboard looks on this device.">
            <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2.5 sm:max-w-md">
              {([["system", "System", Monitor], ["light", "Light", Sun], ["dark", "Dark", Moon]] as const).map(([k, label, I]) => {
                const on = mounted && theme === k;
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setTheme(k)}
                    className={cn(
                      "relative flex flex-col items-center gap-2 rounded-2xl border px-3 py-4 text-[13.5px] font-medium transition-colors",
                      on ? "border-brand/60 bg-brand/[0.06]" : "border-[var(--dz-hairline)] text-muted-foreground hover:border-foreground/25 hover:text-foreground",
                    )}
                  >
                    <I className="h-5 w-5" />{label}
                    {on && <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-brand"><Check className="h-2.5 w-2.5 text-white" /></span>}
                  </button>
                );
              })}
            </div>
          </SettingsSection>

          <SettingsSection id="developer" icon={Terminal} title="Developer access" description="Use Deployzy from your terminal, scripts and CI.">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="dark rounded-2xl bg-[#0b0c10] p-3.5 text-white">
                <p className="mb-2.5 text-[13px] font-medium text-white/70">Install the CLI and sign in</p>
                <div className="space-y-2">
                  <CopyLine cmd="npm install -g deployzy" />
                  <CopyLine cmd="deployzy login" />
                </div>
                <Link href="/docs/cli" className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-white/70 hover:text-white">CLI docs <ArrowRight className="h-3.5 w-3.5" /></Link>
              </div>
              <div className="flex flex-col justify-between rounded-2xl border border-[var(--dz-hairline)] p-3.5">
                <div>
                  <p className="flex items-center gap-2 text-[14px] font-medium"><KeyRound className="h-4 w-4 text-muted-foreground" />API keys</p>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {keyCount === null ? "For the SDKs, CI and the REST API." : `${keyCount} active key${keyCount === 1 ? "" : "s"} for the SDKs, CI and the REST API.`}
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href="/api-keys" className="pill pill-line pill-sm">Manage keys <ArrowRight className="h-3.5 w-3.5" /></Link>
                  <Link href="/notifications" className="pill pill-line pill-sm"><Bell className="h-4 w-4" />Alerts</Link>
                </div>
              </div>
            </div>
          </SettingsSection>

          <SettingsSection
            id="plan"
            icon={Crown}
            title="Plan"
            description="Your plan sets limits for projects, databases and bandwidth."
            action={<Link href="/billing" className="pill pill-ink pill-sm">{plan === "free" ? "Upgrade" : "Billing"} <ArrowRight className="h-3.5 w-3.5" /></Link>}
          >
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-[var(--dz-hairline)]">
              {[
                { label: "Projects", used: limits?.usage.projects, max: limits?.limits.max_projects },
                { label: "Databases", used: limits?.usage.databases, max: limits?.limits.max_databases },
                { label: "Bandwidth", used: undefined, max: limits?.limits.max_bandwidth_gb, unit: " GB/mo" },
              ].map((r) => (
                <div key={r.label} className="bg-card px-3.5 py-3">
                  <p className="text-[12.5px] text-muted-foreground">{r.label}</p>
                  <p className="mt-1 text-[17px] font-semibold tracking-tight tabular-nums">
                    {limits ? (
                      r.used !== undefined
                        ? <>{r.used}<span className="text-[13px] font-normal text-muted-foreground"> / {r.max !== undefined && r.max < 0 ? "∞" : fmtLimit(r.max)}</span></>
                        : <>{fmtLimit(r.max)}{r.max !== undefined && r.max >= 0 && <span className="text-[13px] font-normal text-muted-foreground">{r.unit}</span>}</>
                    ) : "…"}
                  </p>
                </div>
              ))}
            </div>
          </SettingsSection>

          <SettingsSection id="danger" tone="danger" icon={AlertTriangle} title="Danger zone" description="Permanently delete your account and everything in it.">
            <p className="text-[13.5px] text-muted-foreground">This stops and deletes all your projects, databases, tunnels, domains and API keys. It can&apos;t be undone.</p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field label={<>Type <span className="font-mono">delete my account</span> to confirm</>} htmlFor="del-acct" className="sm:w-72">
                <input id="del-acct" value={deleteText} onChange={(e) => setDeleteText(e.target.value)} placeholder="delete my account" autoComplete="off" className={cn(inputCls, "focus:border-red-500/60 focus:ring-red-500/10")} />
              </Field>
              <button type="button" onClick={deleteAccount} disabled={deleteText !== "delete my account" || deleting} className="pill pill-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-40">
                {deleting && <Loader2 className="h-4 w-4 animate-spin" />} Delete account
              </button>
            </div>
          </SettingsSection>
        </div>
      </div>
    </div>
  );
}
