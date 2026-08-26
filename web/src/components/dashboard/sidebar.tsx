"use client";

import Link from "next/link";
import { useState, useEffect, useId } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Rocket, Database, Waypoints, Server, BarChart3,
  Link2, Globe, Eye, Key, Bell, Users, CreditCard, Settings,
  ShieldCheck, LogOut, Plus, ChevronDown, Check, LayoutTemplate, Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { ThemeToggle } from "@/components/theme-toggle";

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard sidebar — premium minimal nav. Active item carries a sliding pill
// (framer-motion layoutId, namespaced per sidebar instance so the desktop and
// mobile-overlay sidebars never fight over the same layout animation).
// All colors come from theme tokens so light/dark both work.
// ─────────────────────────────────────────────────────────────────────────────

const EASE = [0.22, 1, 0.36, 1] as const;

const navGroups = [
  {
    label: "Deploy",
    items: [
      { href: "/agent",      icon: Sparkles,         label: "Agent" },
      { href: "/overview",   icon: LayoutDashboard,  label: "Overview" },
      { href: "/projects",   icon: Rocket,           label: "Projects" },
      { href: "/templates",  icon: LayoutTemplate,   label: "Templates" },
      { href: "/services",   icon: Database,          label: "Databases" },
      { href: "/servers",    icon: Server,            label: "Servers" },
    ],
  },
  {
    label: "Network",
    items: [
      { href: "/tunnels",    icon: Waypoints, label: "Tunnels" },
      { href: "/subdomains", icon: Link2,     label: "Subdomains" },
      { href: "/domains",    icon: Globe,     label: "Domains" },
      { href: "/inspector",  icon: Eye,       label: "Inspector" },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/analytics",     icon: BarChart3,  label: "Analytics" },
      { href: "/api-keys",      icon: Key,        label: "API Keys" },
      { href: "/notifications", icon: Bell,       label: "Notifications" },
      { href: "/team",          icon: Users,      label: "Team" },
      { href: "/billing",       icon: CreditCard, label: "Billing" },
      { href: "/settings",      icon: Settings,   label: "Settings" },
    ],
  },
] as const;

const adminItem = { href: "/admin", icon: ShieldCheck, label: "Admin" };

