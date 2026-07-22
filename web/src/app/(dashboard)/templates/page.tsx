"use client";

import { useEffect, useState, useCallback, type ReactNode } from "react";
import { api, Template, EnvVarSchema, WorkerServer } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/brand-logos";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Search,
  Star,
  Download,
  Rocket,
  CheckCircle,
  ExternalLink,
  X,
} from "lucide-react";

// ─── Category metadata ────────────────────────────────────────────────────────
const CATEGORY_META: Record<string, { label: string }> = {
  all:        { label: "All" },
  bots:       { label: "Bots" },
  automation: { label: "Automation" },
  monitoring: { label: "Monitoring" },
  cms:        { label: "CMS & Blogs" },
  analytics:  { label: "Analytics" },
  security:   { label: "Security" },
  other:      { label: "Other" },
};

const SORT_OPTIONS = [
  { value: "popular",  label: "Most Popular" },
  { value: "newest",   label: "Newest" },
  { value: "stars",    label: "Most Starred" },
  { value: "featured", label: "Featured" },
];

// ─── Minimal markdown renderer ────────────────────────────────────────────────
// Handles: ## headings, **bold**, `inline code`, ```code blocks```
function renderMarkdown(raw: string) {
  const blocks: ReactNode[] = [];
  const codeBlockRe = /```[\w]*\n?([\s\S]*?)```/g;
  const parts = raw.split(codeBlockRe);
  // split alternates: [text, codeContent, text, codeContent, ...]

  parts.forEach((part, idx) => {
    if (idx % 2 === 1) {
      // code block content
      blocks.push(
        <pre key={idx} className="my-2 rounded-md bg-muted px-3 py-2 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
          {part.trim()}
        </pre>
      );
      return;
    }

    // process inline text lines
    part.split("\n").forEach((line, li) => {
      const key = `${idx}-${li}`;
      const trimmed = line.trimEnd();
      if (!trimmed) return;

      // h2 / h3
      if (trimmed.startsWith("## ")) {
        blocks.push(
          <p key={key} className="mt-3 mb-1 font-semibold text-sm text-foreground">
            {inlineFormat(trimmed.slice(3))}
          </p>
        );
        return;
      }
      if (trimmed.startsWith("### ")) {
        blocks.push(
          <p key={key} className="mt-2 mb-0.5 font-medium text-sm text-foreground">
            {inlineFormat(trimmed.slice(4))}
          </p>
        );
        return;
      }

      blocks.push(
        <p key={key} className="text-sm text-foreground/80 leading-relaxed">
          {inlineFormat(trimmed)}
        </p>
      );
    });
  });

  return blocks;
}

function inlineFormat(text: string): ReactNode[] {
  // tokenise by **bold** and `code`
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return tokens.map((tok, i) => {
    if (tok.startsWith("**") && tok.endsWith("**"))
      return <strong key={i} className="font-semibold text-foreground">{tok.slice(2, -2)}</strong>;
    if (tok.startsWith("`") && tok.endsWith("`"))
      return <code key={i} className="rounded bg-muted px-1 py-0.5 text-xs font-mono text-foreground">{tok.slice(1, -1)}</code>;
    return tok;
  });
}

