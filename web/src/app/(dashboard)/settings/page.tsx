"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  User as UserIcon, Shield, Palette, Terminal, Crown, AlertTriangle, Check, Loader2, Mail, CalendarDays,
  BadgeCheck, KeyRound, Monitor, Sun, Moon, Copy, ArrowRight, Bell, Eye, EyeOff,
} from "lucide-react";
import { api, type User } from "@/lib/api";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";
const headers = () => ({ Authorization: `Bearer ${localStorage.getItem("sm_token")}`, "Content-Type": "application/json" });

interface Limits {
  plan: string; is_admin: boolean;
  limits: { max_projects: number; max_databases: number; max_bandwidth_gb: number };
  usage: { projects: number; databases: number };
}

const SECTIONS = [
  { id: "profile", label: "Profile", icon: UserIcon },
  { id: "security", label: "Security", icon: Shield },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "developer", label: "Developer access", icon: Terminal },
  { id: "plan", label: "Plan", icon: Crown },
  { id: "danger", label: "Danger zone", icon: AlertTriangle },
] as const;

function Section({ id, title, desc, children, tone }: { id: string; title: string; desc: string; children: React.ReactNode; tone?: "danger" }) {
  return (
    <section id={id} className={`scroll-mt-24 rounded-2xl border bg-card ${tone === "danger" ? "border-red-500/30" : "border-border/60"}`}>
      <div className={`border-b px-5 py-4 ${tone === "danger" ? "border-red-500/20" : "border-border/60"}`}>
        <h2 className={`text-sm font-semibold ${tone === "danger" ? "text-red-600 dark:text-red-400" : ""}`}>{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

const inputCls = "h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none transition-all focus:border-foreground/30 focus:ring-4 focus:ring-emerald-500/10 disabled:opacity-60";

function PasswordInput({ value, onChange, placeholder, autoComplete }: { value: string; onChange: (v: string) => void; placeholder: string; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete={autoComplete} className={`${inputCls} pr-10`} />
      <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"}
        className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function CopyLine({ cmd }: { cmd: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
      <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]"><span className="text-emerald-500">$</span> {cmd}</code>
      <button onClick={() => navigator.clipboard.writeText(cmd).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); })} aria-label="Copy command"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
        {done ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
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
  const [active, setActive] = useState<string>("profile");

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [pwCur, setPwCur] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

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

  // Highlight the section in view.
  useEffect(() => {
    const obs = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setActive(vis.target.id);
    }, { rootMargin: "-20% 0px -65% 0px" });
    SECTIONS.forEach((s) => { const el = document.getElementById(s.id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [user]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true); setSaved(false);
    try {
      const u = await api.updateProfile(name.trim());
      setUser(u); setName(u.name); setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch { /* button re-enables */ }
    setSaving(false);
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (pwNew.length < 8) { setPwMsg({ ok: false, text: "New password must be at least 8 characters." }); return; }
    if (pwNew !== pwConfirm) { setPwMsg({ ok: false, text: "The new passwords don't match." }); return; }
    setPwBusy(true);
    try {
      const res = await fetch(`${API}/api/v1/users/me/password`, { method: "POST", headers: headers(), body: JSON.stringify({ current_password: pwCur, new_password: pwNew }) });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { setPwMsg({ ok: true, text: "Password updated. We've emailed you a confirmation." }); setPwCur(""); setPwNew(""); setPwConfirm(""); }
      else setPwMsg({ ok: false, text: d.error || "Couldn't update the password." });
    } catch { setPwMsg({ ok: false, text: "Network error." }); }
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
  const fmtLimit = (n?: number) => (n === undefined ? "…" : n < 0 ? "∞" : String(n));

  return (
    <div className="animate-fade-in-up">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Account</p>
      <h1 className="mt-1 text-[22px] font-bold tracking-[-0.02em] sm:text-[26px]">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">Your profile, sign-in, appearance and developer access.</p>

      {/* Identity banner */}
      <div className="relative mt-6 overflow-hidden rounded-2xl border border-border/60 bg-card p-5">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-sky-500 text-xl font-semibold text-white shadow-lg shadow-emerald-500/20">{initials}</div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-lg font-semibold">{user?.name || "…"}</p>
              <Link href="/billing" className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                <Crown className="h-3 w-3" />{plan}
              </Link>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{user?.email}</span>
              {user?.email_verified !== false && <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><BadgeCheck className="h-3.5 w-3.5" />Verified</span>}
              {joined && <span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />Joined {joined}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        {/* Section nav */}
        <nav className="hidden lg:block">
          <div className="sticky top-20 space-y-0.5">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${active === s.id ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"} ${s.id === "danger" ? "text-red-600/80 dark:text-red-400/80" : ""}`}>
                <s.icon className="h-4 w-4" />{s.label}
              </a>
            ))}
          </div>
        </nav>

        <div className="min-w-0 space-y-5">
          <Section id="profile" title="Profile" desc="How you appear across Deployzy and in team invites.">
            <form onSubmit={saveProfile} className="grid gap-4 sm:grid-cols-2">
              <Field label="Display name"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={inputCls} /></Field>
              <Field label="Email" hint="Used to sign in and for account notices. Contact support to change it."><input value={user?.email ?? ""} disabled className={inputCls} /></Field>
              <div className="flex items-center gap-3 sm:col-span-2">
                <button type="submit" disabled={!dirty || saving || !name.trim()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 disabled:opacity-40">
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save changes
                </button>
                {saved && <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><Check className="h-3.5 w-3.5" />Saved</span>}
              </div>
            </form>
          </Section>

          <Section id="security" title="Security" desc="Change the password you use to sign in with email.">
            <form onSubmit={changePassword} className="grid gap-4 sm:grid-cols-3">
              <Field label="Current password"><PasswordInput value={pwCur} onChange={setPwCur} placeholder="••••••••" autoComplete="current-password" /></Field>
              <Field label="New password" hint="At least 8 characters"><PasswordInput value={pwNew} onChange={setPwNew} placeholder="New password" autoComplete="new-password" /></Field>
              <Field label="Confirm new password"><PasswordInput value={pwConfirm} onChange={setPwConfirm} placeholder="Repeat it" autoComplete="new-password" /></Field>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
                <button type="submit" disabled={pwBusy || !pwCur || !pwNew || !pwConfirm}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 disabled:opacity-40">
                  {pwBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}Update password
                </button>
                {pwMsg && <span className={`text-xs ${pwMsg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{pwMsg.text}</span>}
              </div>
              <p className="text-[11px] text-muted-foreground sm:col-span-3">Signed up with Google? Your account has no password of its own; keep using “Continue with Google”.</p>
            </form>
          </Section>

          <Section id="appearance" title="Appearance" desc="Choose how the dashboard looks on this device.">
            <div className="grid grid-cols-3 gap-3 sm:max-w-md">
              {([["system", "System", Monitor], ["light", "Light", Sun], ["dark", "Dark", Moon]] as const).map(([k, label, I]) => {
                const on = mounted && theme === k;
                return (
                  <button key={k} onClick={() => setTheme(k)}
                    className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-sm transition-all ${on ? "border-foreground/40 bg-accent shadow-sm" : "border-border/60 hover:border-foreground/20"}`}>
                    <I className="h-5 w-5" />{label}
                    {on && <Check className="h-3.5 w-3.5 text-emerald-500" />}
                  </button>
                );
              })}
            </div>
          </Section>

          <Section id="developer" title="Developer access" desc="Use Deployzy from your terminal, scripts and CI.">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <p className="text-xs font-medium">Install the CLI and sign in</p>
                <CopyLine cmd="npm install -g deployzy" />
                <CopyLine cmd="deployzy login" />
                <Link href="/docs/cli" className="inline-flex items-center gap-1 text-xs font-medium hover:underline">CLI docs <ArrowRight className="h-3 w-3" /></Link>
              </div>
              <div className="flex flex-col justify-between rounded-xl border border-border/60 bg-muted/20 p-4">
                <div>
                  <p className="flex items-center gap-2 text-sm font-medium"><KeyRound className="h-4 w-4 text-muted-foreground" />API keys</p>
                  <p className="mt-1 text-xs text-muted-foreground">{keyCount === null ? "For the SDKs, CI and the REST API." : `${keyCount} active key${keyCount === 1 ? "" : "s"}. For the SDKs, CI and the REST API.`}</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href="/api-keys" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-xs font-medium hover:bg-accent">Manage keys <ArrowRight className="h-3 w-3" /></Link>
                  <Link href="/notifications" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-xs font-medium hover:bg-accent"><Bell className="h-3.5 w-3.5" />Notifications</Link>
                </div>
              </div>
            </div>
          </Section>

          <Section id="plan" title="Plan" desc="Your plan sets limits for projects, databases and bandwidth.">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-lg font-semibold capitalize">{plan}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {limits ? <>
                    {limits.usage.projects} of {fmtLimit(limits.limits.max_projects)} projects · {limits.usage.databases} of {fmtLimit(limits.limits.max_databases)} databases · {fmtLimit(limits.limits.max_bandwidth_gb)} GB bandwidth/mo
                  </> : "Loading…"}
                </p>
              </div>
              <Link href="/billing" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-medium text-background hover:opacity-90">
                {plan === "free" ? "Upgrade" : "Usage & billing"} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </Section>

          <Section id="danger" title="Danger zone" desc="Permanently delete your account and everything in it." tone="danger">
            <p className="text-sm text-muted-foreground">This stops and deletes all your projects, databases, tunnels, domains and API keys. It can&apos;t be undone.</p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field label="Type “delete my account” to confirm">
                <input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} placeholder="delete my account" className={`${inputCls} sm:w-72`} />
              </Field>
              <button onClick={deleteAccount} disabled={deleteText !== "delete my account" || deleting}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40">
                {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Delete account permanently
              </button>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
