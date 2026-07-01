"use client";

import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Terminal, Users, Check, X } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

export default function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "needsLogin" | "ready" | "accepted" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const savedToken = api.getToken();
    if (!savedToken) {
      setStatus("needsLogin");
    } else {
      // User is logged in — auto-accept the invite
      api.getMe()
        .then(() => {
          // Automatically accept
          acceptInvite();
        })
        .catch(() => setStatus("needsLogin"));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function acceptInvite() {
    setStatus("loading");
    try {
      const authToken = api.getToken();
      const res = await fetch(`${API_URL}/api/v1/invitations/${token}/accept`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
      });

      if (res.ok) {
        setStatus("accepted");
        setTimeout(() => router.push("/team"), 2000);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to accept invitation");
        setStatus("error");
      }
    } catch {
      setError("Something went wrong");
      setStatus("error");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <Link href="/" className="inline-flex items-center gap-2 font-bold text-lg mb-8">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Terminal className="h-4 w-4" />
          </div>
          Deployzy
        </Link>

        {status === "loading" && (
          <div>
            <div className="flex justify-center mb-4">
              <Users className="h-10 w-10 text-muted-foreground animate-pulse" />
            </div>
            <p className="text-sm text-muted-foreground">Processing invitation...</p>
          </div>
        )}

        {status === "needsLogin" && (
          <div>
            <div className="flex justify-center mb-4">
              <Users className="h-10 w-10 text-primary" />
            </div>
            <h2 className="text-xl font-bold">Team Invitation</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              You&apos;ve been invited to join a team on Deployzy. Sign in to accept.
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <Button
                nativeButton={false}
                render={<Link href={`/sign-in?redirect=/invite/${token}`} />}
                className="w-full"
              >
                Sign in to Accept
              </Button>
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href={`/sign-up?redirect=/invite/${token}`} />}
                className="w-full"
              >
                Create Account
              </Button>
            </div>
          </div>
        )}

        {status === "ready" && (
          <div>
            <div className="flex justify-center mb-4">
              <Users className="h-10 w-10 text-primary" />
            </div>
            <h2 className="text-xl font-bold">Team Invitation</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              You&apos;ve been invited to join a team. Click below to accept.
            </p>
            <Button onClick={acceptInvite} className="mt-6 w-full gap-2">
              <Check className="h-4 w-4" />
              Accept Invitation
            </Button>
          </div>
        )}

        {status === "accepted" && (
          <div>
            <div className="flex justify-center mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10 text-green-500">
                <Check className="h-6 w-6" />
              </div>
            </div>
            <h2 className="text-xl font-bold">You&apos;re in!</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Redirecting to your team dashboard...
            </p>
          </div>
        )}

        {status === "error" && (
          <div>
            <div className="flex justify-center mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-500">
                <X className="h-6 w-6" />
              </div>
            </div>
            <h2 className="text-xl font-bold">Invitation Failed</h2>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/team" />}
              className="mt-6 w-full"
            >
              Go to Dashboard
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
