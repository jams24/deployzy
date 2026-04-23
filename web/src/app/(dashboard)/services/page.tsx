"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Database, Plus, Trash2, Eye, EyeOff, Copy, RefreshCw, Loader2, Clock, Download, Upload, Rocket, Table2 } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

// Unified row — either a standalone service or a per-project database
interface DBRow {
  kind: "service" | "project";
  id: string;
  project_id: string | null;
  project_name: string | null;
  project_subdomain?: string;
  name: string;
  type: string;
  status: string;
  db_name: string;
  db_user: string;
  db_password: string;
  host: string;
  port: number;
  connection_url: string;
  external_connection_url: string;
  created_at: string;
  size_mb?: number;
  over_quota?: boolean;
}

interface Backup {
  id: string;
  file_name: string;
  file_size: number;
  created_at: string;
}

interface Schedule {
  enabled: boolean;
  schedule: string;
  time: string;
  retention: number;
}

export default function ServicesPage() {
  const [rows, setRows] = useState<DBRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPass, setShowPass] = useState<Record<string, boolean>>({});
  // Backup state (only for project-linked DBs — standalone services don't
  // expose backups via the current backend yet)
  const [backups, setBackups] = useState<Record<string, Backup[]>>({}); // projectId → backups
  const [backingUp, setBackingUp] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<Schedule>({ enabled: false, schedule: "daily", time: "03:00", retention: 7 });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // SQL Console state (per-row so multiple DBs can be open simultaneously)
  interface SqlResult { columns: string[]; rows: unknown[][]; rows_affected: number; duration_ms: number; truncated: boolean; notice?: string; types: string[]; }
  const [sqlText, setSqlText] = useState<Record<string, string>>({});
  const [sqlResult, setSqlResult] = useState<Record<string, SqlResult | null>>({});
  const [sqlError, setSqlError] = useState<Record<string, string>>({});
  const [sqlRunning, setSqlRunning] = useState<Record<string, boolean>>({});
  const [sqlOpen, setSqlOpen] = useState<Record<string, boolean>>({});

  async function runSQL(row: DBRow) {
    const id = row.id;
    const sql = (sqlText[id] || "").trim();
    if (!sql) return;
    // Remember last-run query per row so refreshes don't lose work.
    try { localStorage.setItem(`sm_sql_${id}`, sql); } catch {}
    setSqlRunning((s) => ({ ...s, [id]: true }));
    setSqlError((s) => ({ ...s, [id]: "" }));
    try {
      const url = row.kind === "project" && row.project_id
        ? `${API}/api/v1/projects/${row.project_id}/database/query`
        : `${API}/api/v1/services/${id}/query`;
      const res = await fetch(url, { method: "POST", headers: headers(), body: JSON.stringify({ sql }) });
      const data = await res.json();
      if (!res.ok) {
        setSqlError((s) => ({ ...s, [id]: data.error || "query failed" }));
        setSqlResult((s) => ({ ...s, [id]: null }));
      } else {
        setSqlResult((s) => ({ ...s, [id]: data }));
      }
    } catch (e) {
      setSqlError((s) => ({ ...s, [id]: (e as Error).message }));
    }
    setSqlRunning((s) => ({ ...s, [id]: false }));
  }

  const headers = () => {
    const token = localStorage.getItem("sm_token");
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };

  async function load() {
    try {
      const res = await fetch(`${API}/api/v1/databases`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setRows(Array.isArray(data) ? data : []);
        // Pre-load backups for project-linked DBs so users see existing backups at a glance.
        (Array.isArray(data) ? data : []).forEach((r: DBRow) => {
          if (r.kind === "project" && r.project_id) loadBackups(r.project_id);
        });
      }
    } catch {}
    setLoading(false);
  }

  async function remove(row: DBRow) {
    const label = row.kind === "project"
      ? `Delete the database for project "${row.project_name}"? All data will be permanently lost.`
      : `Delete this database? All data will be permanently lost.`;
    if (!confirm(label)) return;
    const url = row.kind === "project"
      ? `${API}/api/v1/projects/${row.project_id}/database`
      : `${API}/api/v1/services/${row.id}`;
    await fetch(url, { method: "DELETE", headers: headers() });
    load();
  }

  async function loadBackups(projectId: string) {
    try {
      const res = await fetch(`${API}/api/v1/projects/${projectId}/backups`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setBackups((prev) => ({ ...prev, [projectId]: Array.isArray(data) ? data : [] }));
      }
    } catch {}
  }

  async function createBackup(projectId: string) {
    setBackingUp(projectId);
    try {
      const res = await fetch(`${API}/api/v1/projects/${projectId}/backups`, { method: "POST", headers: headers() });
      if (res.ok) loadBackups(projectId);
      else alert("Backup failed");
    } catch {}
    setBackingUp(null);
  }

  async function deleteBackup(projectId: string, backupId: string) {
    await fetch(`${API}/api/v1/projects/${projectId}/backups/${backupId}`, { method: "DELETE", headers: headers() });
    loadBackups(projectId);
  }

  async function restoreBackup(projectId: string, backupId: string) {
    if (!confirm("Restore this backup? Current data will be overwritten.")) return;
    const res = await fetch(`${API}/api/v1/projects/${projectId}/backups/${backupId}/restore`, { method: "POST", headers: headers() });
    if (res.ok) alert("Database restored successfully");
    else alert("Restore failed");
  }

  async function downloadBackup(projectId: string, b: Backup) {
    const res = await fetch(`${API}/api/v1/projects/${projectId}/backups/${b.id}/download`, { headers: headers() });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = b.file_name; a.click();
    URL.revokeObjectURL(url);
  }

  async function openSchedule(projectId: string) {
    try {
      const res = await fetch(`${API}/api/v1/projects/${projectId}/backup-schedule`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        if (data) setSchedule({ enabled: data.enabled, schedule: data.schedule, time: data.time, retention: data.retention });
      }
    } catch {}
    setShowSchedule(projectId);
  }

  async function saveSchedule(projectId: string) {
    await fetch(`${API}/api/v1/projects/${projectId}/backup-schedule`, {
      method: "PUT", headers: headers(), body: JSON.stringify(schedule),
    });
    setShowSchedule(null);
  }

  useEffect(() => { load(); }, []);

  const mask = (url: string, pw: string) => url.replace(`:${pw}@`, ":****@");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Databases</h1>
          <p className="mt-1 text-sm text-muted-foreground">Managed PostgreSQL instances — standalone or linked to a project.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Button>
          <Button size="sm" className="gap-1" nativeButton={false} render={<Link href="/new" />}>
            <Plus className="h-3.5 w-3.5" /> New Database
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12">
            <Database className="h-10 w-10 text-muted-foreground/30 mb-4" />
            <h3 className="font-semibold">No databases yet</h3>
            <p className="mt-1 text-sm text-muted-foreground text-center max-w-sm">
              Deploy a standalone PostgreSQL database, or a project you create on ServerMe can have one attached automatically.
            </p>
            <Button className="mt-5 gap-2" nativeButton={false} render={<Link href="/new" />}>
              <Database className="h-4 w-4" /> Create Database
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((s) => {
            const isProj = s.kind === "project" && !!s.project_id;
            const rowBackups = isProj && s.project_id ? (backups[s.project_id] || []) : [];
            const isOpen = !!expanded[s.id];
            return (
              <Card key={s.id}>
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 cursor-pointer flex-1" onClick={() => setExpanded((prev) => ({ ...prev, [s.id]: !prev[s.id] }))}>
                      <div className={`flex h-10 w-10 items-center justify-center rounded-lg shrink-0 ${isProj ? "bg-blue-500/10 text-blue-400" : "bg-emerald-500/10 text-emerald-400"}`}>
                        <Database className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold truncate">{s.name}</span>
                          <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-500 border-emerald-500/20">{s.status}</Badge>
                          <Badge variant="outline" className="text-[10px]">PostgreSQL 16</Badge>
                          {isProj && s.project_subdomain && (
                            <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-500/20 gap-1">
                              <Rocket className="h-2.5 w-2.5" />
                              {s.project_name}
                            </Badge>
                          )}
                          {!isProj && (
                            <Badge variant="outline" className="text-[10px] text-zinc-500">standalone</Badge>
                          )}
                          {typeof s.size_mb === "number" && (
                            <Badge variant="outline" className={`text-[10px] ${s.over_quota ? "bg-amber-500/10 text-amber-500 border-amber-500/30" : "text-zinc-400"}`}>
                              {s.size_mb} MB{s.over_quota ? " · over quota — writes blocked" : ""}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">{s.db_name} · {s.host}:{s.port}</p>
                      </div>
                    </div>
                    <Link
                      href={isProj && s.project_id ? `/database/${s.id}?type=project&projectId=${s.project_id}` : `/database/${s.id}?type=service`}
                      className="shrink-0"
                    >
                      <Button variant="outline" size="sm" className="h-8 px-2.5 text-[10px] gap-1">
                        <Table2 className="h-3 w-3" /> Editor
                      </Button>
                    </Link>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive shrink-0" onClick={() => remove(s)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {isOpen && (
                    <>
                      {/* Connection details */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div><span className="text-muted-foreground">Database:</span> <span className="font-mono">{s.db_name}</span></div>
                        <div><span className="text-muted-foreground">User:</span> <span className="font-mono">{s.db_user}</span></div>
                        <div><span className="text-muted-foreground">Host:</span> <span className="font-mono">{s.host}</span></div>
                        <div><span className="text-muted-foreground">Port:</span> <span className="font-mono">{s.port}</span></div>
                      </div>

                      {/* Connection URLs */}
                      <div className="space-y-2">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground font-medium">Internal URL</span>
                            <span className="text-[10px] text-muted-foreground">{isProj ? "Auto-injected as DATABASE_URL" : "Copy into your project's DATABASE_URL"}</span>
                          </div>
                          <div className="flex items-center gap-1 min-w-0">
                            <code className="flex-1 min-w-0 rounded-md border border-input bg-[#09090b] px-3 py-2 font-mono text-[11px] text-zinc-400 overflow-x-auto">
                              {showPass[s.id] ? s.connection_url : mask(s.connection_url, s.db_password)}
                            </code>
                            <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setShowPass((p) => ({ ...p, [s.id]: !p[s.id] }))}>
                              {showPass[s.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => navigator.clipboard.writeText(s.connection_url)}>
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground font-medium">External URL</span>
                            <span className="text-[10px] text-muted-foreground">For local dev / external tools (pgAdmin, DBeaver, etc)</span>
                          </div>
                          <div className="flex items-center gap-1 min-w-0">
                            <code className="flex-1 min-w-0 rounded-md border border-input bg-[#09090b] px-3 py-2 font-mono text-[11px] text-zinc-400 overflow-x-auto">
                              {showPass[s.id] ? s.external_connection_url : mask(s.external_connection_url, s.db_password)}
                            </code>
                            <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setShowPass((p) => ({ ...p, [s.id]: !p[s.id] }))}>
                              {showPass[s.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => navigator.clipboard.writeText(s.external_connection_url)}>
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>

                      {/* SQL Console — run arbitrary queries against this DB.
                          10s statement_timeout, 1000-row cap, credentials never leave the server. */}
                      <div className="border-t border-border/30 pt-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-medium text-muted-foreground flex items-center gap-1.5">
                            <Database className="h-3 w-3" /> SQL Console
                          </span>
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => {
                            setSqlOpen((o) => {
                              const next = !o[s.id];
                              if (next && sqlText[s.id] === undefined) {
                                try {
                                  const saved = localStorage.getItem(`sm_sql_${s.id}`);
                                  setSqlText((t) => ({ ...t, [s.id]: saved || "SELECT * FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;" }));
                                } catch {
                                  setSqlText((t) => ({ ...t, [s.id]: "SELECT * FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;" }));
                                }
                              }
                              return { ...o, [s.id]: next };
                            });
                          }}>
                            {sqlOpen[s.id] ? "Hide" : "Open"}
                          </Button>
                        </div>

                        {sqlOpen[s.id] && (
                          <div className="space-y-2">
                            <textarea
                              value={sqlText[s.id] || ""}
                              onChange={(e) => setSqlText((t) => ({ ...t, [s.id]: e.target.value }))}
                              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); runSQL(s); } }}
                              rows={5}
                              placeholder="SELECT * FROM your_table LIMIT 10;"
                              className="w-full rounded-md border border-input bg-[#09090b] p-2.5 font-mono text-[11px] text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                              spellCheck={false}
                            />
                            <div className="flex items-center justify-between">
                              <p className="text-[9px] text-zinc-600">⌘/Ctrl+Enter to run · 10s timeout · 1000-row cap</p>
                              <Button size="sm" className="h-6 px-3 text-[10px] gap-1" disabled={sqlRunning[s.id] || !(sqlText[s.id] || "").trim()} onClick={() => runSQL(s)}>
                                {sqlRunning[s.id] ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : null}
                                Run
                              </Button>
                            </div>

                            {sqlError[s.id] && (
                              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 font-mono text-[10px] text-red-400 whitespace-pre-wrap break-all">
                                {sqlError[s.id]}
                              </div>
                            )}

                            {sqlResult[s.id] && (
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-3 text-[9px] text-muted-foreground">
                                  <span>{sqlResult[s.id]!.rows.length} rows</span>
                                  <span>{sqlResult[s.id]!.duration_ms}ms</span>
                                  {sqlResult[s.id]!.rows_affected > 0 && <span>affected: {sqlResult[s.id]!.rows_affected}</span>}
                                  {sqlResult[s.id]!.truncated && <span className="text-amber-500">truncated</span>}
                                </div>
                                {sqlResult[s.id]!.columns.length > 0 && (
                                  <div className="rounded-md border border-border/30 bg-[#09090b] overflow-x-auto max-h-80">
                                    <table className="w-full text-[10px] font-mono">
                                      <thead className="sticky top-0 bg-[#09090b] border-b border-border/30">
                                        <tr>
                                          {sqlResult[s.id]!.columns.map((c, i) => (
                                            <th key={i} className="px-2 py-1.5 text-left text-zinc-500 font-medium whitespace-nowrap">
                                              {c}
                                              <span className="ml-1 text-[9px] text-zinc-700">{sqlResult[s.id]!.types[i]}</span>
                                            </th>
                                          ))}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {sqlResult[s.id]!.rows.map((r, i) => (
                                          <tr key={i} className={i % 2 ? "bg-white/[0.02]" : ""}>
                                            {r.map((v, j) => (
                                              <td key={j} className="px-2 py-1 text-zinc-300 whitespace-nowrap max-w-xs truncate" title={v === null ? "NULL" : String(v)}>
                                                {v === null ? <span className="text-zinc-600">NULL</span> : typeof v === "object" ? JSON.stringify(v) : String(v)}
                                              </td>
                                            ))}
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Backups — only for project-linked DBs (existing backend endpoints) */}
                      {isProj && s.project_id && (
                        <div className="border-t border-border/30 pt-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-medium text-muted-foreground flex items-center gap-1.5">
                              <Clock className="h-3 w-3" /> Backups
                            </span>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => openSchedule(s.project_id!)}>Schedule</Button>
                              <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1" onClick={() => createBackup(s.project_id!)} disabled={backingUp === s.project_id}>
                                {backingUp === s.project_id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Database className="h-2.5 w-2.5" />}
                                Backup Now
                              </Button>
                            </div>
                          </div>

                          {showSchedule === s.project_id && (
                            <div className="rounded-md border border-border/30 bg-[#09090b] p-3 space-y-2">
                              <div className="flex items-center gap-3 flex-wrap">
                                <label className="flex items-center gap-1.5 text-[10px]">
                                  <input type="checkbox" checked={schedule.enabled} onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })} className="rounded" />
                                  Enabled
                                </label>
                                <select className="h-6 rounded border border-input bg-background px-1.5 text-[10px]" value={schedule.schedule} onChange={(e) => setSchedule({ ...schedule, schedule: e.target.value })}>
                                  <option value="every6h">Every 6 hours</option>
                                  <option value="every12h">Every 12 hours</option>
                                  <option value="daily">Daily</option>
                                  <option value="weekly">Weekly</option>
                                </select>
                                <input type="time" className="h-6 rounded border border-input bg-background px-1.5 text-[10px]" value={schedule.time} onChange={(e) => setSchedule({ ...schedule, time: e.target.value })} />
                                <select className="h-6 rounded border border-input bg-background px-1.5 text-[10px]" value={schedule.retention} onChange={(e) => setSchedule({ ...schedule, retention: parseInt(e.target.value) })}>
                                  {[3, 7, 14, 30].map((d) => <option key={d} value={d}>Keep {d} days</option>)}
                                </select>
                              </div>
                              <div className="flex gap-1">
                                <Button size="sm" className="h-6 px-2 text-[10px]" onClick={() => saveSchedule(s.project_id!)}>Save</Button>
                                <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setShowSchedule(null)}>Cancel</Button>
                              </div>
                            </div>
                          )}

                          {rowBackups.length > 0 ? (
                            <div className="space-y-1">
                              {rowBackups.map((b) => (
                                <div key={b.id} className="flex items-center justify-between rounded-md bg-[#09090b] px-2.5 py-1.5 text-[10px]">
                                  <div className="flex items-center gap-2 font-mono text-zinc-400">
                                    <Database className="h-3 w-3 text-zinc-600" />
                                    <span>{new Date(b.created_at).toLocaleString()}</span>
                                    <span className="text-zinc-600">{(b.file_size / 1024).toFixed(1)} KB</span>
                                  </div>
                                  <div className="flex gap-1">
                                    <Button variant="ghost" size="sm" className="h-5 px-1 text-[9px] gap-1" onClick={() => downloadBackup(s.project_id!, b)}><Download className="h-2.5 w-2.5" /> Download</Button>
                                    <Button variant="ghost" size="sm" className="h-5 px-1 text-[9px] gap-1 text-blue-400" onClick={() => restoreBackup(s.project_id!, b.id)}><Upload className="h-2.5 w-2.5" /> Restore</Button>
                                    <Button variant="ghost" size="sm" className="h-5 px-1 text-[9px] text-destructive" onClick={() => deleteBackup(s.project_id!, b.id)}>Delete</Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[10px] text-zinc-600">No backups yet</p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
