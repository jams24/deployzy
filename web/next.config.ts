import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async redirects() {
    return [
      // Self-hosting was retired when the platform source went private;
      // BYOC is the "run it on your own VPS" path now.
      { source: "/docs/guides/self-hosting", destination: "/docs/guides/byoc", permanent: true },
      { source: "/docs/self-hosting", destination: "/docs/guides/byoc", permanent: true },
    ];
  },
};

export default nextConfig;
