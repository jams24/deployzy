"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Check, Copy, Database, Eye, EyeOff, Globe, Loader2, Rocket, ShieldCheck } from "lucide-react";
import { useMediaQuery } from "@/lib/use-media-query";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

const DeployField = dynamic(() => import("@/components/home/deploy-field"), { ssr: false });

// ── Brand panel (desktop) ─────────────────────────────────────────────────
// A typed terminal replay of the real product flow (only real CLI commands).
// Lines appear one by one and the sequence loops. Under prefers-reduced-motion
// every line renders at once.
const SCRIPT: { t: "cmd" | "out" | "ok"; text: string }[] = [
  { t: "cmd", text: "deployzy deploy" },
  { t: "out", text: "Detected Next.js · building…" },
  { t: "ok", text: "Live at https://my-app.deployzy.app" },
  { t: "cmd", text: "deployzy http 3000" },
  { t: "ok", text: "Forwarding https://a1b2.deployzy.com → localhost:3000" },
  { t: "cmd", text: "deployzy logs my-app" },
  { t: "out", text: "GET / 200 · 14ms  ·  GET /api/health 200 · 3ms" },
];

function TerminalReplay() {
  const [shown, setShown] = useState(0);
  const [typed, setTyped] = useState(0);
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");

  useEffect(() => {
    if (reduced) return;
    const line = SCRIPT[shown];
    if (!line) {
      const t = setTimeout(() => {
        setShown(0);
        setTyped(0);
      }, 3200);
      return () => clearTimeout(t);
    }
    if (line.t === "cmd" && typed < line.text.length) {
      const t = setTimeout(() => setTyped((n) => n + 1), 45 + Math.random() * 40);
      return () => clearTimeout(t);
    }
    const t = setTimeout(
      () => {
        setShown((n) => n + 1);
        setTyped(0);
      },
      line.t === "cmd" ? 380 : 650,
    );
    return () => clearTimeout(t);
  }, [shown, typed, reduced]);

  const lines = reduced ? SCRIPT : SCRIPT.slice(0, shown + 1);
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0b0c10]/85 shadow-2xl shadow-black/50 backdrop-blur-md">
      <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
        <span className="ml-2 font-mono text-[11.5px] text-white/40">~/my-app</span>
      </div>
      <div className="min-h-[188px] space-y-1.5 px-4 py-3.5 font-mono text-[12.5px] leading-relaxed">
        {lines.map((l, i) => {
          const isCurrent = !reduced && i === shown;
          const text = l.t === "cmd" && isCurrent ? l.text.slice(0, typed) : l.text;
          return (
            <div key={i} className="auth-line break-all">
              {l.t === "cmd" && (
                <>
                  <span className="text-brand">$</span> <span className="text-white">{text}</span>
                  {isCurrent && <span className="auth-caret ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-white/80" />}
                </>
              )}
              {l.t === "out" && <span className="text-white/45">{text}</span>}
              {l.t === "ok" && (
                <span className="text-brand">
                  ✓ <span className="text-white/80">{text}</span>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const POINTS = [
  { icon: Rocket, text: "Deploy from GitHub, a Dockerfile or a folder" },
  { icon: Globe, text: "Share localhost with a public HTTPS URL" },
  { icon: Database, text: "Postgres, Redis, MongoDB and MySQL in one click" },
];

function BrandPanel() {
  const card = useRef<HTMLDivElement>(null);
  // The WebGL field only mounts where the panel is visible (lg and up).
  const wide = useMediaQuery("(min-width: 1024px)");

  return (
    <div className="hidden p-3 lg:sticky lg:top-0 lg:block lg:h-[100dvh]">
      <div
        ref={card}
        className="dark grain relative isolate flex h-full flex-col justify-between overflow-hidden rounded-[24px] bg-[#0b0c10] p-10 text-white xl:p-14"
      >
        {wide && <DeployField className="absolute inset-0 -z-10" eventRef={card} />}
        <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-[#0b0c10] from-25% via-[#0b0c10]/75 to-[#0b0c10]/5" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-28 bg-gradient-to-t from-[#0b0c10] to-transparent" />

        <Link href="/" className="flex w-fit items-center gap-2.5 text-[17px] font-semibold tracking-[-0.02em]">
          <img src="/logo-mark.png" alt="" className="h-9 w-9 rounded-lg" />
          Deployzy
        </Link>

        <div className="max-w-md">
          <h2 className="rise text-[clamp(2.4rem,3.6vw,3.4rem)] font-semibold leading-[0.98] tracking-[-0.045em]">
            Push code.
            <br />
            It&rsquo;s <span className="accent-serif text-launch pr-1">live.</span>
          </h2>
          <ul className="mt-7 space-y-3">
            {POINTS.map((p, i) => (
              <li
                key={p.text}
                className="rise flex items-center gap-3 text-[14.5px] text-white/70"
                style={{ animationDelay: `${0.12 + i * 0.06}s` }}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
                  <p.icon className="h-4 w-4 text-brand" />
                </span>
                {p.text}
              </li>
            ))}
          </ul>
          <div className="rise mt-9" style={{ animationDelay: "0.3s" }}>
            <TerminalReplay />
          </div>
        </div>

        <p className="flex items-center gap-2 text-[12.5px] text-white/45">
          <ShieldCheck className="h-3.5 w-3.5" /> Free tier, no credit card. Open-source CLI.
        </p>
      </div>
    </div>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: React.ReactNode;
  subtitle: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-[100dvh] bg-background lg:grid-cols-[1.05fr_1fr]">
      <style>{`
        @keyframes auth-blink { 50% { opacity: 0 } }
        @keyframes auth-shake { 10%,90% { transform: translateX(-1px) } 20%,80% { transform: translateX(2px) } 30%,50%,70% { transform: translateX(-4px) } 40%,60% { transform: translateX(4px) } }
        .auth-line { animation: dz-rise .3s ease both }
        .auth-caret { animation: auth-blink 1s step-end infinite }
        .auth-shake { animation: auth-shake .45s ease both }
        @media (prefers-reduced-motion: reduce) { .auth-line, .auth-caret, .auth-shake { animation: none !important } }
      `}</style>
      <BrandPanel />
      <div className="relative flex flex-col px-5 py-6 sm:px-10 sm:py-8">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_70%_100%_at_50%_0%,color-mix(in_oklch,var(--dz-green)_12%,transparent),transparent)] lg:hidden" />
        <header className="relative flex items-center justify-between lg:justify-end">
          <Link href="/" className="flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.02em] lg:hidden">
            <img src="/logo-mark.png" alt="" className="h-8 w-8 rounded-lg" /> Deployzy
          </Link>
          <Link href="/" className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13.5px] text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Back to site</span>
            <span className="sm:hidden">Home</span>
          </Link>
        </header>

        <div className="relative m-auto w-full max-w-[380px] py-10">
          <div className="rise">
            <h1 className="text-[clamp(1.9rem,5vw,2.25rem)] font-semibold leading-[1.08] tracking-[-0.035em]">{title}</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{subtitle}</p>
          </div>
          <div className="rise mt-8" style={{ animationDelay: "0.08s" }}>
            {children}
          </div>
          {footer && (
            <div className="rise mt-8 text-center text-[14px] text-muted-foreground" style={{ animationDelay: "0.16s" }}>
              {footer}
            </div>
          )}
        </div>

        <p className="relative text-center text-[12.5px] text-muted-foreground/80">
          By continuing you agree to the{" "}
          <Link href="/acceptable-use" className="underline underline-offset-2 hover:text-foreground">
            Acceptable Use Policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

// ── Form pieces ───────────────────────────────────────────────────────────
export function GoogleButton() {
  return (
    <a href={`${API}/api/v1/auth/google`} className="pill pill-line w-full gap-3 font-medium">
      <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" aria-hidden>
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
      </svg>
      Continue with Google
    </a>
  );
}

export function OrDivider({ label = "or with email" }: { label?: string }) {
  return (
    <div className="my-6 flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <span className="eyebrow">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export function Field({
  id,
  label,
  icon: Icon,
  type = "text",
  hint,
  ...rest
}: {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  const isPw = type === "password";
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[14px] font-medium">
          {label}
        </label>
        {hint && <span className="text-[12.5px] text-muted-foreground">{hint}</span>}
      </div>
      <div className="group relative">
        <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-brand" />
        {/* 16px text on phones stops iOS zooming into the field on focus. */}
        <input
          id={id}
          type={isPw && show ? "text" : type}
          className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-10 text-[16px] shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/60 focus:border-brand/60 focus:ring-4 focus:ring-brand/15 sm:text-[15px]"
          {...rest}
        />
        {isPw && (
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide password" : "Show password"}
            className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

export function FormError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      key={message}
      role="alert"
      className="auth-shake flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/[0.06] px-3.5 py-2.5 text-[14px] text-red-600 dark:text-red-400"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      {message}
    </div>
  );
}

export function SubmitButton({
  loading,
  children,
  loadingText,
  disabled,
}: {
  loading: boolean;
  children: React.ReactNode;
  loadingText: string;
  disabled?: boolean;
}) {
  return (
    <button type="submit" disabled={loading || disabled} className="pill pill-ink w-full disabled:cursor-not-allowed disabled:opacity-60">
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {loading ? loadingText : children}
    </button>
  );
}

// ── API key hand-off (after sign-up or email verification) ────────────────
export function ApiKeyReveal({
  apiKey,
  title,
  onContinue,
  continueLabel,
}: {
  apiKey: string;
  title: React.ReactNode;
  onContinue: () => void;
  continueLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(apiKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <AuthShell title={title} subtitle="Here's your API key. Save it now, it won't be shown again.">
      <div className="panel flex items-center gap-2 p-1.5 pl-4">
        <code className="min-w-0 flex-1 truncate font-mono text-[13.5px]">{apiKey}</code>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy API key"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-muted"
        >
          {copied ? <Check className="h-4 w-4 text-brand" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>

      <div className="mt-3 overflow-hidden rounded-xl border border-black/10 bg-[#0b0c10] font-mono text-[13px] dark:border-white/[0.07]">
        <div className="space-y-1 px-4 py-3.5">
          <div className="text-white/35"># Save your token and start tunneling</div>
          <div className="break-all text-white/85">
            <span className="text-brand">$</span> deployzy authtoken {apiKey}
          </div>
          <div className="text-white/85">
            <span className="text-brand">$</span> deployzy http 3000
          </div>
        </div>
      </div>

      <button type="button" onClick={onContinue} className="pill pill-ink group mt-6 w-full">
        {continueLabel} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </button>
    </AuthShell>
  );
}

// ── Centered status screen (OAuth callback, CLI sign-in done, …) ─────────
export function StatusScreen({
  title,
  subtitle,
  badge,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative grid min-h-[100dvh] place-items-center overflow-hidden bg-background px-5 py-12">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[420px] overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-80 w-[640px] -translate-x-1/2 rounded-full bg-brand/[0.1] blur-[120px]" />
        <div className="absolute -top-16 right-[12%] h-48 w-[360px] rounded-full bg-brand-cyan/[0.07] blur-[100px]" />
        <div className="mask-fade-b absolute inset-0 text-foreground/[0.035]"><div className="bg-grid absolute inset-0" /></div>
      </div>
      <div className="rise relative w-full max-w-[400px] text-center">
        <Link href="/" aria-label="Deployzy home" className="mx-auto block w-fit">
          <img src="/logo-mark.png" alt="" className="h-11 w-11 rounded-xl" />
        </Link>
        {badge && <div className="mt-8 flex justify-center">{badge}</div>}
        <h1 className={`${badge ? "mt-5" : "mt-8"} text-[clamp(1.8rem,5vw,2.2rem)] font-semibold leading-[1.08] tracking-[-0.035em]`}>{title}</h1>
        {subtitle && <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{subtitle}</p>}
        {children && <div className="mt-8">{children}</div>}
      </div>
    </div>
  );
}

export function StatusBadge({ tone }: { tone: "ok" | "bad" | "busy" }) {
  const cls =
    tone === "ok"
      ? "border-brand/30 bg-brand/10 text-[var(--dz-green-strong)] dark:text-brand"
      : tone === "bad"
        ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
        : "border-[var(--dz-hairline)] bg-foreground/[0.04] text-muted-foreground";
  return (
    <span className={`flex h-14 w-14 items-center justify-center rounded-2xl border ${cls}`}>
      {tone === "ok" ? <Check className="h-6 w-6" /> : tone === "bad" ? <AlertCircle className="h-6 w-6" /> : <Loader2 className="h-6 w-6 animate-spin" />}
    </span>
  );
}
