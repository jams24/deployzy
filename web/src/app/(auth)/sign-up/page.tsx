"use client";

import Link from "next/link";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Copy, Check, Mail, Lock, User } from "lucide-react";
import { AuthShell, GoogleButton, OrDivider, Field, FormError, SubmitButton } from "@/components/auth/auth-shell";
import { api } from "@/lib/api";

function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const ref = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("ref") || undefined : undefined;
      const data = await api.register(email, name, password, ref);
      // Password signups must confirm their address first; the API key is
      // handed over on the verify page once the code checks out.
      if (data.verification_required) {
        const redirect = searchParams.get("redirect");
        router.push(
          `/verify-email?email=${encodeURIComponent(email)}` +
            (redirect ? `&redirect=${encodeURIComponent(redirect)}` : "")
        );
        return;
      }
      setApiKey(data.api_key || "");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  function copyKey() {
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (apiKey) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-md text-center">
          <div className="flex justify-center mb-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10 text-green-500">
              <Check className="h-6 w-6" />
            </div>
          </div>
          <h1 className="text-2xl font-bold">Account created!</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Here&apos;s your API key. Save it now — it won&apos;t be shown again.
          </p>

          <div className="mt-6 flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-3 font-mono text-sm">
            <code className="flex-1 truncate text-left">{apiKey}</code>
            <Button variant="ghost" size="sm" onClick={copyKey}>
              {copied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>

          <div className="mt-4 rounded-lg border border-border bg-[#0d1117] p-4 text-left font-mono text-sm text-[#e6edf3]">
            <div className="text-zinc-500">
              # Save your token and start tunneling
            </div>
            <div className="mt-1">deployzy authtoken {apiKey}</div>
            <div className="mt-1">deployzy http 3000</div>
          </div>

          <Button className="mt-6 w-full" onClick={() => {
            const redirect = searchParams.get("redirect");
            router.push(redirect && redirect.startsWith("/") ? redirect : "/overview");
          }}>
            {searchParams.get("redirect")?.startsWith("/invite/") ? "Accept Invitation →" : "Go to Dashboard"}
          </Button>
        </div>
      </div>
    );
  }

  // 0–3: length 8+, 12+, and a mix of letters with digits/symbols.
  const strength = password.length === 0 ? 0
    : (password.length >= 8 ? 1 : 0) + (password.length >= 12 ? 1 : 0)
      + (/[a-zA-Z]/.test(password) && /[^a-zA-Z]/.test(password) ? 1 : 0);
  const strengthLabel = ["Too short", "Okay", "Good", "Strong"][strength];

  return (
    <AuthShell
      title="Create your account"
      subtitle="Free to start. Deploy your first app or tunnel in under a minute."
      footer={<>Already have an account?{" "}<Link href="/sign-in" className="font-medium text-foreground underline-offset-4 hover:underline">Sign in</Link></>}
    >
      <GoogleButton />
      <OrDivider />
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormError message={error} />
        <Field id="name" label="Name" icon={User} placeholder="Your name" autoComplete="name"
          value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        <Field id="email" label="Email" icon={Mail} type="email" placeholder="you@example.com" autoComplete="email"
          value={email} onChange={(e) => setEmail(e.target.value)} required />
        <div>
          <Field id="password" label="Password" icon={Lock} type="password" placeholder="8+ characters" hint="min. 8 characters"
            autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          {password && (
            <div className="mt-2 flex items-center gap-2" aria-live="polite">
              <div className="flex flex-1 gap-1">
                {[0, 1, 2].map((n) => (
                  <span key={n} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                    n < strength ? (strength === 1 ? "bg-amber-500" : "bg-emerald-500") : "bg-muted"}`} />
                ))}
              </div>
              <span className="w-16 text-right text-[11px] text-muted-foreground">{strengthLabel}</span>
            </div>
          )}
        </div>
        <SubmitButton loading={loading} loadingText="Creating account…">Create account</SubmitButton>
      </form>
    </AuthShell>
  );
}

export default function SignUpPage() {
  return <Suspense><SignUpForm /></Suspense>;
}
