"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { usePathname } from "next/navigation";
import { Bell, BookOpen, Menu, Search } from "lucide-react";
import { UpgradeDialogHost } from "@/components/upgrade-dialog";
import { AuthGuard } from "@/components/dashboard/auth-guard";
import { Sidebar } from "@/components/dashboard/sidebar";
import { CommandMenu, openCommandMenu } from "@/components/dashboard/command-menu";
import { MobileDrawer, MobileTabBar, showsTabBar } from "@/components/dashboard/mobile-nav";
import { pageTitle } from "@/components/dashboard/nav-config";
import { initials, useModKey, useSession } from "@/lib/use-me";

// Dashboard shell: sidebar on desktop; topbar + bottom tab bar + drawer on
// phones; ⌘K command menu everywhere. Decoration is pointer-events-none and
// built from theme tokens so light and dark both stay clean.

const iconBtn =
  "flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground";

function Topbar({ onMenu }: { onMenu: () => void }) {
  const pathname = usePathname();
  const mod = useModKey();
  const { me } = useSession();

  return (
    <header className="frost sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-[var(--dz-hairline)] px-3 sm:gap-3 sm:px-5">
      {/* Phones get "More" in the tab bar; full-height routes hide it, so the menu lives here. */}
      {!showsTabBar(pathname) && (
        <button type="button" onClick={onMenu} aria-label="Open menu" className={`${iconBtn} md:hidden`}>
          <Menu className="h-[18px] w-[18px]" />
        </button>
      )}
      <Link href="/overview" aria-label="Deployzy home" className="shrink-0 md:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-mark.png" alt="" className="h-7 w-7 rounded-lg" />
      </Link>

      <span className="min-w-0 flex-1 truncate pl-1.5 text-[15px] font-semibold tracking-tight text-foreground md:pl-0">{pageTitle(pathname)}</span>

      <button
        type="button"
        onClick={openCommandMenu}
        className="hidden h-9 w-[clamp(200px,24vw,300px)] items-center gap-2 rounded-xl border border-[var(--dz-hairline)] bg-background/70 px-3 text-[13.5px] text-muted-foreground transition-colors hover:border-foreground/15 hover:text-foreground md:flex dark:bg-white/[0.03]"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Search or jump to…</span>
        <kbd className="rounded-md border px-1.5 font-mono text-[11px]">{mod}K</kbd>
      </button>

      <div className="flex items-center gap-0.5">
        <button type="button" onClick={openCommandMenu} aria-label="Search" className={`${iconBtn} md:hidden`}>
          <Search className="h-[18px] w-[18px]" />
        </button>
        <a href="/docs" target="_blank" rel="noopener" className={`${iconBtn} hidden w-auto gap-1.5 px-2.5 text-[13.5px] lg:flex`}>
          <BookOpen className="h-4 w-4" />
          Docs
        </a>
        <Link href="/notifications" aria-label="Notifications" title="Notifications" className={iconBtn}>
          <Bell className="h-[18px] w-[18px]" />
        </Link>
        <Link
          href="/settings"
          title={me?.email}
          aria-label="Account settings"
          className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-[11.5px] font-bold text-background ring-1 ring-border transition-shadow hover:ring-2 hover:ring-brand/50"
        >
          {initials(me?.name || me?.email || "")}
        </Link>
      </div>
    </header>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <AuthGuard>
      <div className="flex h-[100dvh] overflow-hidden bg-background">
        <Sidebar className="hidden md:flex" />
        <MobileDrawer open={drawerOpen} onClose={closeDrawer} />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Topbar onMenu={openDrawer} />
          <main className="relative flex-1 overflow-y-auto overscroll-contain">
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-80 overflow-hidden">
              <div className="animate-aurora-a absolute -top-40 left-1/2 h-72 w-[720px] -translate-x-1/2 rounded-full bg-brand/[0.06] blur-[120px]" />
              <div className="animate-aurora-b absolute -top-24 right-[8%] h-48 w-[420px] rounded-full bg-brand-cyan/[0.045] blur-[110px]" />
              <div className="mask-fade-b absolute inset-0 text-foreground/[0.03]">
                <div className="bg-grid absolute inset-0" />
              </div>
            </div>

            <div className="relative mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</div>
            <UpgradeDialogHost />
          </main>
          <MobileTabBar onMore={openDrawer} />
        </div>

        <CommandMenu />
      </div>
    </AuthGuard>
  );
}
