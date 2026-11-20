"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowsClockwiseIcon, CircleNotchIcon, ClockIcon, CopyIcon, DatabaseIcon, DownloadSimpleIcon, EyeIcon, EyeSlashIcon, HardDrivesIcon, MagnifyingGlassIcon, PlugIcon, PlusIcon, RocketLaunchIcon, TableIcon, TrashIcon, UploadSimpleIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
import { regionName, regionFlag } from "@/lib/regions";
import { EmptyState, IconTile, PageHeader, StackIcon, StatusPill } from "@/components/dashboard/kit";
import { RowMenu } from "@/components/dashboard/row-menu";

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

interface MyLimits {
  plan: string; is_admin: boolean;
  limits: { max_db_size_mb: number; max_databases: number; max_services: number };
  usage: { databases: number; services: number };
}

function fmtMB(mb: number) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB` : `${mb} MB`;
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
  const [myLimits, setMyLimits] = useState<MyLimits | null>(null);
  const [dbSearch, setDbSearch] = useState("");
  const [dbType, setDbType] = useState("all");
  const [rows, setRows] = useState<DBRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPass, setShowPass] = useState<Record<string, boolean>>({});
  // Confirm-delete modal
  const [deleteTarget, setDeleteTarget] = useState<DBRow | null>(null);
  const [deleteInput, setDeleteInput] = useState("");
  const [deleting, setDeleting] = useState(false);
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
      fetch(`${API}/api/v1/users/me/limits`, { headers: headers() })
        .then((r) => (r.ok ? r.json() : null)).then((d) => d && setMyLimits(d)).catch(() => {});
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

  function promptDelete(row: DBRow) {
    setDeleteTarget(row);
    setDeleteInput("");
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const url = deleteTarget.kind === "project"
      ? `${API}/api/v1/projects/${deleteTarget.project_id}/database`
      : `${API}/api/v1/services/${deleteTarget.id}`;
    await fetch(url, { method: "DELETE", headers: headers() });
    setDeleteTarget(null);
    setDeleteInput("");
    setDeleting(false);
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

  // Move a standalone database to another server (Hobby+).
  const [moveOpen, setMoveOpen] = useState<string | null>(null);
  const [moveServers, setMoveServers] = useState<{ id: string; label: string; region: string; is_byoc: boolean; full: boolean }[]>([]);
  const [moving, setMoving] = useState(false);
  async function openMove(id: string) {
    if (moveOpen === id) { setMoveOpen(null); return; }
    setMoveOpen(id);
    if (moveServers.length === 0) {
      try {
        const res = await fetch(`${API}/api/v1/servers/selectable`, { headers: headers() });
        if (res.ok) setMoveServers(await res.json());
      } catch {}
    }
  }
  async function moveDatabase(id: string, name: string, serverId: string, label: string) {
    if (!confirm(`Migrate "${name}" to ${label}?\n\nThis copies the data to a new instance there. Your original stays untouched — repoint your app to the new connection string, then delete the source once verified.`)) return;
    setMoving(true);
    try {
      const res = await fetch(`${API}/api/v1/services/${id}/move`, {
        method: "POST", headers: headers(), body: JSON.stringify({ worker_server_id: serverId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setMoveOpen(null); alert(`Migrating "${name}" to ${label} — copying data now. Your original is untouched. Once done, the copy appears in this list; repoint your app, then delete the source.`); }
      else alert(data.error || "Move failed");
    } catch { alert("Move failed"); }
    setMoving(false);
  }

  async function downloadServiceBackup(id: string, name: string) {
    setBackingUp(id);
    try {
      const res = await fetch(`${API}/api/v1/services/${id}/backup`, { headers: headers() });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Backup failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}-${new Date().toISOString().slice(0, 10)}.sql.gz`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch { alert("Backup failed"); }
    finally { setBackingUp(null); }
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

  const typeLabel = (t: string) => ({ postgres: "PostgreSQL 16", redis: "Redis 7", mongodb: "MongoDB 7", mysql: "MySQL 8" }[t] ?? t);
  const urlEnvKey = (t: string) => ({ postgres: "DATABASE_URL", redis: "REDIS_URL", mongodb: "MONGO_URL", mysql: "MYSQL_URL" }[t] ?? "CONNECTION_URL");
  const isSQL = (t: string) => t === "postgres" || t === "mysql";

  const deleteLabel = deleteTarget
    ? (deleteTarget.kind === "project" ? `${deleteTarget.project_name} database` : deleteTarget.name)
    : "";
  const deleteConfirmReady = deleteInput === deleteLabel && !deleting;

  return (
    <div>
      {/* ── Delete confirmation modal ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-xl border border-red-500/50 bg-card shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-400 mt-0.5">
                <WarningIcon className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-foreground">Delete database</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  This will permanently destroy <span className="font-semibold text-foreground">{deleteLabel}</span> and all its data. This action cannot be undone.
                </p>
              </div>
              <button className="ml-auto shrink-0 p-1 rounded text-muted-foreground hover:text-foreground" onClick={() => setDeleteTarget(null)}>
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 space-y-1">
              <p className="text-[11px] font-medium text-red-400 uppercase tracking-wider">What will be deleted</p>
              <ul className="text-[12px] text-muted-foreground space-y-0.5">
                <li>• All data stored in <span className="font-mono text-foreground">{deleteTarget.db_name || deleteLabel}</span></li>
                <li>• The Docker container ({deleteTarget.type})</li>
                {deleteTarget.kind === "project" && <li>• Connection to project <span className="font-medium text-foreground">{deleteTarget.project_name}</span></li>}
              </ul>
            </div>

            <div className="space-y-1.5">
              <label className="text-[12px] text-muted-foreground">
                Type <span className="font-mono font-semibold text-foreground">{deleteLabel}</span> to confirm:
              </label>
              <Input
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && deleteConfirmReady && confirmDelete()}
                placeholder={deleteLabel}
                className="font-mono text-[13px] border-input focus:border-red-500/50"
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1 h-9" onClick={() => { setDeleteTarget(null); setDeleteInput(""); }}>
                Cancel
              </Button>
              <Button
                className="flex-1 h-9 gap-1.5 bg-red-600 hover:bg-red-700 text-white border-0"
                disabled={!deleteConfirmReady}
                onClick={confirmDelete}
              >
                {deleting ? <CircleNotchIcon className="h-3.5 w-3.5 animate-spin" /> : <TrashIcon className="h-3.5 w-3.5" />}
                Delete permanently
              </Button>
            </div>
          </div>
        </div>
      )}

      <PageHeader
        className="mb-7 animate-fade-in-up"
        title="Databases"
        description="Managed PostgreSQL, MySQL, MongoDB and Redis, with connection strings ready to paste."
        actions={
          <>
            <button type="button" onClick={load} title="Refresh" aria-label="Refresh" className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--dz-hairline)] text-muted-foreground transition-colors hover:text-foreground">
              <ArrowsClockwiseIcon className="h-4 w-4" />
            </button>
            <Link href="/new?type=database" className="pill pill-ink pill-xs"><PlusIcon weight="bold" className="h-3.5 w-3.5" /> New database</Link>
          </>
        }
      />

      {loading ? (
        <p className="text-sm text-muted-foreground animate-pulse">Loading databases…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={DatabaseIcon}
          title="No databases yet"
          description="Create a standalone PostgreSQL, MySQL, MongoDB or Redis database, or attach one when you deploy a project."
          action={<Link href="/new?type=database" className="pill pill-ink pill-sm"><PlusIcon weight="bold" className="h-4 w-4" /> Create database</Link>}
        />
      ) : (
        <>
        {(() => {
          const cap = myLimits?.limits.max_db_size_mb ?? 0;
          const unlimited = !!myLimits?.is_admin || cap < 0;
          const total = rows.reduce((n, r) => n + (r.size_mb ?? 0), 0);
          const biggest = rows.reduce((m, r) => Math.max(m, r.size_mb ?? 0), 0);
          const over = rows.filter((r) => r.over_quota);
          const near = unlimited || cap <= 0 ? [] : rows.filter((r) => !r.over_quota && (r.size_mb ?? 0) >= cap * 0.8);
          return (
            <div className="mb-4 space-y-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  ["Databases", String(rows.length), `${rows.filter((r) => r.kind === "service").length} standalone · ${rows.filter((r) => r.kind === "project").length} attached`],
                  ["Storage used", fmtMB(total), "across all databases"],
                  ["Largest", fmtMB(biggest), unlimited ? "no size cap" : `cap ${fmtMB(cap)} each`],
                  ["Size cap per DB", unlimited ? "Unlimited" : fmtMB(cap), `${myLimits?.plan ?? "…"} plan`],
                ].map(([k, v, sub]) => (
                  <div key={k} className="surface rounded-[16px] px-4 py-3.5">
                    <p className="text-[12px] text-muted-foreground">{k}</p>
                    <p className="mt-1 text-[20px] font-semibold tracking-[-0.02em] tabular-nums">{v}</p>
                    <p className="mt-0.5 truncate text-[12px] first-letter:uppercase text-muted-foreground">{sub}</p>
                  </div>
                ))}
              </div>
              {over.length > 0 && (
                <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-700 dark:text-red-400">
                  <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium">{over.map((r) => r.name).join(", ")} {over.length === 1 ? "is" : "are"} over your plan&apos;s {fmtMB(cap)} size cap and now read-only.</p>
                    <p className="mt-0.5 text-red-700/80 dark:text-red-400/80">Reads keep working. Delete data to get back under the cap (in a SQL session run <span className="font-mono">SET default_transaction_read_only = off;</span> first), or <Link href="/billing" className="font-medium underline">upgrade</Link> for more space. Writes re-enable automatically within 5 minutes.</p>
                  </div>
                </div>
              )}
              {near.length > 0 && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
                  <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{near.map((r) => r.name).join(", ")} {near.length === 1 ? "is" : "are"} above 80% of the {fmtMB(cap)} cap. Over the cap, a database becomes read-only.</p>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[12rem] flex-1">
                  <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={dbSearch} onChange={(e) => setDbSearch(e.target.value)} placeholder="Search databases" className="h-9 rounded-full pl-9 text-sm" />
                </div>
                <div className="flex flex-wrap rounded-full border border-[var(--dz-hairline)] p-0.5">
                  {["all", ...Array.from(new Set(rows.map((r) => r.type)))].map((t) => (
                    <button key={t} onClick={() => setDbType(t)}
                      className={`rounded-full px-3 py-1 text-[12px] font-medium ${dbType === t ? "bg-foreground/[0.08] text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                      {t === "all" ? `All ${rows.length}` : `${typeLabel(t).replace(/ \d+$/, "")} ${rows.filter((r) => r.type === t).length}`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}
        <div className="surface divide-y divide-[var(--dz-hairline)] overflow-hidden rounded-[18px]">
          {rows.filter((r) => (dbType === "all" || r.type === dbType) &&
            (!dbSearch.trim() || [r.name, r.db_name, r.project_name ?? "", r.host].some((v) => v.toLowerCase().includes(dbSearch.trim().toLowerCase())))).map((s) => {
            const isProj = s.kind === "project" && !!s.project_id;
            const rowBackups = isProj && s.project_id ? (backups[s.project_id] || []) : [];
            const isOpen = !!expanded[s.id];
            return (
              <div key={s.id} className={`transition-colors ${isOpen ? "bg-foreground/[0.02]" : "hover:bg-foreground/[0.02]"}`}>
                <div className="space-y-3 px-4 py-3.5 sm:px-5">
                  <div className="flex items-center gap-3.5">
                    <button type="button" aria-expanded={isOpen} className="flex min-w-0 flex-1 items-center gap-3.5 text-left" onClick={() => setExpanded((prev) => ({ ...prev, [s.id]: !prev[s.id] }))}>
                      <IconTile size="md" className="text-foreground/75">
                        <StackIcon stack={s.type} className="h-[18px] w-[18px]" />
                      </IconTile>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-[14px] font-semibold tracking-[-0.01em]">{s.name}</span>
                          <StatusPill status={s.status} />
                          {s.over_quota && <span className="inline-flex h-[22px] shrink-0 items-center rounded-full bg-red-500/10 px-2 text-[12px] font-medium text-red-600 dark:text-red-400">Read-only</span>}
                        </div>
                        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
                          <span className="shrink-0">{typeLabel(s.type)}</span>
                          {isProj && s.project_name && (<><span aria-hidden className="text-foreground/20">·</span><span className="inline-flex min-w-0 items-center gap-1"><RocketLaunchIcon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{s.project_name}</span></span></>)}
                          <span aria-hidden className="hidden text-foreground/20 sm:inline">·</span>
                          <span className="hidden truncate sm:inline">{s.host}:{s.port}</span>
                        </p>
                        {(() => {
                          const cap = myLimits?.limits.max_db_size_mb ?? 0;
                          const unlimited = !!myLimits?.is_admin || cap <= 0;
                          const mb = s.size_mb ?? 0;
                          const pct = unlimited ? 0 : Math.min(100, (mb / cap) * 100);
                          return (
                            <div className="mt-2 flex max-w-xs items-center gap-2" title={unlimited ? `${fmtMB(mb)} used` : `${fmtMB(mb)} of ${fmtMB(cap)} (${pct.toFixed(1)}%)`}>
                              <div className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/[0.07]">
                                <div className={`h-full rounded-full transition-all duration-700 ${s.over_quota || pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-brand"}`}
                                  style={{ width: `${unlimited ? Math.min(100, mb > 0 ? 6 : 0) : Math.max(mb > 0 ? 1.5 : 0, pct)}%` }} />
                              </div>
                              <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                                {typeof s.size_mb === "number" ? fmtMB(mb) : "Not measured"}{!unlimited && typeof s.size_mb === "number" ? ` of ${fmtMB(cap)}` : ""}
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      {(isSQL(s.type) || s.type === "redis" || s.type === "mongodb") && (
                        // .pill is unlayered and beats `hidden`, so the wrapper hides it on phones.
                        <span className="hidden sm:contents">
                        <Link
                          className="pill pill-line pill-xs"
                          href={
                            s.type === "redis"
                              ? `/redis/${s.id}`
                              : s.type === "mongodb"
                                ? `/mongo/${s.id}`
                                : isProj && s.project_id
                                  ? `/database/${s.id}?type=project&projectId=${s.project_id}`
                                  : `/database/${s.id}?type=service`
                          }
                        >
                          <TableIcon className="h-3.5 w-3.5" /> Open
                        </Link>
                        </span>
                      )}
                      {backingUp === s.id && <CircleNotchIcon className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Preparing backup" />}
                      <RowMenu
                        label={`Actions for ${s.name}`}
                        items={[
                          (isSQL(s.type) || s.type === "redis" || s.type === "mongodb") && {
                            label: "Open data editor", icon: TableIcon,
                            href: s.type === "redis" ? `/redis/${s.id}` : s.type === "mongodb" ? `/mongo/${s.id}` : isProj && s.project_id ? `/database/${s.id}?type=project&projectId=${s.project_id}` : `/database/${s.id}?type=service`,
                          },
                          { label: isOpen ? "Hide connection details" : "Connection details", icon: PlugIcon, onSelect: () => setExpanded((prev) => ({ ...prev, [s.id]: !prev[s.id] })) },
                          !isProj && (s.type === "postgres" || s.type === "mysql") && { label: "Download a backup", icon: DownloadSimpleIcon, onSelect: () => downloadServiceBackup(s.id, s.name), disabled: backingUp === s.id },
                          !isProj && s.type !== "redis" && { label: "Move to another server", icon: HardDrivesIcon, onSelect: () => openMove(s.id) },
                          { label: "Delete database", icon: TrashIcon, onSelect: () => promptDelete(s), danger: true, divider: true },
                        ]}
                      />
                    </div>
                  </div>

                  {moveOpen === s.id && (
                    <div className="rounded-lg border border-border/60 bg-muted/50 px-3 py-3">
                      <p className="text-[11px] text-muted-foreground mb-2">Migrate <span className="font-medium text-foreground">{s.name}</span> to another server. It copies the data to a new instance — your <span className="font-medium">original stays untouched</span> (repoint your app, then delete the source once verified).</p>
                      <div className="flex flex-wrap gap-1.5">
                        {moveServers.filter(sv => !sv.full).map(sv => (
                          <button key={sv.id} onClick={() => moveDatabase(s.id, s.name, sv.id, sv.is_byoc ? sv.label : regionName(sv.region, sv.label))} disabled={moving}
                            className="text-[11px] px-2.5 py-1 rounded-md border border-input hover:border-foreground/30 disabled:opacity-50 flex items-center gap-1.5">
                            <span>{sv.is_byoc ? "🔧" : regionFlag(sv.region)}</span>{sv.is_byoc ? `${sv.label} (your server)` : regionName(sv.region, sv.label)}
                          </button>
                        ))}
                        {moveServers.length === 0 && <span className="text-[11px] text-muted-foreground">Loading servers…</span>}
                      </div>
                    </div>
                  )}

                  {isOpen && (
                    <>
                      {/* Connection details */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        {s.type !== "redis" && s.db_name && <div><span className="text-muted-foreground">Database:</span> <span className="font-mono">{s.db_name}</span></div>}
                        {s.type !== "redis" && s.db_user && <div><span className="text-muted-foreground">User:</span> <span className="font-mono">{s.db_user}</span></div>}
                        <div><span className="text-muted-foreground">Host:</span> <span className="font-mono">{s.host}</span></div>
                        <div><span className="text-muted-foreground">Port:</span> <span className="font-mono">{s.port}</span></div>
                      </div>

                      {/* Connection URLs */}
                      <div className="space-y-2">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground font-medium">Internal URL</span>
                            <span className="text-[10px] text-muted-foreground">{isProj ? `Auto-injected as ${urlEnvKey(s.type)}` : `Copy into your project's ${urlEnvKey(s.type)}`}</span>
                          </div>
                          <div className="flex items-center gap-1 min-w-0">
                            <code className="flex-1 min-w-0 rounded-md border border-input bg-muted px-3 py-2 font-mono text-[11px] text-muted-foreground overflow-x-auto">
                              {showPass[s.id] ? s.connection_url : mask(s.connection_url, s.db_password)}
                            </code>
                            <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setShowPass((p) => ({ ...p, [s.id]: !p[s.id] }))}>
                              {showPass[s.id] ? <EyeSlashIcon className="h-3.5 w-3.5" /> : <EyeIcon className="h-3.5 w-3.5" />}
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => navigator.clipboard.writeText(s.connection_url)}>
                              <CopyIcon className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground font-medium">External URL</span>
                            <span className="text-[10px] text-muted-foreground">For local dev / external tools (pgAdmin, DBeaver, etc)</span>
                          </div>
                          <div className="flex items-center gap-1 min-w-0">
                            <code className="flex-1 min-w-0 rounded-md border border-input bg-muted px-3 py-2 font-mono text-[11px] text-muted-foreground overflow-x-auto">
                              {showPass[s.id] ? s.external_connection_url : mask(s.external_connection_url, s.db_password)}
                            </code>
                            <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setShowPass((p) => ({ ...p, [s.id]: !p[s.id] }))}>
                              {showPass[s.id] ? <EyeSlashIcon className="h-3.5 w-3.5" /> : <EyeIcon className="h-3.5 w-3.5" />}
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => navigator.clipboard.writeText(s.external_connection_url)}>
                              <CopyIcon className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>

                      {/* SQL Console — postgres only (query endpoint rejects other types) */}
                      {isSQL(s.type) && <div className="border-t border-border/30 pt-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-medium text-muted-foreground flex items-center gap-1.5">
                            <DatabaseIcon className="h-3 w-3" /> SQL Console
                          </span>
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => {
                            setSqlOpen((o) => {
                              const next = !o[s.id];
                              if (next && sqlText[s.id] === undefined) {
                                const defaultSQL = s.type === "mysql"
                                  ? "SHOW TABLES;"
                                  : "SELECT * FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;";
                                try {
                                  const saved = localStorage.getItem(`sm_sql_${s.id}`);
                                  setSqlText((t) => ({ ...t, [s.id]: saved || defaultSQL }));
                                } catch {
                                  setSqlText((t) => ({ ...t, [s.id]: defaultSQL }));
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
                              className="w-full rounded-md border border-input bg-muted p-2.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                              spellCheck={false}
                            />
                            <div className="flex items-center justify-between">
                              <p className="text-[9px] text-muted-foreground">⌘/Ctrl+Enter to run · 10s timeout · 1000-row cap</p>
                              <Button size="sm" className="h-6 px-3 text-[10px] gap-1" disabled={sqlRunning[s.id] || !(sqlText[s.id] || "").trim()} onClick={() => runSQL(s)}>
                                {sqlRunning[s.id] ? <CircleNotchIcon className="h-2.5 w-2.5 animate-spin" /> : null}
                                Run
                              </Button>
                            </div>

                            {sqlError[s.id] && (
                              <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2 font-mono text-[10px] text-red-600 dark:text-red-400 whitespace-pre-wrap break-all">
                                {sqlError[s.id]}
                              </div>
                            )}

                            {sqlResult[s.id] && (
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-3 text-[9px] text-muted-foreground">
                                  <span>{sqlResult[s.id]!.rows.length} rows</span>
                                  <span>{sqlResult[s.id]!.duration_ms}ms</span>
                                  {sqlResult[s.id]!.rows_affected > 0 && <span>affected: {sqlResult[s.id]!.rows_affected}</span>}
                                  {sqlResult[s.id]!.truncated && <span className="text-amber-600 dark:text-amber-400">truncated</span>}
                                </div>
                                {sqlResult[s.id]!.columns.length > 0 && (
                                  <div className="rounded-md border border-border/30 bg-muted overflow-x-auto max-h-80">
                                    <table className="w-full text-[10px] font-mono">
                                      <thead className="sticky top-0 bg-muted border-b border-border/30">
                                        <tr>
                                          {sqlResult[s.id]!.columns.map((c, i) => (
                                            <th key={i} className="px-2 py-1.5 text-left text-zinc-500 font-medium whitespace-nowrap">
                                              {c}
                                              <span className="ml-1 text-[9px] text-muted-foreground">{sqlResult[s.id]!.types[i]}</span>
                                            </th>
                                          ))}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {sqlResult[s.id]!.rows.map((r, i) => (
                                          <tr key={i} className={i % 2 ? "bg-muted/60" : ""}>
                                            {r.map((v, j) => (
                                              <td key={j} className="px-2 py-1 text-foreground whitespace-nowrap max-w-xs truncate" title={v === null ? "NULL" : String(v)}>
                                                {v === null ? <span className="text-muted-foreground">NULL</span> : typeof v === "object" ? JSON.stringify(v) : String(v)}
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
                      </div>}

                      {/* Backups — only for project-linked DBs (existing backend endpoints) */}
                      {isProj && s.project_id && (
                        <div className="border-t border-border/30 pt-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-medium text-muted-foreground flex items-center gap-1.5">
                              <ClockIcon className="h-3 w-3" /> Backups
                            </span>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => openSchedule(s.project_id!)}>Schedule</Button>
                              <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1" onClick={() => createBackup(s.project_id!)} disabled={backingUp === s.project_id}>
                                {backingUp === s.project_id ? <CircleNotchIcon className="h-2.5 w-2.5 animate-spin" /> : <DatabaseIcon className="h-2.5 w-2.5" />}
                                Backup Now
                              </Button>
                            </div>
                          </div>

                          {showSchedule === s.project_id && (
                            <div className="rounded-md border border-border/30 bg-muted p-3 space-y-2">
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
                                <div key={b.id} className="flex items-center justify-between rounded-md bg-muted px-2.5 py-1.5 text-[10px]">
                                  <div className="flex items-center gap-2 font-mono text-muted-foreground">
                                    <DatabaseIcon className="h-3 w-3 text-muted-foreground" />
                                    <span>{new Date(b.created_at).toLocaleString()}</span>
                                    <span className="text-muted-foreground/70">{(b.file_size / 1024).toFixed(1)} KB</span>
                                  </div>
                                  <div className="flex gap-1">
                                    <Button variant="ghost" size="sm" className="h-5 px-1 text-[9px] gap-1" onClick={() => downloadBackup(s.project_id!, b)}><DownloadSimpleIcon className="h-2.5 w-2.5" /> Download</Button>
                                    <Button variant="ghost" size="sm" className="h-5 px-1 text-[9px] gap-1 text-blue-600 dark:text-blue-400" onClick={() => restoreBackup(s.project_id!, b.id)}><UploadSimpleIcon className="h-2.5 w-2.5" /> Restore</Button>
                                    <Button variant="ghost" size="sm" className="h-5 px-1 text-[9px] text-destructive" onClick={() => deleteBackup(s.project_id!, b.id)}>Delete</Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[10px] text-muted-foreground">No backups yet</p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        </>
      )}
    </div>
  );
}
