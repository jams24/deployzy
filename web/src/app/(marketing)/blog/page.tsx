import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { categoryTone, formatPostDate as formatDate } from "@/lib/blog-ui";

export const revalidate = 60; // ISR: revalidate every 60s

export const metadata: Metadata = {
  title: "Blog — Deployzy",
  description:
    "Guides, tutorials, and comparisons on app deployment, databases, localhost tunnels, Docker, and DevOps. Written by the Deployzy team.",
  alternates: { canonical: "https://deployzy.com/blog" },
  openGraph: {
    title: "Deployzy Blog — Deployment Guides & Tutorials",
    description:
      "Guides on deploying Node.js, self-hosting, free PostgreSQL, ngrok alternatives, and more.",
    url: "https://deployzy.com/blog",
    type: "website",
  },
};

interface BlogPost {
  id: string;
  slug: string;
  title: string;
  description: string;
  excerpt: string;
  category: string;
  tags: string[];
  author: string;
  read_time: string;
  published_at: string | null;
}

async function getPosts(): Promise<BlogPost[]> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081"}/api/v1/blog/posts`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function BlogIndexPage() {
  const posts = await getPosts();
  const sorted = [...posts].sort((a, b) => {
    const da = a.published_at ? new Date(a.published_at).getTime() : 0;
    const db = b.published_at ? new Date(b.published_at).getTime() : 0;
    return db - da;
  });
  const [featured, ...rest] = sorted;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "Deployzy Blog",
    url: "https://deployzy.com/blog",
    description: "Guides and tutorials on app deployment, databases, and DevOps.",
    publisher: {
      "@type": "Organization",
      name: "Deployzy",
      url: "https://deployzy.com",
      logo: { "@type": "ImageObject", url: "https://deployzy.com/logo-mark.png" },
    },
    blogPost: posts.map((p) => ({
      "@type": "BlogPosting",
      headline: p.title,
      url: `https://deployzy.com/blog/${p.slug}`,
      datePublished: p.published_at,
      author: { "@type": "Organization", name: p.author },
    })),
  };

  return (
    <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-6 sm:py-20">
      {/* JSON-LD */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Header */}
      <header className="mb-12 max-w-3xl sm:mb-16">
        <p className="eyebrow rise">Blog</p>
        <h1 className="rise mt-4 text-[clamp(2.4rem,6vw,4.25rem)] font-semibold leading-[1] tracking-[-0.045em]" style={{ animationDelay: "0.06s" }}>
          Deployment guides <span className="accent-serif whitespace-nowrap">&amp; tutorials</span>
        </h1>
        <p className="rise mt-5 max-w-2xl text-[16px] leading-relaxed text-muted-foreground sm:text-[17.5px]" style={{ animationDelay: "0.12s" }}>
          Practical guides on deploying apps, managing databases, localhost tunnels and DevOps, written by the Deployzy team.
        </p>
      </header>

      {posts.length === 0 ? (
        <div className="panel py-20 text-center text-muted-foreground">
          <p className="text-[17px]">No posts yet. Check back soon.</p>
        </div>
      ) : (
        <>
          {/* Featured post */}
          {featured && (
            <Link
              href={`/blog/${featured.slug}`}
              className="dark grain group relative mb-6 block overflow-hidden rounded-[22px] bg-[#0b0c10] text-white sm:mb-8"
            >
              <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand/20 blur-3xl transition-opacity duration-500 group-hover:opacity-80" />
              <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_80%_0%,#000_20%,transparent_70%)]" />
              <div className="relative p-7 sm:p-10 lg:p-12">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-full border border-brand/30 bg-brand/15 px-2.5 py-0.5 text-[12px] font-medium text-brand">Latest</span>
                  <span className={`rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${categoryTone(featured.category)}`}>{featured.category}</span>
                  <span className="flex items-center gap-1 text-[12.5px] text-white/50">
                    <Clock className="h-3.5 w-3.5" /> {featured.read_time}
                  </span>
                  <span className="text-[12.5px] text-white/50">{formatDate(featured.published_at)}</span>
                </div>
                <h2 className="mt-5 max-w-4xl text-[clamp(1.6rem,3.6vw,2.6rem)] font-semibold leading-[1.08] tracking-[-0.035em] text-balance">
                  {featured.title}
                </h2>
                <p className="mt-4 max-w-3xl text-[16px] leading-relaxed text-white/60">{featured.excerpt || featured.description}</p>
                <span className="pill pill-sm pill-launch mt-7">
                  Read article <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
          )}

          {/* Rest of posts */}
          {rest.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
              {rest.map((post) => (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="panel reveal-up group flex flex-col p-6 transition-[border-color,transform] duration-300 hover:-translate-y-0.5 hover:border-brand/40"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[11.5px] font-medium ${categoryTone(post.category)}`}>{post.category}</span>
                    <span className="flex items-center gap-1 text-[12.5px] text-muted-foreground">
                      <Clock className="h-3 w-3" /> {post.read_time}
                    </span>
                  </div>
                  <h3 className="mt-4 flex-1 text-[18px] font-semibold leading-snug tracking-[-0.015em]">{post.title}</h3>
                  <p className="mt-2 line-clamp-3 text-[14.5px] leading-relaxed text-muted-foreground">{post.excerpt || post.description}</p>
                  <div className="mt-5 flex items-center justify-between border-t pt-4">
                    <span className="text-[12.5px] text-muted-foreground">{formatDate(post.published_at)}</span>
                    <span className="flex items-center gap-1 text-[13.5px] font-medium">
                      Read <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
