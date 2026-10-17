"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Users, Plus, Crown, Shield, UserRound, Mail, Copy, Check, X, Loader2, LogOut, Trash2, ArrowRightLeft, Clock, Link2, Send,
} from "lucide-react";
import { api } from "@/lib/api";
import { DashMotion } from "@/components/admin/dash-kit";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";
const headers = () => ({ Authorization: `Bearer ${localStorage.getItem("sm_token")}`, "Content-Type": "application/json" });

interface Team { id: string; name: string; owner_id: string; role: string; created_at: string }
interface Member { user_id: string; email: string; name: string; role: string; joined_at: string }
interface Invitation { id: string; email: string; role: string; token: string; created_at: string; expires_at?: string }
interface TeamDetail { team: { id: string; name: string; owner_id: string; created_at?: string }; role: string; members: Member[]; invitations: Invitation[] }

const ROLE: Record<string, { label: string; icon: typeof Crown; tone: string; desc: string }> = {
  owner: { label: "Owner", icon: Crown, tone: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400", desc: "Full control, billing, can delete the team" },
  admin: { label: "Admin", icon: Shield, tone: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400", desc: "Invite and remove members, manage resources" },
  member: { label: "Member", icon: UserRound, tone: "border-border bg-muted/40 text-muted-foreground", desc: "Work on the team's projects, tunnels and databases" },
};
const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
const initials = (s: string) => s.split(/[\s@._-]+/).filter(Boolean).map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "?";

function RoleBadge({ role }: { role: string }) {
  const r = ROLE[role] ?? ROLE.member;
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${r.tone}`}><r.icon className="h-3 w-3" />{r.label}</span>;
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); })} title={label} aria-label={label}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 text-muted-foreground hover:bg-accent hover:text-foreground">
      {done ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export default function TeamPage() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [selId, setSelId] = useState<string>("");
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [myId, setMyId] = useState("");
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [invEmail, setInvEmail] = useState("");
  const [invRole, setInvRole] = useState("member");
  const [inviting, setInviting] = useState(false);
  const [lastInvite, setLastInvite] = useState<string>("");
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

  async function createTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    let created = "";
    await run(async () => {
      const r = await fetch(`${API}/api/v1/teams`, { method: "POST", headers: headers(), body: JSON.stringify({ name: newName.trim() }) });
      if (r.ok) { const d = await r.clone().json().catch(() => ({})); created = d.id || d.team?.id || ""; }
      return r;
    }, () => setNewName(""));
    await loadTeams(created || undefined);
    setCreating(false);
  }

  async function invite(e: React.FormEvent) {
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
    if (!confirm(self ? `Leave ${detail?.team.name}?` : `Remove ${m.name || m.email} from ${detail?.team.name}?`)) return;
    if (await run(() => fetch(`${API}/api/v1/teams/${teamId}/members/${m.user_id}`, { method: "DELETE", headers: headers() }))) {
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

  return (
    <div className="@container animate-fade-in-up space-y-5">
      <DashMotion />
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Account</p>
        <h1 className="mt-1 text-[22px] font-bold tracking-[-0.02em] sm:text-[26px]">Teams</h1>
        <p className="mt-1 text-sm text-muted-foreground">Share projects, tunnels and databases with your team. Each team is its own workspace.</p>
      </div>

      {err && <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2.5 text-sm text-red-600 dark:text-red-400"><X className="mt-0.5 h-4 w-4 shrink-0" />{err}</div>}

      {/* Team switcher + create */}
      <div className="flex flex-wrap items-center gap-2">
        {teams === null ? <div className="h-10 w-64 animate-pulse rounded-xl bg-muted/50" /> : teams.map((t) => (
          <button key={t.id} onClick={() => setSelId(t.id)}
            className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-all ${selId === t.id ? "border-foreground/30 bg-card shadow-sm" : "border-border/60 hover:border-foreground/20"}`}>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-sky-500 text-[11px] font-semibold text-white">{initials(t.name)}</span>
            <span className="text-sm font-medium">{t.name}</span>
            <RoleBadge role={t.role} />
            {activeWorkspace === t.id && <span className="h-2 w-2 rounded-full bg-emerald-500" title="Current workspace" />}
          </button>
        ))}
        <form onSubmit={createTeam} className="flex items-center gap-1.5">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New team name" maxLength={60}
            className="h-10 w-44 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-foreground/30" />
          <button type="submit" disabled={!newName.trim() || creating}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-foreground px-3 text-sm font-medium text-background hover:opacity-90 disabled:opacity-40">
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Create
          </button>
        </form>
      </div>

      {teams !== null && teams.length === 0 ? (
        <div className="ov-rise flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-14 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/70 bg-card"><Users className="h-5 w-5 text-violet-600 dark:text-violet-400" /></div>
          <h3 className="mt-4 font-semibold">No teams yet</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">Create a team above, then invite people by email. Everyone works in a shared workspace with roles.</p>
        </div>
      ) : detail && (
        <>
          {/* Team header */}
          <div className="ov-rise relative overflow-hidden rounded-2xl border border-border/60 bg-card p-5">
            <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-60 w-60 rounded-full bg-violet-500/10 blur-3xl" />
            <div className="relative flex flex-wrap items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-sky-500 text-lg font-semibold text-white shadow-lg shadow-violet-500/20">{initials(detail.team.name)}</div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><p className="truncate text-lg font-semibold">{detail.team.name}</p><RoleBadge role={myRole} /></div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {detail.members.length} member{detail.members.length === 1 ? "" : "s"} · {detail.invitations.length} pending invite{detail.invitations.length === 1 ? "" : "s"} · created {fmtDate(detail.team.created_at)}
                </p>
              </div>
              {activeWorkspace === teamId ? (
                <button onClick={() => openWorkspace(null)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/60 px-3 text-sm font-medium hover:bg-accent"><ArrowRightLeft className="h-4 w-4" />Back to personal</button>
              ) : (
                <button onClick={() => openWorkspace(teamId)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3 text-sm font-medium text-background hover:opacity-90"><ArrowRightLeft className="h-4 w-4" />Open workspace</button>
              )}
            </div>
          </div>

          <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            {/* Members */}
            <div className="ov-rise rounded-2xl border border-border/60 bg-card" style={{ animationDelay: "60ms" }}>
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                <p className="text-sm font-semibold">Members <span className="font-normal text-muted-foreground">({detail.members.length})</span></p>
              </div>
              <div className="divide-y divide-border/50">
                {detail.members.map((m, i) => {
                  const self = m.user_id === myId;
                  return (
                    <div key={m.user_id} className="ov-rise flex flex-wrap items-center gap-3 px-4 py-3" style={{ animationDelay: `${80 + i * 30}ms` }}>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{initials(m.name || m.email)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 truncate text-sm font-medium">{m.name || m.email.split("@")[0]}{self && <span className="rounded bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">You</span>}</p>
                        <p className="truncate text-xs text-muted-foreground">{m.email} · joined {fmtDate(m.joined_at)}</p>
                      </div>
                      {isOwner && m.role !== "owner" && !self ? (
                        <select value={m.role} onChange={(e) => changeRole(m, e.target.value)} aria-label={`Role for ${m.email}`}
                          className="h-8 rounded-lg border border-input bg-background px-2 text-xs">
                          <option value="member">Member</option><option value="admin">Admin</option>
                        </select>
                      ) : <RoleBadge role={m.role} />}
                      {m.role !== "owner" && (self || canManage) && (
                        <button onClick={() => removeMember(m)} title={self ? "Leave team" : "Remove member"} aria-label={self ? "Leave team" : `Remove ${m.email}`}
                          className="flex h-8 items-center gap-1 rounded-lg border border-border/60 px-2 text-xs text-muted-foreground transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-600">
                          {self ? <><LogOut className="h-3.5 w-3.5" />Leave</> : <X className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-4">
              {/* Invite */}
              {canManage ? (
                <form onSubmit={invite} className="ov-rise rounded-2xl border border-border/60 bg-card p-4" style={{ animationDelay: "100ms" }}>
                  <p className="text-sm font-semibold">Invite someone</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">They get an email with a link to join. You can also copy the link yourself.</p>
                  <div className="mt-3 flex flex-col gap-2">
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input type="email" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} placeholder="teammate@company.com"
                        className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-foreground/30" />
                    </div>
                    <div className="flex gap-2">
                      <select value={invRole} onChange={(e) => setInvRole(e.target.value)} className="h-10 flex-1 rounded-xl border border-input bg-background px-3 text-sm" aria-label="Role">
                        <option value="member">Member</option><option value="admin">Admin</option>
                      </select>
                      <button type="submit" disabled={inviting || !invEmail.trim()}
                        className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 disabled:opacity-40">
                        {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Invite
                      </button>
                    </div>
                  </div>
                  {lastInvite && (
                    <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs">
                      <Check className="h-4 w-4 shrink-0 text-emerald-500" /><span className="min-w-0 flex-1 truncate">Invite sent. Link: <span className="font-mono">{lastInvite}</span></span>
                      <CopyBtn text={lastInvite} label="Copy invite link" />
                    </div>
                  )}
                </form>
              ) : (
                <div className="ov-rise rounded-2xl border border-border/60 bg-muted/20 p-4 text-xs text-muted-foreground" style={{ animationDelay: "100ms" }}>
                  Only owners and admins can invite people. Ask {detail.members.find((m) => m.role === "owner")?.name || "the owner"} if you need someone added.
                </div>
              )}

              {/* Pending invites */}
              <div className="ov-rise rounded-2xl border border-border/60 bg-card" style={{ animationDelay: "140ms" }}>
                <p className="border-b border-border/60 px-4 py-3 text-sm font-semibold">Pending invites <span className="font-normal text-muted-foreground">({detail.invitations.length})</span></p>
                {detail.invitations.length === 0 ? <p className="px-4 py-6 text-center text-xs text-muted-foreground">No pending invites.</p> : (
                  <div className="divide-y divide-border/50">
                    {detail.invitations.map((inv) => (
                      <div key={inv.id} className="flex items-center gap-2 px-4 py-2.5">
                        <Clock className="h-4 w-4 shrink-0 text-amber-500" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{inv.email}</p>
                          <p className="text-[11px] text-muted-foreground">{ROLE[inv.role]?.label ?? inv.role} · sent {fmtDate(inv.created_at)}{inv.expires_at ? ` · expires ${fmtDate(inv.expires_at)}` : ""}</p>
                        </div>
                        {canManage && inv.token && <CopyBtn text={inviteLink(inv.token)} label="Copy invite link" />}
                        {canManage && (
                          <button onClick={() => cancelInvite(inv)} title="Cancel invite" aria-label={`Cancel invite for ${inv.email}`}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 text-muted-foreground hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Roles */}
              <div className="ov-rise rounded-2xl border border-border/60 bg-card p-4" style={{ animationDelay: "180ms" }}>
                <p className="flex items-center gap-2 text-sm font-semibold"><Link2 className="h-4 w-4 text-muted-foreground" />Roles</p>
                <div className="mt-3 space-y-2">
                  {(["owner", "admin", "member"] as const).map((r) => (
                    <div key={r} className="flex items-start gap-2 text-xs"><RoleBadge role={r} /><span className="pt-0.5 text-muted-foreground">{ROLE[r].desc}</span></div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {isOwner && (
            <div className="ov-rise rounded-2xl border border-red-500/30 bg-card p-4" style={{ animationDelay: "220ms" }}>
              <p className="text-sm font-semibold text-red-600 dark:text-red-400">Delete team</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Removes the team and everyone&apos;s access to it. Resources stay with the members who created them.</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} placeholder={`Type "${detail.team.name}" to confirm`}
                  className="h-10 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-red-500/50 sm:w-72" />
                <button onClick={deleteTeam} disabled={deleteText !== detail.team.name}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40"><Trash2 className="h-4 w-4" />Delete team</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
