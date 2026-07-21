import type { MetadataRoute } from "next";

// PWA / mobile home-screen manifest. Icons are the Deployzy rocket mark
// (matching favicon.ico, icon.png and the in-app header logo). The dark tile
// background matches the artwork, so we keep the theme dark here too.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Deployzy",
    short_name: "Deployzy",
    description:
      "Deploy apps from GitHub, tunnel your localhost, and manage databases — on your own VPS.",
    start_url: "/",
    display: "standalone",
    background_color: "#0D1117",
    theme_color: "#0D1117",
    icons: [
      { src: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { src: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
