import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Clock, Tag, ArrowRight, ChevronRight } from "lucide-react";
import { categoryTone, formatPostDate as formatDate } from "@/lib/blog-ui";
import { BlogToc, type Heading } from "./blog-toc";
import { DiscussRail, BlogShare } from "./blog-share";

export const revalidate = 60;

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

// A URL-safe slug for heading anchors + TOC ids.
function slugifyHeading(text: string, i: number): string {
  const base = (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return base ? `${base}-${i}` : `section-${i}`;
}

// "@name", "name" or an x.com / twitter.com profile URL → "name".
function handleFrom(value: string | undefined): string {
  return (value || "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").split(/[/?#]/)[0];
}
const isProfileUrl = (u: string) => /^https?:\/\/(www\.)?(x|twitter)\.com\//i.test(u);

// Author avatar: an explicit image URL wins; an X profile URL pasted into the
// avatar field (x.com refuses to be embedded as an image) or the author's X
// handle goes through unavatar.io; otherwise null → render initials.
function authorAvatar(post: BlogPost): string | null {
  const explicit = (post.author_avatar || "").trim();
  if (explicit && !isProfileUrl(explicit)) return explicit;
  const handle = handleFrom(post.author_twitter) || (explicit ? handleFrom(explicit) : "");
  return handle ? `https://unavatar.io/x/${handle}` : null;
}

function twitterHandle(post: BlogPost): string {
  const a = (post.author_avatar || "").trim();
  return handleFrom(post.author_twitter) || (isProfileUrl(a) ? handleFrom(a) : "");
}

function initials(name: string): string {
  return (name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

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
  author_twitter?: string;
  author_role?: string;
  author_avatar?: string;
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

  // When the post has an explicit cover image, use it. Otherwise omit images
  // here and let the co-located opengraph-image.tsx generate a branded card with
  // the post's title (previously this pointed at og-blog.png, which 404s).
  const coverUrl = post.cover_image
    ? post.cover_image.startsWith("/api") ? `${API_URL}${post.cover_image}` : post.cover_image
    : null;

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
      ...(coverUrl ? { images: [{ url: coverUrl, width: 1200, height: 630, alt: post.title }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      site: "@itsjamsltn",
      creator: "@itsjamsltn",
      title: post.title,
      description: post.description,
      ...(coverUrl ? { images: [coverUrl] } : {}),
    },
  };
}

const CALLOUT_STYLES = {
  info:    { border: "border-sky-500/25 bg-sky-500/[0.06]", icon: "💡" },
  warning: { border: "border-amber-500/30 bg-amber-500/[0.07]", icon: "⚠️" },
  tip:     { border: "border-brand/30 bg-brand/[0.06]", icon: "✅" },
};

function renderSection(section: Section, i: number, anchorId?: string) {
  switch (section.type) {
    case "h2":
      return (
        <h2 key={i} id={anchorId} className="group mt-14 mb-4 scroll-mt-24 text-[clamp(1.4rem,2.6vw,1.75rem)] font-semibold tracking-[-0.025em] text-foreground">
          <a href={anchorId ? `#${anchorId}` : undefined} className="no-underline">
            {section.content}
          </a>
        </h2>
      );
    case "h3":
      return (
        <h3 key={i} id={anchorId} className="mt-9 mb-3 scroll-mt-24 text-[19px] font-semibold tracking-[-0.015em] text-foreground">
          {section.content}
        </h3>
      );
    case "p":
      return (
        <p key={i} className="my-4 text-[16px] leading-[1.8] text-foreground/75">
          {section.content}
        </p>
      );
    case "ul":
      return (
        <ul key={i} className="my-4 space-y-2 pl-5">
          {(section.items || []).map((item, j) => (
            <li key={j} className="flex gap-2.5 text-[16px] leading-[1.75] text-foreground/75">
              <span className="mt-[0.7em] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={i} className="my-4 space-y-2 pl-5">
          {(section.items || []).map((item, j) => (
            <li key={j} className="flex gap-3 text-[16px] leading-[1.75] text-foreground/75">
              <span className="figure w-5 shrink-0 font-semibold text-brand">{j + 1}.</span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      );
    case "code":
      return (
        <div key={i} className="my-7 overflow-hidden rounded-xl border border-white/[0.06] bg-[#0b0c10]">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2">
            <span className="h-2 w-2 rounded-full bg-white/10" />
            <span className="h-2 w-2 rounded-full bg-white/10" />
            <span className="ml-1.5 font-mono text-[11.5px] text-white/40">{section.language || "bash"}</span>
          </div>
          <pre className="overflow-x-auto p-4">
            <code className="font-mono text-[13.5px] leading-6 text-white/85">{section.content}</code>
          </pre>
        </div>
      );
    case "callout": {
      const style = CALLOUT_STYLES[section.calloutType || "info"];
      return (
        <div key={i} className={`my-6 flex gap-3 rounded-xl border ${style.border} p-4`}>
          <span className="shrink-0 text-lg leading-none mt-0.5">{style.icon}</span>
          <p className="text-[15px] leading-relaxed text-foreground/80">{section.content}</p>
        </div>
      );
    }
    case "cta":
      return (
        <div key={i} className="dark grain relative my-10 overflow-hidden rounded-2xl bg-[#0b0c10] p-8 text-center text-white">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-48 w-2/3 rounded-full bg-brand/20 blur-3xl" />
          <p className="relative mx-auto mb-6 max-w-lg text-[16px] leading-relaxed text-white/70">{section.content}</p>
          <Link href={section.ctaHref || "/sign-up"} className="pill pill-launch relative">
            {section.ctaText || "Get started"} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      );
    default:
      return null;
  }
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

  // Build the "On this page" heading list from h2/h3 sections, and a parallel
  // map so we render matching ids on the headings themselves.
  const anchorIds: (string | undefined)[] = [];
  const headings: Heading[] = [];
  (post.content || []).forEach((s, i) => {
    if (s.type === "h2" || s.type === "h3") {
      const id = slugifyHeading(s.content || "", i);
      anchorIds[i] = id;
      headings.push({ id, text: s.content || "", level: s.type === "h2" ? 2 : 3 });
    } else {
      anchorIds[i] = undefined;
    }
  });

  const avatar = authorAvatar(post);
  const handle = twitterHandle(post);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="mx-auto max-w-[1240px] px-5 py-12 sm:px-6 sm:py-16">
        {/* Breadcrumb */}
        <div className="mb-8 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Link href="/blog" className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
            <ArrowLeft className="h-3 w-3" /> Blog
          </Link>
          <ChevronRight className="h-3 w-3 opacity-50" />
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${categoryTone(post.category)}`}>
            <Tag className="h-2.5 w-2.5" /> {post.category}
          </span>
        </div>

        <div className="flex gap-10 lg:gap-14">
          {/* Left share rail (sticky) */}
          <aside className="hidden xl:block w-32 shrink-0">
            <div className="sticky top-28">
              <DiscussRail title={post.title} />
            </div>
          </aside>

          {/* Main content */}
          <article className="flex-1 min-w-0">
            {/* Date */}
            <time dateTime={post.published_at || ""} className="eyebrow">
              {formatDate(post.published_at)}
            </time>

            {/* Title */}
            <h1 className="mt-4 text-[clamp(2rem,4.6vw,3.1rem)] font-semibold leading-[1.05] tracking-[-0.04em] text-balance">
              {post.title}
            </h1>

            {/* Author byline: avatar + name, read time, share */}
            <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
              <div className="flex items-center gap-3">
                {avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatar} alt={post.author} className="h-9 w-9 rounded-full object-cover ring-1 ring-border/60" />
                ) : (
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-muted text-[12px] font-bold text-foreground ring-1 ring-border/60">
                    {initials(post.author)}
                  </span>
                )}
                <div className="leading-tight">
                  {handle ? (
                    <a href={`https://x.com/${handle}`} target="_blank" rel="noopener" className="text-sm font-semibold hover:underline">
                      {post.author}
                    </a>
                  ) : (
                    <span className="text-sm font-semibold">{post.author}</span>
                  )}
                  <p className="text-[12px] text-muted-foreground">
                    {post.author_role || (handle ? `@${handle}` : "Deployzy")}
                  </p>
                </div>
              </div>
              <span className="hidden sm:inline text-border">·</span>
              <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Clock className="h-3.5 w-3.5" /> {post.read_time}
              </span>
              <span className="hidden sm:inline text-border">·</span>
              <BlogShare title={post.title} />
            </div>

            {/* Cover image */}
            {post.cover_image && (
              <div className="mt-8 rounded-2xl overflow-hidden border border-border/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={post.cover_image.startsWith("/api") ? `${API_URL}${post.cover_image}` : post.cover_image}
                  alt={post.title}
                  className="w-full max-h-[420px] object-cover"
                />
              </div>
            )}

            {/* Lead */}
            <p className="mt-9 border-l-2 border-brand pl-5 text-[18px] leading-relaxed text-foreground/80 sm:text-[19px]">
              {post.excerpt || post.description}
            </p>

            {/* Body */}
            <div className="mt-8">
              {(post.content || []).map((s, i) => renderSection(s, i, anchorIds[i]))}
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

            {/* Author card footer */}
            <div className="panel mt-10 flex flex-wrap items-center gap-4 p-5">
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatar} alt={post.author} className="h-12 w-12 rounded-full object-cover ring-1 ring-border/60" />
              ) : (
                <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-sm font-bold text-foreground ring-1 ring-border/60">
                  {initials(post.author)}
                </span>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold">{post.author}</p>
                <p className="text-[12px] text-muted-foreground">{post.author_role || "Deployzy"}</p>
              </div>
              {handle && (
                <a href={`https://x.com/${handle}`} target="_blank" rel="noopener" className="pill pill-sm pill-line ml-auto">
                  Follow @{handle}
                </a>
              )}
            </div>
          </article>

          {/* Sidebar: sticky TOC (stays pinned + auto-highlights) + CTA + related */}
          <aside className="hidden lg:block w-64 shrink-0">
            <div className="sticky top-24 space-y-7">
              {headings.length > 0 && <BlogToc headings={headings} />}

              <div className="panel p-5">
                <div className="flex items-center gap-2 mb-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo-mark.png" alt="Deployzy" className="h-7 w-7 rounded-md" />
                  <span className="font-bold text-sm">Deployzy</span>
                </div>
                <p className="mb-4 text-[13.5px] leading-relaxed text-muted-foreground">
                  Deploy apps from GitHub, tunnel localhost and run databases, on our cloud or your own server.
                </p>
                <Link href="/sign-up" className="pill pill-sm pill-ink w-full">
                  Get started free <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              {related.length > 0 && (
                <div className="space-y-3">
                  <p className="eyebrow">Related articles</p>
                  {related.map((p) => (
                    <Link key={p.slug} href={`/blog/${p.slug}`} className="panel group block p-3.5 transition-colors hover:border-brand/40">
                      <span className={`mb-2 inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${categoryTone(p.category)}`}>{p.category}</span>
                      <p className="text-[13.5px] font-medium leading-snug">{p.title}</p>
                      <p className="mt-1 text-[12.5px] text-muted-foreground">{p.read_time}</p>
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
