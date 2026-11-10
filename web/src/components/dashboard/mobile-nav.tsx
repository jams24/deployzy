"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Database, LayoutDashboard, Menu, Plus, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import { isActive } from "./nav-config";
import { Sidebar } from "./sidebar";

const TABS = [
  { href: "/overview", icon: LayoutDashboard, label: "Home" },
  { href: "/projects", icon: Rocket, label: "Projects" },
  { href: "/services", icon: Database, label: "Databases" },
];

// Routes that need the full height of the screen (editors, chat) hide the
// tab bar; the topbar menu button still opens the drawer there.
const FULL_HEIGHT = ["/agent", "/database/", "/redis/", "/mongo/"];

export function showsTabBar(pathname: string): boolean {
  return !FULL_HEIGHT.some((p) => pathname === p || pathname.startsWith(p));
}

/** Bottom tab bar for phones. Sits in the layout's flex column, not fixed, so content never hides under it. */
export function MobileTabBar({ onMore }: { onMore: () => void }) {
  const pathname = usePathname();
  if (!showsTabBar(pathname)) return null;

  const tab = (t: (typeof TABS)[number]) => {
    const active = isActive(pathname, t.href);
    return (
      <Link
        key={t.href}
        href={t.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex flex-1 flex-col items-center justify-center gap-1 text-[11.5px] font-medium transition-colors",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {active && <motion.span layoutId="dz-tab" className="absolute top-0 h-[2px] w-8 rounded-full bg-brand" transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }} />}
        <t.icon className={cn("h-5 w-5", active && "text-brand")} />
        {t.label}
      </Link>
    );
  };

  return (
    <nav aria-label="Primary" className="frost shrink-0 border-t border-[var(--dz-hairline)] pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="flex h-16 items-stretch">
        {tab(TABS[0])}
        {tab(TABS[1])}
        <div className="flex flex-1 items-center justify-center">
          <Link
            href="/new"
            aria-label="New project"
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground text-background shadow-[0_10px_30px_-10px_color-mix(in_oklch,var(--dz-green)_70%,transparent)] transition-transform active:scale-95"
          >
            <Plus className="h-5 w-5" />
          </Link>
        </div>
        {tab(TABS[2])}
        <button type="button" onClick={onMore} className="flex flex-1 flex-col items-center justify-center gap-1 text-[11.5px] font-medium text-muted-foreground">
          <Menu className="h-5 w-5" />
          More
        </button>
      </div>
    </nav>
  );
}

/** Slide-in drawer holding the full sidebar. */
export function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <motion.div
            className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            className="absolute inset-y-0 left-0 w-[min(300px,86vw)] shadow-2xl"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0.4, right: 0 }}
            onDragEnd={(_, info) => {
              if (info.offset.x < -70 || info.velocity.x < -400) onClose();
            }}
          >
            <Sidebar onNavigate={onClose} onClose={onClose} className="w-full pt-[env(safe-area-inset-top)]" />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
