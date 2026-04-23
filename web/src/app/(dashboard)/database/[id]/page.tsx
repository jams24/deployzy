"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Database, Table2, ArrowLeft, Play, Loader2, ChevronLeft, ChevronRight,
  ArrowUpDown, Columns3,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface TableInfo { name: string; row_estimate: number; size_bytes: number; size_pretty: string; }
interface ColumnInfo { name: string; data_type: string; is_nullable: string; column_default: string; is_primary_key: boolean; }
interface BrowseResult { columns: string[]; types: string[]; rows: unknown[][]; total_rows: number; limit: number; offset: number; }
interface QueryResult { columns: string[]; rows: unknown[][]; rows_affected: number; duration_ms: number; truncated: boolean; notice?: string; types: string[]; }

export default function DatabaseEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  // Detect: is this a service ID or a project ID? The services page passes
  // ?type=service or ?type=project so we know which API path to use.
  const [dbType, setDbType] = useState<"service" | "project">("service");
  const [projectId, setProjectId] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("type");
    if (t === "project") {
      setDbType("project");
      setProjectId(params.get("projectId") || id);
    }
  }, [id]);

  const headers = useCallback(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("sm_token") : null;
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }, []);

  const basePath = dbType === "project"
    ? `${API}/api/v1/projects/${projectId}/database`
    : `${API}/api/v1/services/${id}`;

  // ── State ──────────────────────────────────────────────
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loadingTables, setLoadingTables] = useState(true);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [browseData, setBrowseData] = useState<BrowseResult | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [orderBy, setOrderBy] = useState("");
  const [orderDesc, setOrderDesc] = useState(false);
  const [activeTab, setActiveTab] = useState<"browse" | "sql" | "columns">("browse");

  // SQL runner state
  const [sql, setSql] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(`sm_sql_editor_${id}`) || "SELECT 1;";
    }
    return "SELECT 1;";
  });
  const [sqlResult, setSqlResult] = useState<QueryResult | null>(null);
  const [sqlError, setSqlError] = useState("");
  const [sqlRunning, setSqlRunning] = useState(false);

  const pageSize = 50;

  // ── Load tables ────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    setLoadingTables(true);
    fetch(`${basePath}/tables`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        setTables(Array.isArray(data) ? data : []);
        if (Array.isArray(data) && data.length > 0 && !selectedTable) {
          setSelectedTable(data[0].name);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingTables(false));
  }, [id, basePath]);

  // ── Load columns + rows when table changes ─────────────
  useEffect(() => {
    if (!selectedTable) return;
    setPage(0);
    setOrderBy("");
    setOrderDesc(false);
    // Columns
    fetch(`${basePath}/tables/${selectedTable}/columns`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setColumns(Array.isArray(data) ? data : []))
      .catch(() => setColumns([]));
    // First page of rows
    loadRows(selectedTable, 0, "", false);
  }, [selectedTable]);

  function loadRows(table: string, offset: number, ob: string, desc: boolean) {
    setBrowseLoading(true);
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (ob) { params.set("orderBy", ob); }
    if (desc) params.set("desc", "true");
    fetch(`${basePath}/tables/${table}/rows?${params}`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setBrowseData(data); })
      .catch(() => {})
      .finally(() => setBrowseLoading(false));
  }

  function handleSort(col: string) {
    const desc = orderBy === col ? !orderDesc : false;
    setOrderBy(col);
    setOrderDesc(desc);
    if (selectedTable) loadRows(selectedTable, page * pageSize, col, desc);
  }

  function handlePage(dir: number) {
    const next = page + dir;
    if (next < 0) return;
    setPage(next);
    if (selectedTable) loadRows(selectedTable, next * pageSize, orderBy, orderDesc);
  }

  async function runSQL() {
    const q = sql.trim();
    if (!q) return;
    try { localStorage.setItem(`sm_sql_editor_${id}`, q); } catch {}
    setSqlRunning(true);
    setSqlError("");
    try {
      const res = await fetch(`${basePath}/query`, {
        method: "POST", headers: headers(), body: JSON.stringify({ sql: q }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSqlError(data.error || "query failed");
        setSqlResult(null);
      } else {
        setSqlResult(data);
      }
    } catch (e) {
      setSqlError((e as Error).message);
    }
    setSqlRunning(false);
  }

  // ── Render ─────────────────────────────────────────────
  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border/40 px-4 py-2.5 shrink-0">
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => router.push("/services")}>
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <Database className="h-4 w-4 text-emerald-400" />
        <span className="text-sm font-medium">Database Editor</span>
        {selectedTable && <Badge variant="outline" className="text-[10px]">{selectedTable}</Badge>}
        <div className="ml-auto flex gap-1">
          {(["browse", "columns", "sql"] as const).map((t) => (
            <Button key={t} variant={activeTab === t ? "default" : "ghost"} size="sm" className="h-7 px-3 text-[11px] capitalize" onClick={() => setActiveTab(t)}>
              {t === "browse" ? <Table2 className="h-3 w-3 mr-1" /> : t === "columns" ? <Columns3 className="h-3 w-3 mr-1" /> : <Play className="h-3 w-3 mr-1" />}
              {t}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — table list */}
        <div className="w-52 shrink-0 border-r border-border/40 overflow-y-auto bg-card/30">
          <div className="px-3 py-2 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Tables ({tables.length})</div>
          {loadingTables ? (
            <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : tables.length === 0 ? (
            <p className="px-3 text-[11px] text-muted-foreground">No tables found</p>
          ) : (
            tables.map((t) => (
              <button
                key={t.name}
                onClick={() => setSelectedTable(t.name)}
                className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-accent/40 transition-colors flex items-center justify-between gap-2 ${selectedTable === t.name ? "bg-accent/60 text-foreground font-medium" : "text-muted-foreground"}`}
              >
                <span className="truncate">{t.name}</span>
                <span className="text-[9px] text-zinc-600 shrink-0">{t.size_pretty}</span>
              </button>
            ))
          )}
        </div>

        {/* Main pane */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {activeTab === "browse" && (
            <>
              {/* Toolbar */}
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/30 text-[10px] text-muted-foreground shrink-0">
                <span>
                  {browseData ? `${browseData.total_rows.toLocaleString()} rows · showing ${browseData.offset + 1}–${Math.min(browseData.offset + browseData.rows.length, browseData.total_rows)}` : "—"}
                </span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-6 px-1.5" disabled={page === 0} onClick={() => handlePage(-1)}><ChevronLeft className="h-3 w-3" /></Button>
                  <span>Page {page + 1}</span>
                  <Button variant="ghost" size="sm" className="h-6 px-1.5" disabled={!browseData || browseData.offset + browseData.rows.length >= browseData.total_rows} onClick={() => handlePage(1)}><ChevronRight className="h-3 w-3" /></Button>
                </div>
              </div>

              {/* Data table */}
              <div className="flex-1 overflow-auto">
                {browseLoading ? (
                  <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : browseData && browseData.columns.length > 0 ? (
                  <table className="w-full text-[11px] font-mono">
                    <thead className="sticky top-0 bg-background border-b border-border/30 z-10">
                      <tr>
                        <th className="px-2 py-1.5 text-left text-[9px] text-zinc-600 w-8">#</th>
                        {browseData.columns.map((c, i) => (
                          <th key={c} className="px-2 py-1.5 text-left text-zinc-500 font-medium whitespace-nowrap cursor-pointer hover:text-foreground select-none" onClick={() => handleSort(c)}>
                            {c}
                            <span className="ml-0.5 text-[9px] text-zinc-700">{browseData.types[i]}</span>
                            {orderBy === c && <ArrowUpDown className="inline h-2.5 w-2.5 ml-0.5 text-zinc-400" />}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {browseData.rows.map((r, i) => (
                        <tr key={i} className={`${i % 2 ? "bg-white/[0.02]" : ""} hover:bg-accent/20`}>
                          <td className="px-2 py-1 text-zinc-600 text-[9px]">{browseData.offset + i + 1}</td>
                          {r.map((v, j) => (
                            <td key={j} className="px-2 py-1 text-zinc-300 whitespace-nowrap max-w-[250px] truncate" title={v === null ? "NULL" : String(v)}>
                              {v === null ? <span className="text-zinc-600 italic">NULL</span> : typeof v === "object" ? JSON.stringify(v) : String(v)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Table2 className="h-8 w-8 opacity-30 mb-2" />
                    <p className="text-sm">{selectedTable ? "No rows" : "Select a table"}</p>
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === "columns" && (
            <div className="flex-1 overflow-auto p-4">
              {columns.length === 0 ? (
                <p className="text-sm text-muted-foreground">Select a table to view columns</p>
              ) : (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-border/30">
                      <th className="px-3 py-2 text-left text-[10px] text-muted-foreground font-medium">Column</th>
                      <th className="px-3 py-2 text-left text-[10px] text-muted-foreground font-medium">Type</th>
                      <th className="px-3 py-2 text-left text-[10px] text-muted-foreground font-medium">Nullable</th>
                      <th className="px-3 py-2 text-left text-[10px] text-muted-foreground font-medium">Default</th>
                      <th className="px-3 py-2 text-left text-[10px] text-muted-foreground font-medium">PK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {columns.map((c) => (
                      <tr key={c.name} className="border-b border-border/20 hover:bg-accent/10">
                        <td className="px-3 py-1.5 font-mono font-medium">{c.name}</td>
                        <td className="px-3 py-1.5 font-mono text-blue-400">{c.data_type}</td>
                        <td className="px-3 py-1.5">{c.is_nullable === "YES" ? <span className="text-zinc-500">yes</span> : <span className="text-emerald-500">no</span>}</td>
                        <td className="px-3 py-1.5 font-mono text-zinc-500 max-w-[200px] truncate">{c.column_default || "—"}</td>
                        <td className="px-3 py-1.5">{c.is_primary_key ? <Badge variant="outline" className="text-[9px] text-amber-500 border-amber-500/30">PK</Badge> : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {activeTab === "sql" && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-3 shrink-0 space-y-2">
                <textarea
                  value={sql}
                  onChange={(e) => setSql(e.target.value)}
                  onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); runSQL(); } }}
                  rows={6}
                  placeholder="SELECT * FROM your_table LIMIT 10;"
                  className="w-full rounded-md border border-input bg-[#09090b] p-2.5 font-mono text-[12px] text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                  spellCheck={false}
                />
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-zinc-600">⌘/Ctrl+Enter to run · 10s timeout · 1000-row cap</p>
                  <Button size="sm" className="h-7 px-4 text-[11px] gap-1.5" disabled={sqlRunning || !sql.trim()} onClick={runSQL}>
                    {sqlRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    Run query
                  </Button>
                </div>
              </div>

              {sqlError && (
                <div className="mx-3 mb-2 rounded-md border border-red-500/30 bg-red-500/10 p-2.5 font-mono text-[10px] text-red-400 whitespace-pre-wrap break-all shrink-0">
                  {sqlError}
                </div>
              )}

              <div className="flex-1 overflow-auto">
                {sqlResult && sqlResult.columns.length > 0 && (
                  <div className="px-3 pb-3">
                    <div className="flex items-center gap-3 mb-1.5 text-[10px] text-muted-foreground">
                      <span>{sqlResult.rows.length} rows</span>
                      <span>{sqlResult.duration_ms}ms</span>
                      {sqlResult.rows_affected > 0 && <span>affected: {sqlResult.rows_affected}</span>}
                      {sqlResult.truncated && <span className="text-amber-500">truncated to 1000</span>}
                    </div>
                    <div className="rounded-md border border-border/30 bg-[#09090b] overflow-x-auto max-h-[400px]">
                      <table className="w-full text-[10px] font-mono">
                        <thead className="sticky top-0 bg-[#09090b] border-b border-border/30">
                          <tr>
                            {sqlResult.columns.map((c, i) => (
                              <th key={i} className="px-2 py-1.5 text-left text-zinc-500 font-medium whitespace-nowrap">
                                {c} <span className="text-[9px] text-zinc-700">{sqlResult.types[i]}</span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sqlResult.rows.map((r, i) => (
                            <tr key={i} className={i % 2 ? "bg-white/[0.02]" : ""}>
                              {r.map((v, j) => (
                                <td key={j} className="px-2 py-1 text-zinc-300 whitespace-nowrap max-w-[250px] truncate" title={v === null ? "NULL" : String(v)}>
                                  {v === null ? <span className="text-zinc-600 italic">NULL</span> : typeof v === "object" ? JSON.stringify(v) : String(v)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {sqlResult && sqlResult.columns.length === 0 && sqlResult.rows_affected >= 0 && (
                  <div className="px-3 text-[11px] text-emerald-400">
                    Query OK · {sqlResult.rows_affected} row(s) affected · {sqlResult.duration_ms}ms
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
