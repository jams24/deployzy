"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, BookOpen, ChevronDown, LayoutDashboard, LayoutTemplate, Menu, Rocket, X } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { useSignedIn } from "@/lib/use-signed-in";

const PRODUCT = [
  { href: "/#features", title: "Features", desc: "Deploys, databases, tunnels and more", icon: Rocket },
  { href: "/templates", title: "Templates", desc: "Deploy popular apps in one click", icon: LayoutTemplate },
  { href: "/docs", title: "Docs", desc: "Guides, CLI and API reference", icon: BookOpen },
];

const LINKS = [
  { href: "/#pricing", label: "Pricing" },
  { href: "/blog", label: "Blog" },
  { href: "/docs", label: "Docs" },
];

const EASE = [0.16, 1, 0.3, 1] as const;

/** Smooth-scroll in-page anchors when we're already on the home page. */
function onAnchor(href: string, e: React.MouseEvent, path: string) {
  if (href.startsWith("/#") && path === "/") {
    const el = document.getElementById(href.slice(2));
    if (el) {
      e.preventDefault();
      el.scrollIntoView({ behavior: "smooth" });
      history.replaceState(null, "", href);
    }
  }
}

function Logo() {
  return (
    <Link href="/" className="group flex items-center gap-2.5" aria-label="Deployzy home">
      <img src="/logo-mark.png" alt="" className="h-8 w-8 rounded-lg transition-transform duration-300 group-hover:rotate-[8deg]" />
      <span className="text-[17px] font-semibold tracking-[-0.02em]">Deployzy</span>
    </Link>
  );
}

export function Navbar() {
  const path = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const loggedIn = useSignedIn();
  const [scrolled, setScrolled] = useState(false);
  const [product, setProduct] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Mobile sheet: lock page scroll, close on Escape and on navigation.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  // Close the sheet on navigation (state adjusted during render, not in an effect).
  const [shownPath, setShownPath] = useState(path);
  if (shownPath !== path) {
    setShownPath(path);
    setOpen(false);
  }

  const openMenu = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setProduct(true);
  };
  const closeMenu = () => {
    closeTimer.current = setTimeout(() => setProduct(false), 120);
  };

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div
        className={cn(
          "transition-[background-color,border-color,box-shadow] duration-300",
          scrolled || open ? "frost border-b border-border/60 shadow-[0_1px_30px_-18px_rgba(0,0,0,.25)]" : "border-b border-transparent",
        )}
      >
        <nav className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-5 sm:px-6" aria-label="Main">
          <Logo />

          {/* Desktop links */}
          <div className="hidden items-center gap-0.5 rounded-full border border-border/70 bg-background/50 p-1 backdrop-blur-md md:flex">
            <div className="relative" onMouseEnter={openMenu} onMouseLeave={closeMenu}>
              <button
                type="button"
                aria-expanded={product}
                onClick={() => setProduct((v) => !v)}
                className="flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[14px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Product
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", product && "rotate-180")} />
              </button>
              <AnimatePresence>
                {product && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.98 }}
                    transition={{ duration: 0.18, ease: EASE }}
                    className="absolute left-0 top-full pt-2"
                  >
                    <div className="w-[300px] rounded-2xl border bg-popover p-1.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,.35)]">
                      {PRODUCT.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={(e) => {
                            onAnchor(item.href, e, path);
                            setProduct(false);
                          }}
                          className="group flex items-start gap-3 rounded-xl p-2.5 transition-colors hover:bg-muted"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground transition-colors group-hover:text-brand">
                            <item.icon className="h-4 w-4" />
                          </span>
                          <span>
                            <span className="block text-[14px] font-medium">{item.title}</span>
                            <span className="block text-[12.5px] text-muted-foreground">{item.desc}</span>
                          </span>
                        </Link>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={(e) => onAnchor(l.href, e, path)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-[14px] transition-colors hover:bg-muted hover:text-foreground",
                  path.startsWith(l.href) && l.href !== "/#pricing" ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {l.label}
              </Link>
            ))}
          </div>

          {/* Desktop actions */}
          <div className="hidden items-center gap-1.5 md:flex">
            <ThemeToggle className="rounded-full" />
            {loggedIn ? (
              <Link href="/overview" className="pill pill-sm pill-ink">
                <LayoutDashboard className="h-4 w-4" /> Dashboard
              </Link>
            ) : (
              <>
                <Link href="/sign-in" className="rounded-full px-3.5 py-1.5 text-[14px] text-muted-foreground transition-colors hover:text-foreground">
                  Sign in
                </Link>
                <Link href="/sign-up" className="pill pill-sm pill-ink group">
                  Get started <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </>
            )}
          </div>

          {/* Mobile trigger */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-foreground md:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </nav>
      </div>

      {/* Mobile sheet */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-x-0 bottom-0 top-16 z-40 flex flex-col bg-background md:hidden"
          >
            <div className="flex-1 overflow-y-auto px-5 pb-6 pt-4">
              <ul className="divide-y">
                {[...PRODUCT.slice(0, 2).map((p) => ({ href: p.href, label: p.title })), ...LINKS].map((l, i) => (
                  <motion.li
                    key={l.href + l.label}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.04 * i, duration: 0.35, ease: EASE }}
                  >
                    <Link
                      href={l.href}
                      onClick={(e) => {
                        onAnchor(l.href, e, path);
                        setOpen(false);
                      }}
                      className="flex items-center justify-between py-4 text-[26px] font-semibold tracking-[-0.03em]"
                    >
                      {l.label}
                      <ArrowRight className="h-5 w-5 text-muted-foreground" />
                    </Link>
                  </motion.li>
                ))}
              </ul>
              <div className="mt-6 flex items-center justify-between rounded-2xl border px-4 py-3">
                <span className="text-[14px] text-muted-foreground">Theme</span>
                <ThemeToggle className="rounded-full" />
              </div>
            </div>
            <div className="flex flex-col gap-2.5 border-t px-5 pt-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
              {loggedIn ? (
                <Link href="/overview" className="pill pill-ink w-full">
                  <LayoutDashboard className="h-4 w-4" /> Open dashboard
                </Link>
              ) : (
                <>
                  <Link href="/sign-up" className="pill pill-launch w-full">
                    Start deploying free <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link href="/sign-in" className="pill pill-line w-full">
                    Sign in
                  </Link>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
