import Link from "next/link";
import { Terminal } from "lucide-react";

const footerLinks = {
  Product: [
    { label: "Features", href: "/#features" },
    { label: "Pricing", href: "/#pricing" },
    { label: "Docs", href: "/docs" },
    { label: "Changelog", href: "/changelog" },
  ],
  Developers: [
    { label: "CLI Reference", href: "/docs/cli" },
    { label: "API Reference", href: "/docs/api" },
    { label: "SDKs", href: "/docs/sdks" },
    { label: "Self-Hosting", href: "/docs/self-hosting" },
  ],
  Company: [
    { label: "GitHub", href: "https://github.com/jams24/deployzy" },
    { label: "Blog", href: "/blog" },
    { label: "Status", href: "/status" },
    { label: "Contact", href: "mailto:hello@deployzy.com" },
  ],
};

export function Footer() {
  return (
    <footer className="border-t border-border/40 bg-background">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <Link
              href="/"
              className="flex items-center gap-2 font-bold text-lg"
            >
              <img src="/logo-mark.png" alt="Deployzy" className="h-8 w-8 rounded-lg" />
              Deployzy
            </Link>
            <p className="mt-4 text-sm text-muted-foreground max-w-xs">
              Deploy apps, tunnel localhost, manage databases — your entire backend, one platform.
            </p>
          </div>

          {Object.entries(footerLinks).map(([title, items]) => (
            <div key={title}>
              <h3 className="text-sm font-semibold">{title}</h3>
              <ul className="mt-4 space-y-3">
                {items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-col items-center justify-between gap-4 border-t border-border/40 pt-8 md:flex-row">
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} Deployzy. MIT License.
          </p>
          <p className="text-xs text-muted-foreground">
            Made with care for the developer community.
          </p>
        </div>
      </div>
    </footer>
  );
}
