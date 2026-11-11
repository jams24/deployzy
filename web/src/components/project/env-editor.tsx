"use client";

import { useMemo, useRef, useState, type ClipboardEvent } from "react";
import { Braces, Eye, EyeOff, FileCode2, KeyRound, Loader2, Plus, Rows3, Trash2, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { autoFormatEnvText, parseEnvText } from "@/lib/parseEnvText";
import { FooterNote, SettingsSection, monoInputCls, type Note } from "@/components/dashboard/settings-kit";

// Environment variables editor. Values are masked by default (they are mostly
// secrets: database URLs, API keys) and revealed per row or all at once.
// "Table" edits one variable per row; pasting a whole .env into a key field
// splits it into rows. "Raw" is the old KEY=VALUE textarea for bulk edits.

type Row = { id: number; key: string; value: string };
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

let nextId = 1;
const toRows = (vars: Record<string, string>): Row[] =>
  Object.entries(vars).map(([key, value]) => ({ id: nextId++, key, value }));
const rowsToVars = (rows: Row[]) => {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const k = r.key.trim();
    if (k && KEY_RE.test(k)) out[k] = r.value;
  }
  return out;
};
const toText = (vars: Record<string, string>) => Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n");
const sameVars = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => b[k] === a[k]);
};

export function EnvEditor({
  id,
  initial,
  placeholder,
  saving,
  note,
  onSave,
}: {
  id?: string;
  initial: Record<string, string>;
  placeholder?: string;
  saving: boolean;
  note?: Note;
  onSave: (vars: Record<string, string>, redeploy: boolean) => void;
}) {
  const [mode, setMode] = useState<"table" | "raw">("table");
  const [rows, setRows] = useState<Row[]>(() => toRows(initial));
  const [text, setText] = useState(() => toText(initial));
  const [revealAll, setRevealAll] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const lastKeyRef = useRef<HTMLInputElement | null>(null);

  const current = useMemo(() => (mode === "table" ? rowsToVars(rows) : parseEnvText(text)), [mode, rows, text]);
  const dirty = !sameVars(current, initial);
  const count = Object.keys(current).length;
  const badKeys = mode === "table" ? rows.filter((r) => r.key.trim() && !KEY_RE.test(r.key.trim())).length : 0;

  const switchMode = (m: "table" | "raw") => {
    if (m === mode) return;
    if (m === "raw") setText(toText(rowsToVars(rows)));
    else setRows(toRows(parseEnvText(text)));
    setMode(m);
  };

  const addRow = () => {
    setRows((r) => [...r, { id: nextId++, key: "", value: "" }]);
    requestAnimationFrame(() => lastKeyRef.current?.focus());
  };
  const update = (rid: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.id === rid ? { ...x, ...patch } : x)));
  const remove = (rid: number) => setRows((r) => r.filter((x) => x.id !== rid));
  const toggleReveal = (rid: number) =>
    setRevealed((s) => {
      const n = new Set(s);
      if (n.has(rid)) n.delete(rid); else n.add(rid);
      return n;
    });

  // Pasting "A=1\nB=2" (or a single "A=1") into a key field becomes rows.
  const onKeyPaste = (rid: number, e: ClipboardEvent<HTMLInputElement>) => {
    const t = e.clipboardData.getData("text");
    if (!t.includes("=")) return;
    const parsed = parseEnvText(t);
    const entries = Object.entries(parsed);
    if (!entries.length) return;
    e.preventDefault();
    setRows((r) => {
      const idx = r.findIndex((x) => x.id === rid);
      const head = r.slice(0, idx);
      const tail = r.slice(idx + 1);
      const target = r[idx];
      const keep = target && (target.key || target.value) ? [target] : [];
      const existing = new Set([...head, ...keep, ...tail].map((x) => x.key));
      const fresh = entries.filter(([k]) => !existing.has(k)).map(([key, value]) => ({ id: nextId++, key, value }));
      // Overwrite values for keys that already exist.
      const patch = (list: Row[]) => list.map((x) => (x.key in parsed ? { ...x, value: parsed[x.key] } : x));
      return [...patch(head), ...patch(keep), ...fresh, ...patch(tail)];
    });
  };

  const seg = (on: boolean) =>
    cn(
      "flex h-full items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors",
      on ? "bg-background text-foreground shadow-sm dark:bg-white/[0.1]" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <SettingsSection
      id={id}
      icon={KeyRound}
      title="Environment variables"
      description={count ? `${count} variable${count === 1 ? "" : "s"}, available at build and run time.` : "Available to your app at build and run time."}
      action={
        <div className="flex h-8 items-center gap-0.5 rounded-full bg-foreground/[0.05] p-0.5" role="tablist" aria-label="Editor mode">
          <button type="button" role="tab" aria-selected={mode === "table"} className={seg(mode === "table")} onClick={() => switchMode("table")}>
            <Rows3 className="h-3.5 w-3.5" /><span className="hidden sm:inline">Table</span>
          </button>
          <button type="button" role="tab" aria-selected={mode === "raw"} className={seg(mode === "raw")} onClick={() => switchMode("raw")}>
            <FileCode2 className="h-3.5 w-3.5" /><span className="hidden sm:inline">Raw</span>
          </button>
        </div>
      }
      footer={
        <>
          {/* An error stays until the next save; "Saved" gives way to "Unsaved" once edited again. */}
          {note && (note.kind === "err" || !dirty) ? (
            <FooterNote note={note} />
          ) : dirty ? (
            <span className="flex items-center gap-1.5 text-[13px] text-amber-700 sm:mr-auto dark:text-amber-400">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Unsaved changes
            </span>
          ) : null}
          <button type="button" disabled={saving || !dirty || badKeys > 0} onClick={() => onSave(current, false)} className="pill pill-line pill-sm disabled:opacity-50">Save</button>
          <button type="button" disabled={saving || badKeys > 0} onClick={() => onSave(current, true)} className="pill pill-ink pill-sm disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save &amp; redeploy
          </button>
        </>
      }
    >
      {mode === "table" ? (
        <div>
          {rows.length > 0 && (
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="hidden text-[12.5px] text-muted-foreground sm:block">Tip: paste a whole .env file into any name field.</p>
              <button
                type="button"
                onClick={() => { setRevealAll((v) => !v); setRevealed(new Set()); }}
                className="ml-auto inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {revealAll ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {revealAll ? "Hide values" : "Reveal values"}
              </button>
            </div>
          )}

          {rows.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-[var(--dz-hairline)] px-6 py-8 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-foreground/[0.05]"><Braces className="h-4 w-4 text-muted-foreground" /></span>
              <p className="mt-3 text-[14.5px] font-semibold">No variables yet</p>
              <p className="mt-1 max-w-xs text-[13.5px] text-muted-foreground">Add one, or paste a whole .env file into the name field.</p>
              <button type="button" onClick={addRow} className="pill pill-line pill-sm mt-4"><Plus className="h-4 w-4" /> Add variable</button>
            </div>
          ) : (
            <ul className="space-y-3 sm:space-y-2">
              {rows.map((r, i) => {
                const show = revealAll || revealed.has(r.id);
                const bad = !!r.key.trim() && !KEY_RE.test(r.key.trim());
                return (
                  <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-[var(--dz-hairline)] max-sm:border-b max-sm:pb-3 max-sm:last:border-0 max-sm:last:pb-0 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)_auto]">
                    <input
                      ref={i === rows.length - 1 ? lastKeyRef : undefined}
                      value={r.key}
                      onChange={(e) => update(r.id, { key: e.target.value.replace(/\s/g, "_") })}
                      onPaste={(e) => onKeyPaste(r.id, e)}
                      placeholder="NAME"
                      aria-label="Variable name"
                      aria-invalid={bad}
                      spellCheck={false}
                      className={cn(monoInputCls, "col-span-2 sm:col-span-1", bad && "border-red-500/60 focus:border-red-500/60 focus:ring-red-500/10")}
                    />
                    <div className="relative min-w-0">
                      <input
                        type={show ? "text" : "password"}
                        value={r.value}
                        onChange={(e) => update(r.id, { value: e.target.value })}
                        placeholder="value"
                        aria-label={`Value of ${r.key || "variable"}`}
                        autoComplete="off"
                        spellCheck={false}
                        className={cn(monoInputCls, "pr-10")}
                      />
                      {!revealAll && (
                        <button
                          type="button"
                          onClick={() => toggleReveal(r.id)}
                          aria-label={show ? "Hide value" : "Show value"}
                          className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                        >
                          {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(r.id)}
                      aria-label={`Remove ${r.key || "variable"}`}
                      className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {rows.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <button type="button" onClick={addRow} className="inline-flex items-center gap-1.5 rounded-full px-1 text-[13.5px] font-medium text-[var(--dz-green-strong)] transition-opacity hover:opacity-80 dark:text-brand">
                <Plus className="h-4 w-4" /> Add variable
              </button>
              {badKeys > 0 && (
                <p className="text-[12.5px] text-red-600 dark:text-red-400">Names use letters, numbers and _ and can&apos;t start with a number.</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder || "DATABASE_URL=postgres://…\nAPI_KEY=…"}
            spellCheck={false}
            className="block min-h-[200px] w-full resize-y rounded-xl border border-[var(--dz-hairline)] bg-background px-3.5 py-3 font-mono text-[13px] leading-relaxed outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/70 focus:border-brand/60 focus:ring-4 focus:ring-brand/10 dark:bg-white/[0.02]"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12.5px] text-muted-foreground">One KEY=VALUE per line. Lines starting with # are ignored.</p>
            <button
              type="button"
              onClick={() => setText(autoFormatEnvText(text))}
              disabled={!text.trim()}
              title="Rewrite as one KEY=VALUE per line. Fixes pasted values that lost their line breaks."
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              <Wand2 className="h-3.5 w-3.5" /> Tidy up
            </button>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
