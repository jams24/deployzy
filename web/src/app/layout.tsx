import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// Geist for UI and headlines, Geist Mono for code and figures, and Instrument
// Serif italic for the one accent word in a headline (`.accent-serif`).
const sans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const mono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

const serif = Instrument_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Deployzy — Deploy Apps, Tunnel Localhost, Manage Databases",
    template: "%s | Deployzy",
  },
  description:
    "Deploy apps from GitHub, tunnel your localhost, attach managed Postgres, Redis, MongoDB, MySQL — or bring your own VPS. The Railway + ngrok + Supabase alternative with a generous free tier.",
  keywords: [
    "railway alternative",
    "heroku alternative",
    "ngrok alternative",
    "deploy nodejs",
    "bring your own server",
    "managed postgresql",
    "BYOC",
    "PaaS",
    "deployzy",
  ],
  metadataBase: new URL("https://deployzy.com"),
  alternates: { canonical: "https://deployzy.com" },
  openGraph: {
    type: "website",
    url: "https://deployzy.com",
    title: "Deployzy — Deploy Apps, Tunnel Localhost, Manage Databases",
    description:
      "The Railway + ngrok + Supabase alternative. Deploy apps from GitHub, manage databases, and tunnel localhost — on our cloud or your own VPS.",
    siteName: "Deployzy",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Deployzy — deploy apps, tunnel localhost, manage databases",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@itsjamsltn",
    creator: "@itsjamsltn",
    title: "Deployzy — Deploy Apps, Tunnel Localhost, Manage Databases",
    description:
      "Railway + ngrok + Supabase alternative. Deploy from GitHub, manage databases, tunnel localhost — on our cloud or your own VPS.",
    images: ["/og-image.png"],
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
      className={`${sans.variable} ${mono.variable} ${serif.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground w-full max-w-[100vw]">
        {/* JSON-LD structured data — helps Google understand the product for
            rich results (SoftwareApplication + Organization + WebSite). */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify([
              {
                "@context": "https://schema.org",
                "@type": "Organization",
                name: "Deployzy",
                url: "https://deployzy.com",
                logo: "https://deployzy.com/icon-512.png",
                description:
                  "Railway + ngrok + Supabase alternative — deploy apps, tunnel localhost, and manage databases on our cloud or your own VPS.",
                sameAs: ["https://x.com/itsjamsltn"],
              },
              {
                "@context": "https://schema.org",
                "@type": "WebSite",
                name: "Deployzy",
                url: "https://deployzy.com",
              },
              {
                "@context": "https://schema.org",
                "@type": "SoftwareApplication",
                name: "Deployzy",
                applicationCategory: "DeveloperApplication",
                operatingSystem: "Web, Linux, macOS, Windows",
                url: "https://deployzy.com",
                description:
                  "Deploy apps from GitHub, tunnel your localhost, and attach managed Postgres, Redis, MongoDB and MySQL — bring your own VPS.",
                offers: {
                  "@type": "Offer",
                  price: "0",
                  priceCurrency: "USD",
                  description: "Free tier available",
                },
              },
            ]),
          }}
        />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
