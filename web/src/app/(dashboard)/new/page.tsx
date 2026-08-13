"use client";

import { useEffect, useRef, useState } from "react";
import { showPlanLimit } from "@/components/upgrade-dialog";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RegionPicker } from "@/components/region-picker";
import { BrandLogo } from "@/components/brand-logos";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  GitBranch, Database, Container, Layers, Search, Rocket,
  ChevronRight, ChevronDown, Loader2, Globe, Server, Check, ArrowLeft, Settings2,
  Download, Sparkles, ExternalLink,
} from "lucide-react";
import { getBuildPlaceholders } from "@/lib/placeholders";
import { autoFormatEnvText, parseEnvText } from "@/lib/parseEnvText";
import { api, Template, EnvVarSchema } from "@/lib/api";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface GitHubRepo {
  id: number; name: string; full_name: string; private: boolean;
  description: string; language: string; default_branch: string;
  html_url: string;
}

const langColor: Record<string, string> = {
  JavaScript: "bg-yellow-400", TypeScript: "bg-blue-400", Python: "bg-green-400",
  Go: "bg-cyan-400", Rust: "bg-orange-400", Java: "bg-red-400",
  Ruby: "bg-red-500", PHP: "bg-violet-400", HTML: "bg-orange-500",
};

const options = [
  { id: "ai", title: "Build with AI", desc: "Describe it — we generate & deploy it", icon: Sparkles, color: "text-fuchsia-400 bg-fuchsia-500/20", category: "deploy" },
  { id: "github", title: "GitHub Repository", desc: "Deploy from a GitHub repo", icon: GitBranch, brand: "github", color: "text-violet-400 bg-violet-500/20", category: "deploy" },
  { id: "database", title: "Database", desc: "PostgreSQL instance with connection URL", icon: Database, color: "text-emerald-400 bg-emerald-500/20", category: "infra" },
  { id: "template", title: "Template", desc: "Start from a pre-built template", icon: Layers, color: "text-amber-400 bg-amber-500/20", category: "deploy" },
  { id: "docker", title: "Docker Image", desc: "Deploy a Docker Hub image", icon: Container, brand: "docker", color: "text-blue-400 bg-blue-500/20", category: "deploy" },
  { id: "domain", title: "Custom Domain", desc: "Connect your own domain", icon: Globe, color: "text-pink-400 bg-pink-500/10", category: "infra" },
  { id: "server", title: "SSH Server (BYOC)", desc: "Add your own server", icon: Server, color: "text-orange-400 bg-orange-500/20", category: "infra" },
];


// Turn a raw error log line into a short, human hint for the chat.
function shortErr(line: string): string {
  if (!line) return "The container didn't stay up. Check the logs on the project page.";
  const l = line.toLowerCase();
  if (l.includes("environment variable not set") || l.includes("token") && l.includes("not set"))
    return "It looks like a required key wasn't set (or was empty/invalid).";
  if (l.includes("unauthorized") || l.includes("invalid token") || l.includes("401"))
    return "A key was rejected — double-check the token/API key you provided.";
  if (l.includes("econnrefused") || l.includes("connect") && l.includes("refused"))
    return "It couldn't reach a service it needs (maybe a database or external API).";
  return line.length > 200 ? line.slice(0, 200) + "…" : line;
}

function detectFramework(language: string | null): string {
  switch (language) {
    case "TypeScript": case "JavaScript": return "node";
    case "Python": return "python";
    case "Go": return "docker";
    case "HTML": case "CSS": return "static";
    default: return "node";
  }
}

