"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { Menu, X, ArrowRight, LayoutDashboard } from "lucide-react";

const links = [
  { href: "/#features", label: "Features" },
  { href: "/#pricing",  label: "Pricing" },
  { href: "/blog",      label: "Blog" },
  { href: "/docs",      label: "Docs" },
];

function scrollTo(href: string, e: React.MouseEvent) {
  if (href.startsWith("/#")) {
    e.preventDefault();
    document.getElementById(href.replace("/#", ""))?.scrollIntoView({ behavior: "smooth" });
  }
}

export function Navbar() {
  const [open, setOpen]       = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    setLoggedIn(!!localStorage.getItem("sm_token"));
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 w-full bg-background/95 backdrop-blur-md border-b border-border/40">
      {/* ── Desktop nav ──────────────────────────────────────── */}
      <div className={`hidden md:flex items-center justify-between h-16 max-w-6xl mx-auto px-6 transition-all ${scrolled ? "py-2" : "py-3"}`}>

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <img src="/logo-mark.png" alt="Deployzy" className="h-7 w-7 rounded-md" />
          <span className="font-semibold text-[15px] tracking-tight text-foreground">Deployzy</span>
        </Link>

        {/* Pill nav */}
        <nav className="flex items-center rounded-full border border-border bg-background/80 backdrop-blur-sm px-1.5 py-1 gap-0.5 shadow-sm">
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
              className="flex items-center gap-1.5 rounded-full bg-foreground text-background text-[13px] font-semibold px-4 py-1.5 hover:opacity-85 transition-opacity"
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
                className="flex items-center gap-1.5 rounded-full bg-foreground text-background text-[13px] font-semibold px-4 py-1.5 hover:opacity-85 transition-opacity"
              >
                Get started <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </>
          )}
        </div>
      </div>

      {/* ── Mobile nav ───────────────────────────────────────── */}
      <div className="md:hidden flex items-center justify-between h-14 px-4 border-b border-border bg-background/95 backdrop-blur-md">
        <Link href="/" className="flex items-center gap-2">
          <img src="/logo-mark.png" alt="Deployzy" className="h-6 w-6 rounded" />
          <span className="font-semibold text-[14px]">Deployzy</span>
        </Link>
        <button
          onClick={() => setOpen(o => !o)}
          className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          {open ? <X className="h-4.5 w-4.5" /> : <Menu className="h-4.5 w-4.5" />}
        </button>
      </div>

      {open && (
        <div className="md:hidden border-b border-border bg-background/98 backdrop-blur-md px-4 py-4 space-y-1">
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
      )}
    </header>
  );
}
