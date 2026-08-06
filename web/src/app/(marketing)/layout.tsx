import { Navbar } from "@/components/marketing/navbar";
import { Footer } from "@/components/marketing/footer";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Distinct branded backdrop — subtle emerald-tinted base + top glow.
          Fixed so it stays behind the transparent marketing sections. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-[#f5faf8] dark:bg-[#070b0a]">
        <div className="absolute inset-x-0 top-0 h-[720px] bg-[radial-gradient(55%_100%_at_50%_0%,rgba(16,185,129,0.07),transparent_70%)]" />
        <div className="absolute inset-0 opacity-[0.015] dark:opacity-[0.03] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:46px_46px]" />
      </div>
      <Navbar />
      <main className="flex-1 pt-16">{children}</main>
      <Footer />
    </>
  );
}
