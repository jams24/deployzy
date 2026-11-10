"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Check, ChevronsUpDown, LogOut, Plus, Search, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { initials, useModKey, useSession } from "@/lib/use-me";
import { API, headers } from "@/components/project/project-shared";
import { ThemeToggle } from "@/components/theme-toggle";
import { openCommandMenu } from "./command-menu";
import { ADMIN_ITEM, NAV_GROUPS, isActive, type NavItem } from "./nav-config";

// Dashboard sidebar. The active item carries a sliding pill (framer-motion
// layoutId, namespaced per instance so the desktop sidebar and the mobile
// drawer never animate between each other).

const EASE = [0.16, 1, 0.3, 1] as const;

const PLAN_LABEL: Record<string, string> = { free: "Free", hobby: "Hobby", pro: "Pro", team: "Team", admin: "Admin" };

function NavLink({ item, active, lid, onNavigate }: { item: NavItem; active: boolean; lid: string; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-9 items-center gap-3 rounded-xl px-3 text-[14px] transition-colors duration-200 md:h-[34px] md:text-[13.5px]",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {active ? (
        <motion.span
          layoutId={lid}
          transition={{ duration: 0.45, ease: EASE }}
          className="absolute inset-0 rounded-xl border border-[var(--dz-hairline)] bg-background shadow-[0_1px_2px_oklch(0_0_0/0.06)] dark:bg-white/[0.06] dark:shadow-none"
        >
          <span className="absolute -left-3 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-brand" />
        </motion.span>
      ) : (
        <span className="absolute inset-0 rounded-xl transition-colors duration-200 group-hover:bg-foreground/[0.04]" />
      )}
      <Icon
        className={cn(
          "relative h-4 w-4 shrink-0 transition-colors duration-200",
          active ? "text-brand" : "text-muted-foreground/80 group-hover:text-foreground",
        )}
      />
      <span className={cn("relative truncate", active && "font-medium")}>{item.label}</span>
    </Link>
  );
}

