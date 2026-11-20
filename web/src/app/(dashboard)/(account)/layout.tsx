"use client";

// Settings hub: every account page (profile, API keys, notifications, team,
// billing) shares one header and a tab bar, the same pattern as a project's
// tabs, so pages get the full width. Help and legal links sit in a quiet
// footer row.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { BookOpenTextIcon, CookieIcon, FlagIcon, LifebuoyIcon, ScalesIcon, SignOutIcon, type Icon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { openCookieSettings } from "@/lib/consent";
import { PageHeader } from "@/components/dashboard/kit";
import { ACCOUNT_NAV, isActive } from "@/components/dashboard/nav-config";

const TAB_LABEL: Record<string, string> = { "/settings": "Profile" };

function FooterLink({ icon: I, label, href, onClick, external }: { icon: Icon; label: string; href?: string; onClick?: () => void; external?: boolean }) {
  const cls = "inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground";
  const inner = <><I className="h-4 w-4" />{label}</>;
  if (onClick) return <button type="button" onClick={onClick} className={cls}>{inner}</button>;
  if (external || href!.startsWith("mailto:")) return <a href={href} target={external ? "_blank" : undefined} rel={external ? "noopener" : undefined} className={cls}>{inner}</a>;
  return <Link href={href!} className={cls}>{inner}</Link>;
}

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const signOut = () => {
    api.logout();
    router.push("/sign-in");
  };

  return (
    <div className="animate-fade-in-up">
      <PageHeader title="Settings" description="Your profile, developer access, team and billing." />

      <nav aria-label="Settings" className="frost sticky top-0 z-10 -mx-4 mt-5 border-b border-[var(--dz-hairline)] px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="-mb-px flex items-center gap-0.5 overflow-x-auto [mask-image:linear-gradient(to_right,#000_88%,transparent)] [scrollbar-width:none] sm:gap-1 sm:[mask-image:none]">
          {ACCOUNT_NAV.map(({ href, label, icon: I }) => {
            const on = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={on ? "page" : undefined}
                ref={on ? (el: HTMLAnchorElement | null) => { el?.scrollIntoView({ block: "nearest", inline: "nearest" }); } : undefined}
                className={cn(
                  "group relative flex h-11 items-center gap-2 whitespace-nowrap px-2.5 text-[13.5px] transition-colors sm:px-3",
                  on ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <I weight="duotone" className={cn("dz-ico hidden h-[17px] w-[17px] sm:block", on && "dz-ico-on")} />
                {TAB_LABEL[href] ?? label}
                {on && (
                  <motion.span layoutId="dz-account-tab" transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }} className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-brand" />
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="mt-7">{children}</div>

      <footer className="mt-14 flex flex-wrap items-center gap-x-5 gap-y-2.5 border-t border-[var(--dz-hairline)] pt-5">
        <FooterLink href="/docs" external icon={BookOpenTextIcon} label="Documentation" />
        <FooterLink href="mailto:support@deployzy.com" icon={LifebuoyIcon} label="Contact support" />
        <FooterLink href="/report" icon={FlagIcon} label="Report abuse" />
        <FooterLink href="/terms" icon={ScalesIcon} label="Terms & privacy" />
        <FooterLink onClick={openCookieSettings} icon={CookieIcon} label="Cookie settings" />
        <span className="sm:ml-auto"><FooterLink onClick={signOut} icon={SignOutIcon} label="Sign out" /></span>
      </footer>
    </div>
  );
}
