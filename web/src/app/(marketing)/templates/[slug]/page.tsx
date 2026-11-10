import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BadgeCheck, Calendar, Download, KeyRound, Lock, ShieldCheck, Sparkles, Star, Wand2 } from "lucide-react";
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

const STEPS = [
  { title: "Fill in a few settings", body: "Defaults are already set. Change only what you need." },
  { title: "We build and provision it", body: "Container, storage and secrets are created for you." },
  { title: "Live on HTTPS", body: "You get a URL right away and can add your own domain later." },
];

export default async function TemplateDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await getTemplate(slug);
  if (!t) notFound();

  const color = t.color || "#888888";
  const created = t.created_at ? new Date(t.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
  const envVars = t.env_vars || [];
  const userVars = envVars.filter((e) => e.type !== "auto");
  const autoVars = envVars.filter((e) => e.type === "auto");

  return (
    <div className="relative">
      {/* Template-tinted glow + fading grid behind the hero */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[460px] overflow-hidden">
        <div className="absolute -top-44 left-[18%] h-80 w-[620px] rounded-full blur-[120px]" style={{ background: color + "26" }} />
        <div className="absolute -top-24 right-[8%] h-56 w-[420px] rounded-full bg-brand/[0.07] blur-[110px]" />
        <div className="mask-fade-b absolute inset-0 text-foreground/[0.035]"><div className="bg-grid absolute inset-0" /></div>
      </div>

      <div className="relative mx-auto max-w-[1120px] px-5 py-10 sm:px-6 sm:py-16">
        <Link href="/templates" className="inline-flex items-center gap-1.5 text-[13.5px] text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> All templates
        </Link>

        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-12">
          {/* Hero */}
          <header className="rise min-w-0">
            <span
              className="flex h-16 w-16 items-center justify-center rounded-[20px] shadow-[0_18px_50px_-20px_var(--glow)]"
              style={{ background: color + "14", border: `1px solid ${color}40`, ["--glow" as string]: color }}
            >
              <BrandLogo logoSlug={t.logo_slug} slug={t.slug} name={t.name} color={t.color} className="h-8 w-8" />
            </span>
            <p className="eyebrow mt-6 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{t.category || "Template"}</span>
              {t.is_official && (
                <>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1 text-brand-cyan"><BadgeCheck className="h-3.5 w-3.5" />Official</span>
                </>
              )}
            </p>
            <h1 className="mt-3 text-[clamp(2.2rem,5.4vw,3.6rem)] font-semibold leading-[1.02] tracking-[-0.045em]">{t.name}</h1>
            <p className="mt-4 max-w-2xl text-[16.5px] leading-relaxed text-muted-foreground sm:text-[18px]">{t.tagline}</p>
            <div className="mt-6 flex flex-wrap gap-2 text-[13px] text-muted-foreground">
              <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--dz-hairline)] px-3 tabular-nums"><Download className="h-3.5 w-3.5" />{t.deploy_count.toLocaleString()} deploy{t.deploy_count === 1 ? "" : "s"}</span>
              <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--dz-hairline)] px-3 tabular-nums"><Star className="h-3.5 w-3.5" />{t.star_count.toLocaleString()} star{t.star_count === 1 ? "" : "s"}</span>
              {created && <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--dz-hairline)] px-3"><Calendar className="h-3.5 w-3.5" />Added {created}</span>}
            </div>
          </header>

          {/* Deploy card — sits right under the hero on phones, sticky beside the content on desktop */}
          <aside className="lg:row-span-2">
            <div className="surface rise rounded-[24px] p-5 sm:p-6 lg:sticky lg:top-24" style={{ animationDelay: "0.08s" }}>
              <p className="text-[15px] font-semibold tracking-tight">Deploy {t.name}</p>
              <p className="mt-1 text-[13.5px] text-muted-foreground">
                {userVars.length > 0 ? `${userVars.length} setting${userVars.length === 1 ? "" : "s"} to review, the rest is automatic.` : "No setup needed: one click and it's live."}
              </p>
              <div className="mt-5">
                <TemplateDeploy slug={t.slug} name={t.name} envVars={envVars} requiredPlan={t.required_plan || ""} />
              </div>
              <ul className="mt-5 space-y-2 border-t border-[var(--dz-hairline)] pt-4 text-[13px] text-muted-foreground">
                <li className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-[var(--dz-green-strong)] dark:text-brand" />HTTPS and a deployzy.app URL included</li>
                <li className="flex items-center gap-2"><Wand2 className="h-3.5 w-3.5 text-[var(--dz-green-strong)] dark:text-brand" />Secrets generated for you</li>
                {t.required_plan && <li className="flex items-center gap-2"><Lock className="h-3.5 w-3.5 text-amber-500" /><span className="capitalize">{t.required_plan}</span> plan or higher</li>}
              </ul>
            </div>
          </aside>

          {/* Content */}
          <div className="min-w-0 space-y-5">
            {t.description && (
              <section className="surface rise rounded-[24px] p-5 sm:p-7" style={{ animationDelay: "0.12s" }}>
                <p className="eyebrow">About</p>
                <p className="mt-3 whitespace-pre-wrap text-[15.5px] leading-relaxed text-foreground/85">{t.description}</p>
              </section>
            )}

            <section className="surface rise rounded-[24px] p-5 sm:p-7" style={{ animationDelay: "0.16s" }}>
              <p className="eyebrow">How it works</p>
              <ol className="mt-4 grid gap-4 sm:grid-cols-3">
                {STEPS.map((s, i) => (
                  <li key={s.title} className="relative">
                    <span className="figure flex h-7 w-7 items-center justify-center rounded-full bg-brand/10 text-[12.5px] font-semibold text-[var(--dz-green-strong)] dark:text-brand">{i + 1}</span>
                    <p className="mt-3 text-[14.5px] font-semibold tracking-tight">{s.title}</p>
                    <p className="mt-1 text-[13.5px] leading-snug text-muted-foreground">{s.body}</p>
                  </li>
                ))}
              </ol>
            </section>

            {envVars.length > 0 && (
              <section className="surface rise rounded-[24px] p-5 sm:p-7" style={{ animationDelay: "0.2s" }}>
                <p className="eyebrow">Configuration</p>
                <ul className="mt-4 divide-y divide-[var(--dz-hairline)]">
                  {userVars.map((v) => (
                    <li key={v.key} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                      <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium">
                          {v.label || v.key}
                          {v.required && <span className="rounded-full bg-red-500/10 px-1.5 py-px text-[11.5px] font-medium text-red-600 dark:text-red-400">Required</span>}
                        </p>
                        <p className="mt-0.5 font-mono text-[12.5px] text-muted-foreground">{v.key}{v.default ? ` = ${v.type === "secret" ? "••••" : v.default}` : ""}</p>
                        {v.description && <p className="mt-1 text-[13.5px] text-muted-foreground">{v.description}</p>}
                      </div>
                    </li>
                  ))}
                  {autoVars.length > 0 && (
                    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium">{autoVars.length} value{autoVars.length === 1 ? "" : "s"} set automatically</p>
                        <p className="mt-1 break-words font-mono text-[12.5px] text-muted-foreground">{autoVars.map((v) => v.key).join(" · ")}</p>
                      </div>
                    </li>
                  )}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
