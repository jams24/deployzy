"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, AlertCircle, Rocket, Globe, Database, ShieldCheck } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

// ── Brand panel (desktop) ─────────────────────────────────────────────────
// A typed terminal replay of the real product flow (only real CLI commands). Lines appear one by one;
// the whole sequence loops. Motion is disabled under prefers-reduced-motion
// (all lines render immediately).
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
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(m.matches);
    const t = setTimeout(apply, 0);
    m.addEventListener("change", apply);
    return () => { clearTimeout(t); m.removeEventListener("change", apply); };
  }, []);

  useEffect(() => {
    if (reduced) return;
    const line = SCRIPT[shown];
    if (!line) {
      const t = setTimeout(() => { setShown(0); setTyped(0); }, 3200);
      return () => clearTimeout(t);
    }
    if (line.t === "cmd" && typed < line.text.length) {
      const t = setTimeout(() => setTyped((n) => n + 1), 45 + Math.random() * 40);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => { setShown((n) => n + 1); setTyped(0); }, line.t === "cmd" ? 380 : 650);
    return () => clearTimeout(t);
  }, [shown, typed, reduced]);

  const lines = reduced ? SCRIPT : SCRIPT.slice(0, shown + 1);
  return (
    <div className="rounded-xl border border-white/10 bg-black/40 shadow-2xl shadow-black/40 backdrop-blur">
      <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-2 text-[11px] text-white/40">~/my-app</span>
      </div>
      <div className="min-h-[188px] space-y-1.5 px-4 py-3.5 font-mono text-[12.5px] leading-relaxed">
        {lines.map((l, i) => {
          const isCurrent = !reduced && i === shown;
          const text = l.t === "cmd" && isCurrent ? l.text.slice(0, typed) : l.text;
          return (
            <div key={i} className="auth-line break-all">
              {l.t === "cmd" && <><span className="text-emerald-400">$</span> <span className="text-white">{text}</span>{isCurrent && <span className="auth-caret ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-white/80" />}</>}
              {l.t === "out" && <span className="text-white/45">{text}</span>}
              {l.t === "ok" && <span className="text-emerald-300"><span className="text-emerald-400">✓</span> {text}</span>}
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
  return (
    <div className="relative hidden overflow-hidden bg-[#07090c] text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
      {/* glow + grid */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="auth-glow absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-emerald-500/25 blur-[110px]" />
        <div className="auth-glow absolute -bottom-40 right-[-6rem] h-[30rem] w-[30rem] rounded-full bg-indigo-500/25 blur-[120px]" style={{ animationDelay: "-6s" }} />
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "44px 44px", maskImage: "radial-gradient(ellipse at 40% 40%, #000 30%, transparent 75%)" }} />
      </div>

      <Link href="/" className="relative flex items-center gap-2.5 text-lg font-semibold">
        <img src="/logo-mark.png" alt="" className="h-9 w-9 rounded-lg" />
        Deployzy
      </Link>

      <div className="relative max-w-lg">
        <h2 className="text-[34px] font-semibold leading-[1.15] tracking-tight xl:text-[40px]">
          Ship apps, tunnels and databases <span className="bg-gradient-to-r from-emerald-300 to-sky-300 bg-clip-text text-transparent">in seconds.</span>
        </h2>
        <ul className="mt-6 space-y-2.5">
          {POINTS.map((p) => (
            <li key={p.text} className="flex items-center gap-3 text-sm text-white/70">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5"><p.icon className="h-3.5 w-3.5 text-emerald-300" /></span>
              {p.text}
            </li>
          ))}
        </ul>
        <div className="mt-8"><TerminalReplay /></div>
      </div>

      <p className="relative flex items-center gap-2 text-xs text-white/40">
        <ShieldCheck className="h-3.5 w-3.5" /> Free tier, no credit card. Open-source CLI.
      </p>
    </div>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────
export function AuthShell({ title, subtitle, children, footer }: {
  title: string; subtitle: string; children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[1.05fr_1fr]">
      <style>{`
        @keyframes auth-rise { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
        @keyframes auth-glow { 0%,100% { transform: translate(0,0) scale(1) } 50% { transform: translate(40px,30px) scale(1.12) } }
        @keyframes auth-blink { 50% { opacity: 0 } }
        @keyframes auth-shake { 10%,90% { transform: translateX(-1px) } 20%,80% { transform: translateX(2px) } 30%,50%,70% { transform: translateX(-4px) } 40%,60% { transform: translateX(4px) } }
        .auth-rise { animation: auth-rise .55s cubic-bezier(.2,.7,.2,1) both }
        .auth-line { animation: auth-rise .3s ease both }
        .auth-glow { animation: auth-glow 14s ease-in-out infinite }
        .auth-caret { animation: auth-blink 1s step-end infinite }
        .auth-shake { animation: auth-shake .45s ease both }
        @media (prefers-reduced-motion: reduce) { .auth-rise, .auth-line, .auth-glow, .auth-caret, .auth-shake { animation: none !important } }
      `}</style>
      <BrandPanel />
      <div className="relative flex flex-col px-6 py-10 sm:px-10">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-emerald-500/[0.06] to-transparent lg:hidden" />
        <Link href="/" className="relative mb-10 flex items-center gap-2 font-semibold lg:hidden">
          <img src="/logo-mark.png" alt="" className="h-8 w-8 rounded-lg" /> Deployzy
        </Link>
        <div className="relative m-auto w-full max-w-[380px]">
          <div className="auth-rise">
            <h1 className="text-[28px] font-semibold tracking-tight">{title}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <div className="auth-rise mt-8" style={{ animationDelay: "80ms" }}>{children}</div>
          {footer && <div className="auth-rise mt-8 text-center text-sm text-muted-foreground" style={{ animationDelay: "160ms" }}>{footer}</div>}
        </div>
        <p className="relative mt-10 text-center text-[11px] text-muted-foreground/70">
          By continuing you agree to the <Link href="/acceptable-use" className="underline underline-offset-2 hover:text-foreground">Acceptable Use Policy</Link>.
        </p>
      </div>
    </div>
  );
}

// ── Form pieces ───────────────────────────────────────────────────────────
export function GoogleButton() {
  return (
    <a href={`${API}/api/v1/auth/google`}
      className="group flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-border bg-background text-sm font-medium shadow-sm transition-all hover:border-foreground/20 hover:bg-accent hover:shadow-md active:scale-[0.99]">
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

export function OrDivider({ label = "or continue with email" }: { label?: string }) {
  return (
    <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
      <span className="h-px flex-1 bg-border" />{label}<span className="h-px flex-1 bg-border" />
    </div>
  );
}

export function Field({ id, label, icon: Icon, type = "text", hint, ...rest }: {
  id: string; label: string; icon: React.ComponentType<{ className?: string }>; hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  const isPw = type === "password";
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      <div className="group relative">
        <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-foreground" />
        <input id={id} type={isPw && show ? "text" : type}
          className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-10 text-sm shadow-sm outline-none transition-all placeholder:text-muted-foreground/60 focus:border-foreground/30 focus:ring-4 focus:ring-emerald-500/15"
          {...rest} />
        {isPw && (
          <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"}
            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
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
    <div key={message} role="alert" className="auth-shake flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/[0.06] px-3.5 py-2.5 text-sm text-red-600 dark:text-red-400">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{message}
    </div>
  );
}

export function SubmitButton({ loading, children, loadingText }: { loading: boolean; children: React.ReactNode; loadingText: string }) {
  return (
    <button type="submit" disabled={loading}
      className="relative flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-foreground text-sm font-medium text-background shadow-sm transition-all hover:opacity-90 hover:shadow-md active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70">
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {loading ? loadingText : children}
    </button>
  );
}
