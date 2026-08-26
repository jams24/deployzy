"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, ArrowRight, LayoutDashboard, ChevronDown, Rocket, LayoutTemplate } from "lucide-react";

// Items inside the "Product" mega-menu (Railway-style).
const productItems = [
  { href: "/#features",  title: "Features",  desc: "Explore the deploy platform",        icon: Rocket },
  { href: "/templates",  title: "Templates", desc: "Deploy popular apps in one click",    icon: LayoutTemplate },
];

// Standalone top-level links (outside the Product menu).
const links = [
  { href: "/#pricing", label: "Pricing" },
  { href: "/blog",     label: "Blog" },
  { href: "/docs",     label: "Docs" },
];

function scrollTo(href: string, e: React.MouseEvent) {
  if (href.startsWith("/#")) {
    e.preventDefault();
    document.getElementById(href.replace("/#", ""))?.scrollIntoView({ behavior: "smooth" });
  }
}

const menuMotion = {
  initial: { opacity: 0, y: 6, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 6, scale: 0.98 },
  transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const },
};

export function Navbar() {
  const [open, setOpen]         = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLoggedIn(!!localStorage.getItem("sm_token"));
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Small close delay so moving the cursor from the trigger to the panel
  // doesn't dismiss the menu.
  const openMenu = () => { if (closeTimer.current) clearTimeout(closeTimer.current); setProductOpen(true); };
  const closeMenu = () => { closeTimer.current = setTimeout(() => setProductOpen(false), 120); };

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 w-full transition-all duration-300 ${
        scrolled
          ? "bg-background/75 backdrop-blur-xl backdrop-saturate-150 border-b border-border/50 shadow-[0_1px_24px_-12px_rgba(0,0,0,0.15)]"
          : "bg-transparent border-b border-transparent"
      }`}
    >
      {/* ── Desktop nav ──────────────────────────────────────── */}
      <div className="hidden md:flex items-center justify-between h-16 max-w-6xl mx-auto px-6">

        {/* Logo */}
        <Link href="/" className="group flex items-center gap-2 shrink-0">
          <span className="relative">
            <img src="/logo-mark.png" alt="Deployzy" className="h-7 w-7 rounded-md transition-transform duration-300 group-hover:scale-110 group-hover:rotate-[8deg]" />
            <span aria-hidden className="absolute inset-0 rounded-md bg-emerald-400/0 blur-md transition-colors duration-300 group-hover:bg-emerald-400/25" />
          </span>
          <span className="font-semibold text-[15px] tracking-tight text-foreground">Deployzy</span>
        </Link>

        {/* Pill nav */}
        <nav className="flex items-center rounded-full border border-border/60 bg-background/60 backdrop-blur-md px-1.5 py-1 gap-0.5 shadow-sm">
          {/* Product dropdown */}
          <div className="relative" onMouseEnter={openMenu} onMouseLeave={closeMenu}>
            <button
              type="button"
              onClick={() => setProductOpen(o => !o)}
              className={`flex items-center gap-1 px-4 py-1.5 rounded-full text-[13px] font-medium transition-colors ${productOpen ? "text-foreground bg-accent" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
            >
              Product
              <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${productOpen ? "rotate-180" : ""}`} />
            </button>

            <AnimatePresence>
              {productOpen && (
                <motion.div {...menuMotion} className="absolute left-1/2 -translate-x-1/2 top-full pt-3 w-[340px] origin-top">
                  <div className="rounded-2xl border border-border/70 bg-popover/90 shadow-xl shadow-black/10 backdrop-blur-xl p-2">
                    {productItems.map(item => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={e => { setProductOpen(false); scrollTo(item.href, e); }}
                        className="flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-accent transition-colors group"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors group-hover:border-emerald-500/40 group-hover:text-emerald-500">
                          <item.icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[13.5px] font-medium text-foreground">{item.title}</span>
                          <span className="block text-[12px] text-muted-foreground">{item.desc}</span>
                        </span>
                      </Link>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {links.map(l => (
            <Link
              key={l.href}
              href={l.href}
              onClick={e => scrollTo(l.href, e)}
              className="px-4 py-1.5 rounded-full text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        {/* Right CTAs */}
        <div className="flex items-center gap-2 shrink-0">
          {loggedIn ? (
            <Link
              href="/overview"
              className="btn-shine flex items-center gap-1.5 rounded-full bg-foreground text-background text-[13px] font-semibold px-4 py-1.5 transition-transform duration-200 hover:scale-[1.04] active:scale-[0.97]"
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="px-4 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="btn-shine flex items-center gap-1.5 rounded-full bg-foreground text-background text-[13px] font-semibold px-4 py-1.5 transition-transform duration-200 hover:scale-[1.04] active:scale-[0.97]"
              >
                Get started <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </>
          )}
        </div>
      </div>

      {/* ── Mobile nav ───────────────────────────────────────── */}
      <div className="md:hidden flex items-center justify-between h-14 px-4">
        <Link href="/" className="flex items-center gap-2">
          <img src="/logo-mark.png" alt="Deployzy" className="h-6 w-6 rounded" />
          <span className="font-semibold text-[14px]">Deployzy</span>
        </Link>
        <button
          onClick={() => setOpen(o => !o)}
          aria-label={open ? "Close menu" : "Open menu"}
          className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          {open ? <X className="h-4.5 w-4.5" /> : <Menu className="h-4.5 w-4.5" />}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="md:hidden overflow-hidden border-b border-border bg-background/95 backdrop-blur-xl"
          >
            <div className="px-4 py-4 space-y-1">
              {/* Product section */}
              <p className="px-1 pt-1 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">Product</p>
              {productItems.map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={e => { setOpen(false); scrollTo(item.href, e); }}
                  className="flex items-center gap-2.5 py-2 text-[14px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.title}
                </Link>
              ))}
              <div className="pt-2 mt-1 border-t border-border/60" />
              {links.map(l => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={e => { setOpen(false); scrollTo(l.href, e); }}
                  className="block py-2 text-[14px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  {l.label}
                </Link>
              ))}
              <div className="flex gap-2 pt-3 border-t border-border mt-3">
                {loggedIn ? (
                  <Link href="/overview" className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-foreground text-background text-[13px] font-semibold py-2 hover:opacity-85 transition-opacity">
                    <LayoutDashboard className="h-3.5 w-3.5" />
                    Dashboard
                  </Link>
                ) : (
                  <>
                    <Link href="/sign-in" className="flex-1 flex items-center justify-center rounded-lg border border-border text-[13px] font-medium py-2 text-muted-foreground hover:text-foreground transition-colors">
                      Sign in
                    </Link>
                    <Link href="/sign-up" className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-foreground text-background text-[13px] font-semibold py-2 hover:opacity-85 transition-opacity">
                      Get started <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
