import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function ClosingCta() {
  return (
    <section className="px-2 pb-2 sm:px-3 sm:pb-3">
      <div className="dark grain relative isolate overflow-hidden rounded-[22px] bg-[#0b0c10] px-5 py-24 text-center text-white sm:rounded-[28px] sm:py-32">
        <div aria-hidden className="floor -z-10" />
        <div aria-hidden className="absolute left-1/2 top-[38%] -z-10 h-[300px] w-[620px] max-w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/15 blur-[110px]" />
        <p className="eyebrow reveal-up !text-white/45">Ready when you are</p>
        <h2 className="reveal-up mx-auto mt-4 max-w-3xl text-[clamp(2.4rem,7vw,5rem)] font-semibold leading-[0.98] tracking-[-0.045em]">
          Your next deploy is <span className="accent-serif text-launch pr-1">30 seconds</span> away.
        </h2>
        <p className="reveal-up mx-auto mt-5 max-w-md text-[15.5px] leading-relaxed text-white/55 sm:text-[17px]">
          Connect GitHub, pick a repo, get a live URL. No credit card.
        </p>
        <div className="reveal-up mx-auto mt-9 flex w-full max-w-xs flex-col gap-2.5 sm:max-w-none sm:flex-row sm:justify-center">
          <Link href="/sign-up" className="pill pill-launch group">
            Create a free account <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link href="/#pricing" className="pill border border-white/15 bg-white/[0.04] text-white hover:bg-white/10">
            Compare plans
          </Link>
        </div>
      </div>
    </section>
  );
}
