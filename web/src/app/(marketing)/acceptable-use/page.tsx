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
  ["Proxies & VPN nodes", "Running VPN, proxy, or traffic-relay servers (such as V2Ray, Xray, sing-box, Hysteria, Trojan, or Shadowsocks) that relay other people's internet traffic, including behind Cloudflare or other tunnels, or hiding such services inside an app."],
];

export default function AcceptableUsePage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-14 sm:px-6 sm:py-20">
      <p className="eyebrow rise">Legal</p>
      <h1 className="rise mt-4 text-[clamp(2.2rem,5.4vw,3.4rem)] font-semibold leading-[1.02] tracking-[-0.045em]" style={{ animationDelay: "0.06s" }}>
        Acceptable <span className="accent-serif">use</span> policy
      </h1>
      <p className="rise mt-5 text-[16px] leading-relaxed text-muted-foreground sm:text-[17px]" style={{ animationDelay: "0.12s" }}>
        Deployzy lets you deploy apps, expose local services through tunnels, and connect custom domains.
        With that power comes a short, non-negotiable set of rules. Using Deployzy means you agree to them,
        and to be responsible for everything you and your users do on the platform.
      </p>

      <h2 className="mt-14 text-[22px] font-semibold tracking-[-0.025em]">Prohibited uses</h2>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {PROHIBITED.map(([t, d], i) => (
          <div key={t} className={`surface rounded-[20px] p-5 ${i === PROHIBITED.length - 1 && PROHIBITED.length % 2 ? "sm:col-span-2" : ""}`}>
            <p className="figure text-[12px] text-muted-foreground">{String(i + 1).padStart(2, "0")}</p>
            <h3 className="mt-2 text-[15px] font-semibold tracking-tight">{t}</h3>
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">{d}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-14 text-[22px] font-semibold tracking-[-0.025em]">Enforcement</h2>
      <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
        We may suspend or terminate any project, tunnel, custom domain, or account — with or without notice —
        when we reasonably believe this policy has been violated, and we may block the associated IP addresses.
        We cooperate with law-enforcement requests and preserve relevant logs (including IP addresses) as required by law.
        Repeat or severe violations result in a permanent ban.
      </p>

      <h2 className="mt-14 text-[22px] font-semibold tracking-[-0.025em]">Report abuse</h2>
      <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
        Seeing something that breaks these rules on a <span className="font-mono text-foreground">deployzy.app</span> or <span className="font-mono text-foreground">deployzy.com</span> address?
        Please tell us — we act fast. Use the{" "}
        <Link href="/report" className="text-[var(--dz-green-strong)] underline underline-offset-2 dark:text-brand">abuse report form</Link>{" "}
        or email <a href="mailto:abuse@deployzy.com" className="text-[var(--dz-green-strong)] underline underline-offset-2 dark:text-brand">abuse@deployzy.com</a>.
      </p>

      <p className="mt-14 text-[12.5px] text-muted-foreground">Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long" })}</p>
    </div>
  );
}
