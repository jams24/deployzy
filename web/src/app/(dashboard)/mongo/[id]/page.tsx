"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, RefreshCw, Loader2, Trash2, Plus, Search,
  Terminal, Database, Check, X, ChevronDown, ChevronRight,
  Layers,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface Collection {
  name: string;
  count: number;
}

interface DocPage {
  documents: unknown[];
  total: number;
  skip: number;
  limit: number;
}

interface ShellResult {
  result?: unknown;
  error?: string;
  duration_ms: number;
}

/** Extract a stable string ID from a doc's _id (handles {$oid:"..."} and plain values). */
function docIdStr(doc: unknown): string {
  const d = doc as Record<string, unknown>;
  const id = d["_id"];
  if (id && typeof id === "object") {
    const oid = (id as Record<string, unknown>)["$oid"];
    if (oid) return String(oid);
  }
  return JSON.stringify(id ?? "");
}

/** Build the filter object for a doc's _id. */
function docIdFilter(doc: unknown): unknown {
  const d = doc as Record<string, unknown>;
  return { _id: d["_id"] };
}

/** Pretty-print a JSON value with simple colour coding. */
function JsonViewer({ value, indent = 0 }: { value: unknown; indent?: number }) {
  if (value === null) return <span className="text-zinc-500">null</span>;
  if (value === undefined) return <span className="text-[#8b949e]">undefined</span>;
  if (typeof value === "boolean") return <span className="text-blue-400">{String(value)}</span>;
  if (typeof value === "number") return <span className="text-blue-400">{value}</span>;
  if (typeof value === "string") return <span className="text-emerald-400">"{value}"</span>;

  if (typeof value === "object") {
    // ObjectID shorthand
    const obj = value as Record<string, unknown>;
    if (obj["$oid"] && Object.keys(obj).length === 1) {
      return (
        <span className="inline-flex items-center gap-1">
          <Badge variant="outline" className="text-[9px] font-mono px-1 py-0 h-4 bg-purple-500/10 text-purple-400 border-purple-500/20">ObjectId</Badge>
          <span className="text-purple-300 font-mono text-[11px]">{String(obj["$oid"])}</span>
        </span>
      );
    }
    if (obj["$date"] && Object.keys(obj).length === 1) {
      return <span className="text-amber-400 font-mono text-[11px]">{String((obj["$date"] as Record<string, unknown>)["$numberLong"] ? new Date(parseInt(String((obj["$date"] as Record<string, unknown>)["$numberLong"]))).toISOString() : obj["$date"])}</span>;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) return <span className="text-zinc-500">[]</span>;
      return (
        <span>
          {"["}
          <div style={{ paddingLeft: (indent + 1) * 12 }}>
            {value.map((item, i) => (
              <div key={i} className="leading-5">
                <JsonViewer value={item} indent={indent + 1} />
                {i < value.length - 1 && <span className="text-[#8b949e]">,</span>}
              </div>
            ))}
          </div>
          <span style={{ paddingLeft: indent * 12 }}>{"]"}</span>
        </span>
      );
    }

    const entries = Object.entries(obj);
    if (entries.length === 0) return <span className="text-zinc-500">{"{}"}</span>;
    return (
      <span>
        {"{"}
        <div style={{ paddingLeft: (indent + 1) * 12 }}>
          {entries.map(([k, v], i) => (
            <div key={k} className="leading-5">
              <span className="text-orange-300">"{k}"</span>
              <span className="text-zinc-500">: </span>
              <JsonViewer value={v} indent={indent + 1} />
              {i < entries.length - 1 && <span className="text-[#8b949e]">,</span>}
            </div>
          ))}
        </div>
        <span style={{ paddingLeft: indent * 12 }}>{"}"}</span>
      </span>
    );
  }

  return <span className="text-zinc-400">{String(value)}</span>;
}