export default function NewResourcePage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [step, setStep] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // GitHub
  const [ghConnected, setGhConnected] = useState(false);
  const [ghRepos, setGhRepos] = useState<GitHubRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);

  // Configure project (shared by github, template, docker)
  const [projectName, setProjectName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  // Live subdomain availability preview (Vercel/Railway style).
  const [subCheck, setSubCheck] = useState<{ checking: boolean; available: boolean; suggestion: string; reason: string } | null>(null);
  const [envText, setEnvText] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [framework, setFramework] = useState("node");
  const [githubRepo, setGithubRepo] = useState("");

  // Advanced build settings (optional)
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [installCmd, setInstallCmd] = useState("");
  const [buildCmd, setBuildCmd] = useState("");
  const [startCmd, setStartCmd] = useState("");
  const [rootDir, setRootDir] = useState("");
  const [nodeVersion, setNodeVersion] = useState("");
  const [portOverride, setPortOverride] = useState(0);
  const [memoryMB, setMemoryMB] = useState(0);
  const [cpus, setCpus] = useState(0);
  const [healthCheckPath, setHealthCheckPath] = useState("");
  const [releaseCmd, setReleaseCmd] = useState("");

  // Docker image
  const [dockerImage, setDockerImage] = useState("");

  // AI builder — streaming chat model
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerator, setAiGenerator] = useState("portfolio");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiChat, setAiChat] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [aiPhase, setAiPhase] = useState<null | "generating" | "building">(null);
  const [aiLogs, setAiLogs] = useState<{ level: string; message: string; created_at: string }[]>([]);
  const [aiActivePid, setAiActivePid] = useState<string | null>(null);
  const [aiSetup, setAiSetup] = useState<{ projectId: string; url: string; summary: string; vars: { key: string; description: string }[]; needsDb: boolean; dbType: string } | null>(null);
  const [aiEnvValues, setAiEnvValues] = useState<Record<string, string>>({});
  const [aiDbChoice, setAiDbChoice] = useState("postgres");
  const [aiResult, setAiResult] = useState<{ ok: boolean; url: string; summary: string; error?: string; isSite: boolean } | null>(null);
  // the current code-gen project being iterated on — follow-up messages edit it
  const [aiCurrentProject, setAiCurrentProject] = useState<{ id: string; sub: string } | null>(null);
  const aiMetaRef = useRef<{ url: string; summary: string; isSite: boolean }>({ url: "", summary: "", isSite: false });
  const aiScrollRef = useRef<HTMLDivElement>(null);

  // Template picker (API-backed)
  const [apiTemplates, setApiTemplates]         = useState<Template[]>([]);
  const [templateSearch, setTemplateSearch]     = useState("");
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [templateEnvVars, setTemplateEnvVars]   = useState<Record<string, string>>({});
  const [templateName, setTemplateName]         = useState("");
  const [templateServer, setTemplateServer]     = useState("");
  const [templateDeploying, setTemplateDeploying] = useState(false);
  const [templateError, setTemplateError]       = useState("");

  // Database
  const [dbName, setDbName] = useState("");
  const [dbType, setDbType] = useState("postgres"); // only postgres is provisionable today
  const [dbTargetServer, setDbTargetServer] = useState(""); // "" = platform, else worker_server_id

  // Servers
  const [userServers, setUserServers] = useState<{ id: string; label: string; host: string; status: string; total_memory_mb?: number; total_cpu?: number }[]>([]);
  const [selectedServer, setSelectedServer] = useState("");

  // Plan limits (used to show real resource caps in the advanced form)
  const [planLimits, setPlanLimits] = useState<{ max_memory_mb: number; max_cpus: number; allow_advanced_databases?: boolean; allow_db_migration?: boolean; max_db_size_mb?: number } | null>(null);
  // Migration ("bring your own database") sub-form state.
  const [showMigrate, setShowMigrate] = useState(false);
  const [migType, setMigType] = useState("postgres");
  const [migUrl, setMigUrl] = useState("");
  const [migName, setMigName] = useState("");
  const [migrating, setMigrating] = useState(false);
  const [migJob, setMigJob] = useState<{ id: string; status: string; error?: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const headers = () => {
    const token = localStorage.getItem("sm_token");
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };

  useEffect(() => {
    // Check GitHub connection
    fetch(`${API}/api/v1/github/status`, { headers: headers() })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setGhConnected(!!data.connected); })
      .catch(() => {});
    // Load BYOC servers
    fetch(`${API}/api/v1/servers`, { headers: headers() })
      .then(r => r.ok ? r.json() : [])
      .then(data => setUserServers(Array.isArray(data) ? data : []))
      .catch(() => {});
    // Load plan limits so the advanced form can show real caps
    fetch(`${API}/api/v1/users/me/limits`, { headers: headers() })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.limits) { setPlanLimits({ max_memory_mb: data.limits.max_memory_mb, max_cpus: data.limits.max_cpus, allow_advanced_databases: data.limits.allow_advanced_databases, allow_db_migration: data.limits.allow_db_migration, max_db_size_mb: data.limits.max_db_size_mb }); setIsAdmin(!!data.is_admin); } })
      .catch(() => {});
  }, []);

  // Debounced availability check for the subdomain field. Shows whether the
  // name is free, or the auto-generated variant the deploy would use instead.
  useEffect(() => {
    if (step !== "configure" && step !== "docker") return;
    const value = subdomain.trim();
    if (!value) { setSubCheck(null); return; }
    setSubCheck((c) => ({ checking: true, available: c?.available ?? false, suggestion: c?.suggestion ?? "", reason: c?.reason ?? "" }));
    const t = setTimeout(() => {
      fetch(`${API}/api/v1/subdomains/check?subdomain=${encodeURIComponent(value)}`, { headers: headers() })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) { setSubCheck(null); return; }
          setSubCheck({ checking: false, available: !!d.available, suggestion: d.suggestion || d.slug || value, reason: d.reason || "" });
        })
        .catch(() => setSubCheck(null));
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subdomain, step]);

  async function loadRepos() {
    setLoadingRepos(true);
    try {
      const res = await fetch(`${API}/api/v1/github/repos`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setGhRepos(Array.isArray(data) ? data : []);
      }
    } catch {}
    setLoadingRepos(false);
  }

  function selectRepo(repo: GitHubRepo) {
    setSelectedRepo(repo);
    setProjectName(repo.name);
    setSubdomain(repo.name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-"));
    setRepoUrl(repo.html_url + ".git");
    setBranch(repo.default_branch || "main");
    setGithubRepo(repo.full_name);
    setFramework(detectFramework(repo.language));
    setEnvText("");
    setInstallCmd(""); setBuildCmd(""); setStartCmd("");
    setRootDir(""); setNodeVersion("");
    setPortOverride(0); setMemoryMB(0); setCpus(0);
    setHealthCheckPath(""); setReleaseCmd("");
    setShowAdvanced(false);
    setStep("configure");
  }

function startDocker() {
    setSelectedRepo(null);
    setProjectName("");
    setSubdomain("");
    setRepoUrl("");
    setDockerImage("");
    setEnvText("");
    setInstallCmd(""); setBuildCmd(""); setStartCmd("");
    setRootDir(""); setNodeVersion("");
    setPortOverride(0); setMemoryMB(0); setCpus(0);
    setHealthCheckPath(""); setReleaseCmd("");
    setShowAdvanced(false);
    setStep("docker");
  }

  async function deployProject() {
    if (!projectName || !subdomain) return;
    setCreating(true);

    const body: Record<string, string | undefined> = {
      name: projectName,
      subdomain,
      framework,
      repo_url: repoUrl || undefined,
      branch: branch || "main",
      github_repo: githubRepo || undefined,
      worker_server_id: selectedServer || undefined,
    };

    const res = await fetch(`${API}/api/v1/projects`, {
      method: "POST", headers: headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed" }));
      const msg = err.error || "Failed to create project";
      if (!showPlanLimit(msg)) alert(msg);
      setCreating(false);
      return;
    }

    const project = await res.json();

    // Set env vars if provided
    if (envText.trim()) {
      const envVars = parseEnvText(envText);
      await fetch(`${API}/api/v1/projects/${project.id}`, {
        method: "PUT", headers: headers(),
        body: JSON.stringify({ env_vars: envVars }),
      });
    }

    // Set build config if any advanced setting was customized — must happen
    // before /deploy so the first build picks it up.
    if (installCmd || buildCmd || startCmd || rootDir || nodeVersion || portOverride || memoryMB || cpus || healthCheckPath || releaseCmd) {
      await fetch(`${API}/api/v1/projects/${project.id}/build-config`, {
        method: "PUT", headers: headers(),
        body: JSON.stringify({
          install_cmd: installCmd, build_cmd: buildCmd, start_cmd: startCmd,
          root_dir: rootDir, node_version: nodeVersion,
          port_override: portOverride, memory_mb: memoryMB, cpus,
          health_check_path: healthCheckPath, release_cmd: releaseCmd,
        }),
      });
    }

    // Deploy
    await fetch(`${API}/api/v1/projects/${project.id}/deploy`, {
      method: "POST", headers: headers(),
    });

    router.push("/projects");
  }

  async function createDatabase() {
    if (!dbName) return;
    setCreating(true);
    try {
      const res = await fetch(`${API}/api/v1/services`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ name: dbName, type: dbType, worker_server_id: dbTargetServer || undefined }),
      });
      if (res.ok) router.push("/services");
      else {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        const msg = err.error || "Failed to create database";
        if (!showPlanLimit(msg)) alert(msg);
      }
    } catch {}
    setCreating(false);
  }

  async function startMigration() {
    if (!migUrl.trim()) return;
    setMigrating(true);
    setMigJob(null);
    try {
      const res = await fetch(`${API}/api/v1/migrations`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ source_type: migType, source_url: migUrl.trim(), target_name: migName.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data.error || "Failed to start migration";
        if (!showPlanLimit(msg)) alert(msg);
        setMigrating(false);
        return;
      }
      // Poll the job until it finishes.
      const jobId = data.migration.id;
      setMigJob({ id: jobId, status: "running" });
      const poll = setInterval(async () => {
        try {
          const jr = await fetch(`${API}/api/v1/migrations/${jobId}`, { headers: headers() });
          if (jr.ok) {
            const job = await jr.json();
            setMigJob(job);
            if (job.status === "success" || job.status === "failed") {
              clearInterval(poll);
              setMigrating(false);
              if (job.status === "success") setTimeout(() => router.push("/services"), 1500);
            }
          }
        } catch {}
      }, 3000);
    } catch {
      setMigrating(false);
    }
  }

  async function deployTemplate() {
    if (!selectedTemplate || !templateName.trim()) return;
    setTemplateDeploying(true);
    setTemplateError("");
    try {
      const payload: { name: string; env_vars: Record<string, string>; worker_server_id?: string } = {
        name: templateName,
        env_vars: templateEnvVars,
      };
      if (templateServer) {
        payload.worker_server_id = templateServer;
      }
      await api.deployFromTemplate(selectedTemplate.slug, payload);
      router.push("/projects");
    } catch (e: unknown) {
      setTemplateError(e instanceof Error ? e.message : "Deploy failed");
      setTemplateDeploying(false);
    }
  }

  // Deep-link support: /new?type=database opens the database form directly
  // (used by the "New Database" button) instead of the resource picker.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("type");
    if (t === "database") { setDbName(""); setStep("database"); }
  }, []);

  function handleSelect(id: string) {
    switch (id) {
      case "github":
        if (!ghConnected) { window.location.href = `${API}/api/v1/github/connect`; return; }
        loadRepos();
        setRepoSearch("");
        setStep("github");
        break;
      case "database": setDbName(""); setStep("database"); break;
      case "template":
        setTemplateSearch("");
        setSelectedTemplate(null);
        setTemplateEnvVars({});
        setTemplateError("");
        setTemplatesLoading(true);
        setStep("template");
        api.listTemplates({ sort: "popular", limit: 50 })
          .then((res) => setApiTemplates(res.templates ?? []))
          .catch(() => {})
          .finally(() => setTemplatesLoading(false));
        break;
      case "ai": setAiPrompt(""); setAiChat([]); setAiResult(null); setAiSetup(null); setAiLogs([]); setAiPhase(null); setAiActivePid(null); setAiCurrentProject(null); setStep("ai"); break;
      case "docker": startDocker(); break;
      case "domain": router.push("/domains"); break;
      case "server": router.push("/servers"); break;
    }
  }

  const pushAssistant = (text: string) => setAiChat((c) => [...c, { role: "assistant" as const, text }]);
  const isCodegenGen = (g: string) => ["api", "telegram-bot", "discord-bot", "worker"].includes(g);

  // Edit the current code-gen project instead of building a new one.
  async function editCurrentProject(instruction: string) {
    if (!aiCurrentProject) return;
    setAiChat((c) => [...c, { role: "user", text: instruction }]);
    setAiPrompt("");
    setAiBusy(true); setAiPhase("generating"); setAiResult(null); setAiSetup(null); setAiLogs([]);
    try {
      const res = await fetch(`${API}/api/v1/ai/edit`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ project_id: aiCurrentProject.id, instruction }),
      });
      const data = await res.json();
      if (!res.ok) { pushAssistant("❌ " + (data.error || "Couldn't apply that change.")); setAiPhase(null); setAiBusy(false); return; }
      pushAssistant(`Applying your change${data.summary ? ` — ${data.summary}` : ""}. Redeploying…`);
      setAiPhase("building"); setAiActivePid(aiCurrentProject.id);
    } catch {
      pushAssistant("❌ Something went wrong — please try again.");
      setAiPhase(null);
    }
    setAiBusy(false);
  }

  async function runAIBuild() {
    const p = aiPrompt.trim();
    if (!p || aiBusy) return;
    // Follow-up messages iterate on the current code-gen project.
    if (aiCurrentProject && isCodegenGen(aiGenerator)) { editCurrentProject(p); return; }
    setAiChat((c) => [...c, { role: "user", text: p }]);
    setAiPrompt("");
    setAiBusy(true); setAiPhase("generating"); setAiResult(null); setAiSetup(null); setAiLogs([]);
    try {
      const res = await fetch(`${API}/api/v1/ai/build`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ generator: aiGenerator, prompt: p }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) showPlanLimit(data.error || "Plan limit reached");
        else pushAssistant("❌ " + (data.error || "That didn't work — try rephrasing your idea."));
        setAiPhase(null); setAiBusy(false); return;
      }
      aiMetaRef.current = { url: data.url, summary: data.summary || "your project", isSite: !isCodegenGen(aiGenerator) };
      if (data.status === "needs_setup") {
        setAiPhase(null);
        const bits: string[] = [];
        if ((data.env_vars || []).length) bits.push(`${data.env_vars.length} secret${data.env_vars.length > 1 ? "s" : ""}`);
        if (data.needs_database) bits.push(`a ${data.database_type} database`);
        pushAssistant(`Here's the plan: ${data.summary}\n\nBefore I deploy it, I need ${bits.join(" and ")}. Grant below 👇`);
        setAiSetup({
          projectId: data.project?.id, url: data.url, summary: data.summary || "",
          vars: (data.env_vars || []).map((e: { key: string; description: string }) => ({ key: e.key, description: e.description })),
          needsDb: !!data.needs_database, dbType: data.database_type || "postgres",
        });
        setAiEnvValues({}); setAiDbChoice(data.database_type || "postgres");
      } else {
        pushAssistant(`On it — building "${data.summary || "your project"}". Streaming the logs below…`);
        setAiPhase("building"); setAiActivePid(data.project?.id);
        if (isCodegenGen(aiGenerator)) setAiCurrentProject({ id: data.project?.id, sub: data.project?.subdomain });
      }
    } catch {
      pushAssistant("❌ Something went wrong — please try again.");
      setAiPhase(null);
    }
    setAiBusy(false);
  }

  async function grantAndDeploy() {
    if (!aiSetup || aiBusy) return;
    setAiBusy(true);
    try {
      const res = await fetch(`${API}/api/v1/ai/deploy`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({
          project_id: aiSetup.projectId, prompt: aiChat.filter(m => m.role === "user").slice(-1)[0]?.text || "",
          env: aiEnvValues, database: aiSetup.needsDb ? aiDbChoice : "",
        }),
      });
      const data = await res.json();
      if (!res.ok) { pushAssistant("❌ " + (data.error || "Deploy failed.")); setAiBusy(false); return; }
      pushAssistant("Thanks — deploying now. Streaming the logs below…");
      setAiCurrentProject({ id: aiSetup.projectId, sub: "" });
      setAiSetup(null); setAiPhase("building"); setAiActivePid(aiSetup.projectId);
    } catch {
      pushAssistant("❌ Deploy failed — please try again.");
    }
    setAiBusy(false);
  }

  // Stream deploy logs + detect terminal state while a build is active.
  useEffect(() => {
    if (!aiActivePid) return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`${API}/api/v1/projects/${aiActivePid}`, { headers: headers() });
        if (!res.ok) return;
        const data = await res.json();
        const logs = (data.logs || []).slice().reverse(); // chronological
        setAiLogs(logs);
        const st = data.project?.status;
        if (st === "running" || st === "failed" || st === "crashed") {
          if (stopped) return;
          stopped = true;
          const ok = st === "running";
          const meta = aiMetaRef.current;
          const errLine = logs.filter((l: { level: string }) => l.level === "error").slice(-1)[0]?.message || "";
          setAiPhase(null); setAiActivePid(null);
          setAiResult({ ok, url: meta.url, summary: meta.summary, isSite: meta.isSite, error: ok ? undefined : errLine });
          if (ok) pushAssistant(meta.isSite ? `✅ Done! Your site is live at ${meta.url}` : `✅ Deployed and running. ${meta.url ? "Live at " + meta.url : ""}`);
          else pushAssistant(`❌ It failed to start.\n\n${shortErr(errLine)}\n\nTell me a fix (e.g. a valid key) or a change and I'll rebuild.`);
        }
      } catch {}
    };
    const iv = setInterval(tick, 1800);
    tick();
    return () => { stopped = true; clearInterval(iv); };
  }, [aiActivePid]);

  // Auto-scroll the chat as it grows.
  useEffect(() => {
    const el = aiScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [aiChat, aiLogs, aiSetup, aiResult, aiPhase]);

  const filtered = options.filter(o =>
    !search || o.title.toLowerCase().includes(search.toLowerCase()) || o.desc.toLowerCase().includes(search.toLowerCase())
  );

  const filteredRepos = ghRepos.filter(r =>
    !repoSearch || r.name.toLowerCase().includes(repoSearch.toLowerCase()) || r.full_name.toLowerCase().includes(repoSearch.toLowerCase())
  );

  const BackButton = () => (
    <button onClick={() => setStep(null)} className="text-xs text-muted-foreground hover:text-foreground mb-4 flex items-center gap-1">
      <ArrowLeft className="h-3 w-3" /> Back
    </button>
  );

  // Effective resource caps for the advanced form: on a BYOC server the limit is
  // the server's own capacity (no plan cap — you're paying for that box);
  // otherwise the plan max (0 = unlimited, e.g. admin).
  const byocSrv = userServers.find((s) => s.id === selectedServer);
  const memCap = byocSrv?.total_memory_mb || (planLimits && planLimits.max_memory_mb > 0 ? planLimits.max_memory_mb : 0);
  const cpuCap = byocSrv?.total_cpu || (planLimits && planLimits.max_cpus > 0 ? planLimits.max_cpus : 0);
  const capLabel = byocSrv ? "server max" : "plan max";

  // ── Step: Build with AI ──
  if (step === "ai") {
    const generators = [
      { id: "portfolio", label: "Portfolio", ready: true },
      { id: "landing", label: "Landing page", ready: true },
      { id: "api", label: "API / microservice", ready: true },
      { id: "telegram-bot", label: "Telegram bot", ready: true },
      { id: "discord-bot", label: "Discord bot", ready: true },
      { id: "worker", label: "Worker / job", ready: true },
    ];
    const examplesByGen: Record<string, string[]> = {
      portfolio: [
        "A portfolio for a self-taught Go backend engineer from Lagos who built a message queue",
        "A minimal portfolio for a UX designer who works on fintech apps",
        "A portfolio for a data scientist doing ML for climate, published research, loves Python",
      ],
      landing: [
        "Landing page for a SaaS that turns receipts into expense reports, with pricing and FAQ",
        "Landing page for an AI note-taking app for students, playful and colorful",
        "Landing page for a dev tool that monitors cron jobs, with 3 pricing tiers",
      ],
      api: [
        "A TypeScript REST API with /health, and /quote returning a random programming quote",
        "A URL shortener API in TypeScript with in-memory storage",
        "A Python API that converts currencies using a built-in rates table",
      ],
      "telegram-bot": [
        "A meme bot: /meme sends a random meme, /joke tells a programming joke",
        "A crypto price alert bot: /price BTC shows the price from CoinGecko",
        "A reminder bot: /remind <minutes> <text> pings you after the delay",
      ],
      "discord-bot": [
        "A Discord bot with /roll dice and /8ball fortune commands",
        "A Discord welcome bot that greets new members",
      ],
      worker: [
        "A worker that logs a heartbeat every 30 seconds",
        "A Python job that fetches an RSS feed every 10 minutes and prints new items",
      ],
    };
    const examples = examplesByGen[aiGenerator] || examplesByGen.portfolio;
    return (
      <div className="max-w-2xl mx-auto mt-6 flex flex-col h-[calc(100vh-150px)]">
        <BackButton />
        <div className="flex items-center gap-3 mb-3">
          <div className="h-9 w-9 rounded-xl bg-fuchsia-500/20 text-fuchsia-400 grid place-items-center">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-xl font-bold leading-tight">Build with AI</h1>
            <p className="text-xs text-muted-foreground">Describe it in plain English — I&apos;ll generate, deploy, and stream the logs.</p>
          </div>
        </div>

        <div className="flex gap-1.5 flex-wrap mb-3 items-center">
          {generators.map((g) => (
            <button key={g.id} disabled={!g.ready || aiChat.length > 0}
              onClick={() => g.ready && setAiGenerator(g.id)}
              className={`h-7 px-3 rounded-full text-xs border transition-colors disabled:opacity-40 ${
                aiGenerator === g.id ? "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/50"
                : "border-border/60 text-muted-foreground hover:bg-accent/40"}`}>
              {g.label}
            </button>
          ))}
          {aiChat.length > 0 && (
            <button onClick={() => { setAiChat([]); setAiResult(null); setAiSetup(null); setAiLogs([]); setAiPhase(null); setAiActivePid(null); setAiCurrentProject(null); }}
              className="h-7 px-3 rounded-full text-xs border border-border/60 text-muted-foreground hover:bg-accent/40 ml-auto">
              + New build
            </button>
          )}
        </div>
        {aiCurrentProject && !aiPhase && (
          <p className="text-[11px] text-muted-foreground mb-2">✏️ Editing <span className="font-mono">{aiCurrentProject.sub || "your project"}</span> — describe a change, or start a “+ New build”.</p>
        )}

        <div ref={aiScrollRef} className="flex-1 overflow-y-auto rounded-xl border border-border/60 bg-background/50 p-4 space-y-3">
          {aiChat.length === 0 && !aiPhase && (
            <div className="text-sm text-muted-foreground">
              <p className="mb-3">Try one of these, or write your own:</p>
              <div className="flex flex-col gap-1.5">
                {examples.map((ex, i) => (
                  <button key={i} onClick={() => setAiPrompt(ex)}
                    className="text-left text-[13px] border border-border/40 rounded-lg px-3 py-2 hover:bg-accent/40 transition-colors">
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {aiChat.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                m.role === "user" ? "bg-fuchsia-500/20 text-foreground" : "bg-muted/60 text-foreground"}`}>
                {m.text}
              </div>
            </div>
          ))}

          {aiPhase === "generating" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Generating code…
            </div>
          )}

          {aiLogs.length > 0 && (
            <div className="rounded-lg border border-white/[0.08] bg-[#0d1117] overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.08] bg-[#161b22] text-[10px] font-mono text-muted-foreground">
                {aiPhase === "building"
                  ? <><span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" /> streaming build logs…</>
                  : <>build logs</>}
              </div>
              <div className="p-2 font-mono text-[11px] max-h-56 overflow-y-auto space-y-0.5">
                {aiLogs.map((l, i) => (
                  <div key={i} className={
                    l.level === "error" ? "text-[#f85149]" : l.level === "deploy" ? "text-[#3fb950]" : "text-[#d29922]"}>
                    {l.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {aiSetup && (
            <Card className="border-fuchsia-500/40">
              <CardContent className="p-4 space-y-3">
                {aiSetup.vars.map((v) => (
                  <div key={v.key}>
                    <label className="text-xs font-mono font-medium">{v.key}</label>
                    {v.description && <p className="text-[11px] text-muted-foreground mb-1">{v.description}</p>}
                    <Input type="password" value={aiEnvValues[v.key] || ""}
                      onChange={(e) => setAiEnvValues({ ...aiEnvValues, [v.key]: e.target.value })}
                      placeholder={`Paste your ${v.key}…`} className="font-mono text-sm" />
                  </div>
                ))}
                {aiSetup.needsDb && (
                  <div>
                    <label className="text-xs font-medium">Database</label>
                    <p className="text-[11px] text-muted-foreground mb-1.5">This app needs storage — pick one (PostgreSQL is the default). I&apos;ll provision it and wire up DATABASE_URL.</p>
                    <div className="flex gap-1.5 flex-wrap">
                      {["postgres", "redis", "mongodb", "mysql"].map((t) => (
                        <button key={t} onClick={() => setAiDbChoice(t)}
                          className={`h-8 px-3 rounded-lg text-xs border capitalize ${aiDbChoice === t ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/50" : "border-border/60 text-muted-foreground hover:bg-accent/40"}`}>
                          {t === "postgres" ? "PostgreSQL" : t}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <Button onClick={grantAndDeploy} disabled={aiBusy || aiSetup.vars.some((v) => !aiEnvValues[v.key]?.trim())} className="gap-2">
                    {aiBusy ? <><Loader2 className="h-4 w-4 animate-spin" /> Deploying…</> : <><Rocket className="h-4 w-4" /> Grant &amp; deploy</>}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {aiResult && (
            <Card className={aiResult.ok ? "border-emerald-500/40" : "border-red-500/40"}>
              <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm font-medium">{aiResult.ok ? "🎉 Deployed successfully" : "⚠️ Deployment failed"}</div>
                <div className="flex gap-2">
                  {aiResult.ok && aiResult.isSite && <Button size="sm" onClick={() => window.open(aiResult.url, "_blank")} className="gap-1.5"><ExternalLink className="h-4 w-4" /> View site</Button>}
                  <Button size="sm" variant="outline" onClick={() => router.push("/projects")} className="gap-1.5"><Rocket className="h-4 w-4" /> Open project</Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="mt-3 flex gap-2 items-end">
          <textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runAIBuild(); } }}
            rows={1} maxLength={1500} disabled={aiBusy || aiPhase === "building"}
            placeholder={aiChat.length ? "Describe a change, or build something new…" : "Describe what you want to build…"}
            className="flex-1 rounded-xl border border-input bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-fuchsia-500/50 max-h-32" />
          <Button onClick={runAIBuild} disabled={!aiPrompt.trim() || aiBusy || aiPhase === "building"} className="h-11 w-11 p-0 shrink-0">
            {aiBusy || aiPhase === "building" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-[10px] text-center text-muted-foreground mt-1.5">Each build uses one project slot · TypeScript/Python only · your keys stay private</p>
      </div>
    );
  }

  // ── Step: GitHub Repo Picker ──
  if (step === "github") {
    return (
      <div className="max-w-lg mx-auto mt-8">
        <BackButton />
        <h1 className="text-xl font-bold mb-1">Import GitHub Repository</h1>
        <p className="text-sm text-muted-foreground mb-4">Select a repository to deploy.</p>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search repos..." className="pl-9 h-9 text-sm" value={repoSearch} onChange={(e) => setRepoSearch(e.target.value)} />
        </div>

        {loadingRepos ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : filteredRepos.length === 0 ? (
          <div className="flex flex-col items-center py-12 space-y-3">
            <GitBranch className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No repos found</p>
            <p className="text-xs text-muted-foreground text-center max-w-xs">Your GitHub token may have expired. Reconnect to refresh access.</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => loadRepos()}>
                <Loader2 className="h-3 w-3" /> Retry
              </Button>
              <Button size="sm" className="gap-1 text-xs" onClick={() => { window.location.href = `${API}/api/v1/github/connect`; }}>
                <GitBranch className="h-3 w-3" /> Reconnect GitHub
              </Button>
            </div>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto space-y-1">
            {filteredRepos.map((repo) => (
              <button key={repo.id} onClick={() => selectRepo(repo)} className="flex w-full items-center justify-between rounded-lg border border-border/30 p-3 hover:bg-accent/20 transition-colors text-left">
                <div className="flex items-center gap-3 min-w-0">
                  {repo.language && <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${langColor[repo.language] || "bg-gray-400"}`} />}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{repo.name}</span>
                      {repo.private && <Badge variant="outline" className="text-[9px]">private</Badge>}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">{repo.description || repo.full_name}</p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Step: Configure Project (shared by GitHub, Template, Docker) ──
  if (step === "configure" || step === "docker") {
    const ph = getBuildPlaceholders(framework);
    return (
      <div className="max-w-lg mx-auto mt-8">
        <BackButton />
        <h1 className="text-xl font-bold mb-1">Configure Project</h1>
        <p className="text-sm text-muted-foreground mb-6">
          {selectedRepo ? `Deploying ${selectedRepo.full_name}` : repoUrl ? `From template` : "Configure your project"}
        </p>

        <div className="space-y-4">
          {/* Selected repo info */}
          {selectedRepo && (
            <div className="flex items-center gap-3 rounded-lg border border-border/30 p-3 bg-accent/10">
              {selectedRepo.language && <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${langColor[selectedRepo.language] || "bg-gray-400"}`} />}
              <div className="min-w-0">
                <span className="text-sm font-medium">{selectedRepo.full_name}</span>
                {selectedRepo.private && <Badge variant="outline" className="ml-2 text-[9px]">private</Badge>}
              </div>
            </div>
          )}

          {/* Docker image input */}
          {step === "docker" && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Docker Image</label>
              <Input placeholder="nginx:latest or myuser/myapp:v1" value={dockerImage} onChange={(e) => setDockerImage(e.target.value)} className="h-9 text-sm font-mono" />
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Project Name</label>
            <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="my-project" className="h-9 text-sm" />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Subdomain</label>
            <div className="flex items-center gap-0">
              <Input
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="my-project"
                className="h-9 text-sm rounded-r-none font-mono"
              />
              <span className="flex h-9 items-center rounded-r-md border border-l-0 border-input bg-muted px-3 text-xs text-muted-foreground">.deployzy.com</span>
            </div>
            {subCheck && subdomain.trim() && (
              subCheck.checking ? (
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Checking availability…
                </p>
              ) : subCheck.available ? (
                <p className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                  <Check className="h-3 w-3" /> <span className="font-mono">{subCheck.suggestion}.deployzy.app</span> is available
                </p>
              ) : subCheck.reason === "subdomain already taken" ? (
                <p className="text-[11px] text-muted-foreground">
                  <span className="font-mono text-foreground">{subdomain}</span> is taken — deploys as{" "}
                  <span className="font-mono text-foreground">{subCheck.suggestion}.deployzy.app</span>
                </p>
              ) : (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">{subCheck.reason}</p>
              )
            )}
          </div>

          {/* Region / server — user picks explicitly; no silent auto-assign */}
          <RegionPicker value={selectedServer} onChange={setSelectedServer} />

          {/* Env vars */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">
                Environment Variables <span className="text-[10px] font-normal">(optional)</span>
              </label>
              <button
                type="button"
                onClick={() => setEnvText(autoFormatEnvText(envText))}
                disabled={!envText.trim()}
                className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Parse and rewrite as one KEY=VALUE per line. Recovers from pasted values with missing newlines."
              >
                Auto-format
              </button>
            </div>
            <textarea
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              placeholder={ph.env}
              className="w-full h-28 rounded-md border border-input bg-muted px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="text-[10px] text-muted-foreground">KEY=VALUE format, one per line. Click Auto-format if a paste came out mangled.</p>
          </div>

          {/* Advanced Build & Runtime Settings */}
          <div className="rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
            >
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-medium">Advanced Build &amp; Runtime Settings</span>
                <span className="text-[10px] text-muted-foreground">(optional)</span>
              </div>
              {showAdvanced ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </button>
            {showAdvanced && (
              <div className="border-t border-border/40 p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">Root Directory <span className="text-muted-foreground">(monorepos)</span></label>
                    <input type="text" placeholder="apps/web" value={rootDir} onChange={(e) => setRootDir(e.target.value)} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">Node Version</label>
                    <select value={nodeVersion} onChange={(e) => setNodeVersion(e.target.value)} className="w-full h-8 rounded-md border border-input bg-muted px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                      <option value="">Default (20)</option>
                      <option value="18">Node 18</option>
                      <option value="20">Node 20</option>
                      <option value="22">Node 22</option>
                    </select>
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[10px] text-muted-foreground">Install Command</label>
                    <input type="text" placeholder={ph.install} value={installCmd} onChange={(e) => setInstallCmd(e.target.value)} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[10px] text-muted-foreground">Build Command</label>
                    <input type="text" placeholder={ph.build} value={buildCmd} onChange={(e) => setBuildCmd(e.target.value)} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[10px] text-muted-foreground">Start Command</label>
                    <input type="text" placeholder={ph.start} value={startCmd} onChange={(e) => setStartCmd(e.target.value)} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">Port <span className="text-muted-foreground">(0 = auto)</span></label>
                    <input type="number" min="0" max="65535" value={portOverride || ""} onChange={(e) => setPortOverride(parseInt(e.target.value) || 0)} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">
                      Memory MB <span className="text-muted-foreground">(0 = {memCap > 0 ? Math.min(512, memCap) : 512}{memCap > 0 ? `, ${capLabel} ${memCap}` : ""})</span>
                    </label>
                    <input type="number" min="0" max={memCap > 0 ? memCap : 16384} step="128" value={memoryMB || ""} onChange={(e) => setMemoryMB(parseInt(e.target.value) || 0)} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">
                      CPUs <span className="text-muted-foreground">(0 = {cpuCap > 0 ? Math.min(0.5, cpuCap) : 0.5}{cpuCap > 0 ? `, ${capLabel} ${cpuCap}` : ""})</span>
                    </label>
                    <input type="number" min="0" max={cpuCap > 0 ? cpuCap : 8} step="0.25" value={cpus || ""} onChange={(e) => setCpus(parseFloat(e.target.value) || 0)} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[10px] text-muted-foreground">Health Check Path <span className="text-muted-foreground">(e.g. /health; empty = skip)</span></label>
                    <input type="text" placeholder={ph.healthCheck} value={healthCheckPath} onChange={(e) => setHealthCheckPath(e.target.value)} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[10px] text-muted-foreground">Release Command <span className="text-muted-foreground">(runs before start, e.g. migrations)</span></label>
                    <input type="text" placeholder={ph.release} value={releaseCmd} onChange={(e) => setReleaseCmd(e.target.value)} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">All fields optional — blank uses defaults. You can also change these later from the project settings.</p>
              </div>
            )}
          </div>

          <Button className="w-full gap-2" onClick={deployProject} disabled={creating || !projectName || !subdomain}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            Deploy Project
          </Button>
        </div>
      </div>
    );
  }

  // ── Step: Database ──
  if (step === "database") {
    return (
      <div className="max-w-lg mx-auto mt-8">
        <BackButton />
        <h1 className="text-xl font-bold mb-1">Create Database</h1>
        <p className="text-sm text-muted-foreground mb-6">Set up a new managed database instance. Use the connection URL in any project.</p>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium">Database Name</label>
            <Input placeholder="my-database" value={dbName} onChange={(e) => setDbName(e.target.value)} className="h-10" />
          </div>

          {(() => {
            const advancedAllowed = isAdmin || planLimits?.allow_advanced_databases !== false;
            const engines = [
              { id: "postgres", label: "PostgreSQL 16", desc: "Relational SQL — managed instance.", bg: "bg-emerald-500/15", text: "text-emerald-500", locked: false },
              { id: "redis",    label: "Redis 7",       desc: "In-memory key-value store for caching & pub/sub.", bg: "bg-red-500/15", text: "text-red-500", locked: !advancedAllowed },
              { id: "mongodb",  label: "MongoDB 7",     desc: "Schema-free JSON document database.", bg: "bg-green-500/15", text: "text-green-500", locked: !advancedAllowed },
              { id: "mysql",    label: "MySQL 8",       desc: "Popular relational database, broad ecosystem.", bg: "bg-orange-500/15", text: "text-orange-500", locked: !advancedAllowed },
            ];
            return (
              <div className="space-y-2">
                <label className="text-xs font-medium">Database Type</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {engines.map((e) => {
                    const selected = dbType === e.id;
                    return (
                      <button
                        key={e.id}
                        type="button"
                        disabled={e.locked}
                        onClick={() => !e.locked && setDbType(e.id)}
                        className={`relative flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                          e.locked
                            ? "cursor-not-allowed border-border/60 opacity-70"
                            : selected
                              ? "border-primary bg-primary/5 ring-1 ring-primary"
                              : "border-border hover:border-foreground/30"
                        }`}
                      >
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${e.bg} ${e.text}`}>
                          <Database className="h-4.5 w-4.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{e.label}</p>
                          <p className="text-[11px] text-muted-foreground line-clamp-2">{e.desc}</p>
                          {e.locked && (
                            <a
                              href="/billing"
                              onClick={(ev) => ev.stopPropagation()}
                              className="mt-1 inline-block text-[11px] font-medium text-primary hover:underline"
                            >
                              Upgrade to access →
                            </a>
                          )}
                        </div>
                        {selected && !e.locked && <Check className="h-4 w-4 shrink-0 text-primary" />}
                      </button>
                    );
                  })}
                </div>
                {!advancedAllowed && (
                  <p className="text-[11px] text-muted-foreground">
                    Your plan includes one PostgreSQL database. Redis, MongoDB and MySQL are available on paid plans.
                  </p>
                )}
              </div>
            );
          })()}

          <div className="space-y-2">
            <RegionPicker value={dbTargetServer} onChange={setDbTargetServer} label="Region" />
            <p className="text-[11px] text-muted-foreground">Deploy on your own VPS to use its full disk and skip plan DB-size caps.</p>
          </div>

          {planLimits?.max_db_size_mb !== undefined && planLimits.max_db_size_mb > 0 && (
            <p className="text-[11px] text-muted-foreground -mt-1">
              Includes {planLimits.max_db_size_mb >= 1024 ? `${(planLimits.max_db_size_mb / 1024).toFixed(planLimits.max_db_size_mb % 1024 === 0 ? 0 : 1)} GB` : `${planLimits.max_db_size_mb} MB`} of storage per database. Writes pause if you exceed it — upgrade for more.
            </p>
          )}

          <Button className="w-full gap-2" onClick={createDatabase} disabled={creating || !dbName}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            Create Database
          </Button>

          {/* Migrate an existing database (premium) */}
          <div className="pt-4 mt-2 border-t border-border/60">
            {!showMigrate ? (
              <button onClick={() => setShowMigrate(true)}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                <ArrowLeft className="h-3 w-3 rotate-180" /> Already have a database? Migrate it to Deployzy
              </button>
            ) : (isAdmin || planLimits?.allow_db_migration) ? (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium">Migrate an existing database</p>
                  <p className="text-[11px] text-muted-foreground">We&apos;ll create a fresh managed database and copy your data into it. The source must be publicly reachable.</p>
                </div>
                <select value={migType} onChange={(e) => setMigType(e.target.value)}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="postgres">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                  <option value="mongodb">MongoDB</option>
                </select>
                <Input placeholder="Source connection string (e.g. postgres://user:pass@host:5432/db)"
                  value={migUrl} onChange={(e) => setMigUrl(e.target.value)} />
                <Input placeholder="New database name (optional)" value={migName} onChange={(e) => setMigName(e.target.value)} />
                {migJob && (
                  <div className={`rounded-md border px-3 py-2 text-xs ${
                    migJob.status === "success" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : migJob.status === "failed" ? "border-red-500/40 bg-red-500/10 text-red-500"
                    : "border-border/60 bg-muted/30 text-muted-foreground"}`}>
                    {migJob.status === "running" && <span className="flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Copying your data… this can take a few minutes. You can leave this page.</span>}
                    {migJob.status === "success" && "Migration complete — redirecting to your databases…"}
                    {migJob.status === "failed" && `Migration failed: ${migJob.error || "unknown error"}`}
                  </div>
                )}
                <Button className="w-full gap-2" onClick={startMigration} disabled={migrating || !migUrl.trim()}>
                  {migrating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                  Start migration
                </Button>
              </div>
            ) : (
              <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-3 text-xs space-y-1">
                <p className="font-medium">Migrating an existing database is a paid feature.</p>
                <a href="/billing" className="text-primary hover:underline">Upgrade to access →</a>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Step: Template Configure ──
  if (step === "template" && selectedTemplate) {
    const userFacingVars = selectedTemplate.env_vars.filter((ev: EnvVarSchema) => ev.type !== "auto");
    return (
      <div className="max-w-lg mx-auto mt-8">
        <button onClick={() => setSelectedTemplate(null)} className="text-xs text-muted-foreground hover:text-foreground mb-4 flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> Back to templates
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
            style={{ background: selectedTemplate.color + "14", border: `1px solid ${selectedTemplate.color}33` }}
          >
            <BrandLogo logoSlug={selectedTemplate.logo_slug} slug={selectedTemplate.slug}
              name={selectedTemplate.name} color={selectedTemplate.color} className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold">{selectedTemplate.name}</h1>
            <p className="text-xs text-muted-foreground">{selectedTemplate.tagline}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Project name</label>
            <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder={selectedTemplate.slug} className="h-9 text-sm" />
          </div>

          {userFacingVars.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground">Configuration</p>
              {userFacingVars.map((ev: EnvVarSchema) => (
                <div key={ev.key} className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs font-medium">{ev.label || ev.key}</label>
                    {ev.required && <span className="text-[10px] text-destructive font-medium">*</span>}
                  </div>
                  {ev.description && <p className="text-[10px] text-muted-foreground">{ev.description}</p>}
                  {ev.type === "select" && ev.options ? (
                    <select
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      value={templateEnvVars[ev.key] ?? ""}
                      onChange={(e) => setTemplateEnvVars((p) => ({ ...p, [ev.key]: e.target.value }))}
                    >
                      <option value="">Select…</option>
                      {ev.options.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  ) : (
                    <Input
                      type={ev.type === "secret" ? "password" : "text"}
                      value={templateEnvVars[ev.key] ?? ""}
                      onChange={(e) => setTemplateEnvVars((p) => ({ ...p, [ev.key]: e.target.value }))}
                      placeholder={ev.placeholder || ev.default || ev.key}
                      className="h-9 text-sm"
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          <RegionPicker value={templateServer} onChange={setTemplateServer} />

          {templateError && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
              {templateError}
            </div>
          )}

          <Button
            className="w-full gap-2"
            onClick={deployTemplate}
            disabled={templateDeploying || !templateName.trim()}
          >
            {templateDeploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            Deploy Template
          </Button>
        </div>
      </div>
    );
  }

  // ── Step: Template Picker ──
  if (step === "template") {
    const filteredTemplates = apiTemplates.filter((t) =>
      !templateSearch ||
      t.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
      t.tagline.toLowerCase().includes(templateSearch.toLowerCase()) ||
      t.tags.some((tag) => tag.toLowerCase().includes(templateSearch.toLowerCase()))
    );

    function openTemplate(t: Template) {
      setSelectedTemplate(t);
      setTemplateName(t.slug);
      setTemplateEnvVars({});
      setTemplateError("");
      setTemplateServer("platform");
    }

    return (
      <div className="max-w-lg mx-auto mt-8">
        <BackButton />

        {/* Search box — always visible at top */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            autoFocus
            className="pl-9 h-9 text-sm"
            placeholder="Search templates…"
            value={templateSearch}
            onChange={(e) => setTemplateSearch(e.target.value)}
          />
        </div>

        {/* Scrollable template list */}
        <div className="rounded-xl border border-border overflow-hidden">
          {templatesLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-muted-foreground gap-2">
              <Layers className="h-7 w-7 opacity-30" />
              <p className="text-sm">No templates found</p>
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto divide-y divide-border">
              {filteredTemplates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => openTemplate(t)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors group"
                >
                  {/* Icon */}
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: t.color + "14", border: `1px solid ${t.color}33` }}
                  >
                    <BrandLogo logoSlug={t.logo_slug} slug={t.slug} name={t.name} color={t.color} className="h-4.5 w-4.5" />
                  </div>

                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-foreground truncate">{t.name}</span>
                      {t.is_featured && (
                        <span className="shrink-0 rounded-full bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                          Featured
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">{t.tagline}</p>
                  </div>

                  {/* Deploy count */}
                  {t.deploy_count > 0 && (
                    <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0">
                      <Download className="h-2.5 w-2.5" />
                      {t.deploy_count.toLocaleString()}
                    </div>
                  )}

                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Main Command Palette ──
  return (
    <div className="max-w-lg mx-auto mt-8">
      <div className="rounded-xl border border-border/60 bg-card/50 overflow-hidden shadow-lg">
        <div className="relative border-b border-border/40">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="What would you like to create?"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-12 pl-11 border-0 rounded-none focus-visible:ring-0 text-sm"
            autoFocus
          />
        </div>

        <div className="p-2">
          {filtered.filter(o => o.category === "deploy").length > 0 && (
            <>
              <p className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Deploy</p>
              {filtered.filter(o => o.category === "deploy").map((opt) => (
                <button key={opt.id} onClick={() => handleSelect(opt.id)} className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left hover:bg-accent/50 transition-colors group">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${opt.color} shrink-0 transition-transform group-hover:scale-110`}>
                      {"brand" in opt && opt.brand
                        ? <BrandLogo logoSlug={opt.brand as string} name={opt.title} className="h-4 w-4" />
                        : <opt.icon className="h-4 w-4" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{opt.title}</p>
                      <p className="text-[11px] text-muted-foreground">{opt.desc}</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </>
          )}

          {filtered.filter(o => o.category === "infra").length > 0 && (
            <>
              <div className="border-t border-border/30 my-1" />
              <p className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Infrastructure</p>
              {filtered.filter(o => o.category === "infra").map((opt) => (
                <button key={opt.id} onClick={() => handleSelect(opt.id)} className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left hover:bg-accent/50 transition-colors group">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${opt.color} shrink-0 transition-transform group-hover:scale-110`}>
                      {"brand" in opt && opt.brand
                        ? <BrandLogo logoSlug={opt.brand as string} name={opt.title} className="h-4 w-4" />
                        : <opt.icon className="h-4 w-4" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{opt.title}</p>
                      <p className="text-[11px] text-muted-foreground">{opt.desc}</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </>
          )}

          {filtered.length === 0 && (
            <p className="px-3 py-6 text-sm text-muted-foreground text-center">No matching options</p>
          )}
        </div>
      </div>
    </div>
  );
}
