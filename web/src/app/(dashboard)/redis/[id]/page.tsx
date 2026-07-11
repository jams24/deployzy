"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, RefreshCw, Loader2, Trash2, Plus, Search,
  Terminal, Database, Check, X, ChevronDown, ChevronRight,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface KeyInfo {
  key: string;
  type: string;
  ttl: number;   // -1 = no expiry, -2 = gone
  preview: string;
  size: number;
}

interface KeyValue {
  key: string;
  type: string;
  ttl: number;
  value: unknown;
}

interface ExecResult {
  result?: unknown;
  error?: string;
  duration_ms: number;
}

const TYPE_COLORS: Record<string, string> = {
  string: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  list:   "bg-purple-500/10 text-purple-400 border-purple-500/20",
  set:    "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  hash:   "bg-orange-500/10 text-orange-400 border-orange-500/20",
  zset:   "bg-pink-500/10 text-pink-400 border-pink-500/20",
  stream: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
};

function TypeBadge({ type }: { type: string }) {
  return (
    <Badge variant="outline" className={`text-[9px] font-mono shrink-0 ${TYPE_COLORS[type] || "text-zinc-500"}`}>
      {type}
    </Badge>
  );
}

function TtlBadge({ ttl }: { ttl: number }) {
  if (ttl === -1) return <span className="text-[10px] text-zinc-600">∞</span>;
  if (ttl === -2) return <span className="text-[10px] text-red-500">gone</span>;
  if (ttl < 60) return <span className="text-[10px] text-amber-400">{ttl}s</span>;
  if (ttl < 3600) return <span className="text-[10px] text-zinc-400">{Math.round(ttl / 60)}m</span>;
  return <span className="text-[10px] text-zinc-400">{Math.round(ttl / 3600)}h</span>;
}

function renderValue(v: unknown, type: string): React.ReactNode {
  if (v === null || v === undefined) return <span className="text-zinc-600 italic">nil</span>;
  if (type === "string") return <span className="font-mono text-[11px] text-zinc-200 break-all whitespace-pre-wrap">{String(v)}</span>;
  if (type === "hash") {
    const obj = v as Record<string, string>;
    return (
      <table className="w-full text-[11px] font-mono">
        <thead><tr><th className="text-left text-zinc-500 py-0.5 pr-4 font-medium w-1/3">field</th><th className="text-left text-zinc-500 py-0.5 font-medium">value</th></tr></thead>
        <tbody>{Object.entries(obj).map(([k, val]) => (
          <tr key={k} className="border-t border-border/20">
            <td className="py-0.5 pr-4 text-orange-300 break-all">{k}</td>
            <td className="py-0.5 text-zinc-300 break-all">{val}</td>
          </tr>
        ))}</tbody>
      </table>
    );
  }
  if (type === "zset") {
    const arr = v as Array<{ member: string; score: number }>;
    return (
      <table className="w-full text-[11px] font-mono">
        <thead><tr><th className="text-left text-zinc-500 py-0.5 pr-4 font-medium w-1/4">score</th><th className="text-left text-zinc-500 py-0.5 font-medium">member</th></tr></thead>
        <tbody>{arr.map((z, i) => (
          <tr key={i} className="border-t border-border/20">
            <td className="py-0.5 pr-4 text-pink-300">{z.score}</td>
            <td className="py-0.5 text-zinc-300 break-all">{z.member}</td>
          </tr>
        ))}</tbody>
      </table>
    );
  }
  if (type === "stream") {
    const arr = v as Array<{ id: string; values: Record<string, string> }>;
    return (
      <div className="space-y-1.5">
        {arr.map((msg) => (
          <div key={msg.id} className="rounded-md bg-zinc-900/60 px-2 py-1.5 text-[11px] font-mono">
            <div className="text-cyan-400 mb-1">{msg.id}</div>
            {Object.entries(msg.values).map(([k, val]) => (
              <div key={k}><span className="text-zinc-500">{k}: </span><span className="text-zinc-300">{val}</span></div>
            ))}
          </div>
        ))}
      </div>
    );
  }
  // list or set → array of strings
  if (Array.isArray(v)) {
    return (
      <div className="space-y-0.5">
        {(v as string[]).map((item, i) => (
          <div key={i} className="flex items-start gap-2 font-mono text-[11px]">
            <span className="text-zinc-600 shrink-0 w-6 text-right">{i}</span>
            <span className="text-zinc-300 break-all">{item}</span>
          </div>
        ))}
      </div>
    );
  }
  return <pre className="text-[11px] text-zinc-300 whitespace-pre-wrap break-all">{JSON.stringify(v, null, 2)}</pre>;
}

