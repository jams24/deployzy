"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { Terminal } from "lucide-react";

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get("token");
    if (token) {
      api.setToken(token);
      router.replace("/tunnels");
    } else {
      router.replace("/sign-in?error=Authentication failed");
    }
  }, [searchParams, router]);

  return null;
}

export default function AuthCallbackPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="flex justify-center mb-4">
          <img src="/logo-icon.svg" alt="Deployzy" className="h-10 w-10 rounded-lg animate-pulse" />
        </div>
        <p className="text-sm text-muted-foreground">Signing you in...</p>
        <Suspense>
          <CallbackHandler />
        </Suspense>
      </div>
    </div>
  );
}
