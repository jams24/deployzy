import type { Icon } from "@phosphor-icons/react";
import {
  BellSimpleIcon, ChartLineUpIcon, CreditCardIcon, DatabaseIcon, EnvelopeOpenIcon, GearSixIcon,
  GlobeHemisphereWestIcon, HardDrivesIcon, HouseSimpleIcon, KeyIcon, LinkSimpleIcon,
  ListMagnifyingGlassIcon, PlugsConnectedIcon, RocketLaunchIcon, ShieldCheckIcon, SparkleIcon,
  SquaresFourIcon, UserCircleIcon, UsersThreeIcon,
} from "@phosphor-icons/react";

export interface NavItem {
  href: string;
  icon: Icon;
  label: string;
  /** Extra words the command menu matches on. */
  keywords?: string;
  /** Tiny tag after the label, e.g. "AI". */
  badge?: string;
}

// One source for the sidebar, the mobile tab bar, the account hub and the
// command menu. The sidebar shows MAIN without a heading and MORE under one
// quiet label; account pages live in the Settings hub (ACCOUNT_NAV).
export const NAV_MAIN: NavItem[] = [
  { href: "/overview", icon: HouseSimpleIcon, label: "Overview", keywords: "home dashboard" },
  { href: "/projects", icon: RocketLaunchIcon, label: "Projects", keywords: "apps deploys" },
  { href: "/services", icon: DatabaseIcon, label: "Databases", keywords: "postgres redis mongo mysql services" },
  { href: "/new/template", icon: SquaresFourIcon, label: "Templates", keywords: "one click apps n8n ghost" },
  { href: "/tunnels", icon: PlugsConnectedIcon, label: "Tunnels", keywords: "localhost http tcp" },
  { href: "/domains", icon: GlobeHemisphereWestIcon, label: "Domains", keywords: "custom dns ssl" },
  { href: "/agent", icon: SparkleIcon, label: "Agent", keywords: "ai builder chat", badge: "AI" },
];

export const NAV_MORE: NavItem[] = [
  { href: "/servers", icon: HardDrivesIcon, label: "Servers", keywords: "byoc vps" },
  { href: "/subdomains", icon: LinkSimpleIcon, label: "Subdomains" },
  { href: "/inspector", icon: ListMagnifyingGlassIcon, label: "Inspector", keywords: "requests replay" },
  { href: "/email-verify", icon: EnvelopeOpenIcon, label: "Email Verify" },
  { href: "/analytics", icon: ChartLineUpIcon, label: "Analytics", keywords: "traffic visitors" },
];

export const ACCOUNT_NAV: NavItem[] = [
  { href: "/settings", icon: UserCircleIcon, label: "Profile & security", keywords: "account password appearance settings" },
  { href: "/api-keys", icon: KeyIcon, label: "API keys", keywords: "tokens" },
  { href: "/notifications", icon: BellSimpleIcon, label: "Notifications", keywords: "alerts webhooks telegram" },
  { href: "/team", icon: UsersThreeIcon, label: "Team", keywords: "members invite" },
  { href: "/billing", icon: CreditCardIcon, label: "Billing", keywords: "plan upgrade credits invoice" },
];

export const SETTINGS_ITEM: NavItem = { href: "/settings", icon: GearSixIcon, label: "Settings", keywords: "account profile" };
export const ADMIN_ITEM: NavItem = { href: "/admin", icon: ShieldCheckIcon, label: "Admin", keywords: "console" };

/** Every destination, for the command menu. */
export const ALL_NAV: NavItem[] = [...NAV_MAIN, ...NAV_MORE, ...ACCOUNT_NAV];

const TITLES: [string, string][] = [
  ["/settings", "Settings"],
  ...ALL_NAV.map((i) => [i.href, i.label] as [string, string]),
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

/** True on any page that lives in the Settings hub. */
export function inAccountHub(pathname: string): boolean {
  return ACCOUNT_NAV.some((i) => isActive(pathname, i.href));
}
