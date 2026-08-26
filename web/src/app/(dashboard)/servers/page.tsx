"use client";

import { useEffect, useState } from "react";
import { showPlanLimit } from "@/components/upgrade-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Server, Plus, Trash2, CheckCircle2, AlertCircle, Loader2, Wifi } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Servers (BYOC) — connect your own VPS over SSH. Flow unchanged;
// presentation rebuilt with the Deployzy 2.0 card language (both themes).
// ─────────────────────────────────────────────────────────────────────────────

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface WorkerServer {
  id: string; label: string; host: string; port: number; ssh_user: string;
  region: string; total_cpu: number; total_memory_mb: number;
  allocated_cpu: number; allocated_memory_mb: number;
  used_memory_mb: number; load_avg: number;
  max_projects: number; current_projects: number;
  status: string; docker_installed: boolean; last_heartbeat: string | null; created_at: string;
  docker_install_status?: string; docker_install_error?: string | null;
}

export default function ServersPage() {
  const [servers, setServers] = useState<WorkerServer[]>([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ label: "", host: "", port: "22", ssh_user: "root", ssh_password: "" });
  // Whether the user's plan allows bring-your-own servers. null = still loading.
  const [byocAllowed, setByocAllowed] = useState<boolean | null>(null);

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
        const msg = err.error || "Failed to add server";
        if (!showPlanLimit(msg)) alert(msg);
      }
    } catch {}
    setAdding(false);
  }

  async function installDocker(id: string) {
    if (!confirm("Install Docker on this server? Runs in the background — takes ~60 seconds.")) return;
    try {
      const res = await fetch(`${API}/api/v1/servers/${id}/install-docker`, { method: "POST", headers: headers() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 202) {
        alert(data.error || "Failed to start Docker install");
        return;
      }
      load();
    } catch {
      alert("Network error starting Docker install.");
    }
  }

  // Poll while any server has an install in progress so the UI reflects state.
  useEffect(() => {
    const anyInstalling = servers.some((s) => s.docker_install_status === "installing");
    if (!anyInstalling) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [servers]);

  async function removeServer(id: string) {
    if (!confirm("Remove this server? Projects deployed on it will be stopped and become inaccessible.")) return;
    setNotice("");
    try {
      const res = await fetch(`${API}/api/v1/servers/${id}`, { method: "DELETE", headers: headers() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(data.error || `Failed to remove server (HTTP ${res.status})`);
        return;
      }
      // If the host was unreachable we could not stop its containers — tell
      // the owner exactly what is still running and how to clean it up.
      if (data.warning) setNotice(data.warning);
      load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Network error removing server");
    }
  }

  useEffect(() => { load(); }, []);

  // Determine if the plan allows BYOC (free plan has max_byoc_servers = 0). A
  // plan not present in the public list (e.g. admin) defaults to allowed.
  useEffect(() => {
    (async () => {
      try {
        const me = await fetch(`${API}/api/v1/users/me`, { headers: headers() }).then((r) => r.json());
        const plans = await fetch(`${API}/api/v1/plans`).then((r) => r.json());
        const pl = Array.isArray(plans) ? plans.find((p: { plan: string; max_byoc_servers: number }) => p.plan === me.plan) : null;
        setByocAllowed(!pl || pl.max_byoc_servers !== 0);
      } catch {
        setByocAllowed(true);
      }
    })();
  }, []);

  const byocUpsell = () =>
    showPlanLimit("plan limit reached: your own server (BYOC) is not available on the free plan — upgrade to unlock it");

  return (
    <div className="animate-fade-in-up">
      {notice && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice("")} className="text-xs text-muted-foreground hover:text-foreground">Dismiss</button>
        </div>
      )}
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Deploy</p>
          <h1 className="mt-1 text-[22px] sm:text-[26px] font-bold tracking-[-0.02em]">My Servers</h1>
          <p className="mt-1 text-sm text-muted-foreground hidden sm:block">Bring your own compute — deploy projects to your own servers via SSH.</p>
        </div>
        <Button size="sm" onClick={() => (byocAllowed === false ? byocUpsell() : setShowAdd(true))} className="btn-shine gap-1 h-8 shrink-0 px-2.5 sm:px-3 rounded-lg">
          <Plus className="h-3.5 w-3.5" /><span className="hidden sm:inline"> Add Server</span>
        </Button>
      </div>

      {byocAllowed === false && (
        <div className="mb-6 rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
              <p className="text-sm font-medium">Bring-your-own-server is a paid feature</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                Connect your own VPS to deploy projects on your own infrastructure. Upgrade to Hobby or higher to unlock it.
              </p>
            </div>
            <Button size="sm" onClick={byocUpsell} className="btn-shine shrink-0 rounded-full px-5">Upgrade</Button>
          </div>
        </div>
      )}

      {showAdd && byocAllowed !== false && (
        <div className="mb-6 rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/60">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">Add SSH Server</p>
          </div>
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              <Button size="sm" onClick={addServer} disabled={adding || !form.label || !form.host || !form.ssh_password} className="btn-shine gap-1 rounded-lg">
                {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wifi className="h-3 w-3" />} Connect & Add
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground animate-pulse">Loading servers…</p>
      ) : servers.length === 0 ? (
        <div className="relative rounded-2xl border border-dashed border-border overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute -top-20 left-1/2 h-40 w-[380px] -translate-x-1/2 rounded-full bg-orange-500/[0.07] blur-[80px] dark:bg-orange-400/[0.08]" />
          <div className="relative flex flex-col items-center py-16 px-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/70 bg-card">
              <Server className="h-5 w-5 text-orange-500 dark:text-orange-400" />
            </div>
            <h3 className="mt-4 font-semibold">No servers yet</h3>
            <p className="mt-2 text-sm text-muted-foreground text-center max-w-sm">
              Add your own server to deploy projects there instead of using shared infrastructure.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {servers.map((s, i) => (
            <div
              key={s.id}
              className="animate-fade-in-up rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-4 transition-all duration-300 hover:border-foreground/20"
              style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-orange-500/20 bg-orange-500/10 text-orange-500 dark:text-orange-400 shrink-0">
                    <Server className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{s.label}</span>
                      <Badge variant="outline" className={`text-[10px] ${s.status === "active" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/40" : "bg-zinc-500/10 text-muted-foreground border-zinc-500/20"}`}>
                        {s.status}
                      </Badge>
                      {s.docker_installed ? (
                        <Badge variant="outline" className="text-[10px] gap-0.5"><CheckCircle2 className="h-2.5 w-2.5" /> Docker</Badge>
                      ) : s.docker_install_status === "installing" ? (
                        <Badge variant="outline" className="text-[10px] gap-1 text-blue-600 dark:text-blue-400 border-blue-500/40">
                          <Loader2 className="h-2.5 w-2.5 animate-spin" /> Installing Docker…
                        </Badge>
                      ) : (
                        <>
                          <Badge variant="outline" className={`text-[10px] gap-0.5 ${s.docker_install_status === "failed" ? "text-red-600 dark:text-red-400 border-red-500/40" : "text-amber-600 dark:text-amber-400 border-amber-500/40"}`}>
                            <AlertCircle className="h-2.5 w-2.5" /> {s.docker_install_status === "failed" ? "Install failed" : "No Docker"}
                          </Badge>
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] rounded-md" onClick={() => installDocker(s.id)}>
                            {s.docker_install_status === "failed" ? "Retry install" : "Install Docker"}
                          </Button>
                          {s.docker_install_status === "failed" && s.docker_install_error && (
                            <span className="text-[10px] text-red-600 dark:text-red-400 truncate max-w-[200px]" title={s.docker_install_error}>{s.docker_install_error}</span>
                          )}
                        </>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground font-mono mt-1 truncate">{s.ssh_user}@{s.host}:{s.port}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right text-[11px] text-muted-foreground space-y-1 min-w-[140px] hidden sm:block">
                    <div><span className="text-foreground font-mono">{s.current_projects}</span>/{s.max_projects} projects</div>
                    <div>
                      <span className="text-foreground font-mono">{s.used_memory_mb}</span>
                      <span>/{s.total_memory_mb >= 1024 ? `${(s.total_memory_mb / 1024).toFixed(1)} GB` : `${s.total_memory_mb} MB`} RAM used</span>
                    </div>
                    <div>
                      load <span className="text-foreground font-mono">{(s.load_avg ?? 0).toFixed(1)}</span>/<span className="font-mono">{s.total_cpu.toFixed(0)}</span> cores
                    </div>
                    {s.total_memory_mb > 0 && (
                      <div className="h-1 rounded-full bg-border overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${s.used_memory_mb / s.total_memory_mb > 0.85 ? "bg-amber-500" : "bg-gradient-to-r from-emerald-500 to-emerald-400"}`}
                          style={{ width: `${Math.min(100, (s.used_memory_mb / s.total_memory_mb) * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => removeServer(s.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
