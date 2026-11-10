import Link from "next/link";
import { ArrowRight, Cloud, Server } from "lucide-react";
import { fetchPlanCards } from "@/lib/plans";
import { Hero } from "@/components/home/hero";
import { StackMarquee } from "@/components/home/marquee";
import { Bento } from "@/components/home/bento";
import { Steps } from "@/components/home/steps";
import { Globe } from "@/components/home/globe";
import { Pricing, type PricingPlan } from "@/components/home/pricing";
import { Faq } from "@/components/home/faq";
import { ClosingCta } from "@/components/home/cta";
import { SectionTitle } from "@/components/home/section-title";

const WRAP = "mx-auto w-full max-w-[1200px] px-5 sm:px-6";

export default async function HomePage() {
  // Live pricing from plan_limits (ISR-cached 60s so admin edits appear within a
  // minute without a redeploy). Falls back to the static list if unreachable.
  const liveCards = await fetchPlanCards(60);
  const plans: PricingPlan[] = liveCards
    ? liveCards.map((c) => ({ name: c.name, price: c.price, period: c.period, popular: c.popular, desc: c.tagline, cta: c.cta, features: c.features }))
    : FALLBACK_PLANS;

  return (
    <>
      <Hero />

      {/* Stacks */}
      <section className="pb-4 pt-16 sm:pt-20">
        <p className="eyebrow reveal-up mb-6 text-center">Deploy the stack you already use</p>
        <StackMarquee />
      </section>

      {/* Features */}
      <section id="features" className="home-section scroll-mt-20">
        <div className={WRAP}>
          <SectionTitle
            eyebrow="Platform"
            title={
              <>
                Everything your app needs, <span className="accent-serif">in one tab.</span>
              </>
            }
            body="Deploys, databases, tunnels, domains, metrics and logs share one dashboard, one CLI and one bill. No five-tool stack to wire together."
          />
          <div className="mt-12 sm:mt-14">
            <Bento />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="home-section border-y bg-muted/30">
        <div className={WRAP}>
          <SectionTitle
            eyebrow="How it works"
            title={
              <>
                From repo to URL <span className="accent-serif">in three steps.</span>
              </>
            }
          />
          <div className="mt-12 sm:mt-14">
            <Steps />
          </div>
        </div>
      </section>

      {/* Our cloud or yours */}
      <section className="home-section overflow-hidden">
        <div className={`${WRAP} grid items-center gap-10 lg:grid-cols-[1fr_1.05fr] lg:gap-16`}>
          <div>
            <SectionTitle
              eyebrow="Where it runs"
              title={
                <>
                  Our cloud, <span className="accent-serif">or yours.</span>
                </>
              }
              body="Start on Deployzy Cloud. When you want your own hardware, attach a VPS and pick it from the region menu. Same dashboard, same deploys."
            />
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <div className="panel reveal-up p-5">
                <Cloud className="h-5 w-5 text-brand" />
                <h3 className="mt-4 text-[16px] font-semibold">Deployzy Cloud</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">Managed regions in the US and Europe. Nothing to set up.</p>
              </div>
              <div className="panel reveal-up p-5">
                <Server className="h-5 w-5 text-brand" />
                <h3 className="mt-4 text-[16px] font-semibold">Your own server</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
                  Any Ubuntu or Debian VPS. Your data stays on your box.
                </p>
              </div>
            </div>
            <Link href="/docs/guides/byoc" className="reveal-up mt-6 inline-flex items-center gap-1.5 text-[14.5px] font-medium underline-offset-4 hover:underline">
              How bring-your-own-server works <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="relative mx-auto w-full max-w-[560px]">
            <Globe />
            <div className="pointer-events-none absolute bottom-[8%] left-0 flex flex-col gap-2 sm:left-[2%]">
              <span className="frost inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px]">
                <span className="live-dot" /> Deployzy Cloud · US · Europe
              </span>
              <span className="frost inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-brand/50" /> Servers people bring
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="home-section scroll-mt-20 border-t">
        <div className={WRAP}>
          <SectionTitle
            align="center"
            eyebrow="Pricing"
            title={
              <>
                Start free. <span className="accent-serif">Scale when ready.</span>
              </>
            }
            body="Every plan includes deploys, databases, tunnels, custom domains and analytics. Upgrade only when you outgrow the limits."
          />
          <div className="mt-12 sm:mt-14">
            <Pricing plans={plans} />
          </div>
          <p className="mt-6 text-center text-[13px] text-muted-foreground">Prices in USD. Cancel anytime from Billing.</p>
        </div>
      </section>

      {/* FAQ */}
      <section className="home-section border-t">
        <div className={`${WRAP} grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16`}>
          <div>
            <SectionTitle eyebrow="FAQ" title="Questions, answered." />
            <p className="reveal-up mt-4 text-[15px] leading-relaxed text-muted-foreground">
              Something else? Write to{" "}
              <a href="mailto:support@deployzy.com" className="font-medium text-foreground underline-offset-4 hover:underline">
                support@deployzy.com
              </a>{" "}
              or ask on{" "}
              <a href="https://t.me/deployzy" target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline-offset-4 hover:underline">
                Telegram
              </a>
              .
            </p>
          </div>
          <Faq />
        </div>
      </section>

      <ClosingCta />
    </>
  );
}

