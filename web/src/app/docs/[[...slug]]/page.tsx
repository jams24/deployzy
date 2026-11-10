"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { use, useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  categories,
  getDoc,
  getAdjacentPages,
  type DocPage,
} from "@/lib/docs";
import { Navbar } from "@/components/marketing/navbar";
import {
  Terminal,
  ChevronRight,
  ExternalLink,
  Copy,
  Check,
  Rocket,
  Code,
  Package,
  BookOpen,
  ArrowLeft,
  ArrowRight,
  Hash,
  ChevronDown,
  Info,
} from "lucide-react";

const categoryIcons: Record<string, React.ReactNode> = {
  rocket: <Rocket className="h-3.5 w-3.5" />,
  terminal: <Terminal className="h-3.5 w-3.5" />,
  code: <Code className="h-3.5 w-3.5" />,
  package: <Package className="h-3.5 w-3.5" />,
  book: <BookOpen className="h-3.5 w-3.5" />,
};

export default function DocsPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = use(params);
  const pathname = usePathname();
  const docSlug = slug?.join("/") || "introduction";
  const doc = getDoc(docSlug);
  const adjacent = getAdjacentPages(docSlug);

  const [mobileNav, setMobileNav] = useState(false);

  return (
    <>
      <Navbar />
      <div className="pt-16">
        {/* Mobile: current section bar that opens the full docs nav */}
        <div className="frost sticky top-16 z-30 border-b lg:hidden">
          <button
            type="button"
            onClick={() => setMobileNav((v) => !v)}
            aria-expanded={mobileNav}
            className="flex w-full items-center gap-2 px-5 py-3 text-left text-[14px]"
          >
            <BookOpen className="h-4 w-4 shrink-0 text-brand" />
            <span className="shrink-0 text-muted-foreground">{doc?.category || "Docs"}</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
            <span className="truncate font-medium">{doc?.title || "Navigation"}</span>
            <ChevronDown className={cn("ml-auto h-4 w-4 shrink-0 transition-transform duration-200", mobileNav && "rotate-180")} />
          </button>
          {mobileNav && (
            <div className="max-h-[calc(100dvh-8rem)] overflow-y-auto border-t pb-6 pt-4" onClick={() => setMobileNav(false)}>
              <DocsSidebar pathname={pathname} />
            </div>
          )}
        </div>

        <div className="mx-auto flex w-full max-w-[1400px] overflow-x-clip">
          {/* Desktop sidebar */}
          <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-72 shrink-0 overflow-y-auto border-r py-8 lg:block">
            <DocsSidebar pathname={pathname} />
          </aside>

          {/* Content */}
          <main className="min-w-0 flex-1 px-5 py-8 sm:px-8 lg:px-14 lg:py-12 xl:px-16">
            {doc ? (
              <>
                {/* Breadcrumb */}
                <nav aria-label="Breadcrumb" className="mb-6 hidden items-center gap-1.5 text-[13px] text-muted-foreground lg:flex">
                  <Link href="/docs" className="transition-colors hover:text-foreground">
                    Docs
                  </Link>
                  <ChevronRight className="h-3.5 w-3.5 opacity-50" />
                  <span>{doc.category}</span>
                  <ChevronRight className="h-3.5 w-3.5 opacity-50" />
                  <span className="text-foreground">{doc.title}</span>
                </nav>

                <DocContent doc={doc} />

                {/* Prev / next */}
                <div className="mt-14 grid gap-3 border-t pt-8 sm:grid-cols-2">
                  {adjacent.prev ? (
                    <Link
                      href={`/docs/${adjacent.prev.slug}`}
                      className="panel group flex flex-col p-5 transition-colors hover:border-brand/40"
                    >
                      <span className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                        <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
                        Previous
                      </span>
                      <span className="mt-1.5 text-[15.5px] font-medium">{adjacent.prev.title}</span>
                    </Link>
                  ) : (
                    <div className="hidden sm:block" />
                  )}
                  {adjacent.next && (
                    <Link
                      href={`/docs/${adjacent.next.slug}`}
                      className="panel group flex flex-col items-end p-5 text-right transition-colors hover:border-brand/40"
                    >
                      <span className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                        Next
                        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                      </span>
                      <span className="mt-1.5 text-[15.5px] font-medium">{adjacent.next.title}</span>
                    </Link>
                  )}
                </div>

                <p className="mt-10 text-[13.5px] text-muted-foreground">
                  Stuck? Email{" "}
                  <a href="mailto:support@deployzy.com" className="font-medium text-foreground underline decoration-brand/50 underline-offset-4 hover:decoration-brand">
                    support@deployzy.com
                  </a>{" "}
                  or ask on{" "}
                  <a href="https://t.me/deployzy" target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline decoration-brand/50 underline-offset-4 hover:decoration-brand">
                    Telegram
                  </a>
                  .
                </p>
              </>
            ) : (
              <div className="py-24 text-center">
                <p className="eyebrow">404</p>
                <h1 className="mt-3 text-[32px] font-semibold tracking-[-0.03em]">Page not found</h1>
                <p className="mt-2 text-muted-foreground">This page doesn&apos;t exist yet.</p>
                <Link href="/docs/introduction" className="pill pill-sm pill-ink mt-6">
                  Go to Introduction <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}
          </main>

          {/* Table of contents */}
          {doc && <TableOfContents content={doc.content} />}
        </div>
      </div>
    </>
  );
}

