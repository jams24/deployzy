"use client";

// "⋯" overflow menu for list rows and cards: keeps one obvious action on the
// row and tucks the rest away. Built on Base UI's Menu (keyboard, focus and
// outside-click handled), styled to match the dashboard surfaces.
//
// The popup is portalled, but React events still bubble to the row, so put
// the menu inside a wrapper that stops propagation if the row is clickable.

import Link from "next/link";
import { Menu } from "@base-ui/react/menu";
import { DotsThreeIcon, type Icon as PhosphorIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export interface RowMenuItem {
  label: string;
  icon: PhosphorIcon;
  /** Runs on click / Enter. */
  onSelect?: () => void;
  /** Internal route or external URL (external opens in a new tab). */
  href?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Draw a divider above this item. */
  divider?: boolean;
}

const itemCls =
  "flex w-full cursor-default items-center gap-2.5 rounded-[9px] px-2.5 py-[7px] text-[13px] text-foreground outline-none select-none transition-colors data-[highlighted]:bg-foreground/[0.06] data-[disabled]:pointer-events-none data-[disabled]:opacity-45";

export function RowMenu({
  items,
  label = "More actions",
  className,
}: {
  items: (RowMenuItem | false | null | undefined)[];
  label?: string;
  className?: string;
}) {
  const list = items.filter(Boolean) as RowMenuItem[];
  if (!list.length) return null;
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={label}
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors",
          "hover:bg-foreground/[0.06] hover:text-foreground data-[popup-open]:bg-foreground/[0.06] data-[popup-open]:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
          className,
        )}
      >
        <DotsThreeIcon weight="bold" className="h-[18px] w-[18px]" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={6} className="z-50 outline-none">
          <Menu.Popup
            className={cn(
              "min-w-[190px] origin-[var(--transform-origin)] rounded-[13px] border border-[var(--dz-hairline)] bg-card p-1 outline-none",
              "shadow-[0_18px_44px_-18px_rgb(0_0_0/0.4),0_2px_6px_-2px_rgb(0_0_0/0.08)]",
              "transition-[opacity,transform] duration-150 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0",
            )}
          >
            {list.map((it) => {
              const Icon = it.icon;
              const body = (
                <>
                  <Icon weight="duotone" className={cn("h-4 w-4 shrink-0", it.danger ? "text-red-600 dark:text-red-400" : "text-muted-foreground")} />
                  <span className={cn("flex-1", it.danger && "text-red-600 dark:text-red-400")}>{it.label}</span>
                </>
              );
              const ext = it.href && /^https?:/.test(it.href);
              return (
                <div key={it.label}>
                  {it.divider && <Menu.Separator className="mx-1.5 my-1 h-px bg-[var(--dz-hairline)]" />}
                  {it.href ? (
                    <Menu.LinkItem
                      className={itemCls}
                      render={ext ? <a href={it.href} target="_blank" rel="noopener noreferrer" /> : <Link href={it.href} />}
                    >
                      {body}
                    </Menu.LinkItem>
                  ) : (
                    <Menu.Item className={itemCls} disabled={it.disabled} onClick={it.onSelect}>
                      {body}
                    </Menu.Item>
                  )}
                </div>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
