"use client";

// API keys — create and revoke keys for the CLI and SDKs, plus bring-your-own
// AI provider keys for the Agent and AI builder. Creating a key happens in a
// sheet that shows the secret once, with ready-to-paste setup snippets.

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check, Copy, Eye, EyeOff, KeyRound, Loader2, Plus, Rocket, ShieldCheck, Sparkles, Terminal, Trash2, X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, type ApiKey } from "@/lib/api";
import { EmptyState, PageHeader, PanelHeader } from "@/components/dashboard/kit";
import { FooterNote, SettingsSection, inputCls, monoInputCls, selectCls, type Note } from "@/components/dashboard/settings-kit";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";
const authHeaders = () => {
  const token = typeof window !== "undefined" ? localStorage.getItem("sm_token") : "";
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
};

type Scope = "full" | "deploy" | "read";
const SCOPES: { id: Scope; label: string; icon: LucideIcon; desc: string; tone: string }[] = [
  { id: "deploy", label: "Deploy", icon: Rocket, desc: "Create, deploy and manage projects. Safe for CI.", tone: "border-brand/30 bg-brand/10 text-[var(--dz-green-strong)] dark:text-brand" },
  { id: "read", label: "Read-only", icon: Eye, desc: "List and inspect. Can't change anything.", tone: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  { id: "full", label: "Full access", icon: ShieldCheck, desc: "Everything, including account and key management.", tone: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
];
const scopeOf = (s?: string) => SCOPES.find((x) => x.id === s) || SCOPES[2];

function ago(iso: string | null) {
  if (!iso) return null;
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (id: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(id); setTimeout(() => setCopied(null), 1500); }).catch(() => {});
  };
  return { copied, copy };
}

const SNIPPETS = (key: string) => [
  { id: "cli", label: "CLI", code: `deployzy authtoken ${key}` },
  { id: "node", label: "Node", code: `import { Deployzy } from "deployzy-sdk";\n\nconst dz = new Deployzy({ authtoken: "${key}" });` },
  { id: "python", label: "Python", code: `from deployzy import Deployzy\n\ndz = Deployzy(authtoken="${key}")` },
];

