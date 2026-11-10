"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { ArrowRight, BookOpen, CornerDownLeft, Database, LogOut, Moon, Plus, Rocket, Search, Sun, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { API, headers } from "@/components/project/project-shared";
import { useSession } from "@/lib/use-me";
import { ADMIN_ITEM, NAV_GROUPS } from "./nav-config";

const OPEN_EVENT = "dz:command-menu";

/** Open the command menu from anywhere (sidebar search, topbar, tab bar). */
export function openCommandMenu() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

interface Entry {
  id: string;
  group: string;
  label: string;
  hint?: string;
  keywords?: string;
  icon: LucideIcon;
  dot?: string;
  run: () => void;
}

interface ProjectLite {
  id: string;
  name: string;
  subdomain: string;
  status: string;
}
interface DbLite {
  id: string;
  name: string;
  type: string;
}

const STATUS_DOT: Record<string, string> = {
  running: "bg-brand",
  building: "bg-amber-500",
  deploying: "bg-amber-500",
  failed: "bg-red-500",
  crashed: "bg-red-500",
  stopped: "bg-zinc-400",
  sleeping: "bg-zinc-400",
};

/** Lower is better; null means no match. */
function score(entry: Entry, q: string): number | null {
  if (!q) return 0;
  const label = entry.label.toLowerCase();
  if (label.startsWith(q)) return 0;
  if (label.includes(q)) return 1;
  const hay = `${label} ${entry.keywords ?? ""} ${entry.hint ?? ""} ${entry.group}`.toLowerCase();
  if (hay.includes(q)) return 2;
  // Subsequence match ("prj" → "projects").
  let i = 0;
  for (const ch of label) if (ch === q[i]) i++;
  return i === q.length ? 3 : null;
}

