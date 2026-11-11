"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { Check, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Inline result line for a section footer ("Saved", or an error) instead of alert().
export type Note = { kind: "ok" | "err"; text: string } | null;

export function FooterNote({ note }: { note: Note }) {
  if (!note) return null;
  return (
    <span
      role={note.kind === "err" ? "alert" : "status"}
      className={cn(
        "flex items-center gap-1.5 text-[13px] sm:mr-auto",
        note.kind === "err" ? "text-red-600 dark:text-red-400" : "text-[var(--dz-green-strong)] dark:text-brand",
      )}
    >
      {note.kind === "err" ? <TriangleAlert className="h-3.5 w-3.5 shrink-0" /> : <Check className="h-3.5 w-3.5 shrink-0" />}
      {note.text}
    </span>
  );
}

// Shared building blocks for settings-style pages (project settings, account
// settings): a titled section card with an optional footer for actions, form
// fields, a switch, and a sticky in-page section nav with scroll-spy.

export const inputCls =
  "h-10 w-full rounded-xl border border-[var(--dz-hairline)] bg-background px-3 text-[14px] outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/70 focus:border-brand/60 focus:ring-4 focus:ring-brand/10 disabled:opacity-60 dark:bg-white/[0.02]";
export const monoInputCls = cn(inputCls, "font-mono text-[13.5px]");
export const selectCls = cn(inputCls, "pr-8");

export function SettingsSection({
  id,
  title,
  description,
  icon: Icon,
  action,
  footer,
  tone,
  children,
  className,
  bodyClassName,
}: {
  id?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  tone?: "danger";
  children?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const danger = tone === "danger";
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-28 overflow-hidden rounded-[20px]",
        danger ? "border border-red-500/30 bg-red-500/[0.025]" : "surface",
        className,
      )}
    >
      <div className={cn("flex items-start justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5", !children && !footer && "pb-4 sm:pb-5")}>
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <span className={cn(
              "hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:flex",
              danger ? "bg-red-500/10 text-red-600 dark:text-red-400" : "bg-foreground/[0.05] text-foreground/70",
            )}>
              <Icon className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0">
            <h2 className={cn("text-[15px] font-semibold tracking-tight", danger && "text-red-600 dark:text-red-400")}>{title}</h2>
            {description && <p className="mt-0.5 text-[13.5px] leading-snug text-muted-foreground">{description}</p>}
          </div>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children && <div className={cn("px-4 pb-4 pt-4 sm:px-5 sm:pb-5", bodyClassName)}>{children}</div>}
      {footer && (
        <div className={cn(
          "flex flex-col-reverse gap-2 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-end sm:px-5",
          danger ? "border-red-500/20" : "border-[var(--dz-hairline)] bg-foreground/[0.015]",
        )}>
          {footer}
        </div>
      )}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
  htmlFor,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13.5px] font-medium">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-[12.5px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50",
        checked ? "bg-brand" : "bg-foreground/15",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
          checked ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

// A row inside a section: text on the left, a control on the right.
export function SettingRow({ title, description, control, className }: {
  title: React.ReactNode; description?: React.ReactNode; control: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0", className)}>
      <div className="min-w-0">
        <p className="text-[14px] font-medium">{title}</p>
        {description && <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

export type SettingsNavItem = { id: string; label: string; icon: LucideIcon; tone?: "danger" };

// Sticky in-page nav for desktop. Highlights the section in view.
export function SettingsNav({ items, className }: { items: SettingsNavItem[]; className?: string }) {
  const [active, setActive] = useState(items[0]?.id);
  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items]);

  return (
    <nav aria-label="Sections" className={cn("space-y-0.5", className)}>
      {items.map(({ id, label, icon: Icon, tone }) => {
        const on = active === id;
        return (
          <a
            key={id}
            href={`#${id}`}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
              setActive(id);
            }}
            className={cn(
              "flex h-9 items-center gap-2.5 rounded-xl px-3 text-[14px] transition-colors",
              on ? "bg-foreground/[0.06] font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
              tone === "danger" && "text-red-600 hover:text-red-600 dark:text-red-400 dark:hover:text-red-400",
            )}
          >
            <Icon className={cn("h-4 w-4", on && tone !== "danger" && "text-brand")} />
            {label}
          </a>
        );
      })}
    </nav>
  );
}
