"use client";

// Templates, inside the dashboard: browse one-click apps, then name and
// configure one and deploy it. (The public gallery at /templates is the
// marketing version of the same catalogue.) ?slug=<slug> opens one directly.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon, ArrowRightIcon, CircleNotchIcon, DownloadSimpleIcon, MagnifyingGlassIcon,
  RocketLaunchIcon, SealCheckIcon, SquaresFourIcon,
} from "@phosphor-icons/react";
import { api, type EnvVarSchema, type Template } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { BrandLogo } from "@/components/brand-logos";
import { RegionPicker } from "@/components/region-picker";
import { EmptyState, PageHeader } from "@/components/dashboard/kit";

const ACRONYMS = new Set(["cms", "ai", "vpn", "api", "crm", "seo", "llm", "db"]);
function categoryLabel(c: string) {
  const k = c.trim().toLowerCase();
  return ACRONYMS.has(k) ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1);
}

function Logo({ t, size = "md" }: { t: Template; size?: "md" | "lg" }) {
  const color = t.color || "#888888";
  return (
    <span
      aria-hidden
      className={cn("flex shrink-0 items-center justify-center", size === "lg" ? "h-12 w-12 rounded-[14px]" : "h-10 w-10 rounded-[11px]")}
      style={{ background: `${color}14`, boxShadow: `inset 0 0 0 1px ${color}26` }}
    >
      <BrandLogo logoSlug={t.logo_slug} slug={t.slug} name={t.name} color={color} className={size === "lg" ? "h-6 w-6" : "h-5 w-5"} />
    </span>
  );
}

