"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiKeyReveal, AuthShell, FormError, SubmitButton } from "@/components/auth/auth-shell";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

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
  const [focused, setFocused] = useState(false);
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

  // Verified: same API-key hand-off the sign-up flow shows.
  if (apiKey) {
    const redirect = searchParams.get("redirect");
    return (
      <ApiKeyReveal
        apiKey={apiKey}
        title={<>Email <span className="accent-serif text-launch">confirmed.</span></>}
        continueLabel={redirect?.startsWith("/invite/") ? "Accept invitation" : "Go to dashboard"}
        onContinue={() => router.push(redirect && redirect.startsWith("/") ? redirect : "/overview")}
      />
    );
  }

  const activeBox = Math.min(code.length, 5);

  return (
    <AuthShell
      title={<>Check your <span className="accent-serif">inbox.</span></>}
      subtitle={
        <>
          We sent a 6-digit code to <span className="font-medium text-foreground">{email || "your email"}</span>.
        </>
      }
      footer={
        <div className="space-y-2">
          <p>
            Didn&apos;t get it?{" "}
            <button
              type="button"
              onClick={resend}
              disabled={resending || cooldown > 0}
              className="font-medium text-foreground underline decoration-brand/50 underline-offset-4 hover:decoration-brand disabled:no-underline disabled:opacity-50"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : resending ? "Sending…" : "Resend code"}
            </button>
          </p>
          <p className="text-[13px]">
            Wrong address?{" "}
            <Link href="/sign-up" className="underline-offset-4 hover:text-foreground hover:underline">
              Start over
            </Link>
          </p>
        </div>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === 6) submitCode(code);
        }}
      >
        <FormError message={error} />
        {notice && !error && (
          <p role="status" className="rounded-xl border border-brand/25 bg-brand/[0.06] px-3.5 py-2.5 text-[14px] text-foreground/85">
            {notice}
          </p>
        )}

        {/* One real input (keeps paste and one-time-code autofill) under six display boxes. */}
        <div className="relative">
          <input
            ref={inputRef}
            value={code}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            aria-label="Verification code"
            disabled={loading}
            className="absolute inset-0 z-10 h-full w-full cursor-text text-transparent caret-transparent opacity-0"
          />
          <div aria-hidden className="grid grid-cols-6 gap-2">
            {Array.from({ length: 6 }, (_, i) => {
              const isActive = focused && !loading && i === activeBox && code.length < 6;
              return (
                <div
                  key={i}
                  className={cn(
                    "flex h-14 items-center justify-center rounded-xl border bg-background font-mono text-[24px] font-medium shadow-xs transition-[border-color,box-shadow]",
                    isActive && "border-brand/60 ring-4 ring-brand/15",
                    code[i] && "border-foreground/25",
                    error && "border-red-500/40",
                  )}
                >
                  {code[i] ?? (isActive ? <span className="auth-caret h-6 w-0.5 bg-foreground/70" /> : "")}
                </div>
              );
            })}
          </div>
        </div>

        <SubmitButton loading={loading} loadingText="Verifying…" disabled={code.length !== 6}>
          Verify email
        </SubmitButton>
      </form>
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailForm />
    </Suspense>
  );
}
