import { Check } from "lucide-react";
import { PlanCta } from "@/components/marketing/plan-cta";
import { cn } from "@/lib/utils";

export interface PricingPlan {
  name: string;
  price: string;
  period: string | null;
  popular: boolean;
  desc: string;
  cta: string;
  features: string[];
}

export function Pricing({ plans }: { plans: PricingPlan[] }) {
  return (
    <div className="grid items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {plans.map((plan, i) => (
        <div
          key={plan.name}
          style={{ animationDelay: `${i * 60}ms` }}
          className={cn(
            "reveal-up relative flex h-full flex-col rounded-[1.25rem] p-6 sm:p-7",
            plan.popular
              ? "dark bg-[#0b0c10] text-white shadow-[0_30px_80px_-30px] shadow-brand/40 ring-1 ring-brand/40"
              : "panel",
          )}
        >
          {plan.popular && (
            <div aria-hidden className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-brand to-transparent" />
          )}
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-medium">{plan.name}</span>
            {plan.popular && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/15 px-2 py-0.5 text-[11.5px] font-medium text-brand">
                <span className="live-dot !h-1.5 !w-1.5" /> Most popular
              </span>
            )}
          </div>
          <div className="mt-4 flex items-baseline gap-1">
            <span className="text-[2.6rem] font-semibold leading-none tracking-[-0.04em]">{plan.price}</span>
            {plan.period && <span className="text-[14px] text-muted-foreground">/{plan.period}</span>}
          </div>
          <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">{plan.desc}</p>
          <div className="my-6 h-px bg-border" />
          <ul className="flex-1 space-y-2.5">
            {plan.features.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-[13.5px] leading-snug">
                <Check className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", plan.popular ? "text-brand" : "text-muted-foreground")} />
                <span className="text-foreground/80">{f}</span>
              </li>
            ))}
          </ul>
          <PlanCta planId={plan.name.toLowerCase()} cta={plan.cta} popular={plan.popular} />
        </div>
      ))}
    </div>
  );
}
