"use client";

// Settings tab — everything configurable about the project in one place:
// general (auto-deploy, labels), env vars, build & runtime (incl. multi-service),
// custom domains, PR previews, scheduled jobs, and the danger zone
// (move server / delete). Desktop gets a sticky section nav; phones get a
// scrollable chip row of the same sections.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight, ArrowUpRight, Check, Clock, Copy, Folder, GitPullRequest, Globe, Hammer,
  KeyRound, Layers, Loader2, Plus, Settings2, Tag, Trash2, TriangleAlert, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DirectoryPicker } from "@/components/DirectoryPicker";
import { StatusPill } from "@/components/dashboard/kit";
import {
  Field, FooterNote, SettingRow, SettingsNav, SettingsSection, Switch,
  inputCls, monoInputCls, selectCls, type Note, type SettingsNavItem,
} from "@/components/dashboard/settings-kit";
import { EnvEditor } from "@/components/project/env-editor";
import { useProject } from "@/components/project/project-context";
import { ServiceCards } from "@/components/project/service-cards";
import {
  API, detectStackFor, headers, previewSubdomainExample,
  serviceToCfg, servicesPayload,
  type BuildConfig, type Cron, type Domain, type MoveTarget, type Project, type ServiceCfg,
} from "@/components/project/project-shared";
import { getBuildPlaceholders } from "@/lib/placeholders";
import { regionName } from "@/lib/regions";

function Group({ title, children, first }: { title: string; children: ReactNode; first?: boolean }) {
  return (
    <div className={cn(!first && "mt-5 border-t border-[var(--dz-hairline)] pt-5")}>
      <p className="eyebrow mb-3">{title}</p>
      {children}
    </div>
  );
}

