"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Copy, Loader2, MailCheck } from "lucide-react";
import { api } from "@/lib/api";

function VerifyEmailForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";

  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Resend cooldown mirrors the server's one-per-minute limit.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function submitCode(value: string) {
    setError("");
    setLoading(true);
    try {
      const data = await api.verifyEmail(email, value);
      setApiKey(data.api_key);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Verification failed");
      setCode("");
      inputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  }

  function handleChange(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6 && !loading) submitCode(digits);
  }

  async function resend() {
    setError("");
    setNotice("");
    setResending(true);
    try {
      await api.resendVerification(email);
      setNotice("New code sent — check your inbox.");
      setCooldown(60);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not resend code");
    } finally {
      setResending(false);
    }
  }

  function copyKey() {
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Verified — same API-key handoff the signup flow used to show.
  if (apiKey) {
    const redirect = searchParams.get("redirect");
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-md text-center">
          <div className="flex justify-center mb-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
              <Check className="h-6 w-6" />
            </div>
          </div>
          <h1 className="text-2xl font-bold">Email confirmed!</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Here&apos;s your API key. Save it now — it won&apos;t be shown again.
          </p>

          <div className="mt-6 flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-3 font-mono text-sm">
            <code className="flex-1 truncate text-left">{apiKey}</code>
            <Button variant="ghost" size="sm" onClick={copyKey}>
              {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>

          <div className="mt-4 rounded-lg border border-border bg-[#0d1117] p-4 text-left font-mono text-sm text-[#e6edf3]">
            <div className="text-zinc-500"># Save your token and start tunneling</div>
            <div className="mt-1">deployzy authtoken {apiKey}</div>
            <div className="mt-1">deployzy http 3000</div>
          </div>

          <Button
            className="mt-6 w-full"
            onClick={() => router.push(redirect && redirect.startsWith("/") ? redirect : "/overview")}
          >
            {redirect?.startsWith("/invite/") ? "Accept Invitation →" : "Go to Dashboard"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="flex items-center justify-center gap-2 font-bold text-lg mb-8">
          <img src="/logo-mark.png" alt="Deployzy" className="h-8 w-8 rounded-lg" />
          Deployzy
        </Link>

        <div className="flex justify-center mb-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
            <MailCheck className="h-6 w-6" />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-center">Confirm your email</h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          We sent a 6-digit code to{" "}
          <span className="font-medium text-foreground">{email || "your inbox"}</span>
        </p>

        <form
          className="mt-8"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === 6) submitCode(code);
          }}
        >
          <Input
            ref={inputRef}
            value={code}
            onChange={(e) => handleChange(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            aria-label="Verification code"
            disabled={loading}
            className="text-center text-2xl font-mono tracking-[0.5em] h-14"
          />

          {error && (
            <p className="mt-3 text-center text-sm text-red-500">{error}</p>
          )}
          {notice && !error && (
            <p className="mt-3 text-center text-sm text-emerald-500">{notice}</p>
          )}

          <Button type="submit" className="mt-4 w-full gap-2" disabled={loading || code.length !== 6}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Verify email
          </Button>
        </form>

        <div className="mt-6 text-center text-sm text-muted-foreground">
          Didn&apos;t get it?{" "}
          <button
            type="button"
            onClick={resend}
            disabled={resending || cooldown > 0}
            className="font-medium text-foreground hover:underline disabled:opacity-50 disabled:no-underline"
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : resending ? "Sending…" : "Resend code"}
          </button>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Wrong address?{" "}
          <Link href="/sign-up" className="hover:underline">
            Start over
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailForm />
    </Suspense>
  );
}
