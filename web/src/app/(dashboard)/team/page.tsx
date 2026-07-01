"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    if (role === "owner") return "text-yellow-500 border-yellow-500/20";
    if (role === "admin") return "text-blue-500 border-blue-500/20";
    return "text-muted-foreground";
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Teams</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Collaborate with your team on shared tunnels and resources.
          </p>
        </div>
      </div>

      {/* Create team / Team selector */}
      <div className="mt-6 flex flex-col sm:flex-row gap-3">
        {teams.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {teams.map((t) => (
              <button
                key={t.id}
                onClick={() => loadTeam(t.id)}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  selectedTeam?.team.id === t.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent"
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
      </div>

      {/* Create team */}
      {teams.length === 0 && !loading && (
        <Card className="mt-6">
          <CardContent className="flex flex-col items-center py-12">
            <Users className="h-12 w-12 text-muted-foreground/30" />
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
              <Button onClick={createTeam} className="shrink-0 gap-1">
                <Plus className="h-4 w-4" />
                Create
              </Button>
            </div>
          </CardContent>
        </Card>
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
          <Button onClick={createTeam} size="sm" variant="outline" className="gap-1">
            <Plus className="h-3.5 w-3.5" />
            New Team
          </Button>
        </div>
      )}

      {/* Team detail */}
      {selectedTeam && (
        <>
          {/* Members */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Members ({selectedTeam.members?.length || 0})</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {selectedTeam.members?.map((m) => (
                  <div key={m.user_id} className="flex items-center justify-between rounded-lg border border-border/50 p-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs">
                          {m.name?.[0]?.toUpperCase() || m.email[0].toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium">{m.name || m.email}</p>
                        <p className="text-xs text-muted-foreground">{m.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
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
            </CardContent>
          </Card>

          {/* Invite */}
          {(selectedTeam.role === "owner" || selectedTeam.role === "admin") && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <UserPlus className="h-4 w-4" />
                  Invite Member
                </CardTitle>
              </CardHeader>
              <CardContent>
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
                  <Button onClick={inviteMember} className="gap-1 shrink-0">
                    <Mail className="h-4 w-4" />
                    Send Invite
                  </Button>
                </div>

                {inviteURL && (
                  <div className="mt-4 rounded-lg border border-green-500/20 bg-green-500/5 p-4">
                    <p className="text-sm font-medium text-green-500 mb-2">Invitation created!</p>
                    <p className="text-xs text-muted-foreground mb-2">Share this link with your teammate:</p>
                    <div className="flex items-center gap-2 rounded-md bg-background p-2 font-mono text-xs">
                      <code className="flex-1 truncate">{inviteURL}</code>
                      <Button variant="ghost" size="sm" onClick={copyInvite}>
                        {copied === "new" ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
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
                          <div key={inv.id} className="rounded-lg border border-border/50 p-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <span className="text-sm">{inv.email}</span>
                                <Badge variant="outline" className="ml-2 text-[10px]">{inv.role}</Badge>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => copyLink(url, inv.id)}
                                  className="h-7 px-2 text-xs gap-1"
                                  title="Copy invite link"
                                >
                                  {copied === inv.id ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
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
                            <div className="mt-1.5 flex items-center gap-1 rounded bg-muted/30 px-2 py-1">
                              <code className="text-[10px] text-muted-foreground truncate flex-1">{url}</code>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
