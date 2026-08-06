import { Navbar } from "@/components/marketing/navbar";
import { Footer } from "@/components/marketing/footer";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Distinct branded backdrop — a clean, flat tinted base with a faint grid.
          No colored radial gradient (kept it modern, not the AI-mesh look). */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-[#fafaf9] dark:bg-[#09090b]">
        <div className="absolute inset-0 opacity-[0.02] dark:opacity-[0.028] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:48px_48px]" />
      </div>
      <Navbar />
      <main className="flex-1 pt-16">{children}</main>
      <Footer />
    </>
  );
}
