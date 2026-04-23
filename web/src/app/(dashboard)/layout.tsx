"use client";

import { useState } from "react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { AuthGuard } from "@/components/dashboard/auth-guard";
import { Menu, X, Terminal } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import Link from "next/link";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <AuthGuard>
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile header */}
        <header className="flex h-14 items-center justify-between border-b border-border/40 bg-background px-4 md:hidden">
          <Link href="/" className="flex items-center gap-2 font-bold">
            <img src="/logo-icon.svg" alt="ServerMe" className="h-7 w-7 rounded-md" />
            ServerMe
          </Link>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </header>

        {/* Mobile sidebar */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
            />
            {/* Sidebar panel */}
            {/* Cap the panel to 80% of viewport so small phones (iPhone SE,
                Android mini) still show ~60px of content gutter behind it. */}
            <div className="relative h-full w-72 max-w-[80vw] bg-background shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <Sidebar onNavigate={() => setMobileOpen(false)} />
            </div>
          </div>
        )}

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8">{children}</div>
        </main>
      </div>
    </div>
    </AuthGuard>
  );
}
