import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Star, Calendar, Tag } from "lucide-react";
import { BrandLogo } from "@/components/brand-logos";
import { TemplateDeploy } from "@/components/marketing/template-deploy";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface EnvVarSchema { key: string; label?: string; type?: string; required?: boolean; default?: string; description?: string; }
interface Template {
  slug: string; name: string; tagline: string; description: string; category: string;
  logo_slug: string; color: string; deploy_count: number; star_count: number;
  is_official: boolean; created_at: string; env_vars: EnvVarSchema[]; required_plan?: string;
}

async function getTemplate(slug: string): Promise<Template | null> {
  try {
    const res = await fetch(`${API}/api/v1/templates/${encodeURIComponent(slug)}`, { next: { revalidate: 120 } });
    if (!res.ok) return null;
    return (await res.json()) as Template;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await getTemplate(slug);
  if (!t) return { title: "Template — Deployzy" };
  return { title: `${t.name} — Deploy on Deployzy`, description: t.tagline };
}

export default async function TemplateDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await getTemplate(slug);
  if (!t) notFound();

  const created = t.created_at ? new Date(t.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";

  return (
    <div className="mx-auto max-w-5xl px-6 pt-28 pb-24">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link href="/" className="hover:text-foreground">Home</Link>
        <span>/</span>
        <Link href="/templates" className="hover:text-foreground">Templates</Link>
        <span>/</span>
        <span className="text-foreground">{t.name}</span>
      </nav>

      <div className="mt-8 grid md:grid-cols-3 gap-10">
        {/* Main */}
        <div className="md:col-span-2">
          <div className="flex items-center gap-4">
            <span
              className="flex h-14 w-14 items-center justify-center rounded-xl"
              style={{ background: (t.color || "#888") + "14", border: `1px solid ${(t.color || "#888")}33` }}
            >
              <BrandLogo logoSlug={t.logo_slug} slug={t.slug} name={t.name} color={t.color} className="h-7 w-7" />
            </span>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t.name}</h1>
              <p className="text-muted-foreground">{t.tagline}</p>
            </div>
          </div>

          {t.description && (
            <div className="mt-8 rounded-xl border border-border/60 p-5 text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
              {t.description}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="space-y-5">
          <TemplateDeploy slug={t.slug} name={t.name} envVars={t.env_vars || []} requiredPlan={t.required_plan || ""} />

          <div className="rounded-xl border border-border/60 p-4 space-y-3 text-sm">
            {t.is_official && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <BrandLogo slug="deployzy" name="Deployzy" className="h-4 w-4" /> Deployzy Templates
              </div>
            )}
            {created && <div className="flex items-center gap-2 text-muted-foreground"><Calendar className="h-3.5 w-3.5" /> Created {created}</div>}
            <div className="flex items-center gap-2 text-muted-foreground"><Download className="h-3.5 w-3.5" /> {t.deploy_count.toLocaleString()} deploys</div>
            <div className="flex items-center gap-2 text-muted-foreground"><Star className="h-3.5 w-3.5" /> {t.star_count.toLocaleString()} stars</div>
            {t.category && <div className="flex items-center gap-2 text-muted-foreground capitalize"><Tag className="h-3.5 w-3.5" /> {t.category}</div>}
          </div>
        </aside>
      </div>
    </div>
  );
}
