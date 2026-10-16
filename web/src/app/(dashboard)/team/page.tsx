"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { api } from "@/lib/api";
import {
  Users, UserPlus, Crown, Shield, Trash2, Copy, Check, Plus, Mail,
  Clock, CalendarDays, Loader2,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Teams — members, roles, invitations. Rebuilt with the Deployzy dashboard
// card language: a team header with live stat tiles, richer member rows, and
// clearer invite state so the page reflects the team instead of feeling empty.
// ─────────────────────────────────────────────────────────────────────────────

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface Team { id: string; name: string; owner_id: string; role: string; created_at: string; }
interface Member { user_id: string; email: string; name: string; role: string; joined_at: string; }
interface Invitation { id: string; email: string; role: string; token: string; created_at: string; }
interface TeamDetail {
  team: { id: string; name: string; owner_id: string; created_at?: string };
  role: string; members: Member[]; invitations: Invitation[];
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
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
function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function Panel({ title, icon, action, children, className = "" }: { title: string; icon?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 overflow-hidden ${className}`}>
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          {icon}
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">{title}</p>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function StatTile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/50 p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <div className="mt-1.5 text-lg font-bold tracking-tight tabular-nums capitalize">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default function TeamPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<TeamDetail | null>(null);
  const [myId, setMyId] = useState<string>("");
  const [newTeamName, setNewTeamName] = useState("");
  const [creating, setCreating] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);
  const [inviteURL, setInviteURL] = useState("");
  const [copied, setCopied] = useState("");
  const [loading, setLoading] = useState(true);

  const headers = () => {
    const token = localStorage.getItem("sm_token");
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };

  async function loadTeams() {
    try {
      const res = await fetch(`${API}/api/v1/teams`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setTeams(data);
        if (data.length > 0 && !selectedTeam) loadTeam(data[0].id);
      }
    } catch {}
    setLoading(false);
  }

  async function loadTeam(teamId: string) {
    try {
      const res = await fetch(`${API}/api/v1/teams/${teamId}`, { headers: headers() });
      if (res.ok) setSelectedTeam(await res.json());
    } catch {}
  }

  async function createTeam() {
    if (!newTeamName.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch(`${API}/api/v1/teams`, {
        method: "POST", headers: headers(), body: JSON.stringify({ name: newTeamName }),
      });
      if (res.ok) { setNewTeamName(""); await loadTeams(); }
    } catch {}
    setCreating(false);
  }

  async function inviteMember() {
    if (!inviteEmail.trim() || !selectedTeam || inviting) return;
    setInviting(true);
    try {
      const res = await fetch(`${API}/api/v1/teams/${selectedTeam.team.id}/invite`, {
        method: "POST", headers: headers(), body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      if (res.ok) {
        const data = await res.json();
        setInviteURL(data.invite_url);
        setInviteEmail("");
        loadTeam(selectedTeam.team.id);
      }
    } catch {}
    setInviting(false);
  }

  async function removeMember(userId: string) {
    if (!selectedTeam) return;
    try {
      await fetch(`${API}/api/v1/teams/${selectedTeam.team.id}/members/${userId}`, { method: "DELETE", headers: headers() });
      loadTeam(selectedTeam.team.id);
    } catch {}
  }

  async function cancelInvite(inviteId: string) {
    if (!selectedTeam) return;
    try {
      await fetch(`${API}/api/v1/teams/${selectedTeam.team.id}/invitations/${inviteId}`, { method: "DELETE", headers: headers() });
      loadTeam(selectedTeam.team.id);
    } catch {}
  }

  function copyLink(url: string, id: string) {
    navigator.clipboard.writeText(url);
    setCopied(id);
    setTimeout(() => setCopied(""), 2000);
  }
  function copyInvite() { copyLink(inviteURL, "new"); }

  useEffect(() => {
    loadTeams();
    api.getMe().then((u) => setMyId(u.id)).catch(() => {});
  }, []);

  const roleIcon = (role: string) => {
    if (role === "owner") return <Crown className="h-3 w-3" />;
    if (role === "admin") return <Shield className="h-3 w-3" />;
    return <Users className="h-3 w-3" />;
  };
  const roleColor = (role: string) => {
    if (role === "owner") return "text-amber-600 dark:text-amber-400 border-amber-500/40";
    if (role === "admin") return "text-blue-600 dark:text-blue-400 border-blue-500/40";
    return "text-muted-foreground";
  };
  const canManage = selectedTeam && (selectedTeam.role === "owner" || selectedTeam.role === "admin");

  return (
    <div className="animate-fade-in-up pb-16">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Account</p>
      <h1 className="mt-1 text-[22px] sm:text-[26px] font-bold tracking-[-0.02em]">Teams</h1>
      <p className="mt-1 text-sm text-muted-foreground">Collaborate with your team on shared tunnels and resources.</p>

      {/* Team selector */}
      {teams.length > 0 && (
        <div className="mt-6 flex items-center gap-2 flex-wrap">
          {teams.map((t) => (
            <button
              key={t.id}
              onClick={() => loadTeam(t.id)}
              className={`group inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[13px] font-medium transition-all ${
                selectedTeam?.team.id === t.id
                  ? "border-foreground/30 bg-accent text-foreground shadow-sm"
                  : "border-border/60 text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {t.name}
              <Badge variant="outline" className={`gap-1 text-[10px] ${roleColor(t.role)}`}>
                {roleIcon(t.role)} {t.role}
              </Badge>
            </button>
          ))}
          {/* Inline new-team input */}
          <div className="inline-flex items-center gap-1.5">
            <Input
              placeholder="New team"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createTeam()}
              className="h-8 w-36 text-[13px] rounded-full"
            />
            <Button onClick={createTeam} size="sm" variant="outline" disabled={creating || !newTeamName.trim()} className="h-8 gap-1 rounded-full">
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              New
            </Button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {teams.length === 0 && !loading && (
        <div className="relative mt-6 rounded-2xl border border-dashed border-border overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute -top-20 left-1/2 h-40 w-[380px] -translate-x-1/2 rounded-full bg-violet-500/[0.07] blur-[80px] dark:bg-violet-400/[0.08]" />
          <div className="relative flex flex-col items-center py-14 px-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/70 bg-card">
              <Users className="h-5 w-5 text-violet-500 dark:text-violet-400" />
            </div>
            <h3 className="mt-4 font-semibold">No teams yet</h3>
            <p className="mt-2 text-sm text-muted-foreground text-center max-w-sm">
              Create a team to collaborate on tunnels, domains, and API keys with your teammates.
            </p>
            <div className="mt-6 flex items-center gap-2 w-full max-w-sm">
              <Input
                placeholder="Team name"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createTeam()}
              />
              <Button onClick={createTeam} disabled={creating || !newTeamName.trim()} className="btn-shine shrink-0 gap-1 rounded-lg">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Create
              </Button>
            </div>
          </div>
        </div>
      )}

      {loading && teams.length === 0 && (
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[72px] rounded-xl border border-border/60 bg-background/40 animate-pulse" />
          ))}
        </div>
      )}

      {/* Team detail */}
      {selectedTeam && (
        <>
          {/* Stat tiles */}
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile icon={<Users className="h-3.5 w-3.5" />} label="Members" value={selectedTeam.members?.length || 0} />
            <StatTile icon={<Clock className="h-3.5 w-3.5" />} label="Pending" value={selectedTeam.invitations?.length || 0} sub="invitations" />
            <StatTile icon={roleIcon(selectedTeam.role)} label="Your role" value={selectedTeam.role} />
            <StatTile icon={<CalendarDays className="h-3.5 w-3.5" />} label="Created" value={fmtDate(selectedTeam.team.created_at)} />
          </div>

          {/* Members */}
          <Panel
            title={`Members (${selectedTeam.members?.length || 0})`}
            icon={<Users className="h-3.5 w-3.5 text-muted-foreground" />}
            className="mt-4"
          >
            <div className="space-y-2">
              {selectedTeam.members?.map((m) => (
                <div key={m.user_id} className="flex items-center justify-between rounded-xl border border-border/60 bg-background/50 p-3 transition-colors hover:border-foreground/20">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="bg-foreground text-background text-xs font-bold">
                        {m.name?.[0]?.toUpperCase() || m.email[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium truncate">{m.name || m.email}</p>
                        {m.user_id === myId && (
                          <span className="rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">You</span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {m.email}{m.joined_at ? ` · joined ${timeAgo(m.joined_at)}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className={`gap-1 text-[10px] ${roleColor(m.role)}`}>
                      {roleIcon(m.role)} {m.role}
                    </Badge>
                    {m.role !== "owner" && canManage && m.user_id !== myId && (
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => removeMember(m.user_id)}
                        className="text-destructive hover:text-destructive h-8 w-8 p-0"
                        title="Remove member"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          {/* Invite */}
          {canManage && (
            <Panel
              title="Invite member"
              icon={<UserPlus className="h-3.5 w-3.5 text-muted-foreground" />}
              className="mt-4"
            >
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  placeholder="teammate@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && inviteMember()}
                  className="flex-1"
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <Button onClick={inviteMember} disabled={inviting || !inviteEmail.trim()} className="btn-shine gap-1 shrink-0 rounded-lg">
                  {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  Send invite
                </Button>
              </div>

              {inviteURL && (
                <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                  <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400 mb-2">Invitation created!</p>
                  <p className="text-xs text-muted-foreground mb-2">Share this link with your teammate:</p>
                  <div className="flex items-center gap-2 rounded-lg bg-background border border-border/60 p-2 font-mono text-xs">
                    <code className="flex-1 truncate">{inviteURL}</code>
                    <Button variant="ghost" size="sm" onClick={copyInvite}>
                      {copied === "new" ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
              )}

              {selectedTeam.invitations && selectedTeam.invitations.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Pending invitations</p>
                  <div className="space-y-2">
                    {selectedTeam.invitations.map((inv) => {
                      const url = `https://deployzy.com/invite/${inv.token}`;
                      return (
                        <div key={inv.id} className="rounded-xl border border-border/60 bg-background/50 p-3">
                          <div className="flex items-center justify-between">
                            <div className="min-w-0 flex items-center gap-2">
                              <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="text-sm truncate">{inv.email}</span>
                              <Badge variant="outline" className={`text-[10px] ${roleColor(inv.role)}`}>{inv.role}</Badge>
                              {inv.created_at && <span className="text-[11px] text-muted-foreground shrink-0">· {timeAgo(inv.created_at)}</span>}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <Button variant="ghost" size="sm" onClick={() => copyLink(url, inv.id)} className="h-7 px-2 text-xs gap-1" title="Copy invite link">
                                {copied === inv.id ? <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-3 w-3" />}
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => cancelInvite(inv.id)} className="h-7 px-2 text-destructive hover:text-destructive" title="Cancel invitation">
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                          <div className="mt-1.5 flex items-center gap-1 rounded bg-muted/50 px-2 py-1">
                            <code className="text-[10px] text-muted-foreground truncate flex-1">{url}</code>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
