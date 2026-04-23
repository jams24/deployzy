"use client";

import Link from "next/link";
import {
  useState, useEffect } from "react";
import {
  usePathname } from "next/navigation";
import {
  cn } from "@/lib/utils";
import {
  Terminal,
  Globe,
  Key,
  Eye,
  Rocket,
  Link2,
  Users,
  Settings,
  LogOut,
  Waypoints,
  BarChart3,
  Bell,
  ShieldCheck,
  CreditCard,
  Server,
  LayoutDashboard,
  Database,
} from "lucide-react";
import {
  api } from "@/lib/api";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  useRouter } from "next/navigation";

const navItems = [
  { href: "/overview", icon: LayoutDashboard, label: "Overview" },
  { href: "/projects", icon: Rocket, label: "Projects" },
  { href: "/services", icon: Database, label: "Databases" },
  { href: "/tunnels", icon: Waypoints, label: "Tunnels" },
  { href: "/servers", icon: Server, label: "Servers" },
  { href: "/analytics", icon: BarChart3, label: "Analytics" },
  { href: "/subdomains", icon: Link2, label: "Subdomains" },
  { href: "/domains", icon: Globe, label: "Domains" },
  { href: "/inspector", icon: Eye, label: "Inspector" },
  { href: "/api-keys", icon: Key, label: "API Keys" },
  { href: "/notifications", icon: Bell, label: "Notifications" },
  { href: "/team", icon: Users, label: "Team" },
  { href: "/billing", icon: CreditCard, label: "Billing" },
  { href: "/settings", icon: Settings, label: "Settings" },
  { href: "/admin", icon: ShieldCheck, label: "Admin", adminOnly: true },
] as const;

export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const pathname = usePathname();
  const router = useRouter();

  const [isAdmin, setIsAdmin] = useState(false);
  const [teams, setTeams] = useState<{ id: string; name: string; role: string }[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("sm_token");
    if (!token) return;
    const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";
    const h = { Authorization: `Bearer ${token}` };

    fetch(`${base}/api/v1/teams`, { headers: h })
      .then((r) => r.ok ? r.json() : [])
      .then((data) => {
        setTeams(data || []);
        const saved = localStorage.getItem("sm_team_id");
        if (saved && data?.some((t: { id: string }) => t.id === saved)) setActiveTeamId(saved);
      })
      .catch(() => {});

    // Check admin status
    fetch(`${base}/api/v1/admin/stats`, { headers: h })
      .then((r) => { if (r.ok) setIsAdmin(true); })
      .catch(() => {});
  }, []);

  function switchTeam(id: string | null) {
    setActiveTeamId(id);
    if (id) localStorage.setItem("sm_team_id", id);
    else localStorage.removeItem("sm_team_id");
    window.location.reload(); // Reload to refresh all data with team context
  }

  return (
    <aside className="flex h-full w-full flex-col border-r border-border/40 bg-background shrink-0">
      <div className="flex h-16 items-center gap-2 border-b border-border/40 px-6">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg" onClick={onNavigate}>
          <img src="/logo-icon.svg" alt="ServerMe" className="h-7 w-7 rounded-md" />
          ServerMe
        </Link>
      </div>

      {/* Team Switcher */}
      {teams.length > 0 && (
        <div className="border-b border-border/40 p-3">
          <select
            value={activeTeamId || "personal"}
            onChange={(e) => switchTeam(e.target.value === "personal" ? null : e.target.value)}
            className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs font-medium"
          >
            <option value="personal">Personal Account</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.role})</option>
            ))}
          </select>
        </div>
      )}

      <nav className="flex-1 space-y-1 p-3 overflow-y-auto">
        {navItems.filter((item) => !("adminOnly" in item && item.adminOnly) || isAdmin).map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                active
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border/40 p-3 space-y-1">
        <div className="flex items-center justify-between px-3 py-1">
          <span className="text-xs text-muted-foreground">Theme</span>
          <ThemeToggle />
        </div>
        <button
          onClick={() => {
            api.logout();
            onNavigate?.();
            router.push("/sign-in");
          }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
