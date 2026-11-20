"use client";

import Link from "next/link";
import { useSignedIn } from "@/lib/use-signed-in";
import { cn } from "@/lib/utils";

/**
 * Pricing-card CTA that routes based on auth state: logged-in users go
 * straight to checkout for the chosen plan (or the overview for Free)
 * instead of being bounced through sign-up.
 */
export function PlanCta({ planId, cta, popular }: { planId: string; cta: string; popular: boolean }) {
  const loggedIn = useSignedIn();

  // Paid plans open the checkout sheet for that plan directly; signed-out
  // visitors come back to it after signing up.
  const target = planId === "free" ? "/overview" : `/billing?checkout=${planId}`;
  const href = loggedIn ? target : planId === "free" ? "/sign-up" : `/sign-up?redirect=${encodeURIComponent(target)}`;
  const label = loggedIn && planId === "free" ? "Go to dashboard" : cta;

  return (
    <Link href={href} className={cn("pill pill-sm mt-7 w-full", popular ? "pill-launch" : "pill-line")}>
      {label}
    </Link>
  );
}
