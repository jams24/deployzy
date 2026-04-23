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
    default: "ServerMe — Deploy, Tunnel, Database Platform",
    template: "%s | ServerMe",
  },
  description:
    "Deploy apps from GitHub, tunnel your localhost, attach managed Postgres, bring your own VPS — Railway + ngrok + Supabase in one open-source platform.",
  keywords: [
    "deploy",
    "tunnel",
    "database",
    "BYOC",
    "ngrok alternative",
    "railway alternative",
    "open source",
    "serverme",
  ],
  icons: {
    icon: "/logo-icon.svg",
    apple: "/logo-icon.svg",
  },
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
