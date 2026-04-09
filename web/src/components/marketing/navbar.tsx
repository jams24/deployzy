"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Menu, X, Terminal, LayoutDashboard } from "lucide-react";

const links = [
  { href: "/#features", label: "Features" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
  { href: "https://github.com/jams24/serverme", label: "GitHub" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("sm_token");
    setLoggedIn(!!token);
  }, []);

  return (
    <nav className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Terminal className="h-4 w-4" />
          </div>
          ServerMe
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={(e) => {
                if (l.href.startsWith("/#")) {
                  e.preventDefault();
                  const id = l.href.replace("/#", "");
                  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
                }
              }}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <ThemeToggle />
          {loggedIn ? (
            <Button size="sm" nativeButton={false} render={<Link href="/tunnels" />} className="gap-2">
              <LayoutDashboard className="h-3.5 w-3.5" />
              Dashboard
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/sign-in" />}>
                Sign in
              </Button>
              <Button size="sm" nativeButton={false} render={<Link href="/sign-up" />}>
                Get Started
              </Button>
            </>
          )}
        </div>

        <button
          className="md:hidden text-muted-foreground"
          onClick={() => setOpen(!open)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-border/40 px-6 py-4 md:hidden">
          <div className="flex flex-col gap-3">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-sm text-muted-foreground"
                onClick={(e) => {
                  setOpen(false);
                  if (l.href.startsWith("/#")) {
                    e.preventDefault();
                    const id = l.href.replace("/#", "");
                    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
                  }
                }}
              >
                {l.label}
              </Link>
            ))}
            <div className="flex gap-2 pt-2">
              {loggedIn ? (
                <Button size="sm" nativeButton={false} render={<Link href="/tunnels" />} className="flex-1 gap-2">
                  <LayoutDashboard className="h-3.5 w-3.5" />
                  Dashboard
                </Button>
              ) : (
                <>
                  <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/sign-in" />} className="flex-1">
                    Sign in
                  </Button>
                  <Button size="sm" nativeButton={false} render={<Link href="/sign-up" />} className="flex-1">
                    Get Started
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
