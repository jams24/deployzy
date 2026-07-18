import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Clock, Tag, ArrowRight } from "lucide-react";

export const revalidate = 60;

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

type SectionType = "h2" | "h3" | "p" | "ul" | "ol" | "code" | "callout" | "cta";

interface Section {
  type: SectionType;
  content?: string;
  items?: string[];
  language?: string;
  calloutType?: "info" | "warning" | "tip";
  ctaText?: string;
  ctaHref?: string;
}

interface BlogPost {
  id: string;
  slug: string;
  title: string;
  description: string;
  excerpt: string;
  content: Section[];
  cover_image: string | null;
  category: string;
  tags: string[];
  author: string;
  read_time: string;
  status: string;
  published_at: string | null;
  updated_at: string;
}

async function getPost(slug: string): Promise<BlogPost | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/blog/posts/${slug}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Parse content if it came back as a string
    if (typeof data.content === "string") {
      try { data.content = JSON.parse(data.content); } catch { data.content = []; }
    }
    if (!Array.isArray(data.content)) data.content = [];
    return data;
  } catch {
    return null;
  }
}

async function getAllPosts(): Promise<BlogPost[]> {
  try {
    const res = await fetch(`${API_URL}/api/v1/blog/posts`, { next: { revalidate: 60 } });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return {};

  const ogImageUrl = post.cover_image
    ? post.cover_image.startsWith("/api") ? `${API_URL}${post.cover_image}` : post.cover_image
    : "https://deployzy.com/og-blog.png";

  return {
    title: `${post.title} | Deployzy Blog`,
    description: post.description,
    keywords: post.tags,
    alternates: { canonical: `https://deployzy.com/blog/${post.slug}` },
    openGraph: {
      title: post.title,
      description: post.description,
      url: `https://deployzy.com/blog/${post.slug}`,
      type: "article",
      publishedTime: post.published_at ?? undefined,
      modifiedTime: post.updated_at,
      authors: [post.author],
      tags: post.tags,
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: post.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: [ogImageUrl],
    },
  };
}

const CATEGORY_COLORS: Record<string, string> = {
  Comparisons: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Tutorials:   "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Databases:   "bg-purple-500/10 text-purple-400 border-purple-500/20",
  Tools:       "bg-orange-500/10 text-orange-400 border-orange-500/20",
  General:     "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
};

const CALLOUT_STYLES = {
  info:    { border: "border-blue-500/30 bg-blue-500/5", icon: "💡", text: "text-blue-300" },
  warning: { border: "border-amber-500/30 bg-amber-500/5", icon: "⚠️", text: "text-amber-300" },
  tip:     { border: "border-emerald-500/30 bg-emerald-500/5", icon: "✅", text: "text-emerald-300" },
};

function renderSection(section: Section, i: number) {
  switch (section.type) {
    case "h2":
      return (
        <h2 key={i} className="mt-10 mb-4 text-2xl font-bold tracking-tight text-foreground scroll-mt-20">
          {section.content}
        </h2>
      );
    case "h3":
      return (
        <h3 key={i} className="mt-7 mb-3 text-xl font-semibold text-foreground">
          {section.content}
        </h3>
      );
    case "p":
      return (
        <p key={i} className="my-4 text-[15px] leading-7 text-muted-foreground">
          {section.content}
        </p>
      );
    case "ul":
      return (
        <ul key={i} className="my-4 space-y-2 pl-5">
          {(section.items || []).map((item, j) => (
            <li key={j} className="flex gap-2 text-[15px] leading-7 text-muted-foreground">
              <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={i} className="my-4 space-y-2 pl-5">
          {(section.items || []).map((item, j) => (
            <li key={j} className="flex gap-3 text-[15px] leading-7 text-muted-foreground">
              <span className="shrink-0 font-mono text-[13px] text-primary font-bold w-5">{j + 1}.</span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      );
    case "code":
      return (
        <div key={i} className="my-6 rounded-xl overflow-hidden border border-border/40">
          <div className="flex items-center justify-between bg-zinc-900 px-4 py-2 border-b border-border/30">
            <span className="font-mono text-[11px] text-zinc-500">{section.language || "bash"}</span>
          </div>
          <pre className="overflow-x-auto bg-[#0d0d0d] p-4">
            <code className="font-mono text-[13px] leading-6 text-zinc-200">{section.content}</code>
          </pre>
        </div>
      );
    case "callout": {
      const style = CALLOUT_STYLES[section.calloutType || "info"];
      return (
        <div key={i} className={`my-6 flex gap-3 rounded-xl border ${style.border} p-4`}>
          <span className="shrink-0 text-lg leading-none mt-0.5">{style.icon}</span>
          <p className="text-[14px] leading-6 text-muted-foreground">{section.content}</p>
        </div>
      );
    }
    case "cta":
      return (
        <div key={i} className="my-10 rounded-2xl border border-primary/20 bg-primary/5 p-8 text-center">
          <p className="text-muted-foreground mb-5 max-w-lg mx-auto text-[15px]">{section.content}</p>
          <Link
            href={section.ctaHref || "/sign-up"}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {section.ctaText || "Get started"} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      );
    default:
      return null;
  }
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [post, allPosts] = await Promise.all([getPost(slug), getAllPosts()]);
  if (!post || post.status !== "published") notFound();

  const related = allPosts
    .filter((p) => p.slug !== post.slug && p.status === "published")
    .slice(0, 2);

  const ogImage = post.cover_image
    ? post.cover_image.startsWith("/api") ? `${API_URL}${post.cover_image}` : post.cover_image
    : "https://deployzy.com/og-blog.png";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.published_at,
    dateModified: post.updated_at,
    author: { "@type": "Organization", name: post.author, url: "https://deployzy.com" },
    publisher: {
      "@type": "Organization",
      name: "Deployzy",
      url: "https://deployzy.com",
      logo: { "@type": "ImageObject", url: "https://deployzy.com/logo-mark.png" },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": `https://deployzy.com/blog/${post.slug}` },
    keywords: post.tags.join(", "),
    articleSection: post.category,
    image: ogImage,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex gap-12 lg:gap-16">
          {/* Main content */}
          <article className="flex-1 min-w-0">
            {/* Back link */}
            <Link
              href="/blog"
              className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> All posts
            </Link>

            {/* Cover image */}
            {post.cover_image && (
              <div className="mb-8 rounded-2xl overflow-hidden border border-border/40">
                <img
                  src={post.cover_image.startsWith("/api") ? `${API_URL}${post.cover_image}` : post.cover_image}
                  alt={post.title}
                  className="w-full h-64 object-cover"
                />
              </div>
            )}

            {/* Meta */}
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${CATEGORY_COLORS[post.category] ?? "bg-zinc-500/10 text-zinc-400"}`}>
                <Tag className="h-2.5 w-2.5" /> {post.category}
              </span>
              <span className="text-[12px] text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" /> {post.read_time}
              </span>
              <time dateTime={post.published_at || ""} className="text-[12px] text-muted-foreground">
                {formatDate(post.published_at)}
              </time>
              <span className="text-[12px] text-muted-foreground">by {post.author}</span>
            </div>

            {/* Title */}
            <h1 className="text-3xl sm:text-4xl font-bold leading-tight tracking-tight mb-6">
              {post.title}
            </h1>

            {/* Lead */}
            <p className="text-lg text-muted-foreground leading-relaxed border-l-4 border-primary/40 pl-4 mb-8">
              {post.excerpt || post.description}
            </p>

            {/* Divider */}
            <hr className="border-border/40 mb-8" />

            {/* Body */}
            <div>
              {(post.content || []).map((s, i) => renderSection(s, i))}
              {post.content.length === 0 && (
                <p className="text-muted-foreground italic">This post has no content yet.</p>
              )}
            </div>

            {/* Tags */}
            {post.tags.length > 0 && (
              <div className="mt-12 pt-6 border-t border-border/40 flex flex-wrap gap-2">
                {post.tags.map((tag) => (
                  <span key={tag} className="rounded-full border border-border/60 px-3 py-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </article>

          {/* Sidebar */}
          <aside className="hidden lg:flex flex-col gap-6 w-64 shrink-0">
            <div className="sticky top-24 space-y-5">
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <img src="/logo-mark.png" alt="Deployzy" className="h-7 w-7 rounded-md" />
                  <span className="font-bold text-sm">Deployzy</span>
                </div>
                <p className="text-[13px] text-muted-foreground leading-relaxed mb-4">
                  Deploy apps from GitHub, tunnel localhost, manage databases — all on your own VPS.
                </p>
                <Link
                  href="/sign-up"
                  className="block w-full text-center rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Get started free →
                </Link>
              </div>

              {related.length > 0 && (
                <div className="space-y-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Related articles</p>
                  {related.map((p) => (
                    <Link key={p.slug} href={`/blog/${p.slug}`} className="group block rounded-lg border border-border/40 p-3 hover:bg-card/60 transition-colors">
                      <span className={`inline-block rounded-full border px-1.5 py-0.5 text-[9px] font-semibold mb-1.5 ${CATEGORY_COLORS[p.category] ?? ""}`}>{p.category}</span>
                      <p className="text-[12px] font-medium leading-snug group-hover:text-primary transition-colors">{p.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-1">{p.read_time}</p>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
