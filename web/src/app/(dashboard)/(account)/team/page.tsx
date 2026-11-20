"use client";

// Teams — shared workspaces with roles. Pick a team, open its workspace,
// manage members and invites. Removing someone (or leaving) and deleting the
// team confirm inline.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ArrowRightLeft, Check, Clock, Copy, Crown, Loader2, LogOut, Mail, Plus, Send, Shield, Trash2, TriangleAlert,
  UserRound, Users, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { EmptyState, PageHeader, PanelHeader } from "@/components/dashboard/kit";
import { inputCls, selectCls } from "@/components/dashboard/settings-kit";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";
const headers = () => ({ Authorization: `Bearer ${localStorage.getItem("sm_token")}`, "Content-Type": "application/json" });

interface Team { id: string; name: string; owner_id: string; role: string; created_at: string }
interface Member { user_id: string; email: string; name: string; role: string; joined_at: string }
interface Invitation { id: string; email: string; role: string; token: string; created_at: string; expires_at?: string }
interface TeamDetail { team: { id: string; name: string; owner_id: string; created_at?: string }; role: string; members: Member[]; invitations: Invitation[] }

const ROLE: Record<string, { label: string; icon: typeof Crown; tone: string; desc: string }> = {
  owner: { label: "Owner", icon: Crown, tone: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400", desc: "Full control and billing. Can delete the team." },
  admin: { label: "Admin", icon: Shield, tone: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400", desc: "Invites and removes members, manages resources." },
  member: { label: "Member", icon: UserRound, tone: "border-[var(--dz-hairline)] bg-foreground/[0.04] text-muted-foreground", desc: "Works on the team's projects, tunnels and databases." },
};
const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
const initials = (s: string) => s.split(/[\s@._-]+/).filter(Boolean).map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "?";

function RoleBadge({ role, className }: { role: string; className?: string }) {
  const r = ROLE[role] ?? ROLE.member;
  return (
    <span className={cn("inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full border px-2 text-[12px] font-medium", r.tone, className)}>
      <r.icon className="h-3 w-3" />{r.label}
    </span>
  );
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }).catch(() => {})}
      title={label}
      aria-label={label}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
    >
      {done ? <Check className="h-3.5 w-3.5 text-brand" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function TeamMark({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={cn(
      "flex shrink-0 items-center justify-center bg-gradient-to-br from-brand to-brand-cyan font-semibold text-[#06281d]",
      size === "sm" && "h-7 w-7 rounded-lg text-[11.5px]",
      size === "md" && "h-9 w-9 rounded-xl text-[13px]",
      size === "lg" && "h-14 w-14 rounded-2xl text-[18px] shadow-lg shadow-brand/20",
    )}>
      {initials(name)}
    </span>
  );
}

export default function TeamPage() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [selId, setSelId] = useState<string>("");
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [myId, setMyId] = useState("");
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [invEmail, setInvEmail] = useState("");
  const [invRole, setInvRole] = useState("member");
  const [inviting, setInviting] = useState(false);
  const [lastInvite, setLastInvite] = useState<string>("");
  const [confirmMember, setConfirmMember] = useState<string | null>(null);
  const [deleteText, setDeleteText] = useState("");

  const loadTeams = useCallback(async (select?: string) => {
    try {
      const res = await fetch(`${API}/api/v1/teams`, { headers: headers() });
      const list: Team[] = (res.ok ? await res.json() : null) ?? [];
      setTeams(list);
      setSelId((cur) => select || (cur && list.some((t) => t.id === cur) ? cur : list[0]?.id || ""));
    } catch { setTeams([]); }
  }, []);
  const loadDetail = useCallback(async (id: string) => {
    if (!id) { setDetail(null); return; }
    try {
      const res = await fetch(`${API}/api/v1/teams/${id}`, { headers: headers() });
      if (res.ok) {
        const d = await res.json();
        // Defensive: the API used to send null for empty lists.
        setDetail({ ...d, members: d.members ?? [], invitations: d.invitations ?? [] });
      }
    } catch { /* keep */ }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      loadTeams();
      setActiveWorkspace(localStorage.getItem("sm_team_id"));
    }, 0);
    api.getMe().then((u) => setMyId(u.id)).catch(() => {});
    return () => clearTimeout(t);
  }, [loadTeams]);
  useEffect(() => { const t = setTimeout(() => loadDetail(selId), 0); return () => clearTimeout(t); }, [selId, loadDetail]);

  const run = async (fn: () => Promise<Response>, okMsg?: () => void) => {
    setErr("");
    try {
      const res = await fn();
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error || `Request failed (${res.status})`); return false; }
      okMsg?.(); return true;
    } catch { setErr("Network error"); return false; }
  };

  async function createTeam(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    let created = "";
    const ok = await run(async () => {
      const r = await fetch(`${API}/api/v1/teams`, { method: "POST", headers: headers(), body: JSON.stringify({ name: newName.trim() }) });
      if (r.ok) { const d = await r.clone().json().catch(() => ({})); created = d.id || d.team?.id || ""; }
      return r;
    }, () => setNewName(""));
    await loadTeams(created || undefined);
    if (ok) setShowCreate(false);
    setCreating(false);
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    if (!detail || !invEmail.trim()) return;
    setInviting(true); setLastInvite("");
    await run(async () => {
      const r = await fetch(`${API}/api/v1/teams/${detail.team.id}/invite`, { method: "POST", headers: headers(), body: JSON.stringify({ email: invEmail.trim(), role: invRole }) });
      if (r.ok) { const d = await r.clone().json().catch(() => ({})); setLastInvite(d.invite_url || ""); }
      return r;
    }, () => setInvEmail(""));
    await loadDetail(detail.team.id);
    setInviting(false);
  }

  const teamId = detail?.team.id ?? "";
  const myRole = detail?.role ?? "member";
  const canManage = myRole === "owner" || myRole === "admin";
  const isOwner = myRole === "owner";
  const inviteLink = (token: string) => `${typeof window !== "undefined" ? window.location.origin : "https://deployzy.com"}/invite/${token}`;

  async function removeMember(m: Member) {
    const self = m.user_id === myId;
    if (await run(() => fetch(`${API}/api/v1/teams/${teamId}/members/${m.user_id}`, { method: "DELETE", headers: headers() }))) {
      setConfirmMember(null);
      if (self) { if (activeWorkspace === teamId) localStorage.removeItem("sm_team_id"); await loadTeams(); } else await loadDetail(teamId);
    }
  }
  async function changeRole(m: Member, role: string) {
    if (await run(() => fetch(`${API}/api/v1/teams/${teamId}/members/${m.user_id}/role`, { method: "PUT", headers: headers(), body: JSON.stringify({ role }) }))) await loadDetail(teamId);
  }
  async function cancelInvite(inv: Invitation) {
    if (await run(() => fetch(`${API}/api/v1/teams/${teamId}/invitations/${inv.id}`, { method: "DELETE", headers: headers() }))) await loadDetail(teamId);
  }
  async function deleteTeam() {
    if (await run(() => fetch(`${API}/api/v1/teams/${teamId}`, { method: "DELETE", headers: headers() }))) {
      if (activeWorkspace === teamId) localStorage.removeItem("sm_team_id");
      setDeleteText(""); await loadTeams();
    }
  }
  const openWorkspace = (id: string | null) => {
    if (id) localStorage.setItem("sm_team_id", id); else localStorage.removeItem("sm_team_id");
    window.location.reload();
  };

  const createForm = (
    <form onSubmit={createTeam} className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
      <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Team name" maxLength={60} aria-label="Team name" className={cn(inputCls, "sm:w-56")} />
      <div className="flex gap-2">
        {teams && teams.length > 0 && <button type="button" onClick={() => { setShowCreate(false); setNewName(""); }} className="pill pill-line pill-sm flex-1 sm:flex-none">Cancel</button>}
        <button type="submit" disabled={!newName.trim() || creating} className="pill pill-ink pill-sm flex-1 disabled:opacity-50 sm:flex-none">
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create team
        </button>
      </div>
    </form>
  );

  return (
    <div className="animate-fade-in-up">
      <PageHeader
        eyebrow="Account"
        title="Teams"
        description="Share projects, tunnels and databases. Each team is its own workspace with roles."
        actions={teams && teams.length > 0 && !showCreate ? (
          <button type="button" onClick={() => setShowCreate(true)} className="pill pill-line pill-sm"><Plus className="h-4 w-4" /> New team</button>
        ) : undefined}
      />

      {err && (
        <div role="alert" className="mt-5 flex items-start gap-2 rounded-2xl border border-red-500/30 bg-red-500/[0.05] px-3.5 py-3 text-[13.5px] text-red-600 dark:text-red-400">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">{err}</span>
          <button type="button" onClick={() => setErr("")} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100"><X className="h-4 w-4" /></button>
        </div>
      )}

      {showCreate && teams && teams.length > 0 && (
        <div className="surface mt-5 rounded-[20px] p-4 sm:p-5">
          <p className="mb-3 text-[14.5px] font-semibold tracking-tight">New team</p>
          {createForm}
        </div>
      )}

      {teams === null ? (
        <div className="mt-6 space-y-4" aria-busy>
          <div className="h-10 w-72 animate-pulse rounded-full bg-foreground/[0.05]" />
          <div className="h-40 animate-pulse rounded-[24px] bg-foreground/[0.05]" />
        </div>
      ) : teams.length === 0 ? (
        <EmptyState
          className="mt-6"
          icon={Users}
          title="No teams yet"
          description="Create a team, then invite people by email. Everyone works in a shared workspace with roles."
          action={createForm}
        />
      ) : (
        <>
          {/* Team switcher */}
          {teams.length > 1 && (
            <div role="tablist" aria-label="Teams" className="-mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden">
              {teams.map((t) => {
                const on = selId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => { setSelId(t.id); setConfirmMember(null); setLastInvite(""); }}
                    className={cn(
                      "flex shrink-0 items-center gap-2.5 rounded-2xl border py-1.5 pl-1.5 pr-3 text-left transition-colors",
                      on ? "border-foreground/25 bg-card shadow-sm" : "border-[var(--dz-hairline)] hover:border-foreground/20",
                    )}
                  >
                    <TeamMark name={t.name} size="sm" />
                    <span className="text-[14px] font-medium">{t.name}</span>
                    {activeWorkspace === t.id && <span className="h-2 w-2 rounded-full bg-brand" title="Current workspace" />}
                  </button>
                );
              })}
            </div>
          )}

          {detail && (
            <div className="mt-5 space-y-4 sm:space-y-5">
              {/* Team hero */}
              <section className="dark grain relative isolate overflow-hidden rounded-[24px] bg-[#0b0c10] p-5 text-white sm:p-6">
                <div aria-hidden className="pointer-events-none absolute -right-24 -top-28 -z-10 h-72 w-72 rounded-full bg-brand/15 blur-3xl" />
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <TeamMark name={detail.team.name} size="lg" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-[22px] font-semibold tracking-[-0.03em]">{detail.team.name}</h2>
                        <RoleBadge role={myRole} className="border-white/15 bg-white/[0.06] text-white/80" />
                      </div>
                      <p className="mt-1 text-[13.5px] text-white/55">
                        {activeWorkspace === teamId ? <span className="text-brand">Your current workspace · </span> : null}
                        Created {fmtDate(detail.team.created_at)}
                      </p>
                    </div>
                  </div>
                  {activeWorkspace === teamId ? (
                    <button type="button" onClick={() => openWorkspace(null)} className="pill pill-sm border border-white/15 bg-white/[0.06] text-white hover:bg-white/[0.11]">
                      <ArrowRightLeft className="h-4 w-4" /> Back to personal
                    </button>
                  ) : (
                    <button type="button" onClick={() => openWorkspace(teamId)} className="pill pill-launch pill-sm">
                      <ArrowRightLeft className="h-4 w-4" /> Open workspace
                    </button>
                  )}
                </div>
                <div className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-white/[0.06]">
                  {[
                    { label: "Members", value: detail.members.length },
                    { label: "Owners & admins", value: detail.members.filter((m) => m.role === "admin" || m.role === "owner").length },
                    { label: "Pending invites", value: detail.invitations.length },
                  ].map((s) => (
                    <div key={s.label} className="bg-[#0b0c10] px-4 py-3">
                      <p className="text-[24px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{s.value}</p>
                      <p className="mt-1.5 text-[12.5px] leading-tight text-white/50">{s.label}</p>
                    </div>
                  ))}
                </div>
              </section>

              <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                {/* Members */}
                <section className="surface overflow-hidden rounded-[20px] lg:self-start">
                  <PanelHeader title="Members" count={detail.members.length} />
                  <ul className="divide-y divide-[var(--dz-hairline)]">
                    {detail.members.map((m) => {
                      const self = m.user_id === myId;
                      const confirming = confirmMember === m.user_id;
                      return (
                        <li key={m.user_id} className="px-4 py-3 sm:px-5">
                          <div className="flex items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-[12.5px] font-semibold">{initials(m.name || m.email)}</span>
                            <div className="min-w-0 flex-1">
                              <p className="flex items-center gap-2 text-[14px] font-medium">
                                <span className="truncate">{m.name || m.email.split("@")[0]}</span>
                                {self && <span className="shrink-0 rounded-full bg-foreground/[0.06] px-2 py-px text-[11.5px] font-medium text-muted-foreground">You</span>}
                              </p>
                              <p className="truncate text-[13px] text-muted-foreground">{m.email}<span className="hidden sm:inline"> · joined {fmtDate(m.joined_at)}</span></p>
                            </div>
                            {isOwner && m.role !== "owner" && !self ? (
                              <select value={m.role} onChange={(e) => changeRole(m, e.target.value)} aria-label={`Role for ${m.email}`} className={cn(selectCls, "h-8 w-auto rounded-lg py-0 pl-2.5 text-[13px]")}>
                                <option value="member">Member</option><option value="admin">Admin</option>
                              </select>
                            ) : <RoleBadge role={m.role} />}
                            {m.role !== "owner" && (self || canManage) && !confirming && (
                              <button
                                type="button"
                                onClick={() => setConfirmMember(m.user_id)}
                                title={self ? "Leave team" : "Remove member"}
                                aria-label={self ? "Leave team" : `Remove ${m.email}`}
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                              >
                                {self ? <LogOut className="h-4 w-4" /> : <X className="h-4 w-4" />}
                              </button>
                            )}
                          </div>
                          {confirming && (
                            <div className="mt-3 flex flex-col gap-2 rounded-2xl bg-red-500/[0.06] p-3 sm:flex-row sm:items-center">
                              <p className="text-[13.5px] sm:mr-auto">
                                {self ? <>Leave <span className="font-semibold">{detail.team.name}</span>? You&apos;ll lose access to its resources.</> : <>Remove <span className="font-semibold">{m.name || m.email}</span> from the team?</>}
                              </p>
                              <div className="flex gap-2">
                                <button type="button" onClick={() => setConfirmMember(null)} className="pill pill-line pill-sm flex-1 sm:flex-none">Cancel</button>
                                <button type="button" onClick={() => removeMember(m)} className="pill pill-sm flex-1 bg-red-600 text-white hover:bg-red-700 sm:flex-none">{self ? "Leave" : "Remove"}</button>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>

                <div className="min-w-0 space-y-4 sm:space-y-5">
                  {/* Invite */}
                  {canManage ? (
                    <form onSubmit={invite} className="surface rounded-[20px] p-4 sm:p-5">
                      <p className="text-[14.5px] font-semibold tracking-tight">Invite someone</p>
                      <p className="mt-0.5 text-[13px] text-muted-foreground">They get an email with a link to join. You can copy the link too.</p>
                      <div className="mt-3 space-y-2">
                        <div className="relative">
                          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <input type="email" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} placeholder="teammate@company.com" aria-label="Email address" className={cn(inputCls, "pl-9")} />
                        </div>
                        <div className="flex gap-2">
                          <select value={invRole} onChange={(e) => setInvRole(e.target.value)} className={cn(selectCls, "flex-1")} aria-label="Role">
                            <option value="member">Member</option><option value="admin">Admin</option>
                          </select>
                          <button type="submit" disabled={inviting || !invEmail.trim()} className="pill pill-ink pill-sm shrink-0 disabled:opacity-50">
                            {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Invite
                          </button>
                        </div>
                      </div>
                      {lastInvite && (
                        <div className="mt-3 flex items-center gap-2 rounded-2xl border border-brand/30 bg-brand/[0.06] py-1.5 pl-3 pr-1.5">
                          <Check className="h-4 w-4 shrink-0 text-brand" />
                          <span className="min-w-0 flex-1 truncate text-[13px]">Invite sent · <span className="font-mono text-[12.5px] text-muted-foreground">{lastInvite}</span></span>
                          <CopyBtn text={lastInvite} label="Copy invite link" />
                        </div>
                      )}
                    </form>
                  ) : (
                    <p className="rounded-[20px] border border-dashed border-[var(--dz-hairline)] p-4 text-[13.5px] text-muted-foreground">
                      Only owners and admins can invite people. Ask {detail.members.find((m) => m.role === "owner")?.name || "the owner"} if you need someone added.
                    </p>
                  )}

                  {/* Pending invites */}
                  <section className="surface overflow-hidden rounded-[20px]">
                    <PanelHeader title="Pending invites" count={detail.invitations.length} />
                    {detail.invitations.length === 0 ? (
                      <p className="px-4 py-6 text-center text-[13.5px] text-muted-foreground">No pending invites.</p>
                    ) : (
                      <ul className="divide-y divide-[var(--dz-hairline)]">
                        {detail.invitations.map((inv) => (
                          <li key={inv.id} className="flex items-center gap-2.5 px-4 py-3 sm:px-5">
                            <Clock className="h-4 w-4 shrink-0 text-amber-500" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[14px]">{inv.email}</p>
                              <p className="truncate text-[12.5px] text-muted-foreground">{ROLE[inv.role]?.label ?? inv.role} · sent {fmtDate(inv.created_at)}{inv.expires_at ? ` · expires ${fmtDate(inv.expires_at)}` : ""}</p>
                            </div>
                            {canManage && inv.token && <CopyBtn text={inviteLink(inv.token)} label="Copy invite link" />}
                            {canManage && (
                              <button type="button" onClick={() => cancelInvite(inv)} title="Cancel invite" aria-label={`Cancel invite for ${inv.email}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400">
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  {/* Roles */}
                  <section className="surface rounded-[20px] p-4 sm:p-5">
                    <p className="text-[14.5px] font-semibold tracking-tight">Roles</p>
                    <ul className="mt-3 space-y-3">
                      {(["owner", "admin", "member"] as const).map((r) => (
                        <li key={r} className="flex items-start gap-3">
                          <RoleBadge role={r} className="mt-px w-[5.5rem] justify-center" />
                          <span className="text-[13px] leading-snug text-muted-foreground">{ROLE[r].desc}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              </div>

              {isOwner && (
                <section className="rounded-[20px] border border-red-500/30 bg-red-500/[0.025] p-4 sm:p-5">
                  <p className="flex items-center gap-2 text-[15px] font-semibold text-red-600 dark:text-red-400"><TriangleAlert className="h-4 w-4" /> Delete team</p>
                  <p className="mt-0.5 text-[13.5px] text-muted-foreground">Removes the team and everyone&apos;s access to it. Resources stay with the members who created them.</p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} placeholder={`Type "${detail.team.name}" to confirm`} aria-label="Confirm team name" autoComplete="off" className={cn(inputCls, "focus:border-red-500/60 focus:ring-red-500/10 sm:w-72")} />
                    <button type="button" onClick={deleteTeam} disabled={deleteText !== detail.team.name} className="pill pill-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-40">
                      <Trash2 className="h-4 w-4" /> Delete team
                    </button>
                  </div>
                </section>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
