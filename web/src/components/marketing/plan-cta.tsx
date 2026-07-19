"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Pricing-card CTA that routes based on auth state: logged-in users go
 * straight to the dashboard billing page (or overview for the free plan)
 * instead of being bounced through sign-up.
 */
export function PlanCta({ planId, cta, popular }: { planId: string; cta: string; popular: boolean }) {
  const [loggedIn, setLoggedIn] = useState(false);
  useEffect(() => {
    setLoggedIn(!!localStorage.getItem("sm_token"));
  }, []);

  const href = loggedIn
    ? planId === "free" ? "/dashboard" : "/billing"
    : "/sign-up";
  const label = loggedIn && planId === "free" ? "Go to dashboard" : cta;

  return (
    <Button
      className="mt-6 w-full h-9 text-xs"
      variant={popular ? "default" : "outline"}
      nativeButton={false}
      render={<Link href={href} />}
    >
      {label}
    </Button>
  );
}