export function Sidebar({ onNavigate, onClose, className }: { onNavigate?: () => void; onClose?: () => void; className?: string } = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const lid = useId();
  const mod = useModKey();
  const { me, isAdmin } = useSession();

  const [teams, setTeams] = useState<{ id: string; name: string; role: string }[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("sm_token")) return;
    fetch(`${API}/api/v1/teams`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        setTeams(data || []);
        const saved = localStorage.getItem("sm_team_id");
        if (saved && data?.some((t: { id: string }) => t.id === saved)) setActiveTeamId(saved);
      })
      .catch(() => {});
  }, []);

  function switchTeam(id: string | null) {
    setActiveTeamId(id);
    setTeamOpen(false);
    if (id) localStorage.setItem("sm_team_id", id);
    else localStorage.removeItem("sm_team_id");
    window.location.reload();
  }

  const name = me?.name ?? "";
  const email = me?.email ?? "";
  const plan = me?.plan ?? "";
  const activeTeam = teams.find((t) => t.id === activeTeamId);
  const workspaceName = activeTeam?.name ?? (name ? `${name.split(" ")[0]}'s workspace` : "Personal");

  return (
    <aside className={cn("flex h-full w-[248px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar", className)}>
      {/* Logo */}
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <Link href="/" onClick={onNavigate} className="group flex items-center gap-2.5">
          <span className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.png" alt="" className="h-7 w-7 rounded-lg transition-transform duration-300 group-hover:rotate-[8deg] group-hover:scale-105" />
            <span aria-hidden className="absolute inset-0 rounded-lg bg-brand/0 blur-md transition-colors duration-300 group-hover:bg-brand/30" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-foreground">Deployzy</span>
        </Link>
        <div className="flex items-center gap-1.5">
          {plan && (
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider",
                plan === "free" ? "text-muted-foreground" : "border-brand/30 bg-brand/10 text-brand",
              )}
            >
              {PLAN_LABEL[plan] ?? plan}
            </span>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              className="-mr-1.5 flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
            >
              <X className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>
      </div>

      <div className="shrink-0 space-y-2 px-3 pb-3">
        {/* Workspace switcher */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setTeamOpen((o) => !o)}
            aria-expanded={teamOpen}
            className={cn(
              "flex h-11 w-full items-center gap-2.5 rounded-xl border bg-background px-2 text-left transition-colors duration-200 dark:bg-white/[0.03]",
              teamOpen ? "border-foreground/20" : "border-[var(--dz-hairline)] hover:border-foreground/15",
            )}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--dz-green)] to-[var(--dz-cyan)] text-[11.5px] font-bold text-[oklch(0.16_0.02_165)]">
              {initials(workspaceName)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium leading-tight text-foreground">{workspaceName}</span>
              <span className="block truncate text-[11.5px] leading-tight text-muted-foreground">{activeTeam ? `Team · ${activeTeam.role}` : "Personal"}</span>
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>

          <AnimatePresence>
            {teamOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.18, ease: EASE }}
                className="absolute inset-x-0 top-[calc(100%+6px)] z-30 origin-top overflow-hidden rounded-xl border bg-popover p-1 shadow-[0_20px_50px_-15px_rgba(0,0,0,.35)]"
              >
                <button
                  type="button"
                  onClick={() => switchTeam(null)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors hover:bg-muted"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-foreground text-[11px] font-bold text-background">
                    {initials(name || "Personal")}
                  </span>
                  <span className="flex-1 text-left">Personal</span>
                  {!activeTeamId && <Check className="h-3.5 w-3.5 text-brand" />}
                </button>
                {teams.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => switchTeam(t.id)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors hover:bg-muted"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-cyan/20 text-[11px] font-bold text-foreground">
                      {initials(t.name)}
                    </span>
                    <span className="flex-1 truncate text-left">{t.name}</span>
                    {activeTeamId === t.id && <Check className="h-3.5 w-3.5 text-brand" />}
                  </button>
                ))}
                <div className="mt-1 border-t pt-1">
                  <Link
                    href="/team"
                    onClick={() => {
                      setTeamOpen(false);
                      onNavigate?.();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Create team
                  </Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              onNavigate?.();
              openCommandMenu();
            }}
            className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl border border-[var(--dz-hairline)] bg-background px-2.5 text-[13.5px] text-muted-foreground transition-colors hover:border-foreground/15 hover:text-foreground dark:bg-white/[0.03]"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 truncate text-left">Search</span>
            <kbd className="hidden rounded-md border px-1.5 font-mono text-[11px] md:inline">{mod}K</kbd>
          </button>
          <Link href="/new" onClick={onNavigate} title="New project" aria-label="New project" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-background transition-transform hover:opacity-90 active:scale-95">
            <Plus className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-3 pb-4 pt-1">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="eyebrow mb-1.5 px-3 !text-[11px]">{group.label}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} lid={lid} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        ))}
        {isAdmin && (
          <div>
            <p className="eyebrow mb-1.5 px-3 !text-[11px]">System</p>
            <NavLink item={ADMIN_ITEM} active={isActive(pathname, ADMIN_ITEM.href)} lid={lid} onNavigate={onNavigate} />
          </div>
        )}
      </nav>

      {/* Upgrade nudge for free plans */}
      {plan === "free" && (
        <div className="shrink-0 px-3 pb-3">
          <Link
            href="/billing"
            onClick={onNavigate}
            className="group relative block overflow-hidden rounded-2xl border border-brand/25 bg-gradient-to-br from-brand/[0.12] via-transparent to-brand-cyan/[0.10] p-3.5"
          >
            <span className="flex items-center gap-2 text-[13.5px] font-semibold text-foreground">
              <Zap className="h-3.5 w-3.5 text-brand" />
              Upgrade plan
              <ArrowUpRight className="ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </span>
            <span className="mt-1 block text-[12.5px] leading-snug text-muted-foreground">Private repos, more projects and higher limits.</span>
          </Link>
        </div>
      )}

      {/* Account */}
      <div className="shrink-0 border-t border-sidebar-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2.5">
          <Link
            href="/settings"
            onClick={onNavigate}
            title={email}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-[11.5px] font-bold text-background ring-1 ring-border transition-shadow hover:ring-2 hover:ring-brand/50"
          >
            {initials(name || email)}
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium leading-tight text-foreground">{name || "Account"}</p>
            <p className="truncate text-[12px] leading-tight text-muted-foreground">{email || " "}</p>
          </div>
          <ThemeToggle />
          <button
            type="button"
            onClick={() => {
              api.logout();
              onNavigate?.();
              router.push("/sign-in");
            }}
            title="Sign out"
            aria-label="Sign out"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
