"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Rocket, Database, Waypoints, Server, BarChart3,
  Link2, Globe, Eye, Key, Bell, Users, CreditCard, Settings,
  ShieldCheck, LogOut, Plus, ChevronDown, Check,
} from "lucide-react";
import { api } from "@/lib/api";
import { ThemeToggle } from "@/components/theme-toggle";

const navGroups = [
  {
    label: "Deploy",
    items: [
      { href: "/overview",  icon: LayoutDashboard, label: "Overview" },
      { href: "/projects",  icon: Rocket,          label: "Projects" },
      { href: "/services",  icon: Database,         label: "Databases" },
      { href: "/servers",   icon: Server,           label: "Servers" },
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

export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const pathname = usePathname();
  const router = useRouter();

  const [isAdmin, setIsAdmin] = useState(false);
  const [teams, setTeams] = useState<{ id: string; name: string; role: string }[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);
  const [userName, setUserName] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("sm_token");
    if (!token) return;
    const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";
    const h = { Authorization: `Bearer ${token}` };

    fetch(`${base}/api/v1/users/me`, { headers: h })
      .then(r => r.ok ? r.json() : null)
      .then(u => { if (u?.name) setUserName(u.name); })
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

  return (
    <aside className="flex h-full w-[220px] flex-col bg-background border-r border-border shrink-0">

      {/* Logo */}
      <div className="flex h-[52px] items-center gap-2.5 px-4 border-b border-border shrink-0">
        <Link href="/" className="flex items-center gap-2.5" onClick={onNavigate}>
          <img src="/logo-icon.svg" alt="Deployzy" className="h-6 w-6 rounded" />
          <span className="font-semibold text-[14px] tracking-tight text-foreground">Deployzy</span>
        </Link>
      </div>

      {/* Workspace switcher */}
      <div className="px-3 pt-3 pb-2 border-b border-border shrink-0">
        <button
          onClick={() => setTeamOpen(o => !o)}
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent transition-colors text-left"
        >
          <div className="flex h-6 w-6 items-center justify-center rounded bg-foreground text-background text-[10px] font-bold shrink-0">
            {initials}
          </div>
          <span className="flex-1 text-[13px] font-medium text-foreground truncate">{workspaceName}</span>
          <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", teamOpen && "rotate-180")} />
        </button>

        {teamOpen && (
          <div className="mt-1 rounded-md border border-border bg-popover shadow-md overflow-hidden">
            <button
              onClick={() => switchTeam(null)}
              className="flex w-full items-center gap-2 px-3 py-2 text-[12px] hover:bg-accent transition-colors"
            >
              <div className="flex h-5 w-5 items-center justify-center rounded bg-foreground text-background text-[9px] font-bold shrink-0">
                {(userName.slice(0, 2) || "PL").toUpperCase()}
              </div>
              <span className="flex-1">Personal</span>
              {!activeTeamId && <Check className="h-3 w-3 text-foreground" />}
            </button>
            {teams.map(t => (
              <button
                key={t.id}
                onClick={() => switchTeam(t.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-[12px] hover:bg-accent transition-colors"
              >
                <div className="flex h-5 w-5 items-center justify-center rounded bg-indigo-500 text-white text-[9px] font-bold shrink-0">
                  {t.name.slice(0, 2).toUpperCase()}
                </div>
                <span className="flex-1 truncate">{t.name}</span>
                {activeTeamId === t.id && <Check className="h-3 w-3 text-foreground" />}
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
          </div>
        )}
      </div>

      {/* New project shortcut */}
      <div className="px-3 py-2 shrink-0">
        <Link
          href="/new"
          onClick={onNavigate}
          className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 hover:bg-accent transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New project
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 pb-3 space-y-4">
        {navGroups.map(group => (
          <div key={group.label}>
            <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              {group.label}
            </p>
            <div className="space-y-px">
              {group.items.map(item => {
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors",
                      active
                        ? "bg-accent text-foreground font-medium"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    <item.icon className={cn("h-4 w-4 shrink-0", active ? "text-foreground" : "text-muted-foreground/70")} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        {isAdmin && (
          <div>
            <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              System
            </p>
            <Link
              href={adminItem.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors",
                pathname.startsWith(adminItem.href)
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <adminItem.icon className="h-4 w-4 shrink-0 text-muted-foreground/70" />
              {adminItem.label}
            </Link>
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="border-t border-border px-3 py-2 shrink-0 space-y-px">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-[12px] text-muted-foreground">Theme</span>
          <ThemeToggle />
        </div>
        <button
          onClick={() => {
            api.logout();
            onNavigate?.();
            router.push("/sign-in");
          }}
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <LogOut className="h-4 w-4 shrink-0 text-muted-foreground/70" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
