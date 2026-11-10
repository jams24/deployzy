"use client";

import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Check, Loader2, Users } from "lucide-react";
import { api } from "@/lib/api";
import { AuthShell, FormError } from "@/components/auth/auth-shell";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

type Status = "loading" | "needsLogin" | "accepted" | "error";

const COPY: Record<Status, { title: React.ReactNode; subtitle: string }> = {
  loading: { title: "Joining the team", subtitle: "Accepting your invitation…" },
  needsLogin: {
    title: <>You&apos;re <span className="accent-serif">invited</span></>,
    subtitle: "A teammate invited you to their Deployzy workspace. Sign in or create an account to join.",
  },
  accepted: { title: <>You&apos;re <span className="accent-serif">in</span></>, subtitle: "Taking you to your team…" },
  error: { title: "Couldn't join the team", subtitle: "The invitation may have expired or already been used." },
};

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");

  async function acceptInvite() {
    setStatus("loading");
    try {
      const res = await fetch(`${API_URL}/api/v1/invitations/${token}/accept`, {
        method: "POST",
        headers: { Authorization: `Bearer ${api.getToken()}`, "Content-Type": "application/json" },
      });
      if (res.ok) {
        setStatus("accepted");
        setTimeout(() => router.push("/team"), 1500);
      } else {
        const data = await res.json().catch(() => ({}));
        const msg: string = data.error || "Failed to accept invitation";
        setError(msg.charAt(0).toUpperCase() + msg.slice(1));
        setStatus("error");
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  useEffect(() => {
    if (!api.getToken()) {
      // Deferred so the state update isn't synchronous inside the effect.
      Promise.resolve().then(() => setStatus("needsLogin"));
      return;
    }
    // Logged in: accept straight away.
    api.getMe()
      .then(() => acceptInvite())
      .catch(() => setStatus("needsLogin"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const back = encodeURIComponent(`/invite/${token}`);

  return (
    <AuthShell title={COPY[status].title} subtitle={COPY[status].subtitle}>
      <div className="mb-6 flex items-center gap-3 rounded-2xl border border-[var(--dz-hairline)] bg-foreground/[0.03] p-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-[var(--dz-green-strong)] dark:text-brand">
          {status === "accepted" ? <Check className="h-5 w-5" /> : status === "loading" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Users className="h-5 w-5" />}
        </span>
        <div className="min-w-0 text-left">
          <p className="text-[14px] font-semibold">Team invitation</p>
          <p className="text-[13px] text-muted-foreground">Shared projects, databases and domains</p>
        </div>
      </div>

      {status === "needsLogin" && (
        <div className="space-y-3">
          <Link href={`/sign-in?redirect=${back}`} className="pill pill-ink w-full">
            Sign in to accept <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href={`/sign-up?redirect=${back}`} className="pill pill-line w-full">
            Create an account
          </Link>
        </div>
      )}

      {status === "error" && (
        <div className="space-y-4">
          <FormError message={error} />
          <div className="flex gap-3">
            <button type="button" onClick={acceptInvite} className="pill pill-ink flex-1">Try again</button>
            <Link href="/team" className="pill pill-line flex-1">Go to dashboard</Link>
          </div>
        </div>
      )}
    </AuthShell>
  );
}
