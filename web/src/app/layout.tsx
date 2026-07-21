import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// Inter + JetBrains Mono — same pairing ngrok.com uses (they use Roobert
// for sans, which is proprietary; Inter is the closest free equivalent —
// same geometric neutral grotesque character). JetBrains Mono is the exact
// mono font ngrok uses.
const sans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
  // Use the variable font so we get every weight without multiple file
  // downloads — matches how ngrok ships it.
  axes: ["opsz"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Deployzy — Deploy Apps, Tunnel Localhost, Manage Databases",
    template: "%s | Deployzy",
  },
  description:
    "Deploy apps from GitHub, tunnel your localhost, attach managed Postgres, Redis, MongoDB, MySQL — bring your own VPS. The open-source Railway + ngrok + Supabase alternative.",
  keywords: [
    "railway alternative",
    "heroku alternative",
    "ngrok alternative",
    "deploy nodejs",
    "self-hosted deployment",
    "managed postgresql",
    "BYOC",
    "open source PaaS",
    "deployzy",
  ],
  metadataBase: new URL("https://deployzy.com"),
  alternates: { canonical: "https://deployzy.com" },
  openGraph: {
    type: "website",
    url: "https://deployzy.com",
    title: "Deployzy — Deploy Apps, Tunnel Localhost, Manage Databases",
    description:
      "The open-source Railway + ngrok + Supabase alternative. Deploy apps from GitHub, manage databases, and tunnel localhost — all on your own VPS.",
    siteName: "Deployzy",
  },
  twitter: {
    card: "summary_large_image",
    title: "Deployzy — Deploy Apps, Tunnel Localhost, Manage Databases",
    description:
      "Open-source Railway + ngrok + Supabase alternative. Deploy from GitHub, manage databases, tunnel localhost — on your own VPS.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-snippet": -1, "max-image-preview": "large" },
  },
  // Favicon / app icons are supplied by the file conventions in app/:
  // favicon.ico, icon.png, apple-icon.png — all rendered from the Deployzy
  // rocket mark. See also app/manifest.ts for the PWA icon set.
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground overflow-x-hidden w-full max-w-[100vw]">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