function Chip({ children, tone }: { children: ReactNode; tone?: "ok" | "warn" | "bad" | "info" }) {
  return (
    <span className={cn(
      "inline-flex h-[22px] shrink-0 items-center rounded-full border px-2 text-[12px] font-medium",
      tone === "ok" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      tone === "warn" && "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      tone === "bad" && "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
      tone === "info" && "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
      !tone && "border-[var(--dz-hairline)] bg-foreground/[0.03] text-foreground/80",
    )}>
      {children}
    </span>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }).catch(() => {}); }}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
    >
      {done ? <Check className="h-3.5 w-3.5 text-brand" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

const CRON_PRESETS = [
  { label: "Hourly", value: "0 * * * *" },
  { label: "Daily 3am", value: "0 3 * * *" },
  { label: "Weekly", value: "0 3 * * 0" },
  { label: "Every 15 min", value: "*/15 * * * *" },
];

const textBtn = "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors";

export default function ProjectSettingsPage() {
  const { project: p, refresh, deploy, move, remove, deploying, deleting } = useProject();
  const ph = getBuildPlaceholders(p.framework);
  const branch = p.github_branch || p.branch || "main";

  // ── Auto-deploy ──
  const [togglingAutoDeploy, setTogglingAutoDeploy] = useState(false);
  async function toggleAutoDeploy(enabled: boolean) {
    setTogglingAutoDeploy(true);
    try {
      await fetch(`${API}/api/v1/projects/${p.id}/auto-deploy`, {
        method: "PUT", headers: headers(), body: JSON.stringify({ enabled }),
      });
      refresh();
    } catch {}
    setTogglingAutoDeploy(false);
  }

  // ── Labels ──
  const [editingLabels, setEditingLabels] = useState(false);
  const [labelDraft, setLabelDraft] = useState<string[]>([]);
  const [labelInput, setLabelInput] = useState("");
  const [savingLabels, setSavingLabels] = useState(false);
  const [labelNote, setLabelNote] = useState<Note>(null);
  const addLabels = (raw: string) => {
    const next = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!next.length) return;
    setLabelDraft((d) => Array.from(new Set([...d, ...next])).slice(0, 10));
    setLabelInput("");
  };
  async function saveLabels() {
    const labels = Array.from(new Set([...labelDraft, ...labelInput.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)])).slice(0, 10);
    setSavingLabels(true); setLabelNote(null);
    try {
      const res = await fetch(`${API}/api/v1/projects/${p.id}/labels`, {
        method: "PUT", headers: headers(), body: JSON.stringify({ labels }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setLabelNote({ kind: "err", text: e.error || "Couldn't save labels" });
      } else {
        setEditingLabels(false);
        setLabelInput("");
        refresh();
      }
    } catch { setLabelNote({ kind: "err", text: "Network error" }); }
    setSavingLabels(false);
  }

  // ── Env vars ──
  const [savingEnv, setSavingEnv] = useState(false);
  const [envNote, setEnvNote] = useState<Note>(null);
  async function saveEnvVars(vars: Record<string, string>, redeploy: boolean) {
    setSavingEnv(true); setEnvNote(null);
    try {
      const res = await fetch(`${API}/api/v1/projects/${p.id}`, {
        method: "PUT", headers: headers(), body: JSON.stringify({ env_vars: vars }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setEnvNote({ kind: "err", text: e.error || "Couldn't save variables" });
      } else {
        setEnvNote({ kind: "ok", text: redeploy ? "Saved. Redeploying…" : "Saved. Applies on the next deploy." });
        if (redeploy) deploy(); else refresh();
      }
    } catch { setEnvNote({ kind: "err", text: "Network error" }); }
    setSavingEnv(false);
  }

  // ── Build & runtime ──
  const [buildCfg, setBuildCfg] = useState<BuildConfig>(() => ({
    install_cmd: p.install_cmd || "",
    build_cmd: p.build_cmd || "",
    start_cmd: p.start_cmd || "",
    root_dir: p.root_dir || "",
    node_version: p.node_version || "",
    port_override: p.port_override || 0,
    memory_mb: p.memory_mb || 0,
    cpus: p.cpus || 0,
    health_check_path: p.health_check_path || "",
    release_cmd: p.release_cmd || "",
    build_mode: p.build_mode || "",
    dockerfile_path: p.dockerfile_path || "",
  }));
  const setCfg = (patch: Partial<BuildConfig>) => setBuildCfg((prev) => ({ ...prev, ...patch }));
  const [multiService, setMultiService] = useState(() => (p.services || []).length > 0);
  const [services, setServices] = useState<ServiceCfg[]>(() => (p.services || []).map(serviceToCfg));
  const [savingBuild, setSavingBuild] = useState(false);
  const [buildNote, setBuildNote] = useState<Note>(null);
  const [planLimits, setPlanLimits] = useState<{ max_memory_mb: number; max_cpus: number } | null>(null);
  const [dirPicker, setDirPicker] = useState<{ kind: "root" } | { kind: "service"; index: number } | null>(null);

  useEffect(() => {
    fetch(`${API}/api/v1/users/me/limits`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.limits) setPlanLimits({ max_memory_mb: d.limits.max_memory_mb, max_cpus: d.limits.max_cpus }); })
      .catch(() => {});
  }, []);
  const memCap = planLimits && planLimits.max_memory_mb > 0 ? planLimits.max_memory_mb : 0;
  const cpuCap = planLimits && planLimits.max_cpus > 0 ? planLimits.max_cpus : 0;

  async function saveBuildConfig(redeploy: boolean) {
    setSavingBuild(true); setBuildNote(null);
    try {
      const res = await fetch(`${API}/api/v1/projects/${p.id}/build-config`, {
        method: "PUT", headers: headers(),
        body: JSON.stringify({ ...buildCfg, services: servicesPayload(multiService, services) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        setBuildNote({ kind: "err", text: err.error || "Couldn't save build settings" });
      } else {
        setBuildNote({ kind: "ok", text: redeploy ? "Saved. Redeploying…" : "Saved. Applies on the next deploy." });
        if (redeploy) deploy(); else refresh();
      }
    } catch {
      setBuildNote({ kind: "err", text: "Couldn't save build settings" });
    }
    setSavingBuild(false);
  }

  // ── Custom domains ──
  const [allDomains, setAllDomains] = useState<Domain[]>([]);
  const [newDomain, setNewDomain] = useState("");
  const [addingDomain, setAddingDomain] = useState(false);
  const [domainNote, setDomainNote] = useState<Note>(null);
  const [pendingDns, setPendingDns] = useState<Domain | null>(null);

  const loadDomains = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/domains`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setAllDomains(Array.isArray(data) ? data : []);
      }
    } catch {}
  }, []);
  // Deferred so the mount effect doesn't synchronously trigger a setState.
  useEffect(() => {
    const t = setTimeout(() => loadDomains(), 0);
    return () => clearTimeout(t);
  }, [loadDomains]);

  async function addProjectDomain() {
    const d = newDomain.trim().toLowerCase();
    if (!d) return;
    setAddingDomain(true); setDomainNote(null); setPendingDns(null);
    try {
      // 1) Register domain
      const regRes = await fetch(`${API}/api/v1/domains`, {
        method: "POST", headers: headers(), body: JSON.stringify({ domain: d }),
      });
      if (!regRes.ok && regRes.status !== 409) {
        const err = await regRes.json().catch(() => ({ error: "Failed to add domain" }));
        setDomainNote({ kind: "err", text: err.error || "Failed to add domain" });
        setAddingDomain(false);
        return;
      }
      // 2) Fetch domain list to find the one we just added (or existing)
      const listRes = await fetch(`${API}/api/v1/domains`, { headers: headers() });
      const list: Domain[] = listRes.ok ? await listRes.json() : [];
      const row = list.find((x) => x.domain === d);
      if (!row) {
        setDomainNote({ kind: "err", text: "Domain registered but not found in your list. Try again." });
        setAddingDomain(false);
        return;
      }
      // 3) Not verified yet: show the CNAME to set, verify from /domains.
      if (!row.verified) {
        setPendingDns(row);
        setNewDomain("");
        loadDomains();
        setAddingDomain(false);
        return;
      }
      // 4) Already verified — bind it to this project.
      await fetch(`${API}/api/v1/domains/${row.id}/bind`, {
        method: "PUT", headers: headers(),
        body: JSON.stringify({ target_type: "project", target_subdomain: p.subdomain }),
      });
      setNewDomain("");
      setDomainNote({ kind: "ok", text: `${d} now points to this project.` });
      loadDomains();
    } catch {
      setDomainNote({ kind: "err", text: "Failed to add domain" });
    }
    setAddingDomain(false);
  }

  async function unbindDomain(domainId: string) {
    // Unbinding = clearing target_subdomain (target_subdomain != '' is the routing filter).
    await fetch(`${API}/api/v1/domains/${domainId}/bind`, {
      method: "PUT", headers: headers(),
      body: JSON.stringify({ target_type: "project", target_subdomain: "" }),
    });
    loadDomains();
  }

  const boundDomains = allDomains.filter((d) => d.target_type === "project" && d.target_subdomain === p.subdomain);
  const unverifiedCount = allDomains.filter((d) => !d.verified && !d.target_subdomain).length;

  // ── PR previews ──
  const [previews, setPreviews] = useState<Project[]>([]);
  const [togglingPreview, setTogglingPreview] = useState(false);
  const loadPreviews = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/projects/${p.id}/previews`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setPreviews(Array.isArray(data) ? data : []);
      }
    } catch {}
  }, [p.id]);
  useEffect(() => {
    const t = setTimeout(() => { if (p.github_repo) loadPreviews(); }, 0);
    return () => clearTimeout(t);
  }, [loadPreviews, p.github_repo]);

  async function togglePreviewEnabled(enabled: boolean) {
    setTogglingPreview(true);
    try {
      await fetch(`${API}/api/v1/projects/${p.id}/preview-enabled`, {
        method: "PUT", headers: headers(), body: JSON.stringify({ enabled }),
      });
      refresh();
    } catch {}
    setTogglingPreview(false);
  }

  // ── Cron jobs ──
  const [crons, setCrons] = useState<Cron[]>([]);
  const [editingCron, setEditingCron] = useState(false);
  const [cronForm, setCronForm] = useState({ name: "", schedule: "0 3 * * *", command: "" });
  const [cronNote, setCronNote] = useState<Note>(null);
  const [savingCron, setSavingCron] = useState(false);
  const [confirmCron, setConfirmCron] = useState<string | null>(null);
  const loadCrons = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/projects/${p.id}/crons`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setCrons(Array.isArray(data) ? data : []);
      }
    } catch {}
  }, [p.id]);
  useEffect(() => {
    const t = setTimeout(() => loadCrons(), 0);
    return () => clearTimeout(t);
  }, [loadCrons]);

  async function addCron() {
    if (!cronForm.schedule.trim() || !cronForm.command.trim()) { setCronNote({ kind: "err", text: "Schedule and command are required." }); return; }
    setSavingCron(true); setCronNote(null);
    try {
      const res = await fetch(`${API}/api/v1/projects/${p.id}/crons`, {
        method: "POST", headers: headers(), body: JSON.stringify(cronForm),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        setCronNote({ kind: "err", text: err.error || "Couldn't create the job" });
      } else {
        setCronForm({ name: "", schedule: "0 3 * * *", command: "" });
        setEditingCron(false);
        loadCrons();
      }
    } catch { setCronNote({ kind: "err", text: "Network error" }); }
    setSavingCron(false);
  }
  async function toggleCron(c: Cron) {
    await fetch(`${API}/api/v1/projects/${c.project_id}/crons/${c.id}`, {
      method: "PUT", headers: headers(),
      body: JSON.stringify({ name: c.name, schedule: c.schedule, command: c.command, enabled: !c.enabled }),
    });
    loadCrons();
  }
  async function deleteCron(c: Cron) {
    await fetch(`${API}/api/v1/projects/${c.project_id}/crons/${c.id}`, {
      method: "DELETE", headers: headers(),
    });
    setConfirmCron(null);
    loadCrons();
  }

  // ── Danger zone (move + delete) ──
  const [moveTargets, setMoveTargets] = useState<MoveTarget[]>([]);
  useEffect(() => {
    fetch(`${API}/api/v1/servers/selectable`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setMoveTargets(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);
  const [moveTo, setMoveTo] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  // Destinations = selectable platform regions + own BYOC, minus wherever this
  // project already lives and any full box. A project on a specific server can
  // always be rescued back to the shared platform.
  const targets = moveTargets.filter((s) => !s.full && s.id !== p.worker_server_id);
  const canMoveToPlatform = !!p.worker_server_id;
  const canMove = targets.length > 0 || canMoveToPlatform;
  const moveLabel = moveTo === "platform"
    ? "Deployzy Cloud"
    : (() => { const s = targets.find((t) => t.id === moveTo); return s ? (s.is_byoc ? s.label : regionName(s.region, s.label)) : ""; })();

  const buildCustomized = !!(p.install_cmd || p.build_cmd || p.start_cmd || p.root_dir || p.node_version || p.port_override || p.memory_mb || p.cpus || p.health_check_path || p.release_cmd || p.dockerfile_path);

  const navItems = useMemo<SettingsNavItem[]>(() => [
    { id: "general", label: "General", icon: Settings2 },
    { id: "env", label: "Environment", icon: KeyRound },
    { id: "build", label: "Build & runtime", icon: Hammer },
    { id: "domains", label: "Domains", icon: Globe },
    ...(p.github_repo ? [{ id: "previews", label: "PR previews", icon: GitPullRequest }] : []),
    { id: "jobs", label: "Scheduled jobs", icon: Clock },
    { id: "danger", label: "Danger zone", icon: TriangleAlert, tone: "danger" as const },
  ], [p.github_repo]);

  return (
    <div className="lg:grid lg:grid-cols-[188px_minmax(0,1fr)] lg:gap-8">
      {/* Directory picker — writes back to root_dir or a service's dir */}
      {dirPicker && p.github_repo && (
        <DirectoryPicker
          repo={p.github_repo}
          branch={branch}
          initialPath={dirPicker.kind === "root" ? buildCfg.root_dir : (services[dirPicker.index]?.root_dir || "")}
          onClose={() => setDirPicker(null)}
          onSelect={async (path) => {
            const dp = dirPicker;
            if (dp.kind === "root") {
              setCfg({ root_dir: path });
            } else {
              const fw = await detectStackFor(p.github_repo, branch, path);
              setServices((prev) => prev.map((s, j) => (j === dp.index ? { ...s, root_dir: path, framework: fw } : s)));
            }
            setDirPicker(null);
          }}
        />
      )}

      <aside className="hidden lg:block">
        <div className="sticky top-20">
          <p className="eyebrow mb-2 px-3">Settings</p>
          <SettingsNav items={navItems} />
        </div>
      </aside>

      <div className="min-w-0 max-w-3xl space-y-4">
        {/* Phone jump row */}
        <nav aria-label="Sections" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden">
          {navItems.map(({ id, label, tone }) => (
            <a
              key={id}
              href={`#${id}`}
              onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
              className={cn(
                "inline-flex h-8 shrink-0 items-center rounded-full border border-[var(--dz-hairline)] px-3 text-[13px] font-medium",
                tone === "danger" ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
              )}
            >
              {label}
            </a>
          ))}
        </nav>

        {/* General */}
        <SettingsSection id="general" icon={Settings2} title="General" description="How this project deploys and how it's organised.">
          <div className="divide-y divide-[var(--dz-hairline)]">
            {p.github_repo && (
              <SettingRow
                title="Auto-deploy"
                description={<>Redeploy on every push to <code className="font-mono text-[12.5px] text-foreground">{branch}</code>.</>}
                control={<Switch checked={!!p.auto_deploy} disabled={togglingAutoDeploy} onChange={toggleAutoDeploy} label="Auto-deploy on push" />}
              />
            )}
            <div className="py-3.5 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium">Labels</p>
                  <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">Filter the Projects list by label. Up to 10.</p>
                </div>
                {!editingLabels && (
                  <button
                    type="button"
                    onClick={() => { setEditingLabels(true); setLabelDraft(p.labels || []); setLabelInput(""); setLabelNote(null); }}
                    className={cn(textBtn, "border border-[var(--dz-hairline)] hover:bg-foreground/[0.04]")}
                  >
                    <Tag className="h-3.5 w-3.5" /> {(p.labels || []).length ? "Edit" : "Add"}
                  </button>
                )}
              </div>
              {editingLabels ? (
                <div className="mt-3">
                  <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl border border-[var(--dz-hairline)] px-2 py-1.5 transition-[border-color,box-shadow] focus-within:border-brand/60 focus-within:ring-4 focus-within:ring-brand/10">
                    {labelDraft.map((l) => (
                      <span key={l} className="inline-flex h-7 items-center gap-1 rounded-full bg-foreground/[0.06] pl-2.5 pr-1 text-[13px] font-medium">
                        {l}
                        <button type="button" aria-label={`Remove ${l}`} onClick={() => setLabelDraft((d) => d.filter((x) => x !== l))} className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    <input
                      autoFocus
                      value={labelInput}
                      onChange={(e) => { const v = e.target.value; if (v.includes(",")) addLabels(v); else setLabelInput(v); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); if (labelInput.trim()) addLabels(labelInput); else saveLabels(); }
                        else if (e.key === "Backspace" && !labelInput) setLabelDraft((d) => d.slice(0, -1));
                        else if (e.key === "Escape") setEditingLabels(false);
                      }}
                      placeholder={labelDraft.length ? "" : "prod, api, client-work"}
                      aria-label="Add a label"
                      disabled={labelDraft.length >= 10}
                      className="h-7 min-w-[8rem] flex-1 border-0 px-1 text-[14px] outline-none"
                      style={{ background: "transparent" }}
                    />
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
                    <FooterNote note={labelNote} />
                    <span className="mr-auto text-[12.5px] text-muted-foreground">Press Enter or comma to add.</span>
                    <button type="button" onClick={() => setEditingLabels(false)} className="pill pill-line pill-sm">Cancel</button>
                    <button type="button" onClick={saveLabels} disabled={savingLabels} className="pill pill-ink pill-sm disabled:opacity-50">
                      {savingLabels && <Loader2 className="h-4 w-4 animate-spin" />} Save labels
                    </button>
                  </div>
                </div>
              ) : (p.labels || []).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(p.labels || []).map((l) => <Chip key={l}>{l}</Chip>)}
                </div>
              )}
            </div>
          </div>
        </SettingsSection>

        {/* Environment */}
        <EnvEditor
          id="env"
          initial={p.env_vars || {}}
          placeholder={ph.env}
          saving={savingEnv}
          note={envNote}
          onSave={saveEnvVars}
        />

        {/* Build & runtime */}
        <SettingsSection
          id="build"
          icon={Hammer}
          title="Build & runtime"
          description="Leave any field blank to use what we detect from your repo."
          action={buildCustomized ? <Chip tone="ok">Customized</Chip> : undefined}
          footer={
            <>
              <FooterNote note={buildNote} />
              <button type="button" onClick={() => saveBuildConfig(false)} disabled={savingBuild} className="pill pill-line pill-sm disabled:opacity-50">Save</button>
              <button type="button" onClick={() => saveBuildConfig(true)} disabled={savingBuild} className="pill pill-ink pill-sm disabled:opacity-50">
                {savingBuild && <Loader2 className="h-4 w-4 animate-spin" />} Save &amp; redeploy
              </button>
            </>
          }
        >
          <Group title="Commands" first>
            <div className="space-y-3.5">
              <Field label="Install" htmlFor="b-install">
                <input id="b-install" className={monoInputCls} placeholder={ph.install} value={buildCfg.install_cmd} onChange={(e) => setCfg({ install_cmd: e.target.value })} spellCheck={false} />
              </Field>
              <Field label="Build" htmlFor="b-build">
                <input id="b-build" className={monoInputCls} placeholder={ph.build} value={buildCfg.build_cmd} onChange={(e) => setCfg({ build_cmd: e.target.value })} spellCheck={false} />
              </Field>
              <Field label="Start" htmlFor="b-start">
                <input id="b-start" className={monoInputCls} placeholder={ph.start} value={buildCfg.start_cmd} onChange={(e) => setCfg({ start_cmd: e.target.value })} spellCheck={false} />
              </Field>
              <Field label="Release" htmlFor="b-release" hint="Runs before each start, e.g. database migrations.">
                <input id="b-release" className={monoInputCls} placeholder={ph.release} value={buildCfg.release_cmd} onChange={(e) => setCfg({ release_cmd: e.target.value })} spellCheck={false} />
              </Field>
            </div>
          </Group>

          <Group title="Source">
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="Root directory" htmlFor="b-root" hint="For monorepos.">
                <div className="relative">
                  <input id="b-root" className={cn(monoInputCls, "pr-10")} placeholder="apps/web" value={buildCfg.root_dir} onChange={(e) => setCfg({ root_dir: e.target.value })} spellCheck={false} />
                  <button
                    type="button"
                    title="Browse repository folders"
                    aria-label="Browse repository folders"
                    disabled={!p.github_repo}
                    onClick={() => setDirPicker({ kind: "root" })}
                    className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-40"
                  >
                    <Folder className="h-4 w-4" />
                  </button>
                </div>
              </Field>
              <Field label="Node version" htmlFor="b-node">
                <select id="b-node" className={selectCls} value={buildCfg.node_version} onChange={(e) => setCfg({ node_version: e.target.value })}>
                  <option value="">Default (20)</option>
                  <option value="18">Node 18</option>
                  <option value="20">Node 20</option>
                  <option value="22">Node 22</option>
                </select>
              </Field>
              <Field label="Build mode" htmlFor="b-mode">
                <select id="b-mode" className={selectCls} value={buildCfg.build_mode} onChange={(e) => setCfg({ build_mode: e.target.value })}>
                  <option value="">Auto (repo Dockerfile if present)</option>
                  <option value="ignore_dockerfile">Ignore repo Dockerfile</option>
                </select>
              </Field>
              <Field label="Dockerfile path" htmlFor="b-docker" hint="Empty means ./Dockerfile.">
                <input id="b-docker" className={monoInputCls} placeholder="Dockerfile" value={buildCfg.dockerfile_path} onChange={(e) => setCfg({ dockerfile_path: e.target.value })} spellCheck={false} />
              </Field>
            </div>
          </Group>

          <Group title="Resources">
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
              <Field label="Port" htmlFor="b-port" hint="Empty = auto">
                <input id="b-port" type="number" inputMode="numeric" min="0" max="65535" className={monoInputCls} placeholder="auto" value={buildCfg.port_override || ""} onChange={(e) => setCfg({ port_override: parseInt(e.target.value) || 0 })} />
              </Field>
              <Field label="Memory (MB)" htmlFor="b-mem" hint={memCap ? `Default ${Math.min(512, memCap)}, plan max ${memCap}` : "Default 512"}>
                <input
                  id="b-mem" type="number" inputMode="numeric" min="0" step="128" max={memCap || 16384}
                  className={monoInputCls} placeholder={String(memCap ? Math.min(512, memCap) : 512)} value={buildCfg.memory_mb || ""}
                  onChange={(e) => { const v = parseInt(e.target.value) || 0; setCfg({ memory_mb: memCap ? Math.min(v, memCap) : v }); }}
                />
              </Field>
              <Field label="CPUs" htmlFor="b-cpu" hint={cpuCap ? `Default ${Math.min(0.5, cpuCap)}, plan max ${cpuCap}` : "Default 0.5"} className="col-span-2 sm:col-span-1">
                <input
                  id="b-cpu" type="number" inputMode="decimal" min="0" step="0.25" max={cpuCap || 8}
                  className={monoInputCls} placeholder={String(cpuCap ? Math.min(0.5, cpuCap) : 0.5)} value={buildCfg.cpus || ""}
                  onChange={(e) => { const v = parseFloat(e.target.value) || 0; setCfg({ cpus: cpuCap ? Math.min(v, cpuCap) : v }); }}
                />
              </Field>
              <Field label="Health check path" htmlFor="b-health" hint="We wait for a 2xx here before switching traffic. Empty skips the check." className="col-span-2 sm:col-span-3">
                <input id="b-health" className={monoInputCls} placeholder={ph.healthCheck} value={buildCfg.health_check_path} onChange={(e) => setCfg({ health_check_path: e.target.value })} spellCheck={false} />
              </Field>
            </div>
          </Group>

          <Group title="Services">
            <div className="overflow-hidden rounded-2xl border border-[var(--dz-hairline)]">
              <div className="flex items-center justify-between gap-4 px-4 py-3.5">
                <div className="flex min-w-0 items-start gap-3">
                  <Layers className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium">Multiple services</p>
                    <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">Run several folders of this repo as services in one container.</p>
                  </div>
                </div>
                <Switch
                  checked={multiService}
                  label="Multiple services"
                  onChange={(next) => {
                    setMultiService(next);
                    if (next && services.length === 0) setServices([{ name: "service-1", root_dir: "", port: 3001, framework: "", install_cmd: "npm install", build_cmd: "npm run build", start_cmd: "npm run start", env_text: "" }]);
                  }}
                />
              </div>
              {multiService && (
                <div className="border-t border-[var(--dz-hairline)] p-3 sm:p-4">
                  <ServiceCards
                    services={services}
                    onChange={setServices}
                    subdomain={p.subdomain}
                    repoConnected={!!p.github_repo}
                    onBrowse={(i) => setDirPicker({ kind: "service", index: i })}
                    detectStack={(dir) => detectStackFor(p.github_repo, branch, dir)}
                  />
                </div>
              )}
            </div>
          </Group>
        </SettingsSection>

        {/* Domains */}
        <SettingsSection
          id="domains"
          icon={Globe}
          title="Custom domains"
          description={<>Your app is always live at <code className="font-mono text-[12.5px] text-foreground">{p.subdomain}.deployzy.app</code>.</>}
          action={
            <a href="/domains" className={cn(textBtn, "text-muted-foreground hover:text-foreground")}>
              All domains <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          }
        >
          {boundDomains.length > 0 && (
            <ul className="mb-3 space-y-2">
              {boundDomains.map((d) => (
                <li key={d.id} className="flex items-center gap-3 rounded-2xl border border-[var(--dz-hairline)] px-3.5 py-2.5">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", d.verified ? "bg-brand" : "bg-amber-500")} aria-hidden />
                  <a href={`https://${d.domain}`} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate font-mono text-[13.5px] hover:underline">{d.domain}</a>
                  {d.verified ? <Chip tone="ok">Verified</Chip> : <Chip tone="warn">Needs DNS</Chip>}
                  <button type="button" onClick={() => unbindDomain(d.id)} className={cn(textBtn, "h-7 px-2 text-muted-foreground hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400")}>
                    Unbind
                  </button>
                </li>
              ))}
            </ul>
          )}

          {pendingDns && (
            <div className="mb-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[14px] font-semibold">Point {pendingDns.domain} at Deployzy</p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">Add this record at your DNS provider, then verify it on the Domains page.</p>
                </div>
                <button type="button" aria-label="Dismiss" onClick={() => setPendingDns(null)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-3 grid gap-2 rounded-xl border border-[var(--dz-hairline)] bg-background p-3 font-mono text-[13px] sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1.3fr)] sm:items-center">
                <span className="eyebrow">CNAME</span>
                <span className="flex min-w-0 items-center gap-1"><span className="truncate">{pendingDns.domain}</span><CopyButton text={pendingDns.domain} label="Copy name" /></span>
                <ArrowRight className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
                <span className="flex min-w-0 items-center gap-1"><span className="truncate">{pendingDns.cname_target}</span><CopyButton text={pendingDns.cname_target} label="Copy target" /></span>
              </div>
              <a href="/domains" className="mt-3 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-[var(--dz-green-strong)] hover:opacity-80 dark:text-brand">
                Verify on the Domains page <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </div>
          )}

          <form
            onSubmit={(e) => { e.preventDefault(); addProjectDomain(); }}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <input
              value={newDomain}
              onChange={(e) => { setNewDomain(e.target.value); setDomainNote(null); }}
              placeholder="app.yourdomain.com"
              aria-label="Domain name"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className={monoInputCls}
            />
            <button type="submit" disabled={addingDomain || !newDomain.trim()} className="pill pill-ink pill-sm shrink-0 disabled:opacity-50">
              {addingDomain ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add domain
            </button>
          </form>
          {(domainNote || (unverifiedCount > 0 && !pendingDns)) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <FooterNote note={domainNote} />
              {unverifiedCount > 0 && !pendingDns && (
                <p className="text-[12.5px] text-muted-foreground">
                  {unverifiedCount} domain{unverifiedCount === 1 ? "" : "s"} waiting for DNS. <a href="/domains" className="font-medium text-foreground underline-offset-2 hover:underline">Verify them</a>
                </p>
              )}
            </div>
          )}
        </SettingsSection>

        {/* PR previews */}
        {p.github_repo && (
          <SettingsSection
            id="previews"
            icon={GitPullRequest}
            title="Pull request previews"
            description={<>Every open PR gets its own URL like <code className="font-mono text-[12.5px] text-foreground">{previewSubdomainExample(p.subdomain)}</code>. Closed PRs are removed.</>}
            action={<Switch checked={!!p.preview_enabled} disabled={togglingPreview} onChange={togglePreviewEnabled} label="Deploy pull request previews" />}
          >
            {!p.preview_enabled ? null : previews.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[var(--dz-hairline)] px-4 py-5 text-center text-[13.5px] text-muted-foreground">
                No open PRs yet. Open one on <span className="font-mono text-foreground">{p.github_repo}</span> and it shows up here.
              </p>
            ) : (
              <ul className="space-y-2">
                {previews.map((pv) => (
                  <li key={pv.id} className="flex items-center gap-3 rounded-2xl border border-[var(--dz-hairline)] px-3.5 py-2.5">
                    <span className="shrink-0 font-mono text-[13px] text-muted-foreground">#{pv.pr_number}</span>
                    <span className="min-w-0 flex-1 truncate text-[14px]">{pv.pr_title || pv.branch}</span>
                    {pv.commit_sha && <code className="hidden shrink-0 font-mono text-[12px] text-muted-foreground sm:inline">{pv.commit_sha.slice(0, 7)}</code>}
                    <StatusPill status={pv.status} />
                    {pv.status === "running" && (
                      <a href={`https://${pv.subdomain}.deployzy.app`} target="_blank" rel="noopener" aria-label={`Open preview for PR #${pv.pr_number}`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
                        <ArrowUpRight className="h-4 w-4" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </SettingsSection>
        )}

        {/* Scheduled jobs */}
        <SettingsSection
          id="jobs"
          icon={Clock}
          title="Scheduled jobs"
          description="Commands that run on a schedule in a fresh container with this project's env vars."
          action={!editingCron ? (
            <button type="button" onClick={() => { setEditingCron(true); setCronNote(null); }} className={cn(textBtn, "border border-[var(--dz-hairline)] hover:bg-foreground/[0.04]")}>
              <Plus className="h-3.5 w-3.5" /> New job
            </button>
          ) : undefined}
        >
          {crons.length === 0 && !editingCron && (
            <p className="rounded-2xl border border-dashed border-[var(--dz-hairline)] px-4 py-5 text-center text-[13.5px] text-muted-foreground">
              No jobs yet. Use them for backups, cleanups or reports.
            </p>
          )}

          {crons.length > 0 && (
            <ul className="space-y-2">
              {crons.map((c) => (
                <li key={c.id} className={cn("rounded-2xl border border-[var(--dz-hairline)] px-3.5 py-3", !c.enabled && "bg-foreground/[0.015]")}>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className={cn("truncate text-[14px] font-medium", !c.enabled && "text-muted-foreground")}>{c.name || "Untitled job"}</span>
                        <code className="rounded-md bg-foreground/[0.05] px-1.5 py-0.5 font-mono text-[12px]">{c.schedule}</code>
                        {c.last_status === "success" && <Chip tone="ok">Last run OK</Chip>}
                        {c.last_status === "failed" && <Chip tone="bad">Last run failed</Chip>}
                        {!c.enabled && <Chip>Paused</Chip>}
                      </div>
                      <code className="mt-1 block truncate font-mono text-[12.5px] text-muted-foreground">$ {c.command}</code>
                      {c.last_run_at && <p className="mt-1 text-[12.5px] text-muted-foreground">Last run {new Date(c.last_run_at).toLocaleString()}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Switch checked={c.enabled} onChange={() => toggleCron(c)} label={c.enabled ? `Pause ${c.name}` : `Resume ${c.name}`} />
                      <button
                        type="button"
                        aria-label={`Delete ${c.name || "job"}`}
                        onClick={() => setConfirmCron(confirmCron === c.id ? null : c.id)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {confirmCron === c.id && (
                    <div className="mt-3 flex items-center gap-2 rounded-xl bg-red-500/[0.06] py-1.5 pl-3 pr-1.5">
                      <span className="mr-auto text-[13px]">Delete this job?</span>
                      <button type="button" onClick={() => setConfirmCron(null)} className={cn(textBtn, "h-7 px-2.5 text-muted-foreground hover:text-foreground")}>Cancel</button>
                      <button type="button" onClick={() => deleteCron(c)} className={cn(textBtn, "h-7 bg-red-600 px-3 text-white hover:bg-red-700")}>Delete</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {editingCron && (
            <form
              onSubmit={(e) => { e.preventDefault(); addCron(); }}
              className={cn("rounded-2xl border border-[var(--dz-hairline)] bg-foreground/[0.015] p-4", crons.length > 0 && "mt-3")}
            >
              <p className="text-[14px] font-semibold">New job</p>
              <div className="mt-3 grid gap-3.5 sm:grid-cols-2">
                <Field label="Name" htmlFor="c-name">
                  <input id="c-name" className={inputCls} placeholder="nightly-backup" value={cronForm.name} onChange={(e) => setCronForm({ ...cronForm, name: e.target.value })} />
                </Field>
                <Field label="Schedule" htmlFor="c-sched" hint="minute hour day month weekday (UTC)">
                  <input id="c-sched" className={monoInputCls} placeholder="0 3 * * *" value={cronForm.schedule} onChange={(e) => setCronForm({ ...cronForm, schedule: e.target.value })} spellCheck={false} />
                </Field>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {CRON_PRESETS.map((pr) => (
                  <button
                    key={pr.value}
                    type="button"
                    onClick={() => setCronForm({ ...cronForm, schedule: pr.value })}
                    className={cn(
                      "h-7 rounded-full border px-2.5 text-[12.5px] font-medium transition-colors",
                      cronForm.schedule === pr.value ? "border-foreground bg-foreground text-background" : "border-[var(--dz-hairline)] text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {pr.label}
                  </button>
                ))}
              </div>
              <Field label="Command" htmlFor="c-cmd" className="mt-3.5">
                <input id="c-cmd" className={monoInputCls} placeholder="node scripts/cleanup.js" value={cronForm.command} onChange={(e) => { setCronForm({ ...cronForm, command: e.target.value }); setCronNote(null); }} spellCheck={false} />
              </Field>
              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                <FooterNote note={cronNote} />
                <button type="button" onClick={() => { setEditingCron(false); setCronNote(null); }} className="pill pill-line pill-sm">Cancel</button>
                <button type="submit" disabled={savingCron} className="pill pill-ink pill-sm disabled:opacity-50">
                  {savingCron && <Loader2 className="h-4 w-4 animate-spin" />} Create job
                </button>
              </div>
            </form>
          )}
        </SettingsSection>

        {/* Danger zone */}
        <SettingsSection id="danger" tone="danger" icon={TriangleAlert} title="Danger zone" description="These change where the project runs or remove it for good.">
          <div className="divide-y divide-red-500/15">
            {canMove && (
              <div className="py-4 first:pt-0">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium">Move to another server</p>
                    <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">Rebuild and run this project in another region or on one of your own servers.</p>
                  </div>
                  <select
                    aria-label="Destination server"
                    className={cn(selectCls, "sm:w-64")}
                    value={moveTo}
                    disabled={deploying}
                    onChange={(e) => setMoveTo(e.target.value)}
                  >
                    <option value="">Choose a destination…</option>
                    {canMoveToPlatform && <option value="platform">Deployzy Cloud (platform)</option>}
                    {targets.map((s) => (
                      <option key={s.id} value={s.id}>{s.is_byoc ? s.label : regionName(s.region, s.label)}</option>
                    ))}
                  </select>
                </div>
                {moveTo && (
                  <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-red-500/25 bg-background p-3 sm:flex-row sm:items-center">
                    <p className="text-[13.5px] sm:mr-auto">Move <span className="font-semibold">{p.name}</span> to <span className="font-semibold">{moveLabel}</span>? It redeploys there, with a short downtime.</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setMoveTo("")} className="pill pill-line pill-sm flex-1 sm:flex-none">Cancel</button>
                      <button
                        type="button"
                        disabled={deploying}
                        onClick={() => { const v = moveTo; setMoveTo(""); move(v); }}
                        className="pill pill-sm flex-1 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 sm:flex-none"
                      >
                        {deploying && <Loader2 className="h-4 w-4 animate-spin" />} Move project
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="py-4 first:pt-0 last:pb-0">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium">Delete this project</p>
                  <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">Removes the project, its container and deployments. This can&apos;t be undone.</p>
                </div>
                {!confirmDelete && (
                  <button
                    type="button"
                    onClick={() => { setConfirmDelete(true); setDeleteText(""); }}
                    className="pill pill-sm shrink-0 border border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" /> Delete project
                  </button>
                )}
              </div>
              {confirmDelete && (
                <div className="mt-3 rounded-2xl border border-red-500/25 bg-background p-4">
                  <label htmlFor="del-confirm" className="block text-[13.5px]">
                    Type <span className="font-mono font-semibold">{p.name}</span> to confirm.
                  </label>
                  <input
                    id="del-confirm"
                    autoFocus
                    value={deleteText}
                    onChange={(e) => setDeleteText(e.target.value)}
                    placeholder={p.name}
                    autoComplete="off"
                    spellCheck={false}
                    className={cn(monoInputCls, "mt-2 focus:border-red-500/60 focus:ring-red-500/10")}
                  />
                  <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button type="button" disabled={deleting} onClick={() => { setConfirmDelete(false); setDeleteText(""); }} className="pill pill-line pill-sm">Cancel</button>
                    <button
                      type="button"
                      disabled={deleteText.trim() !== p.name.trim() || deleting}
                      onClick={() => remove()}
                      className="pill pill-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-40"
                    >
                      {deleting ? <><Loader2 className="h-4 w-4 animate-spin" /> Deleting…</> : <><Trash2 className="h-4 w-4" /> Delete forever</>}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </SettingsSection>
      </div>
    </div>
  );
}
