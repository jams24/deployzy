import { ImageResponse } from "next/og";

// Per-post Open Graph card: a branded 1200x630 image rendered with the post's
// own title, so every blog post gets a unique share preview (Twitter, Slack,
// LinkedIn, Google). Falls back to a generic card if the post can't be loaded.
export const runtime = "nodejs";
export const alt = "Deployzy Blog";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let title = "Deployzy Blog";
  let category = "";
  try {
    const res = await fetch(`${API_URL}/api/v1/blog/posts/${slug}`, {
      next: { revalidate: 300 },
    });
    if (res.ok) {
      const p = await res.json();
      if (p?.title) title = p.title;
      if (p?.category) category = p.category;
    }
  } catch {
    // keep defaults
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background: "linear-gradient(135deg, #0a0a0a 0%, #111827 55%, #0b1120 100%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "56px",
              height: "56px",
              borderRadius: "14px",
              background: "#34d399",
              color: "#052e1b",
              fontSize: "34px",
              fontWeight: 800,
            }}
          >
            D
          </div>
          <span style={{ fontSize: "34px", fontWeight: 700 }}>Deployzy</span>
          {category ? (
            <span
              style={{
                marginLeft: "12px",
                fontSize: "22px",
                padding: "6px 16px",
                borderRadius: "999px",
                background: "rgba(52,211,153,0.15)",
                color: "#34d399",
              }}
            >
              {category}
            </span>
          ) : null}
        </div>

        <div
          style={{
            display: "flex",
            fontSize: title.length > 60 ? "58px" : "72px",
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
          }}
        >
          {title}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "26px", color: "#9ca3af" }}>deployzy.com/blog</span>
          <span style={{ fontSize: "24px", color: "#6b7280" }}>
            Deploy · Tunnel · Databases — on your own VPS
          </span>
        </div>
      </div>
    ),
    { ...size },
  );
}
