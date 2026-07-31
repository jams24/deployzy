"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, Download, Star, ArrowRight } from "lucide-react";
import { BrandLogo } from "@/components/brand-logos";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface Template {
  slug: string; name: string; tagline: string; category: string;
  logo_slug: string; color: string; deploy_count: number; star_count: number;
  is_featured: boolean; is_official: boolean;
}

type Tab = "popular" | "featured" | "newest";

export default function TemplatesGalleryPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("popular");
  const [q, setQ] = useState("");

  useEffect(() => {
    setLoading(true);
    const sort = tab === "featured" ? "featured" : tab === "newest" ? "newest" : "popular";
    fetch(`${API}/api/v1/templates?sort=${sort}&limit=200`)
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d) => setTemplates(d.templates ?? []))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, [tab]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return templates;
    return templates.filter(
      (t) => t.name.toLowerCase().includes(s) || t.tagline.toLowerCase().includes(s) || t.category.toLowerCase().includes(s)
    );
  }, [templates, q]);

  return (
    <div className="mx-auto max-w-6xl px-6 pt-28 pb-24">
      {/* Hero + search */}
      <div className="text-center max-w-2xl mx-auto">
        <h1 className="text-3xl sm:text-5xl font-bold tracking-tight">Deploy an app in minutes</h1>
        <p className="mt-3 text-muted-foreground">
          Databases, tools, bots and starters — pre-configured and ready to run on Deployzy.
        </p>
        <div className="mt-7 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="What would you like to deploy today?"
            className="w-full h-12 rounded-xl border border-border bg-background/60 pl-11 pr-4 text-sm outline-none focus:border-foreground/30 transition-colors"
          />
        </div>
      </div>

      {/* Tabs + count */}
      <div className="mt-12 flex items-center justify-between border-b border-border/50 pb-px">
        <div className="flex items-center gap-1">
          {(["popular", "featured", "newest"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`relative px-3 py-2 text-sm font-medium capitalize transition-colors ${
                tab === t ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
              {tab === t && <span className="absolute left-0 -bottom-px h-0.5 w-full bg-foreground rounded-full" />}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">All templates ({templates.length})</span>
      </div>

      {/* Grid */}
      {loading ? (
        <p className="mt-16 text-center text-sm text-muted-foreground">Loading templates…</p>
      ) : filtered.length === 0 ? (
        <p className="mt-16 text-center text-sm text-muted-foreground">No templates match “{q}”.</p>
      ) : (
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {filtered.map((t) => (
            <Link
              key={t.slug}
              href={`/templates/${encodeURIComponent(t.slug)}`}
              className="group flex flex-col rounded-xl border border-border/60 p-5 transition-all hover:border-foreground/25 hover:shadow-sm"
            >
              <span
                className="flex h-10 w-10 items-center justify-center rounded-lg"
                style={{ background: (t.color || "#888") + "14", border: `1px solid ${(t.color || "#888")}33` }}
              >
                <BrandLogo logoSlug={t.logo_slug} slug={t.slug} name={t.name} color={t.color} className="h-5 w-5" />
              </span>
              <p className="mt-3 text-sm font-semibold truncate">{t.name}</p>
              <p className="mt-1 flex-1 text-xs text-muted-foreground line-clamp-2">{t.tagline}</p>
              <div className="mt-4 flex items-center gap-3 text-[11px] text-muted-foreground">
                {t.deploy_count > 0 && <span className="flex items-center gap-1"><Download className="h-3 w-3" />{t.deploy_count.toLocaleString()}</span>}
                {t.star_count > 0 && <span className="flex items-center gap-1"><Star className="h-3 w-3" />{t.star_count.toLocaleString()}</span>}
                <span className="ml-auto flex items-center gap-1 font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                  Deploy <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