// Used when the plans API is unreachable at build/render time.
const FALLBACK_PLANS: PricingPlan[] = [
  {
    name: "Free", price: "$0", period: null, popular: false,
    desc: "For hobby projects and learning.",
    cta: "Get started",
    features: [
      "3 projects, 1 PostgreSQL database (1 GB)",
      "5 subdomains, 5 active tunnels",
      "1 BYOC server, 1 custom domain",
      "512 MB RAM / 0.25 vCPU per project",
      "50 GB bandwidth, 120 build min/mo",
      "Cookieless website analytics (7d)",
      "3-day deploy log retention",
    ],
  },
  {
    name: "Hobby", price: "$5", period: "mo", popular: false,
    desc: "Perfect for indie hackers and side projects.",
    cta: "Start with Hobby",
    features: [
      "All Free features, plus:",
      "5 projects, 3 databases · Redis, Mongo & MySQL",
      "5 GB DB storage · migrate existing databases",
      "8 subdomains, 8 tunnels, 2 BYOC servers",
      "2 custom domains, 2 PR previews, 2 cron jobs",
      "1 GB RAM / 0.5 vCPU per project",
      "150 GB bandwidth, 300 build min/mo",
      "TCP/TLS tunnels, private repos, live logs",
      "Health checks, release commands, Telegram alerts",
      "30-day analytics, 7-day deploy logs",
    ],
  },
  {
    name: "Pro", price: "$12", period: "mo", popular: true,
    desc: "Built for production-ready applications.",
    cta: "Upgrade to Pro",
    features: [
      "All Hobby features, plus:",
      "10 projects, 5 databases, 10 services",
      "10 GB DB storage · migrate existing databases",
      "10 subdomains, 15 tunnels, 5 BYOC servers",
      "5 custom domains, 5 PR previews, 5 cron jobs",
      "1 GB RAM / 1 vCPU (configurable)",
      "500 GB bandwidth, 600 build min/mo",
      "7-day backups, 90-day analytics, 14-day deploy logs",
    ],
  },
  {
    name: "Team", price: "$35", period: "mo per seat", popular: false,
    desc: "For small teams shipping in production.",
    cta: "Upgrade to Team",
    features: [
      "All Pro features, plus:",
      "50 subdomains / projects, 20 databases",
      "50 GB DB storage · migrate existing databases",
      "15 BYOC servers, 25 custom domains",
      "25 scheduled jobs, 25 active PR previews",
      "Up to 8 GB RAM / 4 vCPU per project",
      "1 TB bandwidth, 1800 build min/mo",
      "30-day backups, 1-year analytics, 30-day deploy logs",
      "Multi-user collaboration, priority support",
    ],
  },
];