export default function RedisEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const headers = useCallback(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("sm_token") : null;
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }, []);

  const base = `${API}/api/v1/services/${id}/redis`;

  const [activeTab, setActiveTab] = useState<"keys" | "cli">("keys");

  // ── Key browser ────────────────────────────────────────
  const [pattern, setPattern] = useState("*");
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [nextCursor, setNextCursor] = useState(0);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [keyDetail, setKeyDetail] = useState<KeyValue | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  // ── Edit key ───────────────────────────────────────────
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editTtl, setEditTtl] = useState(-1);
  const [saving, setSaving] = useState(false);

  // ── Add key ────────────────────────────────────────────
  const [addingKey, setAddingKey] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newTtl, setNewTtl] = useState(-1);
  const [inserting, setInserting] = useState(false);
  const [insertError, setInsertError] = useState("");

  // ── CLI ────────────────────────────────────────────────
  const [cliInput, setCliInput] = useState("");
  const [cliHistory, setCliHistory] = useState<Array<{ cmd: string; result: ExecResult }>>([]);
  const [cliRunning, setCliRunning] = useState(false);
  const cliEndRef = useRef<HTMLDivElement | null>(null);

  async function loadKeys(reset = false) {
    setLoading(true);
    const cursor = reset ? 0 : nextCursor;
    try {
      const res = await fetch(`${base}/keys?pattern=${encodeURIComponent(pattern)}&cursor=${cursor}&count=200`, { headers: headers() });
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json();
      setKeys(reset ? data.keys : (prev) => [...prev, ...(data.keys || [])]);
      setNextCursor(data.next_cursor);
      setDone(data.done);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { loadKeys(true); }, [id]);

  async function expandKey(k: KeyInfo) {
    if (expandedKey === k.key) { setExpandedKey(null); setKeyDetail(null); return; }
    setExpandedKey(k.key);
    setEditingKey(null);
    setLoadingDetail(true);
    try {
      const res = await fetch(`${base}/value?key=${encodeURIComponent(k.key)}`, { headers: headers() });
      if (res.ok) setKeyDetail(await res.json());
    } catch {}
    setLoadingDetail(false);
  }

  async function deleteKey(key: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete key "${key}"?`)) return;
    setDeletingKey(key);
    await fetch(`${base}/value?key=${encodeURIComponent(key)}`, { method: "DELETE", headers: headers() });
    setKeys((prev) => prev.filter((k) => k.key !== key));
    if (expandedKey === key) { setExpandedKey(null); setKeyDetail(null); }
    setDeletingKey(null);
  }

  async function saveEdit() {
    if (!editingKey) return;
    setSaving(true);
    await fetch(`${base}/value?key=${encodeURIComponent(editingKey)}`, {
      method: "PUT", headers: headers(),
      body: JSON.stringify({ value: editValue, ttl: editTtl }),
    });
    setSaving(false);
    setEditingKey(null);
    // Refresh the detail
    const res = await fetch(`${base}/value?key=${encodeURIComponent(editingKey)}`, { headers: headers() });
    if (res.ok) setKeyDetail(await res.json());
    // Update preview in list
    setKeys((prev) => prev.map((k) => k.key === editingKey ? { ...k, preview: editValue.slice(0, 120) } : k));
  }

  async function saveNewKey() {
    if (!newKey.trim()) { setInsertError("Key name required"); return; }
    setInserting(true); setInsertError("");
    const res = await fetch(`${base}/value?key=${encodeURIComponent(newKey)}`, {
      method: "PUT", headers: headers(),
      body: JSON.stringify({ value: newValue, ttl: newTtl }),
    });
    if (res.ok) {
      setAddingKey(false); setNewKey(""); setNewValue(""); setNewTtl(-1);
      loadKeys(true);
    } else {
      const d = await res.json().catch(() => ({}));
      setInsertError(d.error || "failed");
    }
    setInserting(false);
  }

  async function runCLI() {
    const cmd = cliInput.trim();
    if (!cmd) return;
    // Simple tokenise: split by whitespace, respect single/double quotes
    const args = tokenise(cmd);
    if (args.length === 0) return;
    setCliRunning(true);
    const res = await fetch(`${base}/exec`, {
      method: "POST", headers: headers(),
      body: JSON.stringify({ args }),
    });
    const data: ExecResult = await res.json().catch(() => ({ error: "network error", duration_ms: 0 }));
    setCliHistory((h) => [...h, { cmd, result: data }]);
    setCliInput("");
    setCliRunning(false);
    setTimeout(() => cliEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  function tokenise(s: string): string[] {
    const tokens: string[] = [];
    let cur = "";
    let inQ = "";
    for (const ch of s) {
      if (inQ) {
        if (ch === inQ) { inQ = ""; } else { cur += ch; }
      } else if (ch === '"' || ch === "'") {
        inQ = ch;
      } else if (ch === " " || ch === "\t") {
        if (cur) { tokens.push(cur); cur = ""; }
      } else {
        cur += ch;
      }
    }
    if (cur) tokens.push(cur);
    return tokens;
  }

  function renderCLIResult(r: ExecResult) {
    if (r.error) return <span className="text-red-400">(error) {r.error}</span>;
    const v = r.result;
    if (v === null || v === undefined) return <span className="text-zinc-500">(nil)</span>;
    if (typeof v === "string") return <span className="text-emerald-400">"{v}"</span>;
    if (typeof v === "number") return <span className="text-blue-400">(integer) {v}</span>;
    if (typeof v === "boolean") return <span className="text-blue-400">{String(v)}</span>;
    if (Array.isArray(v)) return (
      <div className="pl-2">
        {(v as unknown[]).map((item, i) => (
          <div key={i}><span className="text-zinc-600">{i + 1}) </span>{renderCLIResult({ result: item, duration_ms: 0 })}</div>
        ))}
      </div>
    );
    return <span className="text-zinc-300">{JSON.stringify(v)}</span>;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border/40 px-4 py-2.5 shrink-0">
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => router.push("/services")}>
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <div className="flex h-6 w-6 items-center justify-center rounded bg-red-500/10 text-red-400">
          <Database className="h-3.5 w-3.5" />
        </div>
        <span className="text-sm font-medium">Redis Browser</span>
        <div className="ml-auto flex gap-1">
          <Button variant={activeTab === "keys" ? "default" : "ghost"} size="sm" className="h-7 px-3 text-[11px]" onClick={() => setActiveTab("keys")}>
            <Database className="h-3 w-3 mr-1" /> Data
          </Button>
          <Button variant={activeTab === "cli" ? "default" : "ghost"} size="sm" className="h-7 px-3 text-[11px]" onClick={() => setActiveTab("cli")}>
            <Terminal className="h-3 w-3 mr-1" /> CLI
          </Button>
        </div>
      </div>

      {/* ── Keys tab ── */}
      {activeTab === "keys" && (
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border/30 shrink-0">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadKeys(true)}
                placeholder="KEYS pattern (e.g. user:*)"
                className="h-8 pl-8 text-[12px] font-mono"
              />
            </div>
            <Button size="sm" className="h-8 gap-1 text-[11px]" onClick={() => loadKeys(true)} disabled={loading}>
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Scan
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1 text-[11px] text-emerald-400 border-emerald-500/30 hover:text-emerald-300" onClick={() => { setAddingKey(true); setInsertError(""); }}>
              <Plus className="h-3 w-3" /> New Key
            </Button>
            <span className="text-[10px] text-muted-foreground ml-auto">{keys.length} key(s){!done && " · partial"}</span>
          </div>

          {/* Add key form */}
          {addingKey && (
            <div className="border-b border-border/30 bg-card/40 px-4 py-3 shrink-0">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">New Key (string)</p>
              <div className="flex items-start gap-2 flex-wrap">
                <div className="flex flex-col gap-1 min-w-[180px]">
                  <label className="text-[9px] text-zinc-500 font-medium">KEY</label>
                  <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="key:name" className="h-7 text-[11px] font-mono" />
                </div>
                <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
                  <label className="text-[9px] text-zinc-500 font-medium">VALUE</label>
                  <Input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="value..." className="h-7 text-[11px] font-mono" />
                </div>
                <div className="flex flex-col gap-1 w-24">
                  <label className="text-[9px] text-zinc-500 font-medium">TTL (sec, -1=∞)</label>
                  <Input type="number" value={newTtl} onChange={(e) => setNewTtl(parseInt(e.target.value) || -1)} className="h-7 text-[11px] font-mono" />
                </div>
                <div className="flex items-end gap-1 pb-0.5">
                  <Button size="sm" className="h-7 px-3 text-[11px] gap-1" disabled={inserting} onClick={saveNewKey}>
                    {inserting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Insert
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => { setAddingKey(false); setInsertError(""); }}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              {insertError && <p className="mt-1.5 text-[10px] text-red-400 font-mono">{insertError}</p>}
            </div>
          )}

          {/* Key table */}
          <div className="flex-1 overflow-y-auto">
            {/* Header row */}
            <div className="sticky top-0 z-10 bg-background flex items-center px-4 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground border-b border-border/30">
              <span className="flex-1 min-w-0">Key</span>
              <span className="w-20 text-center hidden sm:block">Type</span>
              <span className="w-16 text-center hidden md:block">TTL</span>
              <span className="flex-1 min-w-0 hidden lg:block pl-4">Value preview</span>
              <span className="w-8" />
            </div>

            {loading && keys.length === 0 ? (
              <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : keys.length === 0 ? (
              <div className="flex flex-col items-center py-12 text-muted-foreground">
                <Database className="h-8 w-8 opacity-30 mb-2" />
                <p className="text-sm">No keys match <span className="font-mono">{pattern}</span></p>
              </div>
            ) : (
              <>
                {keys.map((k) => (
                  <div key={k.key} className="border-b border-border/20">
                    {/* Key row */}
                    <div
                      className={`flex items-center px-4 py-2 cursor-pointer gap-3 transition-colors ${expandedKey === k.key ? "bg-white/[0.04]" : "hover:bg-white/[0.015]"}`}
                      onClick={() => expandKey(k)}
                    >
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        {expandedKey === k.key
                          ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                          : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                        <span className="font-mono text-[12px] text-zinc-200 truncate">{k.key}</span>
                      </div>
                      <div className="w-20 flex justify-center hidden sm:flex">
                        <TypeBadge type={k.type} />
                      </div>
                      <div className="w-16 text-center hidden md:block">
                        <TtlBadge ttl={k.ttl} />
                      </div>
                      <div className="flex-1 min-w-0 hidden lg:block pl-4">
                        <span className="font-mono text-[11px] text-zinc-500 truncate block">{k.preview}</span>
                      </div>
                      <div className="w-8 flex justify-end">
                        {deletingKey === k.key
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />
                          : (
                            <button
                              onClick={(e) => deleteKey(k.key, e)}
                              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-500/20 text-zinc-600 hover:text-red-400 transition-colors"
                              style={{ opacity: deletingKey ? 0 : undefined }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )
                        }
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {expandedKey === k.key && (
                      <div className="px-4 pb-4 pt-2 border-t border-border/20 bg-white/[0.01]">
                        {loadingDetail ? (
                          <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                        ) : keyDetail ? (
                          <div className="space-y-3">
                            {/* Meta row */}
                            <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
                              <TypeBadge type={keyDetail.type} />
                              <span>TTL: <TtlBadge ttl={keyDetail.ttl} /></span>
                              {keyDetail.type === "string" && (
                                <span className="text-zinc-600">{String(keyDetail.value ?? "").length} bytes</span>
                              )}
                              {/* Edit (string only) */}
                              {keyDetail.type === "string" && editingKey !== k.key && (
                                <button
                                  className="ml-auto text-[10px] text-blue-400 hover:text-blue-300"
                                  onClick={() => {
                                    setEditingKey(k.key);
                                    setEditValue(String(keyDetail.value ?? ""));
                                    setEditTtl(keyDetail.ttl);
                                  }}
                                >
                                  Edit
                                </button>
                              )}
                            </div>

                            {/* Edit form */}
                            {editingKey === k.key ? (
                              <div className="space-y-2">
                                <textarea
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  rows={4}
                                  className="w-full rounded-md border border-blue-500/40 bg-[#09090b] p-2 font-mono text-[11px] text-zinc-200 focus:outline-none resize-y"
                                  spellCheck={false}
                                />
                                <div className="flex items-center gap-2">
                                  <label className="text-[10px] text-zinc-500">TTL (sec, -1=∞)</label>
                                  <Input type="number" value={editTtl} onChange={(e) => setEditTtl(parseInt(e.target.value) || -1)} className="h-7 w-24 text-[11px] font-mono" />
                                  <Button size="sm" className="h-7 px-3 text-[11px] gap-1" disabled={saving} onClick={saveEdit}>
                                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setEditingKey(null)}>
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="rounded-md border border-border/30 bg-[#09090b] p-3 overflow-x-auto max-h-80 overflow-y-auto">
                                {renderValue(keyDetail.value, keyDetail.type)}
                              </div>
                            )}

                            {/* Delete */}
                            <div className="flex justify-end">
                              <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-destructive hover:text-destructive gap-1" onClick={(e) => deleteKey(k.key, e)}>
                                <Trash2 className="h-3 w-3" /> Delete key
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                ))}

                {/* Load more */}
                {!done && (
                  <div className="px-4 py-3 text-center">
                    <Button size="sm" variant="outline" className="text-[11px]" onClick={() => loadKeys(false)} disabled={loading}>
                      {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                      Load more
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── CLI tab ── */}
      {activeTab === "cli" && (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 py-3 font-mono text-[12px] space-y-2">
            {cliHistory.length === 0 && (
              <p className="text-zinc-600 text-[11px]">Type any Redis command and press Enter. Commands like FLUSHALL and CONFIG are blocked.</p>
            )}
            {cliHistory.map((h, i) => (
              <div key={i}>
                <div className="flex items-start gap-2">
                  <span className="text-red-400 shrink-0">›</span>
                  <span className="text-zinc-200">{h.cmd}</span>
                  <span className="text-zinc-700 text-[10px] ml-auto shrink-0">{h.result.duration_ms}ms</span>
                </div>
                <div className="pl-4 mt-0.5">{renderCLIResult(h.result)}</div>
              </div>
            ))}
            <div ref={cliEndRef} />
          </div>
          <div className="border-t border-border/30 px-4 py-2 shrink-0 flex items-center gap-2">
            <span className="text-red-400 font-mono text-sm shrink-0">›</span>
            <input
              type="text"
              value={cliInput}
              onChange={(e) => setCliInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !cliRunning && runCLI()}
              placeholder="SET key value · GET key · KEYS * · HGETALL myhash…"
              className="flex-1 bg-transparent font-mono text-[12px] text-zinc-200 placeholder:text-zinc-700 focus:outline-none"
              disabled={cliRunning}
              autoFocus={activeTab === "cli"}
              spellCheck={false}
              autoComplete="off"
            />
            {cliRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}
          </div>
        </div>
      )}
    </div>
  );
}
