"use client";

// Account settings: profile, password, appearance, developer access, plan and
// account deletion. Lives in the Settings hub, whose layout supplies the nav.

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { ArrowRightIcon, BellSimpleIcon, CalendarBlankIcon, CheckIcon, CircleNotchIcon, CopyIcon, CrownIcon, EnvelopeIcon, EyeIcon, EyeSlashIcon, KeyIcon, MonitorIcon, MoonIcon, PaletteIcon, SealCheckIcon, ShieldIcon, SunIcon, TerminalWindowIcon, UserIcon, WarningIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { api, type User } from "@/lib/api";
import {
  Field, FooterNote, SettingsSection, inputCls, type Note,
} from "@/components/dashboard/settings-kit";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";
const headers = () => ({ Authorization: `Bearer ${localStorage.getItem("sm_token")}`, "Content-Type": "application/json" });

interface Limits {
  plan: string; is_admin: boolean;
  limits: { max_projects: number; max_databases: number; max_bandwidth_gb: number };
  usage: { projects: number; databases: number };
}

function PasswordInput({ id, value, onChange, placeholder, autoComplete }: { id: string; value: string; onChange: (v: string) => void; placeholder: string; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input id={id} type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete={autoComplete} className={cn(inputCls, "pr-10")} />
      <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"}
        className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
        {show ? <EyeSlashIcon className="h-3.5 w-3.5" /> : <EyeIcon className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function CopyLine({ cmd }: { cmd: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-[10px] bg-background py-1 pl-3 pr-1 ring-1 ring-[var(--dz-hairline)] dark:bg-white/[0.03]">
      <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground/85"><span className="select-none text-muted-foreground">$</span> {cmd}</code>
      <button type="button" onClick={() => navigator.clipboard?.writeText(cmd).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }).catch(() => {})} aria-label="Copy command"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
        {done ? <CheckIcon className="h-3.5 w-3.5 text-[var(--dz-green-strong)] dark:text-brand" /> : <CopyIcon className="h-3.5 w-3.5" />}
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

  return (
    <div className="animate-fade-in-up">
      {/* Identity: a quiet row, not a hero card */}
      <div className="flex items-center gap-3.5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-[15px] font-semibold text-foreground/75 ring-1 ring-inset ring-[var(--dz-hairline)] dark:bg-white/[0.07]">{initials}</span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-[15px] font-semibold tracking-[-0.015em]">{user?.name || "…"}</p>
            <Link href="/billing" className="inline-flex h-5 items-center gap-1 rounded-full border border-[var(--dz-hairline)] px-2 text-[11.5px] font-medium capitalize text-muted-foreground transition-colors hover:text-foreground">
              <CrownIcon className="h-3 w-3" />{plan}
            </Link>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1.5"><EnvelopeIcon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{user?.email}</span></span>
            {user && user.email_verified !== false && <span className="flex items-center gap-1 text-[var(--dz-green-strong)] dark:text-brand"><SealCheckIcon className="h-3.5 w-3.5" />Verified</span>}
            {joined && <span className="flex items-center gap-1.5"><CalendarBlankIcon className="h-3.5 w-3.5" />Joined {joined}</span>}
          </p>
        </div>
      </div>

      <div className="mt-6 max-w-3xl space-y-4">
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
                    {saving && <CircleNotchIcon className="h-4 w-4 animate-spin" />} Save
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
              icon={ShieldIcon}
              title="Password"
              description="For signing in with email. Google accounts don't have a separate password."
              footer={
                <>
                  <FooterNote note={pwNote} />
                  <button type="submit" disabled={pwBusy || !pwCur || !pwNew || !pwConfirm} className="pill pill-ink pill-sm disabled:opacity-50">
                    {pwBusy ? <CircleNotchIcon className="h-4 w-4 animate-spin" /> : <KeyIcon className="h-4 w-4" />} Update password
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

          <SettingsSection id="appearance" icon={PaletteIcon} title="Appearance" description="How the dashboard looks on this device.">
            <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2.5 sm:max-w-md">
              {([["system", "System", MonitorIcon], ["light", "Light", SunIcon], ["dark", "Dark", MoonIcon]] as const).map(([k, label, I]) => {
                const on = mounted && theme === k;
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setTheme(k)}
                    className={cn(
                      "relative flex flex-col items-center gap-1.5 rounded-[12px] border px-3 py-3.5 text-[13px] font-medium transition-colors",
                      on ? "border-foreground/25 bg-foreground/[0.04] text-foreground dark:bg-white/[0.05]" : "border-[var(--dz-hairline)] text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                    )}
                  >
                    <I weight="duotone" className={cn("dz-ico h-5 w-5", on && "dz-ico-on")} />{label}
                    {on && <CheckIcon weight="bold" className="absolute right-2.5 top-2.5 h-3 w-3 text-[var(--dz-green-strong)] dark:text-brand" />}
                  </button>
                );
              })}
            </div>
          </SettingsSection>

          <SettingsSection id="developer" icon={TerminalWindowIcon} title="Developer access" description="Use Deployzy from your terminal, scripts and CI.">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-[12px] bg-foreground/[0.03] p-3.5 dark:bg-white/[0.03]">
                <p className="mb-2.5 text-[13px] font-medium">Install the CLI and sign in</p>
                <div className="space-y-2">
                  <CopyLine cmd="npm install -g deployzy" />
                  <CopyLine cmd="deployzy login" />
                </div>
                <Link href="/docs/cli" className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-muted-foreground hover:text-foreground">CLI docs <ArrowRightIcon className="h-3.5 w-3.5" /></Link>
              </div>
              <div className="flex flex-col justify-between rounded-[12px] border border-[var(--dz-hairline)] p-3.5">
                <div>
                  <p className="flex items-center gap-2 text-[13px] font-medium"><KeyIcon className="dz-ico h-4 w-4 text-muted-foreground" />API keys</p>
                  <p className="mt-1 text-[12.5px] text-muted-foreground">
                    {keyCount === null ? "For the SDKs, CI and the REST API." : `${keyCount} active key${keyCount === 1 ? "" : "s"} for the SDKs, CI and the REST API.`}
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href="/api-keys" className="pill pill-line pill-sm">Manage keys <ArrowRightIcon className="h-3.5 w-3.5" /></Link>
                  <Link href="/notifications" className="pill pill-line pill-sm"><BellSimpleIcon className="h-4 w-4" />Alerts</Link>
                </div>
              </div>
            </div>
          </SettingsSection>

          <SettingsSection
            id="plan"
            icon={CrownIcon}
            title="Plan"
            description="Your plan sets limits for projects, databases and bandwidth."
            action={<Link href={plan === "free" ? "/billing?tab=plans" : "/billing"} className="pill pill-line pill-xs">{plan === "free" ? "Upgrade" : "Billing"} <ArrowRightIcon className="h-3.5 w-3.5" /></Link>}
          >
            <div className="grid grid-cols-3 divide-x divide-[var(--dz-hairline)] overflow-hidden rounded-[12px] border border-[var(--dz-hairline)]">
              {[
                { label: "Projects", used: limits?.usage.projects, max: limits?.limits.max_projects },
                { label: "Databases", used: limits?.usage.databases, max: limits?.limits.max_databases },
                { label: "Bandwidth", used: undefined, max: limits?.limits.max_bandwidth_gb, unit: " GB/mo" },
              ].map((r) => (
                <div key={r.label} className="px-3.5 py-3">
                  <p className="text-[12.5px] text-muted-foreground">{r.label}</p>
                  <p className="mt-1 text-[16px] font-semibold tracking-tight tabular-nums">
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

          <SettingsSection id="danger" tone="danger" icon={WarningIcon} title="Danger zone" description="Permanently delete your account and everything in it.">
            <p className="text-[13px] text-muted-foreground">This stops and deletes all your projects, databases, tunnels, domains and API keys. It can&apos;t be undone.</p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field label={<>Type <span className="font-mono">delete my account</span> to confirm</>} htmlFor="del-acct" className="sm:w-72">
                <input id="del-acct" value={deleteText} onChange={(e) => setDeleteText(e.target.value)} placeholder="delete my account" autoComplete="off" className={cn(inputCls, "focus:border-red-500/60 focus:ring-red-500/10")} />
              </Field>
              <button type="button" onClick={deleteAccount} disabled={deleteText !== "delete my account" || deleting} className="pill pill-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-40">
                {deleting && <CircleNotchIcon className="h-4 w-4 animate-spin" />} Delete account
              </button>
            </div>
          </SettingsSection>
      </div>
    </div>
  );
}