export default function TemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [picked, setPicked] = useState<Template | null>(null);

  // Configure form
  const [name, setName] = useState("");
  const [env, setEnv] = useState<Record<string, string>>({});
  const [server, setServer] = useState("platform");
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState("");

  function open(t: Template) {
    setPicked(t);
    setName(t.slug);
    setEnv({});
    setServer("platform");
    setError("");
    window.scrollTo({ top: 0 });
  }

  useEffect(() => {
    let alive = true;
    api.listTemplates({ sort: "popular", limit: 200 })
      .then((res) => {
        if (!alive) return;
        const list = res.templates ?? [];
        setTemplates(list);
        const slug = new URLSearchParams(window.location.search).get("slug");
        const hit = slug && list.find((t) => t.slug === slug);
        if (hit) open(hit);
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of templates) if (t.category) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 8);
  }, [templates]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return templates.filter((t) =>
      (!cat || t.category === cat) &&
      (!s || t.name.toLowerCase().includes(s) || t.tagline.toLowerCase().includes(s) || t.tags.some((x) => x.toLowerCase().includes(s))),
    );
  }, [templates, q, cat]);

  async function deploy() {
    if (!picked || !name.trim()) return;
    setDeploying(true);
    setError("");
    try {
      await api.deployFromTemplate(picked.slug, { name, env_vars: env, ...(server ? { worker_server_id: server } : {}) });
      router.push("/projects");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Deploy failed");
      setDeploying(false);
    }
  }

  // ── Configure one template ──
  if (picked) {
    const vars = picked.env_vars.filter((ev: EnvVarSchema) => ev.type !== "auto");
    const missing = vars.some((ev) => ev.required && !(env[ev.key] ?? "").trim());
    return (
      <div className="mx-auto max-w-xl animate-fade-in-up">
        <button type="button" onClick={() => setPicked(null)} className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeftIcon className="h-3.5 w-3.5" /> All templates
        </button>

        <div className="mt-5 flex items-center gap-3.5">
          <Logo t={picked} size="lg" />
          <div className="min-w-0">
            <h1 className="flex items-center gap-1.5 text-[22px] font-semibold tracking-[-0.022em]">
              {picked.name}
              {picked.is_official && <SealCheckIcon className="h-5 w-5 text-[var(--dz-green-strong)] dark:text-brand" aria-label="Official" />}
            </h1>
            <p className="text-[13.5px] text-muted-foreground">{picked.tagline}</p>
          </div>
        </div>

        <div className="surface mt-6 space-y-5 rounded-[18px] p-5">
          <div className="space-y-1.5">
            <label htmlFor="tpl-name" className="text-[13px] font-medium">Project name</label>
            <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={picked.slug} className="h-9 text-sm" />
          </div>

          {vars.map((ev) => (
            <div key={ev.key} className="space-y-1.5">
              <label htmlFor={`tpl-${ev.key}`} className="flex items-center gap-1 text-[13px] font-medium">
                {ev.label || ev.key}
                {ev.required && <span className="text-red-500" aria-label="required">*</span>}
              </label>
              {ev.description && <p className="text-[12px] text-muted-foreground">{ev.description}</p>}
              {ev.type === "select" && ev.options ? (
                <select
                  id={`tpl-${ev.key}`}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  value={env[ev.key] ?? ""}
                  onChange={(e) => setEnv((p) => ({ ...p, [ev.key]: e.target.value }))}
                >
                  <option value="">Select…</option>
                  {ev.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <Input
                  id={`tpl-${ev.key}`}
                  type={ev.type === "secret" ? "password" : "text"}
                  value={env[ev.key] ?? ""}
                  onChange={(e) => setEnv((p) => ({ ...p, [ev.key]: e.target.value }))}
                  placeholder={ev.placeholder || ev.default || ev.key}
                  className="h-9 text-sm"
                />
              )}
            </div>
          ))}

          <RegionPicker value={server} onChange={setServer} />

          {error && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-[12.5px] text-red-600 dark:text-red-400">{error}</p>}

          <button type="button" onClick={deploy} disabled={deploying || !name.trim() || missing} className="pill pill-ink pill-sm w-full justify-center disabled:opacity-50">
            {deploying ? <CircleNotchIcon className="h-4 w-4 animate-spin" /> : <RocketLaunchIcon className="h-4 w-4" />}
            {deploying ? "Deploying…" : `Deploy ${picked.name}`}
          </button>
        </div>
        {picked.min_memory_mb > 0 && (
          <p className="mt-3 text-center text-[12px] text-muted-foreground">Needs at least {picked.min_memory_mb} MB of memory.</p>
        )}
      </div>
    );
  }

  // ── Gallery ──
  return (
    <div className="animate-fade-in-up">
      <PageHeader
        title="Templates"
        description="Open-source apps, set up and deployed in about a minute."
        actions={<Link href="/new" className="pill pill-line pill-xs">Other ways to deploy</Link>}
      />

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-72">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates" aria-label="Search templates" className="h-9 rounded-full pl-9 text-sm" />
        </div>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Category">
          {["", ...categories].map((c) => (
            <button
              key={c || "all"}
              type="button"
              onClick={() => setCat(c)}
              aria-pressed={cat === c}
              className={cn(
                "h-8 shrink-0 rounded-full px-3 text-[12.5px] font-medium transition-colors",
                cat === c ? "bg-foreground text-background" : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
              )}
            >
              {c ? categoryLabel(c) : "All"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[132px] animate-pulse rounded-[16px] bg-foreground/[0.04]" />)}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState className="mt-6" icon={SquaresFourIcon} title="No templates match" description="Try another search or category." />
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => open(t)}
              className="group flex flex-col rounded-[16px] border border-[var(--dz-hairline)] bg-card p-4 text-left transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-px hover:border-foreground/15 hover:shadow-[0_10px_30px_-18px_rgb(0_0_0/0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              <div className="flex items-start gap-3">
                <Logo t={t} />
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="flex items-center gap-1 truncate text-[14px] font-semibold tracking-[-0.01em]">
                    <span className="truncate">{t.name}</span>
                    {t.is_official && <SealCheckIcon className="h-4 w-4 shrink-0 text-[var(--dz-green-strong)] dark:text-brand" aria-label="Official" />}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">{t.tagline}</p>
                </div>
              </div>
              <div className="mt-auto flex items-center gap-2 pt-4 text-[12px] text-muted-foreground">
                <span>{categoryLabel(t.category || "app")}</span>
                {t.deploy_count > 0 && (
                  <>
                    <span aria-hidden className="text-foreground/20">·</span>
                    <span className="inline-flex items-center gap-1 tabular-nums"><DownloadSimpleIcon className="h-3.5 w-3.5" />{t.deploy_count.toLocaleString()}</span>
                  </>
                )}
                {t.is_featured && <span className="rounded-full bg-amber-500/10 px-1.5 py-px text-[11px] font-medium text-amber-700 dark:text-amber-400">Featured</span>}
                <ArrowRightIcon className="ml-auto h-4 w-4 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
