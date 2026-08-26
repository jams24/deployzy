"use client";

import { useState } from "react";
import { Link2, Check } from "lucide-react";

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z" />
    </svg>
  );
}

// Build share URLs at CLICK time from the live location, so the post URL is
// always embedded (avoids the SSR/hydration race where window is undefined at
// render and the anchor href gets baked empty).
function shareX(title: string) {
  const url = window.location.href;
  window.open(
    `https://x.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`,
    "_blank",
    "noopener,noreferrer,width=600,height=520"
  );
}
function shareLinkedIn() {
  const url = window.location.href;
  window.open(
    `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
    "_blank",
    "noopener,noreferrer,width=600,height=520"
  );
}

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  };
  return { copied, copy };
}

/** Vertical "Discuss online" share rail (sticky left column), monochrome. */
export function DiscussRail({ title }: { title: string }) {
  const { copied, copy } = useCopy();
  const btn =
    "grid h-9 w-9 place-items-center rounded-full border border-border/60 text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/50";
  return (
    <div>
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
        Discuss online
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => shareX(title)} className={btn} aria-label="Share on X">
          <XIcon className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={shareLinkedIn} className={btn} aria-label="Share on LinkedIn">
          <LinkedInIcon className="h-4 w-4" />
        </button>
        <button type="button" onClick={copy} className={btn} aria-label="Copy link">
          {copied ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

/** Compact inline share row shown next to the author byline. */
export function BlogShare({ title }: { title: string }) {
  const { copied, copy } = useCopy();
  const cls =
    "inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-foreground/40";
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={copy} className={cls} aria-label="Copy link">
        {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy link"}
      </button>
      <button type="button" onClick={() => shareX(title)} className={cls} aria-label="Share on X">
        <XIcon className="h-3.5 w-3.5" /> X
      </button>
      <button type="button" onClick={shareLinkedIn} className={cls + " hidden sm:inline-flex"} aria-label="Share on LinkedIn">
        <LinkedInIcon className="h-3.5 w-3.5" /> LinkedIn
      </button>
    </div>
  );
}
