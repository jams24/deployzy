"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { StatusBadge, StatusScreen } from "@/components/auth/auth-shell";

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get("token");
    if (token) {
      api.setToken(token);
      router.replace("/overview");
    } else {
      router.replace("/sign-in?error=Authentication failed");
    }
  }, [searchParams, router]);

  return null;
}

export default function AuthCallbackPage() {
  return (
    <StatusScreen badge={<StatusBadge tone="busy" />} title="Signing you in" subtitle="One moment while we open your dashboard.">
      <Suspense>
        <CallbackHandler />
      </Suspense>
    </StatusScreen>
  );
}