export function CommandMenu() {
  const { isAdmin } = useSession();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [projects, setProjects] = React.useState<ProjectLite[]>([]);
  const [dbs, setDbs] = React.useState<DbLite[]>([]);
  const loaded = React.useRef(false);
  const listRef = React.useRef<HTMLDivElement>(null);
  const returnFocus = React.useRef<HTMLElement | null>(null);

  const show = React.useCallback(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setActive(0);
    setOpen(true);
    if (loaded.current) return;
    loaded.current = true;
    // Load lazily on first open; the menu works without them.
    fetch(`${API}/api/v1/projects`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setProjects(Array.isArray(d) ? d : []))
      .catch(() => {});
    fetch(`${API}/api/v1/databases`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setDbs(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  const close = React.useCallback(() => {
    setOpen(false);
    returnFocus.current?.focus?.();
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close();
        else show();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, show);
    };
  }, [open, show, close]);

  const go = React.useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const entries = React.useMemo<Entry[]>(() => {
    const list: Entry[] = [
      { id: "a-new", group: "Actions", label: "New project", keywords: "deploy create app", icon: Plus, run: () => go("/new") },
      { id: "a-db", group: "Actions", label: "New database", keywords: "postgres redis mongo mysql create", icon: Database, run: () => go("/new?type=database") },
      {
        id: "a-theme",
        group: "Actions",
        label: resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme",
        keywords: "theme dark light mode appearance",
        icon: resolvedTheme === "dark" ? Sun : Moon,
        run: () => {
          setTheme(resolvedTheme === "dark" ? "light" : "dark");
          setOpen(false);
        },
      },
      {
        id: "a-docs",
        group: "Actions",
        label: "Open documentation",
        keywords: "docs help cli api",
        icon: BookOpen,
        run: () => {
          setOpen(false);
          window.open("/docs", "_blank", "noopener");
        },
      },
    ];
    for (const p of projects) {
      list.push({
        id: `p-${p.id}`,
        group: "Projects",
        label: p.name,
        hint: p.status,
        keywords: p.subdomain,
        icon: Rocket,
        dot: STATUS_DOT[p.status] ?? "bg-zinc-400",
        run: () => go(`/projects/${p.id}`),
      });
    }
    for (const d of dbs) {
      list.push({ id: `d-${d.id}`, group: "Databases", label: d.name, hint: d.type, icon: Database, run: () => go("/services") });
    }
    const nav = [...NAV_GROUPS.flatMap((g) => g.items), ...(isAdmin ? [ADMIN_ITEM] : [])];
    for (const n of nav) {
      list.push({ id: `n-${n.href}`, group: "Go to", label: n.label, keywords: n.keywords, icon: n.icon, run: () => go(n.href) });
    }
    list.push({
      id: "a-out",
      group: "Account",
      label: "Sign out",
      keywords: "logout log out",
      icon: LogOut,
      run: () => {
        api.logout();
        go("/sign-in");
      },
    });
    return list;
  }, [projects, dbs, isAdmin, resolvedTheme, setTheme, go]);

  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const scored = entries
      .map((e, i) => ({ e, s: score(e, q), i }))
      .filter((x) => x.s !== null)
      // With no query keep the natural order; otherwise best matches first.
      .sort((a, b) => (q ? (a.s as number) - (b.s as number) || a.i - b.i : a.i - b.i));
    // Without a query, keep projects to a handful so navigation stays visible.
    const capped = q ? scored : scored.filter((x) => x.e.group !== "Databases" && (x.e.group !== "Projects" || x.i < 4 + 6));
    return capped.map((x) => x.e);
  }, [entries, query]);

  // Group in display order while keeping a flat index for the keyboard.
  const groups = React.useMemo(() => {
    const order: string[] = [];
    const by: Record<string, Entry[]> = {};
    for (const r of results) {
      if (!by[r.group]) {
        by[r.group] = [];
        order.push(r.group);
      }
      by[r.group].push(r);
    }
    return order.map((g) => ({ name: g, items: by[g] }));
  }, [results]);

  const flat = React.useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const current = Math.min(active, Math.max(flat.length - 1, 0));

  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (flat.length ? (Math.min(a, flat.length - 1) + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (flat.length ? (Math.min(a, flat.length - 1) - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      flat[current]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  let index = -1;
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-3 pt-3 sm:pt-[12vh]" role="presentation">
      <div className="absolute inset-0 animate-[dz-fade_.15s_ease-out] bg-black/45 backdrop-blur-[2px]" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command menu"
        className="relative w-full max-w-[640px] animate-[dz-pop_.18s_cubic-bezier(.16,1,.3,1)] overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-[0_30px_80px_-20px_rgba(0,0,0,.5)]"
      >
        <div className="flex items-center gap-3 border-b px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search projects, pages and actions…"
            role="combobox"
            aria-expanded="true"
            aria-controls="dz-cmd-list"
            aria-activedescendant={flat[current] ? `dz-cmd-${flat[current].id}` : undefined}
            className="h-14 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground/70 sm:text-[15px]"
          />
          <button type="button" onClick={close} className="rounded-md border px-1.5 py-0.5 font-mono text-[11.5px] text-muted-foreground hover:text-foreground">
            esc
          </button>
        </div>

        <div ref={listRef} id="dz-cmd-list" role="listbox" className="max-h-[min(60vh,440px)] overflow-y-auto overscroll-contain p-2">
          {flat.length === 0 && <p className="px-3 py-10 text-center text-[14px] text-muted-foreground">No results for &ldquo;{query}&rdquo;</p>}
          {groups.map((g) => (
            <div key={g.name} className="mb-1 last:mb-0">
              <p className="eyebrow px-3 pb-1.5 pt-2.5">{g.name}</p>
              {g.items.map((item) => {
                index += 1;
                const i = index;
                const selected = i === current;
                return (
                  <button
                    key={item.id}
                    id={`dz-cmd-${item.id}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-index={i}
                    onMouseMove={() => setActive(i)}
                    onClick={() => item.run()}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14.5px] transition-colors",
                      selected ? "bg-muted text-foreground" : "text-foreground/85",
                    )}
                  >
                    <span
                      className={cn(
                        "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border bg-background",
                        selected ? "text-brand" : "text-muted-foreground",
                      )}
                    >
                      <item.icon className="h-3.5 w-3.5" />
                      {item.dot && <span className={cn("absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-popover", item.dot)} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint && <span className="hidden truncate font-mono text-[12px] text-muted-foreground sm:block">{item.hint}</span>}
                    {selected && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="hidden items-center gap-4 border-t px-4 py-2.5 text-[12px] text-muted-foreground sm:flex">
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border px-1 font-mono">↑</kbd>
            <kbd className="rounded border px-1 font-mono">↓</kbd> to move
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="flex items-center rounded border px-1">
              <CornerDownLeft className="h-3 w-3" />
            </kbd>{" "}
            to open
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <kbd className="rounded border px-1 font-mono">⌘K</kbd> to toggle
          </span>
        </div>
      </div>
    </div>
  );
}
