// Where "Upgrade" links point. A link that names a plan opens the checkout
// sheet for it straight away (/billing?checkout=pro); a generic one lands on
// the Plans tab so the user can pick. Either way nobody has to find the Plans
// tab from the billing overview first.

export type PaidPlan = "hobby" | "pro" | "team";

const ORDER = ["free", "hobby", "pro", "team"] as const;

export function isPaidPlan(v: unknown): v is PaidPlan {
  return v === "hobby" || v === "pro" || v === "team";
}

/** The tier above `current`, or null at the top (or for unknown plans). */
export function nextPlan(current?: string | null): PaidPlan | null {
  const i = ORDER.indexOf((current || "free") as (typeof ORDER)[number]);
  if (i < 0 || i >= ORDER.length - 1) return null;
  return ORDER[i + 1] as PaidPlan;
}

export function upgradeHref(plan?: PaidPlan | null): string {
  return plan ? `/billing?checkout=${plan}` : "/billing?tab=plans";
}

const METHOD_KEY = "dz.payMethod";

export function rememberedPayMethod(): "card" | "crypto" {
  try {
    return localStorage.getItem(METHOD_KEY) === "crypto" ? "crypto" : "card";
  } catch {
    return "card";
  }
}

export function rememberPayMethod(m: "card" | "crypto") {
  try {
    localStorage.setItem(METHOD_KEY, m);
  } catch {
    /* private mode: the choice just isn't remembered */
  }
}
