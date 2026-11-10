import Link from "next/link";
import { SOCIALS } from "@/lib/socials";

const footerLinks = {
  Product: [
    { label: "Features", href: "/#features" },
    { label: "Pricing", href: "/#pricing" },
    { label: "Templates", href: "/templates" },
    { label: "Docs", href: "/docs" },
  ],
  Developers: [
    { label: "CLI Reference", href: "/docs/cli" },
    { label: "API Reference", href: "/docs/api" },
    { label: "SDKs", href: "/docs/sdks" },
    { label: "Bring Your Own Server", href: "/docs/guides/byoc" },
  ],
  Company: [
    { label: "GitHub", href: "https://github.com/jams24/deployzy-cli" },
    { label: "Blog", href: "/blog" },
    { label: "Contact", href: "mailto:support@deployzy.com" },
  ],
  Trust: [
    { label: "Acceptable Use", href: "/acceptable-use" },
    { label: "Report Abuse", href: "/report" },
    { label: "Abuse Contact", href: "mailto:abuse@deployzy.com" },
  ],
};

export function Footer() {
  return (
    <footer className="relative mt-auto overflow-hidden border-t bg-background">
      <div className="mx-auto max-w-[1200px] px-5 pt-16 sm:px-6 sm:pt-20">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-6">
          <div className="col-span-2">
            <Link href="/" className="group inline-flex items-center gap-2.5" aria-label="Deployzy home">
              <img src="/logo-mark.png" alt="" className="h-8 w-8 rounded-lg transition-transform duration-300 group-hover:rotate-[8deg]" />
              <span className="text-[17px] font-semibold tracking-[-0.02em]">Deployzy</span>
            </Link>
            <p className="mt-4 max-w-xs text-[14.5px] leading-relaxed text-muted-foreground">
              Deploy apps, tunnel localhost and run databases, on our cloud or your own server.
            </p>
            <div className="mt-5 flex items-center gap-2">
              {SOCIALS.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.label}
                  className="flex h-10 w-10 items-center justify-center rounded-full border text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:text-foreground"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                    <path d={s.path} />
                  </svg>
                </a>
              ))}
            </div>
          </div>
          {Object.entries(footerLinks).map(([title, items]) => (
            <div key={title}>
              <p className="eyebrow">{title}</p>
              <ul className="mt-4 space-y-1">
                {items.map((item) => (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      className="inline-block py-1 text-[14px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col-reverse items-start justify-between gap-4 border-t py-6 text-[13px] text-muted-foreground sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} Deployzy. All rights reserved.</p>
          <a href="mailto:support@deployzy.com" className="transition-colors hover:text-foreground">
            support@deployzy.com
          </a>
        </div>
      </div>

      {/* Oversized wordmark, cropped by the page edge */}
      <div aria-hidden className="pointer-events-none -mt-6 select-none px-3 leading-none sm:-mt-12">
        <p className="mx-auto max-w-[1400px] translate-y-[22%] bg-gradient-to-b from-foreground/[0.09] to-transparent bg-clip-text text-center text-[clamp(4.5rem,21vw,19rem)] font-semibold tracking-[-0.06em] text-transparent">
          Deployzy
        </p>
      </div>
    </footer>
  );
}