function NavItem({
  href, icon: Icon, label, active, lid, onNavigate,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  lid: string;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] transition-colors duration-200",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {active && (
        <motion.span
          layoutId={lid}
          transition={{ duration: 0.4, ease: EASE }}
          className="absolute inset-0 rounded-lg bg-accent"
        >
          {/* emerald notch on the leading edge of the active pill */}
          <span className="absolute left-0 top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-full bg-emerald-500" />
        </motion.span>
      )}
      {!active && (
        <span className="absolute inset-0 rounded-lg transition-colors duration-200 group-hover:bg-accent/60" />
      )}
      <Icon
        className={cn(
          "relative h-4 w-4 shrink-0 transition-all duration-200",
          active
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-muted-foreground group-hover:text-foreground group-hover:scale-110",
        )}
      />
      <span className={cn("relative truncate", active && "font-medium")}>{label}</span>
    </Link>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const pathname = usePathname();
  const router = useRouter();
  // Unique layoutId namespace — desktop and mobile sidebars can both be mounted
  // (desktop is CSS-hidden); sharing one layoutId would make the active pill
  // animate between the two trees.
  const lid = useId();

  const [isAdmin, setIsAdmin] = useState(false);
  const [teams, setTeams] = useState<{ id: string; name: string; role: string }[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("sm_token");
    if (!token) return;
    const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";
    const h = { Authorization: `Bearer ${token}` };

    fetch(`${base}/api/v1/users/me`, { headers: h })
      .then(r => r.ok ? r.json() : null)
      .then(u => {
        if (!u) return;
        if (u.name) setUserName(u.name);
        if (u.email) setUserEmail(u.email);
      })
      .catch(() => {});

    fetch(`${base}/api/v1/teams`, { headers: h })
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        setTeams(data || []);
        const saved = localStorage.getItem("sm_team_id");
        if (saved && data?.some((t: { id: string }) => t.id === saved)) setActiveTeamId(saved);
      })
      .catch(() => {});

    fetch(`${base}/api/v1/admin/stats`, { headers: h })
      .then(r => { if (r.ok) setIsAdmin(true); })
      .catch(() => {});
  }, []);

  function switchTeam(id: string | null) {
    setActiveTeamId(id);
    setTeamOpen(false);
    if (id) localStorage.setItem("sm_team_id", id);
    else localStorage.removeItem("sm_team_id");
    window.location.reload();
  }

  const activeTeam = teams.find(t => t.id === activeTeamId);
  const workspaceName = activeTeam?.name ?? (userName ? `${userName.split(" ")[0]}'s workspace` : "Personal");
  const initials = workspaceName.slice(0, 2).toUpperCase();
  const userInitials = (userName || userEmail || "U").split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();

  return (
    <aside className="flex h-full w-[220px] flex-col bg-sidebar border-r border-sidebar-border shrink-0">

      {/* Logo — same hover glow as the marketing navbar */}
      <div className="flex h-[52px] items-center gap-2.5 px-4 border-b border-border shrink-0">
        <Link href="/" className="group flex items-center gap-2.5" onClick={onNavigate}>
          <span className="relative">
            <img src="/logo-mark.png" alt="Deployzy" className="h-6 w-6 rounded-md transition-transform duration-300 group-hover:scale-110 group-hover:rotate-[8deg]" />
            <span aria-hidden className="absolute inset-0 rounded-md bg-emerald-400/0 blur-md transition-colors duration-300 group-hover:bg-emerald-400/25" />
          </span>
          <span className="font-semibold text-[14px] tracking-tight text-foreground">Deployzy</span>
        </Link>
      </div>

      {/* Workspace switcher */}
      <div className="px-3 pt-3 pb-2 border-b border-border shrink-0">
        <button
          onClick={() => setTeamOpen(o => !o)}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left transition-all duration-200",
            teamOpen
              ? "border-foreground/20 bg-accent"
              : "border-border/60 bg-card hover:border-foreground/15 hover:bg-accent",
          )}
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground text-background text-[10px] font-bold shrink-0">
            {initials}
          </div>
          <span className="flex-1 text-[13px] font-medium text-foreground truncate">{workspaceName}</span>
          <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform duration-200", teamOpen && "rotate-180")} />
        </button>

        <AnimatePresence>
          {teamOpen && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.18, ease: EASE }}
              className="mt-1.5 rounded-lg border border-border bg-popover shadow-lg shadow-black/5 dark:shadow-black/30 overflow-hidden origin-top"
            >
              <button
                onClick={() => switchTeam(null)}
                className="flex w-full items-center gap-2 px-3 py-2 text-[12px] hover:bg-accent transition-colors"
              >
                <div className="flex h-5 w-5 items-center justify-center rounded-md bg-foreground text-background text-[9px] font-bold shrink-0">
                  {(userName.slice(0, 2) || "PL").toUpperCase()}
                </div>
                <span className="flex-1 text-left">Personal</span>
                {!activeTeamId && <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />}
              </button>
              {teams.map(t => (
                <button
                  key={t.id}
                  onClick={() => switchTeam(t.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-[12px] hover:bg-accent transition-colors"
                >
                  <div className="flex h-5 w-5 items-center justify-center rounded-md bg-violet-500 text-white text-[9px] font-bold shrink-0">
                    {t.name.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="flex-1 truncate text-left">{t.name}</span>
                  {activeTeamId === t.id && <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />}
                </button>
              ))}
              <div className="border-t border-border">
                <Link
                  href="/team"
                  onClick={() => { setTeamOpen(false); onNavigate?.(); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create team
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* New project — primary action */}
      <div className="px-3 py-2.5 shrink-0">
        <Link
          href="/new"
          onClick={onNavigate}
          className="btn-shine flex items-center justify-center gap-2 rounded-lg bg-foreground px-3 py-2 text-[12.5px] font-semibold text-background transition-transform duration-200 hover:scale-[1.02] active:scale-[0.98]"
        >
          <Plus className="h-3.5 w-3.5" />
          New project
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 pb-3 space-y-5">
        {navGroups.map(group => (
          <div key={group.label}>
            <p className="px-2.5 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
              {group.label}
            </p>
            <div className="space-y-px">
              {group.items.map(item => (
                <NavItem
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  active={pathname.startsWith(item.href)}
                  lid={lid}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        ))}

        {isAdmin && (
          <div>
            <p className="px-2.5 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
              System
            </p>
            <NavItem
              href={adminItem.href}
              icon={adminItem.icon}
              label={adminItem.label}
              active={pathname.startsWith(adminItem.href)}
              lid={lid}
              onNavigate={onNavigate}
            />
          </div>
        )}
      </nav>

      {/* Footer — user card with theme + sign-out actions */}
      <div className="border-t border-border p-3 shrink-0">
        <div className="flex items-center gap-2 rounded-lg px-1.5 py-1.5">
          <Link
            href="/settings"
            onClick={onNavigate}
            title={userEmail}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-background text-[10px] font-bold shrink-0 ring-1 ring-border transition-shadow hover:ring-2 hover:ring-emerald-500/40"
          >
            {userInitials}
          </Link>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-foreground truncate leading-tight">
              {userName || "Account"}
            </p>
            <p className="text-[10px] text-muted-foreground truncate leading-tight">
              {userEmail || "Personal workspace"}
            </p>
          </div>
          <ThemeToggle />
          <button
            onClick={() => {
              api.logout();
              onNavigate?.();
              router.push("/sign-in");
            }}
            title="Sign out"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