function CollapsibleDoc({
  doc,
  onDelete,
  onSave,
}: {
  doc: unknown;
  onDelete: (doc: unknown) => void;
  onSave: (doc: unknown, newJson: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const id = docIdStr(doc);
  const docObj = doc as Record<string, unknown>;

  // Preview: first 3 non-_id fields
  const previewEntries = Object.entries(docObj)
    .filter(([k]) => k !== "_id")
    .slice(0, 3);

  function startEdit() {
    setEditText(JSON.stringify(doc, null, 2));
    setEditError("");
    setEditing(true);
  }

  async function handleSave() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(editText);
    } catch {
      setEditError("Invalid JSON");
      return;
    }
    setSaving(true);
    setEditError("");
    try {
      await onSave(doc, editText);
      setEditing(false);
    } catch (e) {
      setEditError(String(e));
    }
    setSaving(false);
  }

  return (
    <div className="border-b border-border/20">
      {/* Row */}
      <div
        className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${expanded ? "bg-white/[0.04]" : "hover:bg-white/[0.015]"}`}
        onClick={() => { setExpanded(!expanded); setEditing(false); }}
      >
        {expanded
          ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
          : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}

        {/* _id */}
        <div className="flex items-center gap-1.5 min-w-0 w-52 shrink-0">
          <Badge variant="outline" className="text-[9px] font-mono px-1 h-4 bg-purple-500/10 text-purple-400 border-purple-500/20 shrink-0">_id</Badge>
          <span className="font-mono text-[11px] text-purple-300 truncate">{id}</span>
        </div>

        {/* Field preview */}
        <div className="flex-1 min-w-0 flex items-center gap-3 overflow-hidden">
          {previewEntries.map(([k, v]) => (
            <span key={k} className="flex items-center gap-1 shrink-0 text-[11px] font-mono">
              <span className="text-orange-300">{k}:</span>
              <span className="text-zinc-400 max-w-[100px] truncate">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
            </span>
          ))}
          {Object.keys(docObj).length - 1 > previewEntries.length && (
            <span className="text-[#8b949e] text-[10px]">+{Object.keys(docObj).length - 1 - previewEntries.length} more</span>
          )}
        </div>

        <button
          className="shrink-0 p-0.5 rounded hover:bg-red-500/20 text-[#8b949e] hover:text-red-400 transition-colors"
          onClick={(e) => { e.stopPropagation(); onDelete(doc); }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Expanded */}
      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-border/20 bg-white/[0.01]">
          {editing ? (
            <div className="space-y-2">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={12}
                className="w-full rounded-md border border-blue-500/40 bg-[#0d1117] p-3 font-mono text-[11px] text-zinc-200 focus:outline-none resize-y"
                spellCheck={false}
              />
              {editError && <p className="text-[10px] text-red-400 font-mono">{editError}</p>}
              <div className="flex gap-1.5">
                <Button size="sm" className="h-7 px-3 text-[11px] gap-1" disabled={saving} onClick={handleSave}>
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setEditing(false)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="rounded-md border border-border/30 bg-[#0d1117] p-3 font-mono text-[11px] overflow-x-auto max-h-96 overflow-y-auto leading-5">
                <JsonViewer value={doc} />
              </div>
              <div className="flex justify-between items-center">
                <button className="text-[10px] text-blue-400 hover:text-blue-300" onClick={startEdit}>
                  Edit document
                </button>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-destructive hover:text-destructive gap-1" onClick={() => onDelete(doc)}>
                  <Trash2 className="h-3 w-3" /> Delete
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MongoEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const headers = useCallback(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("sm_token") : null;
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }, []);

  const base = `${API}/api/v1/services/${id}/mongo`;

  const [activeTab, setActiveTab] = useState<"browse" | "shell">("browse");

  // Collections sidebar
  const [collections, setCollections] = useState<Collection[]>([]);
  const [colLoading, setColLoading] = useState(false);
  const [selectedCol, setSelectedCol] = useState<string | null>(null);

  // Document browser
  const [filter, setFilter] = useState("{}");
  const [filterInput, setFilterInput] = useState("{}");
  const [page, setPage] = useState<DocPage | null>(null);
  const [docsLoading, setDocsLoading] = useState(false);
  const [skip, setSkip] = useState(0);
  const LIMIT = 50;

  // Insert document
  const [inserting, setInserting] = useState(false);
  const [insertJson, setInsertJson] = useState("{\n  \n}");
  const [insertError, setInsertError] = useState("");
  const [insertSaving, setInsertSaving] = useState(false);

  // Shell
  const [shellInput, setShellInput] = useState(`{"find": "collection_name", "filter": {}, "limit": 10}`);
  const [shellHistory, setShellHistory] = useState<Array<{ cmd: string; result: ShellResult }>>([]);
  const [shellRunning, setShellRunning] = useState(false);
  const shellEndRef = useRef<HTMLDivElement | null>(null);

  async function loadCollections() {
    setColLoading(true);
    try {
      const res = await fetch(`${base}/collections`, { headers: headers() });
      if (res.ok) {
        const data: Collection[] = await res.json();
        setCollections(data);
        if (!selectedCol && data.length > 0) setSelectedCol(data[0].name);
      }
    } catch {}
    setColLoading(false);
  }

  async function loadDocs(colName: string, newSkip = 0, filterQuery = filter) {
    setDocsLoading(true);
    setSkip(newSkip);
    try {
      const url = `${base}/documents?collection=${encodeURIComponent(colName)}&filter=${encodeURIComponent(filterQuery)}&skip=${newSkip}&limit=${LIMIT}`;
      const res = await fetch(url, { headers: headers() });
      if (res.ok) {
        const data: DocPage = await res.json();
        setPage(data);
      }
    } catch {}
    setDocsLoading(false);
  }

  useEffect(() => { loadCollections(); }, [id]);

  useEffect(() => {
    if (selectedCol) loadDocs(selectedCol, 0, filter);
  }, [selectedCol]);

  function applyFilter() {
    setFilter(filterInput);
    if (selectedCol) loadDocs(selectedCol, 0, filterInput);
  }

  async function deleteDoc(doc: unknown) {
    if (!selectedCol || !confirm("Delete this document?")) return;
    const res = await fetch(`${base}/documents?collection=${encodeURIComponent(selectedCol)}`, {
      method: "DELETE",
      headers: headers(),
      body: JSON.stringify({ filter: docIdFilter(doc) }),
    });
    if (res.ok) {
      setPage((p) => p ? { ...p, documents: p.documents.filter((d) => docIdStr(d) !== docIdStr(doc)), total: p.total - 1 } : p);
      setCollections((c) => c.map((col) => col.name === selectedCol ? { ...col, count: Math.max(0, col.count - 1) } : col));
    }
  }

  async function saveDoc(doc: unknown, newJson: string) {
    if (!selectedCol) return;
    let parsed: unknown;
    try { parsed = JSON.parse(newJson); } catch { throw new Error("Invalid JSON"); }
    const res = await fetch(`${base}/documents?collection=${encodeURIComponent(selectedCol)}`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ document: parsed }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error((d as Record<string, string>).error || "save failed");
    }
    // Refresh page
    if (selectedCol) await loadDocs(selectedCol, skip, filter);
  }

  async function insertDoc() {
    if (!selectedCol) return;
    let parsed: unknown;
    try { parsed = JSON.parse(insertJson); } catch { setInsertError("Invalid JSON"); return; }
    setInsertSaving(true); setInsertError("");
    const res = await fetch(`${base}/documents?collection=${encodeURIComponent(selectedCol)}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ document: parsed }),
    });
    if (res.ok) {
      setInserting(false);
      setInsertJson("{\n  \n}");
      await loadDocs(selectedCol, 0, filter);
      setCollections((c) => c.map((col) => col.name === selectedCol ? { ...col, count: col.count + 1 } : col));
    } else {
      const d = await res.json().catch(() => ({}));
      setInsertError((d as Record<string, string>).error || "insert failed");
    }
    setInsertSaving(false);
  }

  async function runShell() {
    const cmd = shellInput.trim();
    if (!cmd || shellRunning) return;
    let parsed: unknown;
    try { parsed = JSON.parse(cmd); } catch {
      setShellHistory((h) => [...h, { cmd, result: { error: "Invalid JSON — command must be a JSON object", duration_ms: 0 } }]);
      return;
    }
    setShellRunning(true);
    const res = await fetch(`${base}/shell`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ command: parsed }),
    });
    const data: ShellResult = await res.json().catch(() => ({ error: "network error", duration_ms: 0 }));
    setShellHistory((h) => [...h, { cmd, result: data }]);
    setShellRunning(false);
    setTimeout(() => shellEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border/40 px-4 py-2.5 shrink-0">
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => router.push("/services")}>
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <div className="flex h-6 w-6 items-center justify-center rounded bg-green-500/10 text-green-400">
          <Database className="h-3.5 w-3.5" />
        </div>
        <span className="text-sm font-medium">MongoDB Browser</span>
        {selectedCol && (
          <Badge variant="outline" className="text-[10px] font-mono bg-green-500/10 text-green-400 border-green-500/20">
            {selectedCol}
          </Badge>
        )}
        <div className="ml-auto flex gap-1">
          <Button variant={activeTab === "browse" ? "default" : "ghost"} size="sm" className="h-7 px-3 text-[11px]" onClick={() => setActiveTab("browse")}>
            <Database className="h-3 w-3 mr-1" /> Browse
          </Button>
          <Button variant={activeTab === "shell" ? "default" : "ghost"} size="sm" className="h-7 px-3 text-[11px]" onClick={() => setActiveTab("shell")}>
            <Terminal className="h-3 w-3 mr-1" /> Shell
          </Button>
        </div>
      </div>

      {/* Body: sidebar + main */}
      <div className="flex flex-1 overflow-hidden">
        {/* Collection sidebar */}
        <div className="w-52 shrink-0 border-r border-border/30 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/20 shrink-0">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Collections</span>
            <button onClick={loadCollections} disabled={colLoading} className="p-0.5 rounded hover:bg-white/[0.05] text-muted-foreground">
              {colLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {collections.length === 0 && !colLoading && (
              <p className="text-[11px] text-muted-foreground px-3 py-3">No collections</p>
            )}
            {collections.map((col) => (
              <button
                key={col.name}
                onClick={() => { setSelectedCol(col.name); setActiveTab("browse"); }}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-left text-[12px] transition-colors group ${selectedCol === col.name ? "bg-white/[0.08] text-foreground" : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground"}`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <Layers className="h-3 w-3 shrink-0 text-green-500/70" />
                  <span className="truncate font-mono">{col.name}</span>
                </div>
                <span className="text-[10px] text-[#8b949e] shrink-0">{col.count.toLocaleString()}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Main pane */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* ── Browse tab ── */}
          {activeTab === "browse" && (
            <>
              {/* Toolbar */}
              <div className="flex items-center gap-2 px-4 py-2 border-b border-border/30 shrink-0">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={filterInput}
                    onChange={(e) => setFilterInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && applyFilter()}
                    placeholder='Filter: {"field": "value"}'
                    className="h-8 pl-8 text-[12px] font-mono"
                  />
                </div>
                <Button size="sm" className="h-8 gap-1 text-[11px]" onClick={applyFilter} disabled={docsLoading || !selectedCol}>
                  {docsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Filter
                </Button>
                <Button size="sm" variant="outline" className="h-8 gap-1 text-[11px] text-emerald-400 border-emerald-500/30 hover:text-emerald-300" onClick={() => { setInserting(true); setInsertError(""); }} disabled={!selectedCol}>
                  <Plus className="h-3 w-3" /> Insert
                </Button>
                {page && (
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {page.skip + 1}–{Math.min(page.skip + page.documents.length, page.total)} of {page.total.toLocaleString()} docs
                  </span>
                )}
              </div>

              {/* Insert form */}
              {inserting && (
                <div className="border-b border-border/30 bg-card/40 px-4 py-3 shrink-0">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Insert Document</p>
                  <textarea
                    value={insertJson}
                    onChange={(e) => setInsertJson(e.target.value)}
                    rows={6}
                    className="w-full rounded-md border border-emerald-500/30 bg-[#0d1117] p-2 font-mono text-[11px] text-zinc-200 focus:outline-none resize-y mb-2"
                    spellCheck={false}
                  />
                  {insertError && <p className="text-[10px] text-red-400 font-mono mb-2">{insertError}</p>}
                  <div className="flex gap-1.5">
                    <Button size="sm" className="h-7 px-3 text-[11px] gap-1" disabled={insertSaving} onClick={insertDoc}>
                      {insertSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Insert
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => { setInserting(false); setInsertError(""); }}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Document list */}
              <div className="flex-1 overflow-y-auto">
                {/* Column header */}
                <div className="sticky top-0 z-10 bg-background flex items-center px-4 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground border-b border-border/30">
                  <span className="w-52 shrink-0">_id</span>
                  <span className="flex-1 min-w-0">Fields preview</span>
                  <span className="w-8" />
                </div>

                {!selectedCol && (
                  <div className="flex flex-col items-center py-16 text-muted-foreground">
                    <Layers className="h-8 w-8 opacity-30 mb-2" />
                    <p className="text-sm">Select a collection</p>
                  </div>
                )}

                {selectedCol && docsLoading && (!page || page.documents.length === 0) && (
                  <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                )}

                {selectedCol && !docsLoading && page && page.documents.length === 0 && (
                  <div className="flex flex-col items-center py-12 text-muted-foreground">
                    <Database className="h-8 w-8 opacity-30 mb-2" />
                    <p className="text-sm">No documents match the filter</p>
                  </div>
                )}

                {page && page.documents.map((doc) => (
                  <CollapsibleDoc
                    key={docIdStr(doc)}
                    doc={doc}
                    onDelete={deleteDoc}
                    onSave={saveDoc}
                  />
                ))}

                {/* Pagination */}
                {page && (page.skip > 0 || page.documents.length === LIMIT) && (
                  <div className="flex items-center justify-center gap-2 px-4 py-3 border-t border-border/20">
                    <Button size="sm" variant="outline" className="text-[11px] h-7" disabled={skip === 0 || docsLoading} onClick={() => selectedCol && loadDocs(selectedCol, Math.max(0, skip - LIMIT), filter)}>
                      ← Prev
                    </Button>
                    <span className="text-[11px] text-muted-foreground">
                      Page {Math.floor(skip / LIMIT) + 1} / {Math.ceil((page.total || 1) / LIMIT)}
                    </span>
                    <Button size="sm" variant="outline" className="text-[11px] h-7" disabled={skip + LIMIT >= (page.total) || docsLoading} onClick={() => selectedCol && loadDocs(selectedCol, skip + LIMIT, filter)}>
                      Next →
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Shell tab ── */}
          {activeTab === "shell" && (
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-y-auto px-4 py-3 font-mono text-[12px] space-y-3">
                {shellHistory.length === 0 && (
                  <div className="text-[#8b949e] text-[11px] space-y-1">
                    <p>Run MongoDB commands as JSON. Examples:</p>
                    {[
                      `{"find": "users", "filter": {}, "limit": 10}`,
                      `{"count": "orders", "query": {}}`,
                      `{"aggregate": "orders", "pipeline": [{"$group": {"_id": "$status"}}]}`,
                      `{"insert": "test", "documents": [{"name": "hello"}]}`,
                      `{"drop": "old_collection"}`,
                    ].map((ex) => (
                      <p key={ex} className="text-[#8b949e] cursor-pointer hover:text-zinc-500 transition-colors" onClick={() => setShellInput(ex)}>{ex}</p>
                    ))}
                  </div>
                )}
                {shellHistory.map((h, i) => (
                  <div key={i}>
                    <div className="flex items-start gap-2">
                      <span className="text-green-400 shrink-0">›</span>
                      <pre className="text-zinc-300 text-[11px] whitespace-pre-wrap break-all flex-1">{h.cmd}</pre>
                      <span className="text-[#8b949e] text-[10px] ml-auto shrink-0">{h.result.duration_ms}ms</span>
                    </div>
                    <div className="pl-4 mt-1 font-mono text-[11px]">
                      {h.result.error
                        ? <span className="text-red-400">(error) {h.result.error}</span>
                        : <div className="rounded-md bg-zinc-900/60 p-2 overflow-x-auto max-h-64 overflow-y-auto">
                            <JsonViewer value={h.result.result} />
                          </div>
                      }
                    </div>
                  </div>
                ))}
                <div ref={shellEndRef} />
              </div>

              {/* Shell input */}
              <div className="border-t border-border/30 px-4 py-3 shrink-0 space-y-2">
                <textarea
                  value={shellInput}
                  onChange={(e) => setShellInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runShell(); } }}
                  rows={3}
                  className="w-full bg-transparent font-mono text-[12px] text-zinc-200 placeholder:text-[#8b949e] focus:outline-none resize-none rounded-md border border-border/30 px-3 py-2"
                  placeholder='{"find": "collection", "filter": {}, "limit": 10}'
                  disabled={shellRunning}
                  spellCheck={false}
                  autoComplete="off"
                />
                <div className="flex items-center gap-2">
                  <Button size="sm" className="h-7 px-3 text-[11px] gap-1" onClick={runShell} disabled={shellRunning}>
                    {shellRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Terminal className="h-3 w-3" />} Run
                  </Button>
                  <span className="text-[10px] text-[#8b949e]">or Ctrl+Enter</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