// ─── Deploy Modal ─────────────────────────────────────────────────────────────
function DeployModal({
  template,
  onClose,
}: {
  template: Template;
  onClose: () => void;
}) {
  const [name, setName]             = useState(template.name);
  const [envVars, setEnvVars]       = useState<Record<string, string>>({});
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const [done, setDone]             = useState<{ projectId: string; postDeploy: string } | null>(null);
  const [servers, setServers]       = useState<WorkerServer[]>([]);
  const [serverChoice, setServerChoice] = useState<string>("platform");

  useEffect(() => {
    api.listUserServers()
      .then((list) => setServers(list.filter((s) => s.status === "active" && s.docker_installed)))
      .catch(() => {});
  }, []);

  function setEnv(key: string, val: string) {
    setEnvVars((prev) => ({ ...prev, [key]: val }));
  }

  async function deploy() {
    setLoading(true);
    setError("");
    try {
      const payload: { name: string; env_vars: Record<string, string>; worker_server_id?: string } = {
        name,
        env_vars: envVars,
      };
      if (serverChoice && serverChoice !== "platform") {
        payload.worker_server_id = serverChoice;
      }
      const res = await api.deployFromTemplate(template.slug, payload);
      setDone({ projectId: res.project.id as string, postDeploy: res.post_deploy });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Deploy failed");
    } finally {
      setLoading(false);
    }
  }

  const userFacingVars = template.env_vars.filter((ev) => ev.type !== "auto");

  if (done) {
    return (
      <DialogContent className="w-[min(90vw,32rem)] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex flex-col items-center gap-4 pt-4 pb-2 text-center shrink-0">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
            <CheckCircle className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">Project Created</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Your <span className="font-medium text-foreground">{template.name}</span> project is ready. Go to Projects to deploy it.
            </p>
          </div>
        </div>

        {done.postDeploy && (
          <div className="min-w-0 flex-1 overflow-y-auto rounded-lg border border-border bg-muted/30 p-4 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Next steps</p>
            {renderMarkdown(done.postDeploy)}
          </div>
        )}

        <div className="flex gap-2 pt-2 shrink-0">
          <Button className="flex-1" onClick={() => window.location.href = "/projects"}>
            Go to Projects
          </Button>
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Deploy Another
          </Button>
        </div>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2.5">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg border"
            style={{ borderColor: `${template.color}33`, background: `${template.color}0f` }}
          >
            <BrandLogo slug={template.slug} name={template.name} color={template.color} className="h-4 w-4" />
          </span>
          Deploy {template.name}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4 mt-1">
        {/* Project name */}
        <div className="space-y-1.5">
          <Label>Project name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-telegram-bot"
          />
        </div>

        {/* Env vars */}
        {userFacingVars.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">Configuration</p>
            {userFacingVars.map((ev) => (
              <EnvVarField
                key={ev.key}
                schema={ev}
                value={envVars[ev.key] ?? ""}
                onChange={(v) => setEnv(ev.key, v)}
              />
            ))}
          </div>
        )}

        {/* Server selection — only shown when user has BYOC servers */}
        {servers.length > 0 && (
          <div className="space-y-1.5">
            <Label>Deploy to</Label>
            <select
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              value={serverChoice}
              onChange={(e) => setServerChoice(e.target.value)}
            >
              <option value="platform">Deployzy platform (managed)</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} — {s.host}{s.region ? ` (${s.region})` : ""} · {s.total_memory_mb} MB
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {serverChoice === "platform"
                ? "Deployed and managed on Deployzy infrastructure."
                : "Deployed to your own server via SSH."}
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-2.5 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Template meta */}
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground space-y-1">
          {template.docker_image && (
            <div>Image: <span className="font-mono text-foreground">{template.docker_image}</span></div>
          )}
          {template.source_repo && (
            <div className="flex items-center gap-1">
              Repo:
              <a href={template.source_repo} target="_blank" rel="noreferrer"
                className="text-primary hover:underline flex items-center gap-0.5">
                {template.source_repo.replace("https://github.com/", "")}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
          {template.min_memory_mb > 0 && (
            <div>Min memory: {template.min_memory_mb} MB</div>
          )}
        </div>

        <Button className="w-full" onClick={deploy} disabled={loading || !name.trim()}>
          {loading ? "Creating project…" : "Deploy Template"}
        </Button>
      </div>
    </DialogContent>
  );
}

function EnvVarField({
  schema,
  value,
  onChange,
}: {
  schema: EnvVarSchema;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label className="text-sm">
          {schema.label || schema.key}
        </Label>
        {schema.required && (
          <span className="text-xs text-destructive font-medium">*</span>
        )}
      </div>
      {schema.description && (
        <p className="text-xs text-muted-foreground">{schema.description}</p>
      )}
      {schema.type === "select" && schema.options ? (
        <select
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select…</option>
          {schema.options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : (
        <Input
          type={schema.type === "secret" ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={schema.placeholder || schema.default || schema.key}
        />
      )}
    </div>
  );
}

// ─── Template Card ────────────────────────────────────────────────────────────
function TemplateCard({
  template,
  onDeploy,
  onStar,
}: {
  template: Template;
  onDeploy: (t: Template) => void;
  onStar: (t: Template) => void;
}) {
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-all hover:border-foreground/20 hover:shadow-lg hover:shadow-black/5">
      {/* Brand wash — the template's own colour, barely there, so cards are
          distinguishable at a glance without shouting. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-[0.07] transition-opacity group-hover:opacity-[0.12]"
        style={{ background: `radial-gradient(120% 100% at 0% 0%, ${template.color}, transparent 70%)` }}
      />

      <div className="relative flex flex-1 flex-col p-5">
        {/* Logo + status */}
        <div className="flex items-start justify-between gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border bg-background/80 backdrop-blur"
            style={{ borderColor: `${template.color}33` }}
          >
            <BrandLogo slug={template.slug} name={template.name} color={template.color} className="h-6 w-6" />
          </div>

          <div className="flex items-center gap-1.5">
            {template.is_featured && (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                Featured
              </span>
            )}
            {template.is_official && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                title="Maintained by Deployzy"
              >
                <CheckCircle className="h-2.5 w-2.5" />
                Official
              </span>
            )}
          </div>
        </div>

        {/* Name + tagline */}
        <h3 className="mt-3.5 text-[15px] font-semibold leading-tight tracking-tight">
          {template.name}
        </h3>
        <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
          {template.tagline}
        </p>

        {/* Tags */}
        {template.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {template.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              >
                {tag}
              </span>
            ))}
            {template.tags.length > 3 && (
              <span className="px-1 py-0.5 text-[10px] text-muted-foreground/70">
                +{template.tags.length - 3}
              </span>
            )}
          </div>
        )}

        <div className="flex-1" />

        {/* Actions. Deploy count is only shown once it means something — a row
            of "Be the first" across every card was noise, not information. */}
        <div className="mt-5 flex items-center gap-2">
          <Button size="sm" className="flex-1 gap-1.5 h-8" onClick={() => onDeploy(template)}>
            <Rocket className="h-3.5 w-3.5" />
            Deploy
          </Button>
          <button
            onClick={() => onStar(template)}
            aria-label={template.is_starred ? "Unstar template" : "Star template"}
            className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors ${
              template.is_starred
                ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
            }`}
          >
            <Star className={`h-3.5 w-3.5 ${template.is_starred ? "fill-current" : ""}`} />
            {template.star_count > 0 && template.star_count}
          </button>
        </div>

        {template.deploy_count > 0 && (
          <p className="mt-2.5 text-[11px] text-muted-foreground">
            {template.deploy_count.toLocaleString()} deploy{template.deploy_count !== 1 ? "s" : ""}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function TemplatesPage() {
  const [templates, setTemplates]     = useState<Template[]>([]);
  const [total, setTotal]             = useState(0);
  const [categories, setCategories]   = useState<{ category: string; count: number }[]>([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState("");
  const [activeCategory, setCategory] = useState("all");
  const [sort, setSort]               = useState("popular");
  const [deploying, setDeploying]     = useState<Template | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listTemplates({
        category: activeCategory === "all" ? "" : activeCategory,
        search,
        sort,
        limit: 50,
      });
      setTemplates(res.templates ?? []);
      setTotal(res.total);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [activeCategory, search, sort]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api.listTemplateCategories().then(setCategories).catch(() => {});
  }, []);

  async function handleStar(t: Template) {
    try {
      const res = await api.toggleTemplateStar(t.slug);
      setTemplates((prev) =>
        prev.map((x) =>
          x.id === t.id
            ? { ...x, is_starred: res.starred, star_count: res.star_count }
            : x
        )
      );
    } catch {
      // not logged in — silent
    }
  }

  const categoryPills = [
    { category: "all", count: total },
    ...categories,
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Production-ready open-source tools, deployed to your account in one click.
        </p>
      </div>

      {/* Search + Sort */}
      <div className="flex flex-col sm:flex-row gap-2.5 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9 h-9"
            placeholder="Search templates…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="h-9 rounded-lg border border-border bg-background px-3 py-0 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          {SORT_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Category filter — plain segmented control. The emoji-per-category row
          read as decoration rather than navigation. */}
      <div className="mb-6 flex flex-wrap items-center gap-1 border-b border-border pb-3">
        {categoryPills.map(({ category, count }) => {
          const meta = CATEGORY_META[category] ?? { label: category };
          const active = activeCategory === category;
          return (
            <button
              key={category}
              onClick={() => setCategory(category)}
              className={`relative rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                active
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {meta.label}
              <span className={`ml-1.5 text-[11px] tabular-nums ${active ? "text-muted-foreground" : "text-muted-foreground/60"}`}>
                {count}
              </span>
            </button>
          );
        })}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {total} template{total !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border overflow-hidden animate-pulse">
              <div className="p-5 space-y-3">
                <div className="h-11 w-11 rounded-xl bg-muted/60" />
                <div className="h-4 w-32 rounded bg-muted/60" />
                <div className="h-3 w-full rounded bg-muted/40" />
                <div className="h-3 w-2/3 rounded bg-muted/40" />
                <div className="h-8 w-full rounded-md bg-muted/40 !mt-5" />
              </div>
              <div className="flex gap-1 px-4 pb-3">
                {[40, 52, 36].map((w) => (
                  <div key={w} className="h-4 rounded bg-muted/50" style={{ width: w }} />
                ))}
              </div>
              <div className="h-px bg-border mx-0" />
              <div className="flex items-center justify-between px-4 py-2.5">
                <div className="h-3 w-16 rounded bg-muted/40" />
                <div className="h-7 w-20 rounded-lg bg-muted/60" />
              </div>
            </div>
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
          <span className="text-4xl">🔍</span>
          <p className="text-sm">No templates found</p>
          {(search || activeCategory !== "all") && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setCategory("all"); }}>
              <X className="h-4 w-4 mr-1" /> Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              onDeploy={setDeploying}
              onStar={handleStar}
            />
          ))}
        </div>
      )}

      {/* Deploy Modal */}
      <Dialog open={!!deploying} onOpenChange={(open) => !open && setDeploying(null)}>
        {deploying && (
          <DeployModal
            template={deploying}
            onClose={() => setDeploying(null)}
          />
        )}
      </Dialog>
    </div>
  );
}