function DocsSidebar({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Documentation" className="px-3 lg:px-4">
      {categories.map((cat) => (
        <div key={cat.name} className="mb-6">
          <p className="eyebrow mb-2 flex items-center gap-2 px-3">
            <span className="text-brand">{categoryIcons[cat.icon]}</span>
            {cat.name}
          </p>
          <ul className="space-y-px">
            {cat.pages.map((page) => {
              const href = `/docs/${page.slug}`;
              const active = pathname === href || (page.slug === "introduction" && pathname === "/docs");
              return (
                <li key={page.slug}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex items-center rounded-lg px-3 py-2 text-[14.5px] transition-colors lg:py-1.5 lg:text-[13.5px]",
                      active
                        ? "bg-muted font-medium text-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-[2px] before:rounded-full before:bg-brand"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    {page.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function TableOfContents({ content }: { content: string }) {
  const headings = useMemo(
    () =>
      content
        .split("\n")
        .filter((l) => l.startsWith("## ") || l.startsWith("### "))
        .map((l) => {
          const level = l.startsWith("### ") ? 3 : 2;
          const text = l.replace(/^#{2,3}\s+/, "");
          const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          return { id, text, level };
        }),
    [content],
  );
  const [active, setActive] = useState("");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-80px 0px -80% 0px" },
    );
    headings.forEach((h) => {
      const el = document.getElementById(h.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length < 2) return null;

  return (
    <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-60 shrink-0 overflow-y-auto py-12 pr-6 xl:block">
      <p className="eyebrow mb-3">On this page</p>
      <ul className="space-y-0.5 border-l">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className={cn(
                "-ml-px block border-l-2 py-1.5 text-[13.5px] leading-snug transition-colors",
                h.level === 3 ? "pl-6" : "pl-4",
                active === h.id
                  ? "border-brand font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function DocContent({ doc }: { doc: DocPage }) {
  return (
    <article>
      <h1 className="text-[clamp(2rem,4.2vw,2.75rem)] font-semibold leading-[1.05] tracking-[-0.04em] text-balance">{doc.title}</h1>
      <p className="mt-3 text-[17px] leading-relaxed text-muted-foreground sm:text-[18px]">{doc.description}</p>
      <div className="mt-10">
        <MarkdownRenderer content={doc.content} />
      </div>
    </article>
  );
}

/**
 * Split doc markdown into blocks. Fenced code stays whole even when it holds
 * blank lines, and headings are their own block so text right under a heading
 * still renders as a paragraph.
 */
function splitBlocks(content: string): string[] {
  const blocks: string[] = [];
  let buf: string[] = [];
  let inFence = false;
  const flush = () => {
    if (buf.some((l) => l.trim())) blocks.push(buf.join("\n"));
    buf = [];
  };
  for (const line of content.split("\n")) {
    if (line.trim().startsWith("```")) {
      if (inFence) {
        buf.push(line);
        flush();
      } else {
        flush();
        buf.push(line);
      }
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      buf.push(line);
    } else if (!line.trim()) {
      flush();
    } else if (/^#{2,3}\s/.test(line)) {
      flush();
      blocks.push(line);
    } else {
      buf.push(line);
    }
  }
  flush();
  return blocks;
}

function MarkdownRenderer({ content }: { content: string }) {
  const blocks = splitBlocks(content);

  return (
    <div className="space-y-5">
      {blocks.map((block, i) => {
        const trimmed = block.trim();

        if (trimmed.startsWith("```")) {
          const lines = trimmed.split("\n");
          const lang = lines[0].replace("```", "").trim();
          const closed = lines.length > 1 && lines[lines.length - 1].trim().startsWith("```");
          const code = lines.slice(1, closed ? -1 : undefined).join("\n");
          return <CodeBlock key={i} lang={lang} code={code} />;
        }

        if (trimmed.startsWith("## ")) {
          const text = trimmed.replace("## ", "");
          const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          return (
            <h2
              key={i}
              id={id}
              className="group mb-1 mt-14 flex scroll-mt-32 items-center gap-2 text-[22px] font-semibold tracking-[-0.025em]"
            >
              {text}
              <a href={`#${id}`} aria-label="Link to this section" className="text-brand opacity-0 transition-opacity group-hover:opacity-70">
                <Hash className="h-4 w-4" />
              </a>
            </h2>
          );
        }

        if (trimmed.startsWith("### ")) {
          const text = trimmed.replace("### ", "");
          const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          return (
            <h3
              key={i}
              id={id}
              className="group mb-1 mt-9 flex scroll-mt-32 items-center gap-2 text-[17px] font-semibold tracking-[-0.01em]"
            >
              {text}
              <a href={`#${id}`} aria-label="Link to this section" className="text-brand opacity-0 transition-opacity group-hover:opacity-70">
                <Hash className="h-3.5 w-3.5" />
              </a>
            </h3>
          );
        }

        if (trimmed.startsWith("> ")) {
          const text = trimmed.replace(/^>\s*/gm, "");
          return (
            <div
              key={i}
              className="flex gap-3 rounded-xl border border-brand/25 bg-brand/[0.06] px-4 py-3.5 text-[15px] leading-relaxed text-foreground/85 sm:px-5 sm:py-4"
            >
              <Info className="mt-[3px] h-4 w-4 shrink-0 text-brand" />
              <div className="min-w-0">
                <InlineMarkdown text={text} />
              </div>
            </div>
          );
        }

        if (trimmed.includes("|") && trimmed.includes("---")) {
          const rows = trimmed
            .split("\n")
            .filter((r) => !r.match(/^\|[\s-|]+\|$/));
          const headers = rows[0]
            ?.split("|")
            .filter(Boolean)
            .map((c) => c.trim());
          const body = rows.slice(1).map((r) =>
            r
              .split("|")
              .filter(Boolean)
              .map((c) => c.trim())
          );
          return (
            <div
              key={i}
              className="max-w-full overflow-x-auto rounded-xl border"
            >
              <table className="w-full text-[14.5px]">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {headers?.map((h, j) => (
                      <th
                        key={j}
                        className="whitespace-nowrap px-4 py-2.5 text-left font-mono text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((row, j) => (
                    <tr
                      key={j}
                      className="border-b last:border-0"
                    >
                      {row.map((cell, k) => (
                        <td key={k} className="px-4 py-3 align-top">
                          <InlineMarkdown text={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (trimmed.match(/^(\d+\.|- )/m)) {
          const items = trimmed.split("\n").filter(Boolean);
          const ordered = items[0]?.match(/^\d+\./);
          const Tag = ordered ? "ol" : "ul";
          return (
            <Tag
              key={i}
              className={cn(
                "space-y-2 pl-5 text-[15.5px] leading-relaxed text-foreground/80 marker:text-brand",
                ordered ? "list-decimal" : "list-disc"
              )}
            >
              {items.map((item, j) => (
                <li key={j}>
                  <InlineMarkdown
                    text={item.replace(/^(\d+\.|- )/, "").trim()}
                  />
                </li>
              ))}
            </Tag>
          );
        }

        if (trimmed) {
          return (
            <p
              key={i}
              className="break-words text-[15.5px] leading-[1.75] text-foreground/80"
            >
              <InlineMarkdown text={trimmed} />
            </p>
          );
        }

        return null;
      })}
    </div>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="group relative max-w-full overflow-hidden rounded-xl border border-black/10 bg-[#0b0c10] dark:border-white/[0.07]">
      <div className="flex items-center gap-2 border-b border-white/[0.06] py-1.5 pl-4 pr-2">
        <span className="h-2 w-2 rounded-full bg-white/10" />
        <span className="h-2 w-2 rounded-full bg-white/10" />
        <span className="ml-1.5 font-mono text-[11.5px] text-white/40">{lang || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy code"
          className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-white/45 transition-colors hover:bg-white/5 hover:text-white"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-brand" />
              <span className="text-brand">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </>
          )}
        </button>
      </div>
      <div className="overflow-x-auto">
        <pre className="p-4 text-[13.5px] leading-relaxed">
          <code className="whitespace-pre font-mono text-white/85">{code}</code>
        </pre>
      </div>
    </div>
  );
}

function InlineMarkdown({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const codeMatch = remaining.match(/`([^`]+)`/);
    const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);

    const matches = [
      boldMatch && { type: "bold", index: boldMatch.index!, match: boldMatch },
      codeMatch && { type: "code", index: codeMatch.index!, match: codeMatch },
      linkMatch && { type: "link", index: linkMatch.index!, match: linkMatch },
    ]
      .filter(Boolean)
      .sort((a, b) => a!.index - b!.index);

    if (matches.length === 0) {
      parts.push(remaining);
      break;
    }

    const first = matches[0]!;
    if (first.index > 0) parts.push(remaining.slice(0, first.index));

    if (first.type === "bold") {
      parts.push(
        <strong key={key++} className="font-semibold text-foreground">
          {first.match[1]}
        </strong>
      );
    } else if (first.type === "code") {
      parts.push(
        <code
          key={key++}
          className="break-words rounded-md border bg-muted/70 px-1.5 py-px font-mono text-[0.86em] text-foreground"
        >
          {first.match[1]}
        </code>
      );
    } else if (first.type === "link") {
      const href = first.match[2];
      const isExternal = href.startsWith("http");
      parts.push(
        <Link
          key={key++}
          href={href}
          className="font-medium text-foreground underline decoration-brand/50 underline-offset-4 transition-colors hover:decoration-brand"
          {...(isExternal ? { target: "_blank", rel: "noopener" } : {})}
        >
          {first.match[1]}
          {isExternal && <ExternalLink className="ml-0.5 inline h-3 w-3 align-[-1px]" />}
        </Link>
      );
    }

    remaining = remaining.slice(first.index + first.match[0].length);
  }

  return <>{parts}</>;
}
