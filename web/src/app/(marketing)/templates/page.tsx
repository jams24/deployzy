"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, Download, Star, ArrowRight, ArrowUpRight, GitBranch, Box, BadgeCheck, X } from "lucide-react";
import { BrandLogo } from "@/components/brand-logos";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface Template {
  slug: string; name: string; tagline: string; category: string;
  logo_slug: string; color: string; deploy_count: number; star_count: number;
  is_featured: boolean; is_official: boolean;
}

type Tab = "popular" | "featured" | "newest";
const TABS: { id: Tab; label: string }[] = [
  { id: "popular", label: "Popular" },
  { id: "featured", label: "Featured" },
  { id: "newest", label: "Newest" },
];

const tint = (c: string, a: string) => (c || "#888888") + a;

const ACRONYMS = new Set(["cms", "ai", "vpn", "api", "crm", "seo", "llm", "db"]);
function categoryLabel(c: string) {
  const k = c.trim().toLowerCase();
  if (ACRONYMS.has(k)) return k.toUpperCase();
  return k.charAt(0).toUpperCase() + k.slice(1);
}

export default function TemplatesGalleryPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("popular");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");

  useEffect(() => {
    let alive = true;
    fetch(`${API}/api/v1/templates?sort=${tab}&limit=200`)
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d) => { if (alive) setTemplates(d.templates ?? []); })
      .catch(() => { if (alive) setTemplates([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tab]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of templates) if (t.category) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [templates]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return templates.filter((t) =>
      (!cat || t.category === cat) &&
      (!s || t.name.toLowerCase().includes(s) || t.tagline.toLowerCase().includes(s) || t.category.toLowerCase().includes(s))
    );
  }, [templates, q, cat]);

  const totalDeploys = templates.reduce((n, t) => n + (t.deploy_count || 0), 0);

  return (
    <div className="relative">
      {/* Decoration: brand glow + fading grid behind the header */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[520px] overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-80 w-[760px] -translate-x-1/2 rounded-full bg-brand/[0.09] blur-[120px]" />
        <div className="absolute -top-20 right-[10%] h-56 w-[420px] rounded-full bg-brand-cyan/[0.06] blur-[110px]" />
        <div className="mask-fade-b absolute inset-0 text-foreground/[0.035]"><div className="bg-grid absolute inset-0" /></div>
      </div>

      <div className="relative mx-auto max-w-[1200px] px-5 py-14 sm:px-6 sm:py-20">
        {/* Header */}
        <header className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="max-w-3xl">
            <p className="eyebrow rise">Templates</p>
            <h1 className="rise mt-4 text-[clamp(2.4rem,6vw,4.25rem)] font-semibold leading-[1] tracking-[-0.045em]" style={{ animationDelay: "0.06s" }}>
              Deploy an app <span className="accent-serif whitespace-nowrap">in minutes</span>
            </h1>
            <p className="rise mt-5 max-w-2xl text-[16px] leading-relaxed text-muted-foreground sm:text-[17.5px]" style={{ animationDelay: "0.12s" }}>
              Databases, tools, bots and starters, pre-configured and ready to run on Deployzy. Pick one, fill in a few settings, and it&apos;s live on HTTPS.
            </p>
          </div>
          {!loading && templates.length > 0 && (
            <dl className="rise hidden gap-8 sm:flex lg:pb-2" style={{ animationDelay: "0.18s" }}>
              <div>
                <dt className="eyebrow">Templates</dt>
                <dd className="figure mt-1.5 text-[28px] font-semibold tracking-tight">{templates.length}</dd>
              </div>
              <div>
                <dt className="eyebrow">Deploys</dt>
                <dd className="figure mt-1.5 text-[28px] font-semibold tracking-tight">{totalDeploys.toLocaleString()}</dd>
              </div>
            </dl>
          )}
        </header>

        {/* Toolbar: search, sort, categories */}
        <div className="rise mt-10 space-y-3 sm:mt-12" style={{ animationDelay: "0.2s" }}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="surface relative flex h-12 items-center rounded-full sm:flex-1 transition-colors focus-within:border-foreground/25">
              <Search className="pointer-events-none absolute left-4 h-4 w-4 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="What would you like to deploy today?"
                aria-label="Search templates"
                className="h-full w-full rounded-full bg-transparent pl-11 pr-10 text-[15px] outline-none placeholder:text-muted-foreground/80"
              />
              {q && (
                <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-3 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
            <div role="tablist" aria-label="Sort templates" className="surface flex h-12 shrink-0 items-center gap-1 rounded-full p-1">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => { if (t.id !== tab) { setLoading(true); setTab(t.id); } }}
                  className={`h-full flex-1 rounded-full px-4 text-[14px] font-medium transition-colors sm:flex-none ${
                    tab === t.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {categories.length > 1 && (
            <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
              {["", ...categories].map((c) => (
                <button
                  key={c || "all"}
                  type="button"
                  onClick={() => setCat(c)}
                  className={`h-8 shrink-0 rounded-full border px-3.5 text-[13.5px] font-medium transition-colors ${
                    cat === c
                      ? "border-brand/40 bg-brand/10 text-[var(--dz-green-strong)] dark:text-brand"
                      : "border-[var(--dz-hairline)] text-muted-foreground hover:border-foreground/20 hover:text-foreground"
                  }`}
                >
                  {c ? categoryLabel(c) : "All"}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Grid */}
        {loading ? (
          <div className="mt-8 grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="surface h-[92px] animate-pulse rounded-[22px] sm:h-[212px]" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-8 rounded-[22px] border border-dashed border-[var(--dz-hairline)] px-6 py-16 text-center">
            <p className="text-[15px] font-semibold">No templates match{q ? ` “${q}”` : ""}</p>
            <p className="mx-auto mt-1 max-w-sm text-[13.5px] text-muted-foreground">Try another word, or deploy any repo or Docker image directly.</p>
          </div>
        ) : (
          <div className="mt-8 grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            {filtered.map((t, i) => (
              <Link
                key={t.slug}
                href={`/templates/${encodeURIComponent(t.slug)}`}
                className="surface rise group relative flex items-center gap-4 overflow-hidden rounded-[22px] p-4 transition-[border-color,transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:border-brand/40 sm:flex-col sm:items-stretch sm:gap-0 sm:p-5"
                style={{ animationDelay: `${0.04 * Math.min(i, 10)}s` }}
              >
                {/* Per-template color wash on hover */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
                  style={{ background: tint(t.color, "33") }}
                />
                <span
                  className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
                  style={{ background: tint(t.color, "14"), border: `1px solid ${tint(t.color, "33")}` }}
                >
                  <BrandLogo logoSlug={t.logo_slug} slug={t.slug} name={t.name} color={t.color} className="h-6 w-6" />
                </span>
                <div className="relative min-w-0 flex-1 sm:mt-4">
                  <p className="flex items-center gap-1.5 text-[15.5px] font-semibold tracking-tight">
                    <span className="truncate">{t.name}</span>
                    {t.is_official && <BadgeCheck className="h-4 w-4 shrink-0 text-brand-cyan" aria-label="Official" />}
                  </p>
                  <p className="mt-1 line-clamp-2 text-[13.5px] leading-snug text-muted-foreground">{t.tagline}</p>
                </div>
                <ArrowUpRight className="relative h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground sm:hidden" />
                <div className="relative mt-5 hidden items-center gap-3 text-[12.5px] text-muted-foreground sm:flex">
                  {t.deploy_count > 0 && <span className="figure flex items-center gap-1"><Download className="h-3.5 w-3.5" />{t.deploy_count.toLocaleString()}</span>}
                  {t.star_count > 0 && <span className="figure flex items-center gap-1"><Star className="h-3.5 w-3.5" />{t.star_count.toLocaleString()}</span>}
                  {t.is_featured && <span className="rounded-full bg-amber-500/10 px-2 py-px text-[11.5px] font-medium text-amber-600 dark:text-amber-400">Featured</span>}
                  <span className="ml-auto flex items-center gap-1 font-medium transition-colors group-hover:text-[var(--dz-green-strong)] dark:group-hover:text-brand">
                    Deploy <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Not in the catalog? */}
        <div className="dark grain relative mt-14 overflow-hidden rounded-[26px] bg-[#0b0c10] p-7 text-white sm:mt-20 sm:p-10">
          <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand/20 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-28 left-10 h-64 w-64 rounded-full bg-brand-cyan/10 blur-3xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <p className="eyebrow">Bring your own</p>
              <h2 className="mt-3 text-[clamp(1.6rem,3.4vw,2.4rem)] font-semibold leading-[1.08] tracking-[-0.035em]">
                Don&apos;t see your stack? <span className="accent-serif">Deploy it anyway.</span>
              </h2>
              <p className="mt-3 text-[15.5px] leading-relaxed text-white/60">
                Push any GitHub repo or Docker image. We detect the framework, build it and give you a live URL.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/sign-up?redirect=%2Fnew" className="pill pill-launch">
                <GitBranch className="h-4 w-4" /> Deploy a repo
              </Link>
              <Link href="/docs" className="pill pill-line">
                <Box className="h-4 w-4" /> Read the docs
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
