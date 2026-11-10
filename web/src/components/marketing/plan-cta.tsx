"use client";

import Link from "next/link";
import { useSignedIn } from "@/lib/use-signed-in";
import { cn } from "@/lib/utils";

/**
 * Pricing-card CTA that routes based on auth state: logged-in users go
 * straight to the dashboard billing page (or overview for the free plan)
 * instead of being bounced through sign-up.
 */
export function PlanCta({ planId, cta, popular }: { planId: string; cta: string; popular: boolean }) {
  const loggedIn = useSignedIn();

  const href = loggedIn ? (planId === "free" ? "/overview" : "/billing") : "/sign-up";
  const label = loggedIn && planId === "free" ? "Go to dashboard" : cta;

  return (
    <Link href={href} className={cn("pill pill-sm mt-7 w-full", popular ? "pill-launch" : "pill-line")}>
      {label}
    </Link>
  );
}
