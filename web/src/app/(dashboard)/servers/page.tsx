"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Server, Plus, Trash2, CheckCircle2, AlertCircle, Loader2, Wifi } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface WorkerServer {
  id: string; label: string; host: string; port: number; ssh_user: string;
  region: string; total_cpu: number; total_memory_mb: number;
  allocated_cpu: number; allocated_memory_mb: number;
  max_projects: number; current_projects: number;
  status: string; docker_installed: boolean; last_heartbeat: string | null; created_at: string;
}

export default function ServersPage() {
  const [servers, setServers] = useState<WorkerServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ label: "", host: "", port: "22", ssh_user: "root", ssh_password: "" });

  const headers = () => {
    const token = localStorage.getItem("sm_token");
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };

  async function load() {
    try {
      const res = await fetch(`${API}/api/v1/servers`, { headers: headers() });
      if (res.ok) setServers(await res.json());
    } catch {}
    setLoading(false);
  }

  async function addServer() {
    setAdding(true);
    try {
      const res = await fetch(`${API}/api/v1/servers`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ ...form, port: parseInt(form.port) }),
      });
      if (res.ok) {
        const data = await res.json();
        setShowAdd(false);
        setForm({ label: "", host: "", port: "22", ssh_user: "root", ssh_password: "" });
        load();
        if (!data.docker_installed) {
          alert("Server connected but Docker is not installed. Install Docker to deploy projects to this server.");
        }
      } else {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        alert(err.error || "Failed to add server");
      }
    } catch {}
    setAdding(false);
  }

  async function removeServer(id: string) {
    if (!confirm("Remove this server? Projects deployed on it will become inaccessible.")) return;
    await fetch(`${API}/api/v1/servers/${id}`, { method: "DELETE", headers: headers() });
    load();
  }

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">My Servers</h1>
          <p className="mt-1 text-sm text-muted-foreground">Bring your own compute — deploy projects to your own servers via SSH.</p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> Add Server
        </Button>
      </div>

      {showAdd && (
        <Card className="mb-6 border-primary/30">
          <CardHeader>
            <CardTitle className="text-base">Add SSH Server</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Label</label>
                <Input placeholder="my-vps" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Host / IP</label>
                <Input placeholder="192.168.1.100" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">SSH User</label>
                <Input placeholder="root" value={form.ssh_user} onChange={(e) => setForm({ ...form, ssh_user: e.target.value })} className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Port</label>
                <Input placeholder="22" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} className="h-9 text-sm" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">SSH Password</label>
              <Input type="password" placeholder="Enter password" value={form.ssh_password} onChange={(e) => setForm({ ...form, ssh_password: e.target.value })} className="h-9 text-sm" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={addServer} disabled={adding || !form.label || !form.host || !form.ssh_password} className="gap-1">
                {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wifi className="h-3 w-3" />} Connect & Add
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : servers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12">
            <Server className="h-10 w-10 text-muted-foreground/30 mb-4" />
            <h3 className="font-semibold">No servers yet</h3>
            <p className="mt-1 text-sm text-muted-foreground text-center max-w-sm">
              Add your own server to deploy projects there instead of using shared infrastructure.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {servers.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10 text-orange-400 shrink-0">
                      <Server className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{s.label}</span>
                        <Badge variant="outline" className={`text-[10px] ${s.status === "active" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-zinc-500/10 text-zinc-400"}`}>
                          {s.status}
                        </Badge>
                        {s.docker_installed ? (
                          <Badge variant="outline" className="text-[10px] gap-0.5"><CheckCircle2 className="h-2.5 w-2.5" /> Docker</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] gap-0.5 text-amber-500 border-amber-500/20"><AlertCircle className="h-2.5 w-2.5" /> No Docker</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">{s.ssh_user}@{s.host}:{s.port}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right text-xs text-muted-foreground">
                      <div>{s.current_projects}/{s.max_projects} projects</div>
                      <div>{s.allocated_memory_mb}/{s.total_memory_mb} MB</div>
                    </div>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => removeServer(s.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
