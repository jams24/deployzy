"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Terminal } from "lucide-react";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const token = api.getToken();
    if (!token) {
      router.replace("/sign-in");
      return;
    }

    // Verify the token is still valid
    api.getMe()
      .then(() => {
        setAuthed(true);
        setChecked(true);
      })
      .catch(() => {
        api.setToken(null);
        router.replace("/sign-in");
      });
  }, [router]);

  if (!checked || !authed) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <img src="/logo-mark.png" alt="Deployzy" className="h-8 w-8 rounded-lg animate-pulse" />
          <span className="text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
