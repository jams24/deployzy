"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Users,
  UserPlus,
  Crown,
  Shield,
  Trash2,
  Copy,
  Check,
  Plus,
  Mail,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Teams — members, roles, invitations. Flow unchanged; presentation rebuilt
// with the Deployzy 2.0 card language (both themes).
// ─────────────────────────────────────────────────────────────────────────────

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface Team {
  id: string;
  name: string;
  owner_id: string;
  role: string;
  created_at: string;
}

interface Member {
  user_id: string;
  email: string;
  name: string;
  role: string;
  joined_at: string;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  token: string;
  created_at: string;
}

interface TeamDetail {
  team: { id: string; name: string; owner_id: string };
  role: string;
  members: Member[];
  invitations: Invitation[];
}

function Panel({ title, icon, children, className = "" }: { title: string; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 overflow-hidden ${className}`}>
      <div className="px-4 py-3 border-b border-border/60 flex items-center gap-2">
        {icon}
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">{title}</p>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export default function TeamPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<TeamDetail | null>(null);
  const [newTeamName, setNewTeamName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
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
    if (!newTeamName.trim()) return;
    try {
      const res = await fetch(`${API}/api/v1/teams`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ name: newTeamName }),
      });
      if (res.ok) {
        setNewTeamName("");
        loadTeams();
      }
    } catch {}
  }

  async function inviteMember() {
    if (!inviteEmail.trim() || !selectedTeam) return;
    try {
      const res = await fetch(`${API}/api/v1/teams/${selectedTeam.team.id}/invite`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      if (res.ok) {
        const data = await res.json();
        setInviteURL(data.invite_url);
        setInviteEmail("");
        loadTeam(selectedTeam.team.id);
      }
    } catch {}
  }

  async function removeMember(userId: string) {
    if (!selectedTeam) return;
    try {
      await fetch(`${API}/api/v1/teams/${selectedTeam.team.id}/members/${userId}`, {
        method: "DELETE",
        headers: headers(),
      });
      loadTeam(selectedTeam.team.id);
    } catch {}
  }

  async function cancelInvite(inviteId: string) {
    if (!selectedTeam) return;
    try {
      await fetch(`${API}/api/v1/teams/${selectedTeam.team.id}/invitations/${inviteId}`, {
        method: "DELETE",
        headers: headers(),
      });
      loadTeam(selectedTeam.team.id);
    } catch {}
  }

  function copyLink(url: string, id: string) {
    navigator.clipboard.writeText(url);
    setCopied(id);
    setTimeout(() => setCopied(""), 2000);
  }

  function copyInvite() {
    navigator.clipboard.writeText(inviteURL);
    setCopied("new");
    setTimeout(() => setCopied(""), 2000);
  }

  useEffect(() => {
    loadTeams();
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

  return (
    <div className="animate-fade-in-up">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Account</p>
      <h1 className="mt-1 text-[22px] sm:text-[26px] font-bold tracking-[-0.02em]">Teams</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Collaborate with your team on shared tunnels and resources.
      </p>

      {/* Team selector */}
      {teams.length > 0 && (
        <div className="mt-6 flex gap-2 flex-wrap">
          {teams.map((t) => (
            <button
              key={t.id}
              onClick={() => loadTeam(t.id)}
              className={`rounded-full border px-4 py-1.5 text-[13px] font-medium transition-all ${
                selectedTeam?.team.id === t.id
                  ? "border-foreground/30 bg-accent text-foreground shadow-sm"
                  : "border-border/60 text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {t.name}
              <Badge variant="outline" className={`ml-2 text-[10px] ${roleColor(t.role)}`}>
                {t.role}
              </Badge>
            </button>
          ))}
        </div>
      )}

      {/* Create team — empty state */}
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
              <Button onClick={createTeam} className="btn-shine shrink-0 gap-1 rounded-lg">
                <Plus className="h-4 w-4" />
                Create
              </Button>
            </div>
          </div>
        </div>
      )}

      {teams.length > 0 && (
        <div className="mt-4 flex items-center gap-2">
          <Input
            placeholder="New team name"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createTeam()}
            className="max-w-xs"
          />
          <Button onClick={createTeam} size="sm" variant="outline" className="gap-1 rounded-lg">
            <Plus className="h-3.5 w-3.5" />
            New Team
          </Button>
        </div>
      )}

      {/* Team detail */}
      {selectedTeam && (
        <>
          {/* Members */}
          <Panel
            title={`Members (${selectedTeam.members?.length || 0})`}
            icon={<Users className="h-3.5 w-3.5 text-muted-foreground" />}
            className="mt-6"
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
                      <p className="text-sm font-medium truncate">{m.name || m.email}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{m.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className={`gap-1 text-[10px] ${roleColor(m.role)}`}>
                      {roleIcon(m.role)}
                      {m.role}
                    </Badge>
                    {m.role !== "owner" && (selectedTeam.role === "owner" || selectedTeam.role === "admin") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeMember(m.user_id)}
                        className="text-destructive hover:text-destructive h-8 w-8 p-0"
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
          {(selectedTeam.role === "owner" || selectedTeam.role === "admin") && (
            <Panel
              title="Invite Member"
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
                <Button onClick={inviteMember} className="btn-shine gap-1 shrink-0 rounded-lg">
                  <Mail className="h-4 w-4" />
                  Send Invite
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

              {/* Pending invitations */}
              {selectedTeam.invitations && selectedTeam.invitations.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Pending Invitations</p>
                  <div className="space-y-2">
                    {selectedTeam.invitations.map((inv) => {
                      const url = `https://deployzy.com/invite/${inv.token}`;
                      return (
                        <div key={inv.id} className="rounded-xl border border-border/60 bg-background/50 p-3">
                          <div className="flex items-center justify-between">
                            <div className="min-w-0">
                              <span className="text-sm truncate">{inv.email}</span>
                              <Badge variant="outline" className="ml-2 text-[10px]">{inv.role}</Badge>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => copyLink(url, inv.id)}
                                className="h-7 px-2 text-xs gap-1"
                                title="Copy invite link"
                              >
                                {copied === inv.id ? <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-3 w-3" />}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => cancelInvite(inv.id)}
                                className="h-7 px-2 text-destructive hover:text-destructive"
                                title="Cancel invitation"
                              >
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