// Dark code card with language tabs.
function Snippets({ apiKey, className }: { apiKey: string; className?: string }) {
  const [tab, setTab] = useState("cli");
  const { copied, copy } = useCopy();
  const list = SNIPPETS(apiKey);
  const cur = list.find((s) => s.id === tab) || list[0];
  return (
    <div className={cn("dark overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#0b0c10] text-white", className)}>
      <div className="flex items-center gap-1 border-b border-white/[0.07] px-2 py-2">
        {list.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setTab(s.id)}
            className={cn("h-7 rounded-full px-3 text-[12.5px] font-medium transition-colors", tab === s.id ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white/85")}
          >
            {s.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => copy(cur.id, cur.code)}
          aria-label="Copy snippet"
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-white/55 transition-colors hover:bg-white/10 hover:text-white"
        >
          {copied === cur.id ? <Check className="h-3.5 w-3.5 text-brand" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[12.5px] leading-relaxed text-white/85">{cur.code}</pre>
    </div>
  );
}

function CreateKeySheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Scope>("deploy");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [secret, setSecret] = useState("");
  const { copied, copy } = useCopy();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const create = async () => {
    if (!name.trim()) { setErr("Give the key a name so you can recognise it later."); return; }
    setBusy(true); setErr("");
    try {
      const d = await api.createApiKey(name.trim(), scope);
      setSecret(d.api_key);
      onCreated();
    } catch (e) {
      setErr(e instanceof Error && e.message ? e.message : "Couldn't create the key");
    }
    setBusy(false);
  };

  // Portaled: the page wrapper animates with a transform, which would trap `fixed`.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:px-4"
      style={{ animation: "dz-fade .2s ease both" }}
      onClick={secret ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-key-title"
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[26px] border border-[var(--dz-hairline)] bg-background pb-[env(safe-area-inset-bottom)] shadow-2xl sm:rounded-[26px]"
        style={{ animation: "dz-pop .25s cubic-bezier(.2,.7,.2,1) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-foreground/15 sm:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-3 p-5 pb-4 sm:p-6 sm:pb-4">
          <div>
            <p className="eyebrow">{secret ? "Key created" : "New API key"}</p>
            <h2 id="new-key-title" className="mt-1.5 text-[22px] font-semibold tracking-[-0.03em]">{secret ? "Copy it now" : "Create a key"}</h2>
            <p className="mt-1 text-[13.5px] text-muted-foreground">
              {secret ? "This is the only time the full key is shown." : "For the CLI, the SDKs and CI pipelines."}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!secret ? (
          <form onSubmit={(e) => { e.preventDefault(); create(); }}>
            <div className="space-y-5 px-5 sm:px-6">
              <label className="block">
                <span className="mb-1.5 block text-[13.5px] font-medium">Name</span>
                <input autoFocus value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} placeholder="laptop, github-actions…" className={inputCls} />
              </label>
              <fieldset>
                <legend className="mb-2 text-[13.5px] font-medium">Access</legend>
                <div className="space-y-2">
                  {SCOPES.map((s) => {
                    const on = scope === s.id;
                    return (
                      <label
                        key={s.id}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 transition-colors",
                          on ? "border-brand/60 bg-brand/[0.06]" : "border-[var(--dz-hairline)] hover:border-foreground/25",
                        )}
                      >
                        <input type="radio" name="scope" value={s.id} checked={on} onChange={() => setScope(s.id)} className="sr-only" />
                        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border", s.tone)}><s.icon className="h-4 w-4" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 text-[14px] font-medium">
                            {s.label}
                            {s.id === "deploy" && <span className="rounded-full bg-foreground/[0.06] px-2 py-px text-[11.5px] font-medium text-muted-foreground">Recommended</span>}
                          </span>
                          <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{s.desc}</span>
                        </span>
                        <span className={cn("mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", on ? "border-brand bg-brand" : "border-foreground/25")} aria-hidden>
                          {on && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              {err && <p className="text-[13.5px] text-red-600 dark:text-red-400">{err}</p>}
            </div>
            <div className="flex flex-col-reverse gap-2 p-5 sm:flex-row sm:justify-end sm:p-6">
              <button type="button" onClick={onClose} className="pill pill-line pill-sm">Cancel</button>
              <button type="submit" disabled={busy} className="pill pill-ink pill-sm disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Create key
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="space-y-4 px-5 sm:px-6">
              <div className="flex items-center gap-2 rounded-2xl border border-brand/40 bg-brand/[0.06] p-2 pl-3.5">
                <code className="min-w-0 flex-1 break-all font-mono text-[13px]">{secret}</code>
                <button type="button" onClick={() => copy("secret", secret)} className={cn("pill pill-sm shrink-0", copied === "secret" ? "pill-launch" : "pill-ink")}>
                  {copied === "secret" ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy</>}
                </button>
              </div>
              <div>
                <p className="mb-2 text-[13.5px] font-medium">Use it</p>
                <Snippets apiKey={secret} />
              </div>
              <p className="text-[12.5px] text-muted-foreground">Store it in a password manager or your CI secrets. If it leaks, revoke it here and create a new one.</p>
            </div>
            <div className="flex p-5 sm:justify-end sm:p-6">
              <button type="button" onClick={onClose} className="pill pill-ink pill-sm w-full sm:w-auto">Done</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

interface ByokProvider { id: string; label: string; key_hint: string }
interface ByokKey { provider: string; preview: string; updated_at: string }

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  // ── Bring-your-own AI key (BYOK) ──
  const [byokProviders, setByokProviders] = useState<ByokProvider[]>([]);
  const [byokKeys, setByokKeys] = useState<ByokKey[]>([]);
  const [byokMetering, setByokMetering] = useState(false);
  const [byokProvider, setByokProvider] = useState("anthropic");
  const [byokInput, setByokInput] = useState("");
  const [byokShow, setByokShow] = useState(false);
  const [byokSaving, setByokSaving] = useState(false);
  const [byokNote, setByokNote] = useState<Note>(null);

  const load = useCallback(async () => {
    try { setKeys(await api.listApiKeys()); } catch { /* not signed in */ }
    setLoading(false);
  }, []);

  const loadByok = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/ai/keys`, { headers: authHeaders() });
      if (res.ok) {
        const d = await res.json();
        setByokProviders(d.providers || []);
        setByokKeys(d.keys || []);
        setByokMetering(!!d.metering_on);
        if (d.providers?.[0]) setByokProvider((p) => p || d.providers[0].id);
      }
    } catch {}
  }, []);

  // Deferred so the mount effect doesn't synchronously trigger a setState.
  useEffect(() => {
    const t = setTimeout(() => { load(); loadByok(); }, 0);
    return () => clearTimeout(t);
  }, [load, loadByok]);

  async function revoke(id: string) {
    setRevoking(id);
    try { await api.deleteApiKey(id); await load(); } catch {}
    setRevoking(null);
    setConfirmId(null);
  }

  const saveByok = async () => {
    if (!byokInput.trim()) return;
    setByokSaving(true); setByokNote(null);
    try {
      const res = await fetch(`${API}/api/v1/ai/keys`, { method: "PUT", headers: authHeaders(), body: JSON.stringify({ provider: byokProvider, api_key: byokInput.trim() }) });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { setByokInput(""); setByokNote({ kind: "ok", text: "Saved. The Agent will use your key." }); await loadByok(); }
      else setByokNote({ kind: "err", text: d.error || "Could not save key" });
    } catch { setByokNote({ kind: "err", text: "Network error" }); }
    setByokSaving(false);
  };
  const removeByok = async (provider: string) => {
    try {
      await fetch(`${API}/api/v1/ai/keys/${provider}`, { method: "DELETE", headers: authHeaders() });
      setByokNote(null);
      await loadByok();
    } catch {}
  };
  const providerLabel = (id: string) => byokProviders.find((p) => p.id === id)?.label || id;
  const currentHint = byokProviders.find((p) => p.id === byokProvider)?.key_hint || "sk-…";

  const newKeyButton = (
    <button type="button" onClick={() => setCreating(true)} className="pill pill-ink pill-sm">
      <Plus className="h-4 w-4" /> New key
    </button>
  );

  return (
    <div className="animate-fade-in-up">
      {creating && <CreateKeySheet onClose={() => setCreating(false)} onCreated={load} />}

      <PageHeader
        eyebrow="Account"
        title="API keys"
        description="Keys let the CLI, the SDKs and your CI act on your account. Give each machine its own key so you can revoke one without breaking the rest."
        actions={keys.length > 0 ? newKeyButton : undefined}
      />

      <div className="mt-6 grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4 sm:space-y-5">
          {/* Keys */}
          {loading ? (
            <section className="surface rounded-[20px] p-5" aria-busy>
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 py-3">
                  <div className="h-10 w-10 animate-pulse rounded-xl bg-foreground/[0.06]" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-40 animate-pulse rounded bg-foreground/[0.06]" />
                    <div className="h-3 w-64 animate-pulse rounded bg-foreground/[0.04]" />
                  </div>
                </div>
              ))}
            </section>
          ) : keys.length === 0 ? (
            <EmptyState
              icon={KeyRound}
              title="No API keys yet"
              description="Create one to use the deployzy CLI, the SDKs or a CI pipeline."
              action={newKeyButton}
            />
          ) : (
            <section className="surface overflow-hidden rounded-[20px]">
              <PanelHeader title="Your keys" count={keys.length} />
              <ul className="divide-y divide-[var(--dz-hairline)]">
                {keys.map((k) => {
                  const sc = scopeOf(k.scope);
                  const used = ago(k.last_used_at);
                  const confirming = confirmId === k.id;
                  return (
                    <li key={k.id} className="px-4 py-3.5 sm:px-5">
                      <div className="flex items-center gap-3">
                        <span className={cn("hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl border sm:flex", sc.tone)}><sc.icon className="h-4 w-4" /></span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="truncate text-[14.5px] font-medium">{k.name}</span>
                            <span className={cn("inline-flex h-[22px] items-center rounded-full border px-2 text-[12px] font-medium", sc.tone)}>{sc.label}</span>
                          </div>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground">
                            <code className="font-mono text-[12.5px]">{k.prefix}••••</code>
                            <span aria-hidden>·</span>
                            <span className={cn(used && "text-foreground/80")}>{used ? `Used ${used}` : "Never used"}</span>
                            <span aria-hidden className="hidden sm:inline">·</span>
                            <span className="hidden sm:inline">Created {new Date(k.created_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</span>
                          </p>
                        </div>
                        {!confirming && (
                          <button
                            type="button"
                            onClick={() => setConfirmId(k.id)}
                            aria-label={`Revoke ${k.name}`}
                            className="inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                          >
                            <Trash2 className="h-4 w-4" /><span className="hidden sm:inline">Revoke</span>
                          </button>
                        )}
                      </div>
                      {confirming && (
                        <div className="mt-3 flex flex-col gap-2 rounded-2xl bg-red-500/[0.06] p-3 sm:flex-row sm:items-center">
                          <p className="text-[13.5px] sm:mr-auto">Revoke <span className="font-semibold">{k.name}</span>? Anything using it stops working right away.</p>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => setConfirmId(null)} className="pill pill-line pill-sm flex-1 sm:flex-none">Cancel</button>
                            <button type="button" disabled={revoking === k.id} onClick={() => revoke(k.id)} className="pill pill-sm flex-1 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 sm:flex-none">
                              {revoking === k.id && <Loader2 className="h-4 w-4 animate-spin" />} Revoke
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Bring your own AI key */}
          <SettingsSection
            icon={Sparkles}
            title="Bring your own AI key"
            description={<>The Agent and AI builder use your provider key, so those calls don&apos;t count toward your plan.{byokMetering ? " Without one, usage is billed to your balance." : " AI usage is currently free here."}</>}
          >
            <form onSubmit={(e) => { e.preventDefault(); saveByok(); }} className="flex flex-col gap-2 sm:flex-row">
              <select aria-label="Provider" value={byokProvider} onChange={(e) => setByokProvider(e.target.value)} className={cn(selectCls, "sm:w-48")}>
                {byokProviders.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <div className="relative min-w-0 flex-1">
                <input
                  type={byokShow ? "text" : "password"}
                  value={byokInput}
                  onChange={(e) => { setByokInput(e.target.value); setByokNote(null); }}
                  placeholder={currentHint}
                  aria-label="Provider API key"
                  autoComplete="off"
                  spellCheck={false}
                  className={cn(monoInputCls, "pr-10")}
                />
                <button type="button" onClick={() => setByokShow((v) => !v)} aria-label={byokShow ? "Hide key" : "Show key"} className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
                  {byokShow ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <button type="submit" disabled={byokSaving || !byokInput.trim()} className="pill pill-ink pill-sm shrink-0 disabled:opacity-50">
                {byokSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save key
              </button>
            </form>
            {byokNote && <div className="mt-2.5"><FooterNote note={byokNote} /></div>}

            {byokKeys.length > 0 && (
              <ul className="mt-4 space-y-2">
                {byokKeys.map((k) => (
                  <li key={k.provider} className="flex items-center gap-3 rounded-2xl border border-[var(--dz-hairline)] px-3.5 py-2.5">
                    <span className="relative inline-flex h-2 w-2 shrink-0"><span className="live-dot bg-brand" aria-hidden /></span>
                    <span className="text-[14px] font-medium">{providerLabel(k.provider)}</span>
                    <code className="min-w-0 truncate font-mono text-[12.5px] text-muted-foreground">{k.preview}</code>
                    <span className="ml-auto hidden text-[12.5px] text-muted-foreground sm:inline">In use</span>
                    <button type="button" onClick={() => removeByok(k.provider)} aria-label={`Remove ${providerLabel(k.provider)} key`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 sm:ml-0">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </SettingsSection>
        </div>

        {/* Quick start */}
        <aside className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:self-start">
          <section className="surface rounded-[20px] p-4 sm:p-5">
            <p className="flex items-center gap-2 text-[14.5px] font-semibold tracking-tight"><Terminal className="h-4 w-4 text-muted-foreground" /> Quick start</p>
            <p className="mt-1 text-[13.5px] text-muted-foreground">Paste your key into one of these.</p>
            <Snippets apiKey="<your-key>" className="mt-3" />
          </section>
          <section className="surface rounded-[20px] p-4 sm:p-5">
            <p className="text-[14.5px] font-semibold tracking-tight">Which access?</p>
            <ul className="mt-3 space-y-3">
              {SCOPES.map((s) => (
                <li key={s.id} className="flex gap-3">
                  <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border", s.tone)}><s.icon className="h-3.5 w-3.5" /></span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium">{s.label}</span>
                    <span className="block text-[13px] leading-snug text-muted-foreground">{s.desc}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
