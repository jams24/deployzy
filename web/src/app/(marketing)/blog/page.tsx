import type { Metadata } from "next";
import Link from "next/link";
import { posts, formatDate } from "@/lib/blog";
import { ArrowRight, Clock, Tag } from "lucide-react";

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

const CATEGORY_COLORS: Record<string, string> = {
  Comparisons: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Tutorials:   "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Databases:   "bg-purple-500/10 text-purple-400 border-purple-500/20",
  Tools:       "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

export default function BlogIndexPage() {
  const sorted = [...posts].sort((a, b) => b.date.localeCompare(a.date));
  const [featured, ...rest] = sorted;

  return (
    <div className="mx-auto max-w-6xl px-6 py-20">
      {/* Header */}
      <div className="mb-14">
        <p className="text-sm font-semibold text-primary mb-3 uppercase tracking-wider">Blog</p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Deployment guides & tutorials
        </h1>
        <p className="mt-4 text-lg text-muted-foreground max-w-2xl">
          Practical guides on deploying apps, managing databases, localhost tunneling, and DevOps — written by the Deployzy team.
        </p>
      </div>

      {/* Featured post */}
      <Link
        href={`/blog/${featured.slug}`}
        className="group block mb-12 rounded-2xl border border-border/60 bg-card/40 hover:bg-card/70 transition-colors overflow-hidden"
      >
        <div className="p-8 sm:p-10">
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${CATEGORY_COLORS[featured.category] ?? "bg-zinc-500/10 text-zinc-400"}`}>
              <Tag className="h-2.5 w-2.5" /> {featured.category}
            </span>
            <span className="text-[12px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> {featured.readTime}
            </span>
            <span className="text-[12px] text-muted-foreground">{formatDate(featured.date)}</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold leading-tight group-hover:text-primary transition-colors mb-3">
            {featured.title}
          </h2>
          <p className="text-muted-foreground text-base leading-relaxed mb-6 max-w-3xl">
            {featured.excerpt}
          </p>
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
            Read article <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
          </span>
        </div>
      </Link>

      {/* Rest of posts */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {rest.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="group flex flex-col rounded-xl border border-border/60 bg-card/30 hover:bg-card/60 transition-colors p-6"
          >
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${CATEGORY_COLORS[post.category] ?? "bg-zinc-500/10 text-zinc-400"}`}>
                {post.category}
              </span>
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Clock className="h-2.5 w-2.5" /> {post.readTime}
              </span>
            </div>
            <h3 className="text-lg font-bold leading-snug group-hover:text-primary transition-colors mb-2 flex-1">
              {post.title}
            </h3>
            <p className="text-sm text-muted-foreground line-clamp-3 mb-4">{post.excerpt}</p>
            <div className="flex items-center justify-between mt-auto pt-3 border-t border-border/30">
              <span className="text-[11px] text-muted-foreground">{formatDate(post.date)}</span>
              <span className="text-sm font-medium text-primary flex items-center gap-1">
                Read <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </div>
          </Link>
        ))}
      </div>

      {/* JSON-LD: Blog structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Blog",
            name: "Deployzy Blog",
            url: "https://deployzy.com/blog",
            description: "Guides and tutorials on app deployment, databases, and DevOps.",
            publisher: {
              "@type": "Organization",
              name: "Deployzy",
              url: "https://deployzy.com",
              logo: { "@type": "ImageObject", url: "https://deployzy.com/logo-icon.svg" },
            },
            blogPost: posts.map((p) => ({
              "@type": "BlogPosting",
              headline: p.title,
              url: `https://deployzy.com/blog/${p.slug}`,
              datePublished: p.date,
              author: { "@type": "Organization", name: p.author },
            })),
          }),
        }}
      />
    </div>
  );
}
