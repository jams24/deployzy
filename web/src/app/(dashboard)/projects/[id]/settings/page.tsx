"use client";

// Settings tab — everything configurable about the project in one place:
// auto-deploy, labels, env vars, build & runtime (incl. multi-service),
// custom domains, PR previews, scheduled jobs, and the danger zone
// (move server / delete).

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Clock, Code, Folder, GitPullRequest, Globe, Layers, Loader2, Plus,
  RefreshCw, Settings2, Trash2,
} from "lucide-react";
import { DirectoryPicker } from "@/components/DirectoryPicker";
import { useProject } from "@/components/project/project-context";
import { ServiceCards } from "@/components/project/service-cards";
import {
  API, detectStackFor, headers, previewSubdomainExample,
  serviceToCfg, servicesPayload, statusColor,
  type BuildConfig, type Cron, type Domain, type MoveTarget, type Project, type ServiceCfg,
} from "@/components/project/project-shared";
import { getBuildPlaceholders } from "@/lib/placeholders";
import { autoFormatEnvText, parseEnvText } from "@/lib/parseEnvText";
import { regionName } from "@/lib/regions";

function Section({ title, icon: Icon, children, action }: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 text-muted-foreground" /> {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function ProjectSettingsPage() {
  const { project: p, refresh, deploy, move, remove, deploying, deleting } = useProject();
  const ph = getBuildPlaceholders(p.framework);

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
  const [labelsInput, setLabelsInput] = useState("");
  async function saveLabels() {
    const labels = labelsInput.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    await fetch(`${API}/api/v1/projects/${p.id}/labels`, {
      method: "PUT", headers: headers(), body: JSON.stringify({ labels }),
    });
    setEditingLabels(false);
    setLabelsInput("");
    refresh();
  }

  // ── Env vars ──
  // Initialized once from the fetched project; polls must not clobber typing.
  const [envText, setEnvText] = useState(() =>
    Object.entries(p.env_vars || {}).map(([k, v]) => `${k}=${v}`).join("\n"));
  const [savingEnv, setSavingEnv] = useState(false);
  async function saveEnvVars(redeploy: boolean) {
    setSavingEnv(true);
    await fetch(`${API}/api/v1/projects/${p.id}`, {
      method: "PUT", headers: headers(), body: JSON.stringify({ env_vars: parseEnvText(envText) }),
    });
    setSavingEnv(false);
    if (redeploy) deploy(); else refresh();
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
  const [multiService, setMultiService] = useState(() => (p.services || []).length > 0);
  const [services, setServices] = useState<ServiceCfg[]>(() => (p.services || []).map(serviceToCfg));
  const [savingBuild, setSavingBuild] = useState(false);
  const [planLimits, setPlanLimits] = useState<{ max_memory_mb: number; max_cpus: number } | null>(null);
  const [dirPicker, setDirPicker] = useState<{ kind: "root" } | { kind: "service"; index: number } | null>(null);

  useEffect(() => {
    fetch(`${API}/api/v1/users/me/limits`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.limits) setPlanLimits({ max_memory_mb: d.limits.max_memory_mb, max_cpus: d.limits.max_cpus }); })
      .catch(() => {});
  }, []);

  async function saveBuildConfig(redeploy: boolean) {
    setSavingBuild(true);
    try {
      const res = await fetch(`${API}/api/v1/projects/${p.id}/build-config`, {
        method: "PUT", headers: headers(),
        body: JSON.stringify({ ...buildCfg, services: servicesPayload(multiService, services) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        alert(err.error || "Failed to save build config");
        setSavingBuild(false);
        return;
      }
      if (redeploy) deploy(); else refresh();
    } catch {
      alert("Failed to save build config");
    }
    setSavingBuild(false);
  }

  // ── Custom domains ──
  const [allDomains, setAllDomains] = useState<Domain[]>([]);
  const [newDomain, setNewDomain] = useState("");
  const [addingDomain, setAddingDomain] = useState(false);

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
    setAddingDomain(true);
    try {
      // 1) Register domain
      const regRes = await fetch(`${API}/api/v1/domains`, {
        method: "POST", headers: headers(), body: JSON.stringify({ domain: d }),
      });
      if (!regRes.ok && regRes.status !== 409) {
        const err = await regRes.json().catch(() => ({ error: "Failed to add domain" }));
        alert(err.error || "Failed to add domain");
        setAddingDomain(false);
        return;
      }
      // 2) Fetch domain list to find the one we just added (or existing)
      const listRes = await fetch(`${API}/api/v1/domains`, { headers: headers() });
      const list: Domain[] = listRes.ok ? await listRes.json() : [];
      const row = list.find((x) => x.domain === d);
      if (!row) {
        alert("Domain registered but couldn't find it in the list — try again.");
        setAddingDomain(false);
        return;
      }
      // 3) If not verified yet, tell user to set the CNAME and verify from /domains.
      if (!row.verified) {
        alert(`Domain added. Now set a CNAME record:\n\n  ${d}  →  ${row.cname_target}\n\nThen go to /domains to click Verify.`);
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
      loadDomains();
    } catch {
      alert("Failed to add domain");
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
    if (!cronForm.schedule || !cronForm.command) { alert("Schedule and command are required"); return; }
    const res = await fetch(`${API}/api/v1/projects/${p.id}/crons`, {
      method: "POST", headers: headers(), body: JSON.stringify(cronForm),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed" }));
      alert(err.error || "Failed to create cron");
      return;
    }
    setCronForm({ name: "", schedule: "0 3 * * *", command: "" });
    setEditingCron(false);
    loadCrons();
  }
  async function toggleCron(c: Cron) {
    await fetch(`${API}/api/v1/projects/${c.project_id}/crons/${c.id}`, {
      method: "PUT", headers: headers(),
      body: JSON.stringify({ name: c.name, schedule: c.schedule, command: c.command, enabled: !c.enabled }),
    });
    loadCrons();
  }
  async function deleteCron(c: Cron) {
    if (!confirm(`Delete cron "${c.name}"?`)) return;
    await fetch(`${API}/api/v1/projects/${c.project_id}/crons/${c.id}`, {
      method: "DELETE", headers: headers(),
    });
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  const buildCustomized = !!(p.install_cmd || p.build_cmd || p.start_cmd || p.root_dir || p.node_version || p.port_override || p.memory_mb || p.cpus || p.health_check_path || p.release_cmd || p.dockerfile_path);

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Directory picker — writes back to root_dir or a service's dir */}
      {dirPicker && p.github_repo && (
        <DirectoryPicker
          repo={p.github_repo}
          branch={p.github_branch || p.branch || "main"}
          initialPath={dirPicker.kind === "root" ? buildCfg.root_dir : (services[dirPicker.index]?.root_dir || "")}
          onClose={() => setDirPicker(null)}
          onSelect={async (path) => {
            const dp = dirPicker;
            if (dp.kind === "root") {
              setBuildCfg((prev) => ({ ...prev, root_dir: path }));
            } else {
              const fw = await detectStackFor(p.github_repo, p.github_branch || p.branch || "main", path);
              setServices((prev) => prev.map((s, j) => (j === dp.index ? { ...s, root_dir: path, framework: fw } : s)));
            }
            setDirPicker(null);
          }}
        />
      )}

      {/* Auto-Deploy */}
      {p.github_repo && (
        <Section title="Auto-Deploy" icon={RefreshCw}>
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              Automatically redeploy when you push to <span className="font-mono font-medium text-foreground">{p.github_branch || p.branch || "main"}</span>
            </p>
            <button
              onClick={() => toggleAutoDeploy(!p.auto_deploy)}
              disabled={togglingAutoDeploy}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ${
                p.auto_deploy ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"
              } ${togglingAutoDeploy ? "opacity-50" : ""}`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-200 ${
                p.auto_deploy ? "translate-x-[18px]" : "translate-x-[3px]"
              }`} />
            </button>
          </div>
        </Section>
      )}

      {/* Labels */}
      <Section title="Labels" icon={Code}
        action={!editingLabels ? (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setEditingLabels(true); setLabelsInput((p.labels || []).join(", ")); }}>
            Edit
          </Button>
        ) : undefined}
      >
        {editingLabels ? (
          <div className="space-y-2">
            <label className="text-[10px] text-muted-foreground">Labels <span>(comma-separated, max 10)</span></label>
            <input type="text" value={labelsInput} onChange={(e) => setLabelsInput(e.target.value)} placeholder="prod, api, client-work" className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={saveLabels}>Save</Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingLabels(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 flex-wrap">
            {(p.labels || []).length === 0 ? (
              <span className="text-xs text-muted-foreground">No labels — labels power the filter bar on the Projects list.</span>
            ) : (
              (p.labels || []).map((l) => (
                <Badge key={l} variant="outline" className="text-[10px] text-blue-600 dark:text-blue-400 border-blue-500/40 bg-blue-500/5">{l}</Badge>
              ))
            )}
          </div>
        )}
      </Section>

      {/* Environment Variables */}
      <Section title="Environment Variables" icon={Code}
        action={
          <button
            type="button"
            onClick={() => setEnvText(autoFormatEnvText(envText))}
            disabled={!envText.trim()}
            className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Parse and rewrite as one KEY=VALUE per line. Recovers from pasted values with missing newlines."
          >
            Auto-format
          </button>
        }
      >
        <div className="space-y-3">
          <textarea
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            placeholder={ph.env}
            className="w-full h-40 rounded-md border border-input bg-muted px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground resize-y focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[10px] text-muted-foreground">KEY=VALUE format, one per line</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={savingEnv} onClick={() => saveEnvVars(false)}>Save</Button>
              <Button size="sm" className="h-7 text-xs" disabled={savingEnv} onClick={() => saveEnvVars(true)}>
                {savingEnv ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Save &amp; Redeploy
              </Button>
            </div>
          </div>
        </div>
      </Section>

      {/* Build & Runtime */}
      <Section title="Build &amp; Runtime" icon={Settings2}
        action={buildCustomized ? (
          <Badge variant="outline" className="text-[9px] text-emerald-600 dark:text-emerald-400 border-emerald-500/40">customized</Badge>
        ) : undefined}
      >
        <div className="space-y-3">
          <p className="text-[10px] text-muted-foreground">Leave blank to use defaults.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Root Directory <span>(monorepos)</span></label>
              <div className="relative">
                <input type="text" placeholder="apps/web" value={buildCfg.root_dir} onChange={(e) => setBuildCfg({ ...buildCfg, root_dir: e.target.value })} className="w-full h-8 rounded-md border border-input bg-muted pl-2 pr-8 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                <button type="button" title="Browse repository directories" disabled={!p.github_repo} onClick={() => setDirPicker({ kind: "root" })} className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-violet-500 hover:bg-accent disabled:opacity-40">
                  <Folder className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Node Version</label>
              <select value={buildCfg.node_version} onChange={(e) => setBuildCfg({ ...buildCfg, node_version: e.target.value })} className="w-full h-8 rounded-md border border-input bg-muted px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="">Default (20)</option>
                <option value="18">Node 18</option>
                <option value="20">Node 20</option>
                <option value="22">Node 22</option>
              </select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-[10px] text-muted-foreground">Install Command</label>
              <input type="text" placeholder={ph.install} value={buildCfg.install_cmd} onChange={(e) => setBuildCfg({ ...buildCfg, install_cmd: e.target.value })} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-[10px] text-muted-foreground">Build Command</label>
              <input type="text" placeholder={ph.build} value={buildCfg.build_cmd} onChange={(e) => setBuildCfg({ ...buildCfg, build_cmd: e.target.value })} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-[10px] text-muted-foreground">Start Command</label>
              <input type="text" placeholder={ph.start} value={buildCfg.start_cmd} onChange={(e) => setBuildCfg({ ...buildCfg, start_cmd: e.target.value })} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Port Override <span>(0 = auto)</span></label>
              <input type="number" min="0" max="65535" value={buildCfg.port_override || ""} onChange={(e) => setBuildCfg({ ...buildCfg, port_override: parseInt(e.target.value) || 0 })} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">
                Memory MB <span>(0 = {planLimits && planLimits.max_memory_mb > 0 ? Math.min(512, planLimits.max_memory_mb) : 512}{planLimits && planLimits.max_memory_mb > 0 ? `, plan max ${planLimits.max_memory_mb}` : ""})</span>
              </label>
              <input type="number" min="0" max={planLimits && planLimits.max_memory_mb > 0 ? planLimits.max_memory_mb : 16384} step="128" value={buildCfg.memory_mb || ""} onChange={(e) => { const v = parseInt(e.target.value) || 0; const cap = planLimits && planLimits.max_memory_mb > 0 ? planLimits.max_memory_mb : Infinity; setBuildCfg({ ...buildCfg, memory_mb: Math.min(v, cap) }); }} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">
                CPUs <span>(0 = {planLimits && planLimits.max_cpus > 0 ? Math.min(0.5, planLimits.max_cpus) : 0.5}{planLimits && planLimits.max_cpus > 0 ? `, plan max ${planLimits.max_cpus}` : ""})</span>
              </label>
              <input type="number" min="0" max={planLimits && planLimits.max_cpus > 0 ? planLimits.max_cpus : 8} step="0.25" value={buildCfg.cpus || ""} onChange={(e) => { const v = parseFloat(e.target.value) || 0; const cap = planLimits && planLimits.max_cpus > 0 ? planLimits.max_cpus : Infinity; setBuildCfg({ ...buildCfg, cpus: Math.min(v, cap) }); }} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-[10px] text-muted-foreground">Health Check Path <span>(e.g. /health; empty = skip)</span></label>
              <input type="text" placeholder={ph.healthCheck} value={buildCfg.health_check_path} onChange={(e) => setBuildCfg({ ...buildCfg, health_check_path: e.target.value })} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-[10px] text-muted-foreground">Release Command <span>(runs before start, e.g. migrations)</span></label>
              <input type="text" placeholder={ph.release} value={buildCfg.release_cmd} onChange={(e) => setBuildCfg({ ...buildCfg, release_cmd: e.target.value })} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-[10px] text-muted-foreground">Build Mode</label>
              <select value={buildCfg.build_mode} onChange={(e) => setBuildCfg({ ...buildCfg, build_mode: e.target.value })} className="w-full h-8 rounded-md border border-input bg-muted px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="">Auto (use repo Dockerfile if present)</option>
                <option value="ignore_dockerfile">Ignore repo Dockerfile — always auto-generate</option>
              </select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-[10px] text-muted-foreground">Dockerfile Path <span>(e.g. Dockerfile.bot; empty = Dockerfile)</span></label>
              <input type="text" placeholder="Dockerfile" value={buildCfg.dockerfile_path} onChange={(e) => setBuildCfg({ ...buildCfg, dockerfile_path: e.target.value })} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
          </div>

          {/* Multiple Services */}
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2.5">
              <div className="flex items-start gap-2">
                <Layers className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div>
                  <span className="text-xs font-medium">Multiple Services</span>
                  <p className="text-[10px] text-muted-foreground">Deploy multiple directories from this repository as services inside one container.</p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={multiService}
                onClick={() => {
                  const next = !multiService;
                  setMultiService(next);
                  if (next && services.length === 0) setServices([{ name: "service-1", root_dir: "", port: 3001, framework: "", install_cmd: "npm install", build_cmd: "npm run build", start_cmd: "npm run start", env_text: "" }]);
                }}
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${multiService ? "bg-violet-600" : "bg-zinc-300 dark:bg-zinc-700"}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${multiService ? "left-[18px]" : "left-0.5"}`} />
              </button>
            </div>
            {multiService && (
              <div className="border-t border-border/40 p-3">
                <ServiceCards
                  services={services}
                  onChange={setServices}
                  subdomain={p.subdomain}
                  repoConnected={!!p.github_repo}
                  onBrowse={(i) => setDirPicker({ kind: "service", index: i })}
                  detectStack={(dir) => detectStackFor(p.github_repo, p.github_branch || p.branch || "main", dir)}
                />
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <Button size="sm" className="h-7 text-xs" onClick={() => saveBuildConfig(true)} disabled={savingBuild}>
              {savingBuild ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Save &amp; Redeploy
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => saveBuildConfig(false)} disabled={savingBuild}>Save Only</Button>
          </div>
        </div>
      </Section>

      {/* Custom Domains */}
      <Section title="Custom Domains" icon={Globe}>
        <div className="space-y-2">
          {allDomains.filter((d) => d.target_type === "project" && d.target_subdomain === p.subdomain).map((d) => (
            <div key={d.id} className="flex items-center justify-between text-xs rounded-md bg-muted px-2.5 py-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <a href={`https://${d.domain}`} target="_blank" rel="noopener" className="font-mono text-foreground hover:text-foreground truncate">{d.domain}</a>
                {d.verified ? (
                  <Badge variant="outline" className="text-[9px] text-emerald-600 dark:text-emerald-400 border-emerald-500/40">verified</Badge>
                ) : (
                  <Badge variant="outline" className="text-[9px] text-amber-600 dark:text-amber-400 border-amber-500/40">needs CNAME</Badge>
                )}
              </div>
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] text-destructive hover:text-destructive" onClick={() => unbindDomain(d.id)}>Unbind</Button>
            </div>
          ))}
          {allDomains.filter((d) => !d.verified && !d.target_subdomain).length > 0 && (
            <div className="text-[10px] text-muted-foreground">
              <span>Pending verification — set CNAME, then verify at <a href="/domains" className="text-blue-600 dark:text-blue-400 hover:underline">/domains</a></span>
            </div>
          )}
          <div className="flex gap-1">
            <input
              type="text"
              placeholder="app.yourdomain.com"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              className="flex-1 h-7 rounded-md border border-input bg-muted px-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <Button size="sm" className="h-7 px-2 text-xs" onClick={addProjectDomain} disabled={addingDomain || !newDomain}>
              {addingDomain ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            </Button>
          </div>
        </div>
      </Section>

      {/* PR Previews */}
      {p.github_repo && (
        <Section title="Pull Request Previews" icon={GitPullRequest}
          action={
            <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                className="accent-emerald-500 h-3 w-3"
                checked={!!p.preview_enabled}
                disabled={togglingPreview}
                onChange={(e) => togglePreviewEnabled(e.target.checked)}
              />
              Auto-deploy PRs
            </label>
          }
        >
          {!p.preview_enabled ? (
            <p className="text-[10px] text-muted-foreground">Turn on to auto-deploy every open PR to a <code className="font-mono text-zinc-500">{previewSubdomainExample(p.subdomain)}</code> URL. Closed PRs are torn down automatically.</p>
          ) : previews.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">No open PRs with a preview. Open a PR on <span className="font-mono">{p.github_repo}</span> and it&apos;ll appear here.</p>
          ) : (
            <div className="space-y-1">
              {previews.map((pv) => (
                <div key={pv.id} className="flex items-center justify-between rounded-md bg-muted px-2.5 py-1.5 text-[11px] gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Badge variant="outline" className="text-[9px] text-blue-600 dark:text-blue-400 border-blue-500/40 shrink-0">#{pv.pr_number}</Badge>
                    <Badge variant="outline" className={`text-[9px] shrink-0 ${statusColor[pv.status] || ""}`}>{pv.status}</Badge>
                    <span className="truncate text-foreground">{pv.pr_title || pv.branch}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {pv.commit_sha && <code className="text-[9px] text-muted-foreground font-mono">{pv.commit_sha.slice(0, 7)}</code>}
                    {pv.status === "running" && (
                      <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] gap-1" nativeButton={false} render={<a href={`https://${pv.subdomain}.deployzy.app`} target="_blank" rel="noopener" />}>
                        Visit
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Scheduled Jobs */}
      <Section title="Scheduled Jobs" icon={Clock}
        action={
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1" onClick={() => setEditingCron(!editingCron)}>
            <Plus className="h-3 w-3" /> New job
          </Button>
        }
      >
        <div className="space-y-2">
          {crons.length === 0 && !editingCron && (
            <p className="text-[10px] text-muted-foreground">No scheduled jobs yet.</p>
          )}
          {crons.map((c) => (
            <div key={c.id} className="rounded-md bg-muted px-2.5 py-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${c.enabled ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-zinc-500/10 text-muted-foreground"}`}>{c.enabled ? "on" : "off"}</span>
                  <span className="text-xs font-medium truncate">{c.name}</span>
                  <code className="text-[10px] text-blue-400 font-mono">{c.schedule}</code>
                  {c.last_status === "success" && <Badge variant="outline" className="text-[9px] text-emerald-600 dark:text-emerald-400 border-emerald-500/40">success</Badge>}
                  {c.last_status === "failed" && <Badge variant="outline" className="text-[9px] text-red-500 border-red-500/40">failed</Badge>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => toggleCron(c)}>{c.enabled ? "Pause" : "Resume"}</Button>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-destructive hover:text-destructive" onClick={() => deleteCron(c)}>Delete</Button>
                </div>
              </div>
              <code className="block text-[10px] text-muted-foreground font-mono truncate">$ {c.command}</code>
              {c.last_run_at && (
                <div className="text-[10px] text-muted-foreground">Last run: {new Date(c.last_run_at).toLocaleString()}</div>
              )}
            </div>
          ))}
          {editingCron && (
            <div className="rounded-md border border-border/40 bg-muted p-2.5 space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground">Name</label>
                  <input type="text" placeholder="nightly-backup" value={cronForm.name} onChange={(e) => setCronForm({ ...cronForm, name: e.target.value })} className="w-full h-7 rounded-md border border-input bg-background px-2 font-mono text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground">Schedule <span>(cron: min hour day month dow)</span></label>
                  <input type="text" placeholder="0 3 * * *" value={cronForm.schedule} onChange={(e) => setCronForm({ ...cronForm, schedule: e.target.value })} className="w-full h-7 rounded-md border border-input bg-background px-2 font-mono text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">Command</label>
                <input type="text" placeholder="node scripts/cleanup.js" value={cronForm.command} onChange={(e) => setCronForm({ ...cronForm, command: e.target.value })} className="w-full h-7 rounded-md border border-input bg-background px-2 font-mono text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs" onClick={addCron}>Create</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingCron(false)}>Cancel</Button>
              </div>
              <p className="text-[10px] text-muted-foreground">Runs in a fresh container built from this project&apos;s image, with the same env vars. Stdout/stderr is captured and shown above.</p>
            </div>
          )}
        </div>
      </Section>

      {/* Danger Zone */}
      <section className="rounded-xl border border-red-500/40 bg-red-500/[0.03] p-4 sm:p-5 space-y-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-red-500">
          <Trash2 className="h-4 w-4" /> Danger Zone
        </h2>

        {/* Move server */}
        {(() => {
          // Destinations = selectable platform regions + own BYOC, minus wherever
          // this project already lives and any full box. A project on a specific
          // server can always be rescued back to the shared platform.
          const targets = moveTargets.filter((s) => !s.full && s.id !== p.worker_server_id);
          const canMoveToPlatform = !!p.worker_server_id;
          if (targets.length === 0 && !canMoveToPlatform) return null;
          return (
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-xs font-medium">Move to another server</p>
                <p className="text-[10px] text-muted-foreground">Migrate this project to a platform region or one of your own servers (Pro).</p>
              </div>
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                value=""
                disabled={deploying}
                onChange={(e) => { const v = e.target.value; e.currentTarget.value = ""; if (v) move(v); }}
              >
                <option value="">Move to…</option>
                {canMoveToPlatform && <option value="platform">Deployzy Cloud (platform)</option>}
                {targets.map((s) => (
                  <option key={s.id} value={s.id}>{s.is_byoc ? s.label : regionName(s.region, s.label)}</option>
                ))}
              </select>
            </div>
          );
        })()}

        {/* Delete */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs font-medium">Delete this project</p>
              <p className="text-[10px] text-muted-foreground">Permanently delete the project and its container. This cannot be undone.</p>
            </div>
            {!confirmDelete && (
              <Button variant="outline" size="sm" className="h-8 text-xs border-red-500/50 text-red-500 hover:bg-red-500/10 hover:text-red-500" onClick={() => { setConfirmDelete(true); setDeleteText(""); }}>
                <Trash2 className="h-3 w-3 mr-1" /> Delete project
              </Button>
            )}
          </div>
          {confirmDelete && (
            <div className="rounded-lg border border-red-500/50 bg-red-500/5 p-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                This will permanently delete <span className="font-semibold text-foreground">{p.name}</span> and its container. This action cannot be undone.
              </p>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">
                  Type <span className="font-mono font-semibold text-foreground">{p.name}</span> to confirm:
                </label>
                <Input
                  value={deleteText}
                  onChange={(e) => setDeleteText(e.target.value)}
                  placeholder={p.name}
                  className="h-8 text-sm font-mono"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-red-500/50 text-red-500 hover:bg-red-500/20 hover:text-red-500"
                  disabled={deleteText.trim() !== p.name.trim() || deleting}
                  onClick={() => remove()}
                >
                  {deleting
                    ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Deleting…</>
                    : <><Trash2 className="h-3 w-3 mr-1" /> Delete Forever</>}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={deleting} onClick={() => { setConfirmDelete(false); setDeleteText(""); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
