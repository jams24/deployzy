import {
  BarChart3, Bell, CreditCard, Database, Eye, Globe, Key, LayoutDashboard, LayoutTemplate,
  Link2, MailCheck, Rocket, Server, Settings, ShieldCheck, Sparkles, Users, Waypoints,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
  /** Extra words the command menu matches on. */
  keywords?: string;
}

// One source for the sidebar, the mobile tab bar and the command menu.
export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Deploy",
    items: [
      { href: "/agent", icon: Sparkles, label: "Agent", keywords: "ai builder chat" },
      { href: "/overview", icon: LayoutDashboard, label: "Overview", keywords: "home dashboard" },
      { href: "/projects", icon: Rocket, label: "Projects", keywords: "apps deploys" },
      { href: "/templates", icon: LayoutTemplate, label: "Templates", keywords: "one click" },
      { href: "/services", icon: Database, label: "Databases", keywords: "postgres redis mongo mysql services" },
      { href: "/servers", icon: Server, label: "Servers", keywords: "byoc vps" },
    ],
  },
  {
    label: "Network",
    items: [
      { href: "/tunnels", icon: Waypoints, label: "Tunnels", keywords: "localhost http tcp" },
      { href: "/subdomains", icon: Link2, label: "Subdomains" },
      { href: "/domains", icon: Globe, label: "Domains", keywords: "custom dns ssl" },
      { href: "/inspector", icon: Eye, label: "Inspector", keywords: "requests replay" },
      { href: "/email-verify", icon: MailCheck, label: "Email Verify" },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/analytics", icon: BarChart3, label: "Analytics", keywords: "traffic visitors" },
      { href: "/api-keys", icon: Key, label: "API Keys", keywords: "tokens" },
      { href: "/notifications", icon: Bell, label: "Notifications", keywords: "alerts webhooks" },
      { href: "/team", icon: Users, label: "Team", keywords: "members invite" },
      { href: "/billing", icon: CreditCard, label: "Billing", keywords: "plan upgrade credits invoice" },
      { href: "/settings", icon: Settings, label: "Settings", keywords: "profile account" },
    ],
  },
];

export const ADMIN_ITEM: NavItem = { href: "/admin", icon: ShieldCheck, label: "Admin", keywords: "console" };

const TITLES: [string, string][] = [
  ...NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.href, i.label] as [string, string])),
  ["/admin", "Admin Console"],
  ["/new", "New"],
  ["/database", "Database"],
  ["/redis", "Redis"],
  ["/mongo", "MongoDB"],
];

export function pageTitle(pathname: string): string {
  for (const [prefix, title] of TITLES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return title;
  }
  return "Dashboard";
}

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
