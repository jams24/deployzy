"use client";

import Link from "next/link";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail, Lock } from "lucide-react";
import { AuthShell, GoogleButton, OrDivider, Field, FormError, SubmitButton } from "@/components/auth/auth-shell";
import { api, ApiError } from "@/lib/api";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await api.login(email, password);
      const redirect = searchParams.get("redirect");
      router.push(redirect && redirect.startsWith("/") ? redirect : "/overview");
    } catch (err: unknown) {
      // Unverified signup: the API has already emailed a fresh code, so send
      // the user to the verification step instead of showing a dead end.
      if (err instanceof ApiError && err.verificationRequired) {
        const redirect = searchParams.get("redirect");
        router.push(
          `/verify-email?email=${encodeURIComponent(email)}` +
            (redirect ? `&redirect=${encodeURIComponent(redirect)}` : "")
        );
        return;
      }
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to deploy, tunnel and manage your apps."
      footer={<>New to Deployzy?{" "}<Link href="/sign-up" className="font-medium text-foreground underline-offset-4 hover:underline">Create an account</Link></>}
    >
      <GoogleButton />
      <OrDivider />
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormError message={error} />
        <Field id="email" label="Email" icon={Mail} type="email" placeholder="you@example.com" autoComplete="email"
          value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <Field id="password" label="Password" icon={Lock} type="password" placeholder="Your password" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} required />
        <SubmitButton loading={loading} loadingText="Signing in…">Sign in</SubmitButton>
      </form>
    </AuthShell>
  );
}

export default function SignInPage() {
  return <Suspense><SignInForm /></Suspense>;
}
