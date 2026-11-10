import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { StatusBadge, StatusScreen } from "@/components/auth/auth-shell";

export const metadata = { title: "CLI signed in — Deployzy" };

export default function CLISuccessPage() {
  return (
    <StatusScreen
      badge={<StatusBadge tone="ok" />}
      title="You're signed in to the CLI"
      subtitle="Head back to your terminal. You can close this tab."
    >
      <div className="dark overflow-hidden rounded-2xl border border-white/10 bg-[#0b0c10] text-left shadow-2xl shadow-black/30">
        <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
          <span className="ml-2 font-mono text-[11.5px] text-white/40">terminal</span>
        </div>
        <div className="space-y-1.5 px-4 py-3.5 font-mono text-[13px] leading-relaxed">
          <p><span className="text-brand">$</span> <span className="text-white">deployzy login</span></p>
          <p className="text-brand">✓ <span className="text-white/80">Logged in</span></p>
          <p className="text-white/40"># next: share a local port or deploy this folder</p>
          <p><span className="text-brand">$</span> <span className="text-white">deployzy http 3000</span></p>
        </div>
      </div>
      <Link href="/overview" className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-medium text-muted-foreground transition-colors hover:text-foreground">
        Open the dashboard <ArrowRight className="h-4 w-4" />
      </Link>
    </StatusScreen>
  );
}
