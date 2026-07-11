"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Database, Table2, ArrowLeft, Play, Loader2, ChevronLeft, ChevronRight,
  ArrowUpDown, Columns3, Trash2, Plus, Check, X,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface TableInfo { name: string; row_estimate: number; size_bytes: number; size_pretty: string; }
interface ColumnInfo { name: string; data_type: string; is_nullable: string; column_default: string; is_primary_key: boolean; }
interface BrowseResult { columns: string[]; types: string[]; rows: unknown[][]; total_rows: number; limit: number; offset: number; }
interface QueryResult { columns: string[]; rows: unknown[][]; rows_affected: number; duration_ms: number; truncated: boolean; notice?: string; types: string[]; }

function quoteIdent(s: string) { return '"' + s.replace(/"/g, '""') + '"'; }

function pgLiteral(val: string, type: string): string {
  if ((type === "int" || type === "numeric") && val !== "" && !isNaN(Number(val))) return val;
  if (type === "bool") {
    const v = val.toLowerCase();
    return (v === "true" || v === "t" || v === "1") ? "TRUE" : "FALSE";
  }
  return "'" + val.replace(/'/g, "''") + "'";
}

function dataTypeToSimple(pgType: string): string {
  if (pgType.includes("int") || pgType === "bigint" || pgType === "smallint") return "int";
  if (pgType.includes("numeric") || pgType.includes("float") || pgType.includes("double") || pgType === "real" || pgType === "decimal") return "numeric";
  if (pgType.includes("bool")) return "bool";
  return "text";
}

export default function DatabaseEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

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

  // ── Core state ─────────────────────────────────────────
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

  // ── Inline edit state ──────────────────────────────────
  const [editCell, setEditCell] = useState<{ rowIdx: number; colIdx: number } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editIsNull, setEditIsNull] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [deletingRow, setDeletingRow] = useState<number | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // ── Add row state ──────────────────────────────────────
  const [addingRow, setAddingRow] = useState(false);
  const [newRowValues, setNewRowValues] = useState<Record<string, string>>({});
  const [newRowNulls, setNewRowNulls] = useState<Record<string, boolean>>({});
  const [insertError, setInsertError] = useState("");
  const [inserting, setInserting] = useState(false);

  // ── SQL runner state ───────────────────────────────────
  const [sql, setSql] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem(`sm_sql_editor_${id}`) || "SELECT 1;";
    return "SELECT 1;";
  });
  const [sqlResult, setSqlResult] = useState<QueryResult | null>(null);
  const [sqlError, setSqlError] = useState("");
  const [sqlRunning, setSqlRunning] = useState(false);

  const pageSize = 50;

  const pkColNames = useMemo(() => columns.filter(c => c.is_primary_key).map(c => c.name), [columns]);
  const hasPK = pkColNames.length > 0;

  // ── Load tables ────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    setLoadingTables(true);
    fetch(`${basePath}/tables`, { headers: headers() })
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        setTables(Array.isArray(data) ? data : []);
        if (Array.isArray(data) && data.length > 0 && !selectedTable) setSelectedTable(data[0].name);
      })
      .catch(() => {})
      .finally(() => setLoadingTables(false));
  }, [id, basePath]);

  // ── Load columns + rows on table change ────────────────
  useEffect(() => {
    if (!selectedTable) return;
    setPage(0); setOrderBy(""); setOrderDesc(false);
    setEditCell(null); setAddingRow(false); setSaveError("");
    fetch(`${basePath}/tables/${selectedTable}/columns`, { headers: headers() })
      .then(r => r.ok ? r.json() : [])
      .then(data => setColumns(Array.isArray(data) ? data : []))
      .catch(() => setColumns([]));
    loadRows(selectedTable, 0, "", false);
  }, [selectedTable]);

  // Focus edit input when editing starts
  useEffect(() => {
    if (!editCell) return;
    const type = browseData?.types[editCell.colIdx] || "text";
    const isLong = type === "json" || (type === "text" && String(browseData?.rows[editCell.rowIdx]?.[editCell.colIdx] ?? "").length > 80);
    setTimeout(() => (isLong ? editTextareaRef.current : editInputRef.current)?.focus(), 10);
  }, [editCell]);

  function loadRows(table: string, offset: number, ob: string, desc: boolean) {
    setBrowseLoading(true);
    const p = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (ob) p.set("orderBy", ob);
    if (desc) p.set("desc", "true");
    fetch(`${basePath}/tables/${table}/rows?${p}`, { headers: headers() })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setBrowseData(data); })
      .catch(() => {})
      .finally(() => setBrowseLoading(false));
  }

  function handleSort(col: string) {
    if (editCell) return;
    const desc = orderBy === col ? !orderDesc : false;
    setOrderBy(col); setOrderDesc(desc);
    if (selectedTable) loadRows(selectedTable, page * pageSize, col, desc);
  }

  function handlePage(dir: number) {
    if (editCell) cancelEdit();
    const next = page + dir;
    if (next < 0) return;
    setPage(next);
    if (selectedTable) loadRows(selectedTable, next * pageSize, orderBy, orderDesc);
  }

  // ── Cell editing ───────────────────────────────────────
  function startEdit(rowIdx: number, colIdx: number, currentValue: unknown) {
    if (!hasPK) return;
    setEditCell({ rowIdx, colIdx });
    setEditIsNull(currentValue === null);
    setEditValue(
      currentValue === null ? ""
      : typeof currentValue === "object" ? JSON.stringify(currentValue, null, 2)
      : String(currentValue)
    );
    setSaveError("");
  }

  function cancelEdit() { setEditCell(null); setSaveError(""); }

  async function saveEdit() {
    if (!editCell || !selectedTable || !browseData) return;
    const { rowIdx, colIdx } = editCell;
    const colName = browseData.columns[colIdx];
    const colType = browseData.types[colIdx];
    const row = browseData.rows[rowIdx];

    if (colType === "json" && !editIsNull) {
      try { JSON.parse(editValue); } catch { setSaveError("Invalid JSON value"); return; }
    }

    const whereParts: string[] = [];
    for (const pk of pkColNames) {
      const pkIdx = browseData.columns.indexOf(pk);
      if (pkIdx < 0 || row[pkIdx] === null) { setSaveError("Cannot update: primary key is NULL"); return; }
      whereParts.push(`${quoteIdent(pk)} = ${pgLiteral(String(row[pkIdx]), browseData.types[pkIdx])}`);
    }

    const setVal = editIsNull ? "NULL" : pgLiteral(editValue, colType);
    const updateSQL = `UPDATE ${quoteIdent(selectedTable)} SET ${quoteIdent(colName)} = ${setVal} WHERE ${whereParts.join(" AND ")}`;

    setSaving(true); setSaveError("");
    try {
      const res = await fetch(`${basePath}/query`, { method: "POST", headers: headers(), body: JSON.stringify({ sql: updateSQL }) });
      const data = await res.json();
      if (!res.ok) { setSaveError(data.error || "update failed"); }
      else { setEditCell(null); loadRows(selectedTable, page * pageSize, orderBy, orderDesc); }
    } catch (e) { setSaveError((e as Error).message); }
    setSaving(false);
  }

  // ── Delete row ─────────────────────────────────────────
  async function deleteRow(rowIdx: number) {
    if (!selectedTable || !browseData || !hasPK) return;
    const row = browseData.rows[rowIdx];
    const whereParts: string[] = [];
    for (const pk of pkColNames) {
      const pkIdx = browseData.columns.indexOf(pk);
      if (pkIdx < 0 || row[pkIdx] === null) return;
      whereParts.push(`${quoteIdent(pk)} = ${pgLiteral(String(row[pkIdx]), browseData.types[pkIdx])}`);
    }
    if (!window.confirm(`Delete this row from "${selectedTable}"?`)) return;
    setDeletingRow(rowIdx);
    try {
      await fetch(`${basePath}/query`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ sql: `DELETE FROM ${quoteIdent(selectedTable)} WHERE ${whereParts.join(" AND ")}` }),
      });
      loadRows(selectedTable, page * pageSize, orderBy, orderDesc);
    } catch {}
    setDeletingRow(null);
  }

  // ── Insert row ─────────────────────────────────────────
  function openAddRow() {
    const vals: Record<string, string> = {};
    const nulls: Record<string, boolean> = {};
    for (const col of columns) {
      vals[col.name] = "";
      nulls[col.name] = col.is_nullable === "YES" && !col.is_primary_key && !col.column_default;
    }
    setNewRowValues(vals); setNewRowNulls(nulls);
    setInsertError(""); setAddingRow(true);
  }

  async function saveNewRow() {
    if (!selectedTable) return;
    const colParts: string[] = [];
    const valParts: string[] = [];
    for (const col of columns) {
      const val = newRowValues[col.name] || "";
      const isNull = newRowNulls[col.name];
      // Skip columns with defaults if left empty (DB fills them in)
      if (val === "" && col.column_default && !isNull) continue;
      colParts.push(quoteIdent(col.name));
      valParts.push(isNull ? "NULL" : pgLiteral(val, dataTypeToSimple(col.data_type)));
    }
    const insertSQL = colParts.length === 0
      ? `INSERT INTO ${quoteIdent(selectedTable)} DEFAULT VALUES`
      : `INSERT INTO ${quoteIdent(selectedTable)} (${colParts.join(", ")}) VALUES (${valParts.join(", ")})`;

    setInserting(true); setInsertError("");
    try {
      const res = await fetch(`${basePath}/query`, { method: "POST", headers: headers(), body: JSON.stringify({ sql: insertSQL }) });
      const data = await res.json();
      if (!res.ok) { setInsertError(data.error || "insert failed"); }
      else { setAddingRow(false); loadRows(selectedTable, page * pageSize, orderBy, orderDesc); }
    } catch (e) { setInsertError((e as Error).message); }
    setInserting(false);
  }

  // ── SQL runner ─────────────────────────────────────────
  async function runSQL() {
    const q = sql.trim();
    if (!q) return;
    try { localStorage.setItem(`sm_sql_editor_${id}`, q); } catch {}
    setSqlRunning(true); setSqlError("");
    try {
      const res = await fetch(`${basePath}/query`, { method: "POST", headers: headers(), body: JSON.stringify({ sql: q }) });
      const data = await res.json();
      if (!res.ok) { setSqlError(data.error || "query failed"); setSqlResult(null); }
      else setSqlResult(data);
    } catch (e) { setSqlError((e as Error).message); }
    setSqlRunning(false);
  }

  // ── Edit input ─────────────────────────────────────────
  function renderEditInput(colIdx: number) {
    const type = browseData?.types[colIdx] || "text";
    const currentRaw = browseData?.rows[editCell!.rowIdx]?.[colIdx];
    const isLong = type === "json" || (type === "text" && String(currentRaw ?? "").length > 80);
    const sharedClass = `bg-zinc-900 border border-blue-500 rounded px-1.5 text-[11px] font-mono text-zinc-200 focus:outline-none disabled:opacity-40 w-full min-w-[140px]`;
    if (isLong) {
      return (
        <textarea
          ref={editTextareaRef}
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onKeyDown={e => { if (e.key === "Escape") cancelEdit(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEdit(); } }}
          disabled={editIsNull}
          rows={3}
          className={`${sharedClass} py-1 resize-none`}
        />
      );
    }
    return (
      <input
        ref={editInputRef}
        type="text"
        value={editValue}
        onChange={e => setEditValue(e.target.value)}
        onKeyDown={e => { if (e.key === "Escape") cancelEdit(); if (e.key === "Enter") { e.preventDefault(); saveEdit(); } }}
        disabled={editIsNull}
        className={`${sharedClass} py-0.5`}
      />
    );
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
        {selectedTable && !hasPK && (
          <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500/30">no primary key · read only</Badge>
        )}
        <div className="ml-auto flex gap-1">
          {(["browse", "columns", "sql"] as const).map(t => (
            <Button key={t} variant={activeTab === t ? "default" : "ghost"} size="sm" className="h-7 px-3 text-[11px] capitalize" onClick={() => setActiveTab(t)}>
              {t === "browse" ? <Table2 className="h-3 w-3 mr-1" /> : t === "columns" ? <Columns3 className="h-3 w-3 mr-1" /> : <Play className="h-3 w-3 mr-1" />}
              {t}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-52 shrink-0 border-r border-border/40 overflow-y-auto bg-card/30">
          <div className="px-3 py-2 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Tables ({tables.length})</div>
          {loadingTables ? (
            <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : tables.length === 0 ? (
            <p className="px-3 text-[11px] text-muted-foreground">No tables found</p>
          ) : tables.map(t => (
            <button key={t.name} onClick={() => setSelectedTable(t.name)}
              className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-accent/40 transition-colors flex items-center justify-between gap-2 ${selectedTable === t.name ? "bg-accent/60 text-foreground font-medium" : "text-muted-foreground"}`}>
              <span className="truncate">{t.name}</span>
              <span className="text-[9px] text-[#8b949e] shrink-0">{t.size_pretty}</span>
            </button>
          ))}
        </div>

        {/* Main pane */}
        <div className="flex-1 overflow-hidden flex flex-col">

          {/* ── Browse tab ── */}
          {activeTab === "browse" && (
            <>
              {/* Toolbar */}
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/30 text-[10px] text-muted-foreground shrink-0">
                <span>
                  {browseData
                    ? `${browseData.total_rows.toLocaleString()} rows · showing ${browseData.offset + 1}–${Math.min(browseData.offset + browseData.rows.length, browseData.total_rows)}`
                    : "—"}
                  {hasPK && <span className="ml-2 text-[#8b949e]">· double-click cell to edit</span>}
                </span>
                <div className="flex items-center gap-1.5">
                  {hasPK && !addingRow && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1 text-emerald-400 hover:text-emerald-300" onClick={openAddRow}>
                      <Plus className="h-3 w-3" />Add Row
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-6 px-1.5" disabled={page === 0} onClick={() => handlePage(-1)}><ChevronLeft className="h-3 w-3" /></Button>
                  <span>Page {page + 1}</span>
                  <Button variant="ghost" size="sm" className="h-6 px-1.5"
                    disabled={!browseData || browseData.offset + browseData.rows.length >= browseData.total_rows}
                    onClick={() => handlePage(1)}><ChevronRight className="h-3 w-3" /></Button>
                </div>
              </div>

              {/* Save error */}
              {saveError && (
                <div className="mx-3 mt-1.5 rounded border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[10px] text-red-400 font-mono flex items-center gap-2 shrink-0">
                  <span className="flex-1">{saveError}</span>
                  <button onClick={() => setSaveError("")}><X className="h-3 w-3" /></button>
                </div>
              )}

              {/* Add Row form */}
              {addingRow && (
                <div className="border-b border-border/30 bg-card/50 px-4 py-3 shrink-0">
                  <p className="text-[10px] font-medium text-muted-foreground mb-2.5 uppercase tracking-wider">New Row</p>
                  <div className="grid gap-x-3 gap-y-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
                    {columns.map(col => (
                      <div key={col.name} className="flex flex-col gap-0.5">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[9px] font-mono text-zinc-500 truncate">
                            {col.name}{col.is_primary_key && <span className="ml-0.5 text-amber-500">·PK</span>}
                          </span>
                          {col.is_nullable === "YES" && (
                            <button onClick={() => setNewRowNulls(p => ({ ...p, [col.name]: !p[col.name] }))}
                              className={`text-[9px] px-1 py-0.5 rounded border leading-none ${newRowNulls[col.name] ? "border-blue-500 text-blue-400" : "border-[#30363d] text-[#8b949e]"}`}>
                              NULL
                            </button>
                          )}
                        </div>
                        <input type="text"
                          value={newRowValues[col.name] || ""}
                          onChange={e => setNewRowValues(p => ({ ...p, [col.name]: e.target.value }))}
                          disabled={newRowNulls[col.name]}
                          placeholder={col.column_default ? `default` : ""}
                          className="w-full bg-zinc-900 border border-border/40 rounded px-1.5 py-0.5 text-[11px] font-mono text-zinc-200 focus:outline-none focus:border-blue-500 disabled:opacity-30 placeholder:text-[#8b949e]"
                        />
                      </div>
                    ))}
                  </div>
                  {insertError && <p className="mt-2 text-[10px] text-red-400 font-mono">{insertError}</p>}
                  <div className="flex gap-1.5 mt-3">
                    <Button size="sm" className="h-6 px-3 text-[10px] gap-1" disabled={inserting} onClick={saveNewRow}>
                      {inserting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Insert
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => { setAddingRow(false); setInsertError(""); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* Data table */}
              <div className="flex-1 overflow-auto">
                {browseLoading ? (
                  <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : browseData && browseData.columns.length > 0 ? (
                  <table className="w-full text-[11px] font-mono">
                    <thead className="sticky top-0 bg-background border-b border-border/30 z-10">
                      <tr>
                        <th className="px-2 py-1.5 text-left text-[9px] text-[#8b949e] w-8">#</th>
                        {browseData.columns.map((c, i) => (
                          <th key={c} onClick={() => handleSort(c)}
                            className="px-2 py-1.5 text-left text-zinc-500 font-medium whitespace-nowrap cursor-pointer hover:text-foreground select-none">
                            {c}
                            <span className="ml-0.5 text-[9px] text-[#8b949e]">{browseData.types[i]}</span>
                            {orderBy === c && <ArrowUpDown className="inline h-2.5 w-2.5 ml-0.5 text-zinc-400" />}
                          </th>
                        ))}
                        {hasPK && <th className="w-8 px-1" />}
                      </tr>
                    </thead>
                    <tbody>
                      {browseData.rows.map((r, rowIdx) => (
                        <tr key={rowIdx}
                          className={`${rowIdx % 2 ? "bg-white/[0.02]" : ""} hover:bg-accent/20 group`}
                          onMouseEnter={() => setHoveredRow(rowIdx)}
                          onMouseLeave={() => setHoveredRow(null)}>
                          <td className="px-2 py-1 text-[#8b949e] text-[9px]">{browseData.offset + rowIdx + 1}</td>

                          {r.map((v, colIdx) => {
                            const isEditing = editCell?.rowIdx === rowIdx && editCell?.colIdx === colIdx;
                            return (
                              <td key={colIdx}
                                onDoubleClick={() => !isEditing && startEdit(rowIdx, colIdx, v)}
                                className={`px-2 py-1 text-zinc-300 whitespace-nowrap ${isEditing ? "p-0 align-top" : "max-w-[250px] truncate"} ${!isEditing && hasPK ? "cursor-pointer hover:bg-blue-500/5" : ""}`}
                                title={!isEditing && v !== null ? String(v) : undefined}>
                                {isEditing ? (
                                  <div className="p-1.5 min-w-[160px]">
                                    {renderEditInput(colIdx)}
                                    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                                      <button onClick={() => setEditIsNull(n => !n)}
                                        className={`text-[9px] px-1.5 py-0.5 rounded border leading-none ${editIsNull ? "border-blue-500 text-blue-400" : "border-[#30363d] text-[#8b949e]"}`}>
                                        NULL
                                      </button>
                                      <Button size="sm" className="h-5 px-2 text-[9px] gap-0.5" disabled={saving} onClick={saveEdit}>
                                        {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Check className="h-2.5 w-2.5" />}
                                        Save
                                      </Button>
                                      <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[9px]" onClick={cancelEdit}>
                                        <X className="h-2.5 w-2.5" />
                                      </Button>
                                    </div>
                                  </div>
                                ) : v === null ? (
                                  <span className="text-[#8b949e] italic">NULL</span>
                                ) : typeof v === "object" ? (
                                  JSON.stringify(v)
                                ) : (
                                  String(v)
                                )}
                              </td>
                            );
                          })}

                          {/* Delete button */}
                          {hasPK && (
                            <td className="px-1 py-1 w-8">
                              {hoveredRow === rowIdx && editCell?.rowIdx !== rowIdx && (
                                <button onClick={() => deleteRow(rowIdx)} disabled={deletingRow === rowIdx}
                                  className="p-0.5 rounded hover:bg-red-500/20 text-[#8b949e] hover:text-red-400 transition-colors">
                                  {deletingRow === rowIdx
                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                    : <Trash2 className="h-3 w-3" />}
                                </button>
                              )}
                            </td>
                          )}
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

          {/* ── Columns tab ── */}
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
                    {columns.map(c => (
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

          {/* ── SQL tab ── */}
          {activeTab === "sql" && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-3 shrink-0 space-y-2">
                <textarea
                  value={sql}
                  onChange={e => setSql(e.target.value)}
                  onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); runSQL(); } }}
                  rows={6}
                  placeholder="SELECT * FROM your_table LIMIT 10;"
                  className="w-full rounded-md border border-input bg-[#0d1117] p-2.5 font-mono text-[12px] text-zinc-300 placeholder:text-[#8b949e] focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                  spellCheck={false}
                />
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-[#8b949e]">⌘/Ctrl+Enter to run · 10s timeout · 1000-row cap</p>
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
                    <div className="rounded-md border border-border/30 bg-[#0d1117] overflow-x-auto max-h-[400px]">
                      <table className="w-full text-[10px] font-mono">
                        <thead className="sticky top-0 bg-[#0d1117] border-b border-border/30">
                          <tr>
                            {sqlResult.columns.map((c, i) => (
                              <th key={i} className="px-2 py-1.5 text-left text-zinc-500 font-medium whitespace-nowrap">
                                {c} <span className="text-[9px] text-[#8b949e]">{sqlResult.types[i]}</span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sqlResult.rows.map((r, i) => (
                            <tr key={i} className={i % 2 ? "bg-white/[0.02]" : ""}>
                              {r.map((v, j) => (
                                <td key={j} className="px-2 py-1 text-zinc-300 whitespace-nowrap max-w-[250px] truncate" title={v === null ? "NULL" : String(v)}>
                                  {v === null ? <span className="text-[#8b949e] italic">NULL</span> : typeof v === "object" ? JSON.stringify(v) : String(v)}
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
