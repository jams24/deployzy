import type { MetadataRoute } from "next";
import { posts } from "@/lib/blog";

const BASE = "https://deployzy.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE, lastModified: new Date(), changeFrequency: "weekly", priority: 1.0 },
    // Pricing is a section on the home page (/#pricing), not its own route, so
    // it must NOT be a separate sitemap URL — a standalone /pricing 404s and
    // Next's not-found page carries noindex, which Search Console then reports
    // as "Excluded by 'noindex' tag". /pricing redirects to /#pricing instead.
    { url: `${BASE}/blog`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE}/docs`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
    ...["/terms", "/privacy", "/cookies", "/acceptable-use"].map((path) => ({
      url: `${BASE}${path}`,
      lastModified: new Date("2026-11-19"),
      changeFrequency: "yearly" as const,
      priority: 0.3,
    })),
  ];

  const blogPages: MetadataRoute.Sitemap = posts.map((post) => ({
    url: `${BASE}/blog/${post.slug}`,
    lastModified: new Date(post.date),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  return [...staticPages, ...blogPages];
}
