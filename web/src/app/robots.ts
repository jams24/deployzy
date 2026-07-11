import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/overview", "/projects", "/tunnels", "/services", "/settings", "/admin", "/api/"],
      },
    ],
    sitemap: "https://deployzy.com/sitemap.xml",
    host: "https://deployzy.com",
  };
}
