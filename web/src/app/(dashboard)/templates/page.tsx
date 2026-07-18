"use client";

import { useEffect, useState, useCallback } from "react";
import { api, Template, EnvVarSchema } from "@/lib/api";
import { Button } from "@/components/ui/button";
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
const CATEGORY_META: Record<string, { label: string; emoji: string }> = {
  all:        { label: "All Templates", emoji: "🗂️" },
  bots:       { label: "Bots",          emoji: "🤖" },
  automation: { label: "Automation",    emoji: "⚙️" },
  monitoring: { label: "Monitoring",    emoji: "📊" },
  cms:        { label: "CMS & Blogs",   emoji: "📝" },
  analytics:  { label: "Analytics",     emoji: "📈" },
  security:   { label: "Security",      emoji: "🔒" },
  other:      { label: "Other",         emoji: "📦" },
};

const SORT_OPTIONS = [
  { value: "popular",  label: "Most Popular" },
  { value: "newest",   label: "Newest" },
  { value: "stars",    label: "Most Starred" },
  { value: "featured", label: "Featured" },
];

// ─── Deploy Modal ─────────────────────────────────────────────────────────────
function DeployModal({
  template,
  onClose,
}: {
  template: Template;
  onClose: () => void;
}) {
  const [name, setName]       = useState(template.name);
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [done, setDone]       = useState<{ projectId: string; postDeploy: string } | null>(null);

  function setEnv(key: string, val: string) {
    setEnvVars((prev) => ({ ...prev, [key]: val }));
  }

  async function deploy() {
    setLoading(true);
    setError("");
    try {
      const res = await api.deployFromTemplate(template.slug, {
        name,
        env_vars: envVars,
      });
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
      <DialogContent className="max-w-lg">
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10">
            <CheckCircle className="h-8 w-8 text-green-500" />
          </div>
          <h3 className="text-xl font-semibold">Project Created!</h3>
          <p className="text-sm text-muted-foreground">
            Your <strong>{template.name}</strong> project is ready. Head to Projects to deploy it.
          </p>

          {done.postDeploy && (
            <div className="w-full rounded-lg border border-border bg-muted/40 p-4 text-left">
              <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Next steps</p>
              <pre className="whitespace-pre-wrap text-sm text-foreground">{done.postDeploy}</pre>
            </div>
          )}

          <div className="flex gap-3 w-full">
            <Button className="flex-1" onClick={() => window.location.href = "/projects"}>
              Go to Projects
            </Button>
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Deploy Another
            </Button>
          </div>
        </div>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3">
          <span className="text-2xl">{template.icon}</span>
          Deploy {template.name}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4 mt-2">
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

        {error && (
          <div className="rounded-lg bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
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
    <div
      className="group relative flex flex-col rounded-2xl border border-border bg-card overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:border-transparent"
      style={{ "--card-color": template.color } as React.CSSProperties}
    >
      {/* Colored banner */}
      <div
        className="relative h-28 flex items-center justify-center overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${template.color}22 0%, ${template.color}0a 100%)`,
          borderBottom: `1px solid ${template.color}20`,
        }}
      >
        {/* Subtle noise / grid texture */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: `radial-gradient(${template.color} 1px, transparent 1px)`,
            backgroundSize: "18px 18px",
          }}
        />

        {/* Icon */}
        <div
          className="relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl text-3xl shadow-sm"
          style={{
            background: `${template.color}18`,
            border: `1.5px solid ${template.color}35`,
            backdropFilter: "blur(4px)",
          }}
        >
          {template.icon}
        </div>

        {/* Star pill — top-right */}
        <button
          onClick={() => onStar(template)}
          className={`absolute top-3 right-3 z-10 flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium backdrop-blur-sm transition-all ${
            template.is_starred
              ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
              : "bg-black/10 text-muted-foreground border border-border hover:bg-amber-500/15 hover:text-amber-400 hover:border-amber-500/25 dark:bg-white/5"
          }`}
        >
          <Star className={`h-3 w-3 ${template.is_starred ? "fill-amber-400" : ""}`} />
          {template.star_count}
        </button>

        {/* Badges — top-left */}
        <div className="absolute top-3 left-3 z-10 flex gap-1">
          {template.is_featured && (
            <span className="rounded-full bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 text-[10px] font-semibold text-amber-400 backdrop-blur-sm">
              ✦ Featured
            </span>
          )}
          {template.is_official && !template.is_featured && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold backdrop-blur-sm"
              style={{
                background: `${template.color}25`,
                border: `1px solid ${template.color}40`,
                color: template.color,
              }}
            >
              Official
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col flex-1 p-4 gap-3">
        {/* Name + tagline */}
        <div>
          <h3 className="font-semibold text-foreground leading-snug">{template.name}</h3>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
            {template.tagline}
          </p>
        </div>

        {/* Tags */}
        {template.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {template.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Footer */}
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground flex-1">
            <Download className="h-3 w-3" />
            {template.deploy_count > 0
              ? `${template.deploy_count.toLocaleString()} deploys`
              : "Be the first to deploy"}
          </div>
          <button
            onClick={() => onDeploy(template)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-all hover:opacity-90 hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: `linear-gradient(135deg, ${template.color}, ${template.color}cc)` }}
          >
            <Rocket className="h-3 w-3" />
            Deploy
          </button>
        </div>
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
      // not logged in — could show a login prompt
    }
  }

  // Category pill list: "all" + whatever the DB returned
  const categoryPills = [
    { category: "all", count: total },
    ...categories,
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between gap-4 mb-1">
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Templates</h1>
          <span className="text-xs text-muted-foreground bg-muted rounded-full px-3 py-1">
            {total} available
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Deploy popular open-source tools and starter projects with one click
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

      {/* Category tabs */}
      <div className="flex gap-1.5 flex-wrap mb-6 border-b border-border pb-4">
        {categoryPills.map(({ category, count }) => {
          const meta = CATEGORY_META[category] ?? { label: category, emoji: "📦" };
          const active = activeCategory === category;
          return (
            <button
              key={category}
              onClick={() => setCategory(category)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                active
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
              }`}
            >
              <span className="text-base leading-none">{meta.emoji}</span>
              <span>{meta.label}</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                active ? "bg-background/20 text-background/70" : "bg-muted text-muted-foreground"
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border overflow-hidden animate-pulse">
              <div className="h-28 bg-muted/40" />
              <div className="p-4 space-y-3">
                <div className="h-4 w-32 rounded bg-muted/60" />
                <div className="h-3 w-full rounded bg-muted/40" />
                <div className="h-3 w-3/4 rounded bg-muted/40" />
                <div className="flex gap-1.5 pt-1">
                  {[40, 52, 36].map((w) => (
                    <div key={w} className="h-5 rounded-md bg-muted/50" style={{ width: w }} />
                  ))}
                </div>
                <div className="h-px bg-border mt-2" />
                <div className="flex items-center justify-between pt-1">
                  <div className="h-3 w-20 rounded bg-muted/40" />
                  <div className="h-7 w-20 rounded-lg bg-muted/60" />
                </div>
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
