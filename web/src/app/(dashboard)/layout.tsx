"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/dashboard/sidebar";
import { AuthGuard } from "@/components/dashboard/auth-guard";
import { ThemeToggle } from "@/components/theme-toggle";
import { Menu, X, Bell, Search } from "lucide-react";
import Link from "next/link";

const PAGE_TITLES: Record<string, string> = {
  "/overview":      "Overview",
  "/projects":      "Projects",
  "/services":      "Databases",
  "/tunnels":       "Tunnels",
  "/servers":       "Servers",
  "/analytics":     "Analytics",
  "/subdomains":    "Subdomains",
  "/domains":       "Domains",
  "/inspector":     "Inspector",
  "/api-keys":      "API Keys",
  "/notifications": "Notifications",
  "/team":          "Team",
  "/billing":       "Billing",
  "/settings":      "Settings",
  "/admin":         "Admin Console",
  "/new":           "New Project",
};

function getPageTitle(pathname: string) {
  for (const [prefix, title] of Object.entries(PAGE_TITLES)) {
    if (pathname.startsWith(prefix)) return title;
  }
  return "Dashboard";
}

function DashboardTopbar({ onMenuClick }: { onMenuClick: () => void }) {
  const pathname = usePathname();
  const title = getPageTitle(pathname);
  const [initials, setInitials] = useState("U");
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("sm_token");
    if (!token) return;
    const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";
    fetch(`${base}/api/v1/users/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(u => {
        if (!u) return;
        const name: string = u.name || u.email || "";
        setInitials(name.split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase() || "U");
        setUserEmail(u.email || "");
      })
      .catch(() => {});
  }, []);

  return (
    <header className="sticky top-0 z-20 flex h-[52px] items-center gap-4 border-b border-border bg-background px-4 shrink-0">
      {/* Mobile menu toggle */}
      <button
        onClick={onMenuClick}
        className="md:hidden flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        <Menu className="h-4 w-4" />
      </button>

      {/* Mobile logo */}
      <Link href="/" className="md:hidden flex items-center gap-2">
        <img src="/logo-mark.png" alt="Deployzy" className="h-5 w-5 rounded" />
        <span className="font-semibold text-[14px]">Deployzy</span>
      </Link>

      {/* Page title — desktop */}
      <span className="hidden md:block text-[14px] font-semibold text-foreground tracking-tight">
        {title}
      </span>

      <div className="flex-1" />

      {/* Right actions */}
      <div className="flex items-center gap-1">
        {/* Notifications */}
        <Link
          href="/notifications"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <Bell className="h-4 w-4" />
        </Link>

        <ThemeToggle />

        {/* User avatar */}
        <Link
          href="/settings"
          title={userEmail}
          className="ml-1 flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-background text-[11px] font-bold hover:opacity-80 transition-opacity"
        >
          {initials}
        </Link>
      </div>
    </header>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <AuthGuard>
      <div className="flex h-screen overflow-hidden">
        {/* Desktop sidebar */}
        <div className="hidden md:flex">
          <Sidebar />
        </div>

        {/* Mobile sidebar overlay */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setMobileOpen(false)}
            />
            <div className="relative h-full w-[220px] bg-background shadow-xl" onClick={e => e.stopPropagation()}>
              <Sidebar onNavigate={() => setMobileOpen(false)} />
            </div>
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-md bg-background border border-border text-muted-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Main column */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <DashboardTopbar onMenuClick={() => setMobileOpen(o => !o)} />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
              {children}
            </div>
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}
