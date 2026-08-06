import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Acceptable Use Policy",
  description: "The rules for using Deployzy — what's allowed and what gets you terminated.",
  alternates: { canonical: "https://deployzy.com/acceptable-use" },
};

const PROHIBITED = [
  ["Phishing & fraud", "Pages that impersonate a real person, brand, bank, or service to harvest credentials, payment details, or personal data."],
  ["Malware & C2", "Hosting, distributing, or controlling malware, ransomware, spyware, exploit kits, or command-and-control infrastructure."],
  ["Spam & abuse", "Sending unsolicited bulk email/messages, operating open mail relays, or running services designed to spam or scrape at scale."],
  ["Illegal content", "Any content that is illegal where you or your users are located — including CSAM (which we report to authorities), pirated media, or the sale of illegal goods."],
  ["Attacks & scanning", "Using tunnels or deployments to launch DoS/DDoS attacks, port-scan, brute-force, proxy attacks, or otherwise probe systems you don't own."],
  ["Resource abuse", "Cryptocurrency mining, deliberate resource exhaustion, or circumventing plan limits."],
];

export default function AcceptableUsePage() {
  return (
    <div className="mx-auto max-w-3xl px-5 sm:px-6 py-16 sm:py-24">
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Acceptable Use Policy</h1>
      <p className="mt-4 text-muted-foreground leading-relaxed">
        Deployzy lets you deploy apps, expose local services through tunnels, and connect custom domains.
        With that power comes a short, non-negotiable set of rules. Using Deployzy means you agree to them,
        and to be responsible for everything you and your users do on the platform.
      </p>

      <h2 className="mt-12 text-xl font-semibold tracking-tight">Prohibited uses</h2>
      <div className="mt-5 space-y-4">
        {PROHIBITED.map(([t, d]) => (
          <div key={t} className="rounded-xl border border-border/60 p-4">
            <h3 className="text-sm font-semibold">{t}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{d}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-12 text-xl font-semibold tracking-tight">Enforcement</h2>
      <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
        We may suspend or terminate any project, tunnel, custom domain, or account — with or without notice —
        when we reasonably believe this policy has been violated, and we may block the associated IP addresses.
        We cooperate with law-enforcement requests and preserve relevant logs (including IP addresses) as required by law.
        Repeat or severe violations result in a permanent ban.
      </p>

      <h2 className="mt-12 text-xl font-semibold tracking-tight">Report abuse</h2>
      <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
        Seeing something that breaks these rules on a <span className="font-mono">deployzy.com</span> address?
        Please tell us — we act fast. Use the{" "}
        <Link href="/report" className="text-emerald-600 dark:text-emerald-400 underline underline-offset-2">abuse report form</Link>{" "}
        or email <a href="mailto:abuse@deployzy.com" className="text-emerald-600 dark:text-emerald-400 underline underline-offset-2">abuse@deployzy.com</a>.
      </p>

      <p className="mt-12 text-xs text-muted-foreground">Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long" })}</p>
    </div>
  );
}
