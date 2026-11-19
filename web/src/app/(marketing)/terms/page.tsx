import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell, type LegalSection } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The agreement between you and Deployzy for using the website, dashboard, CLI, API and SDKs.",
  alternates: { canonical: "https://deployzy.com/terms" },
};

const SECTIONS: LegalSection[] = [
  {
    id: "agreement",
    title: "The agreement",
    body: (
      <>
        <p>
          These terms are an agreement between you and Deployzy (“we”, “us”). They cover
          deployzy.com, the dashboard, the <code>deployzy</code> CLI, the API and SDKs, and everything you run with
          them (together, the “Service”). By creating an account or using the Service you accept these terms,
          our <Link href="/acceptable-use">Acceptable Use Policy</Link> and our <Link href="/privacy">Privacy Policy</Link>.
        </p>
        <p>
          If you use Deployzy for a company or other organisation, you accept these terms for it and confirm you are
          allowed to. You must be at least 16 and able to enter into a binding contract.
        </p>
      </>
    ),
  },
  {
    id: "account",
    title: "Your account",
    body: (
      <ul>
        <li>Give accurate details and keep your email address working; it is how we reach you about your account and billing.</li>
        <li>Keep your password, API keys and CLI tokens secret. You are responsible for everything done with your account, including by team members you invite.</li>
        <li>Tell us straight away at <a href="mailto:support@deployzy.com">support@deployzy.com</a> if you think someone else has access.</li>
        <li>One free account per person. Accounts created with disposable email addresses, or to get around limits or a ban, may be closed.</li>
      </ul>
    ),
  },
  {
    id: "service",
    title: "The service",
    body: (
      <>
        <p>
          Deployzy lets you deploy apps, run databases, expose local services through tunnels, connect custom domains,
          run workloads on servers you own (“Bring your own server”), and use AI and email-verification tools.
        </p>
        <p>
          We improve the Service all the time, so features, limits and interfaces may change. Features marked beta or
          preview are offered as they are and may change or be removed.
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    body: (
      <p>
        You must follow the <Link href="/acceptable-use">Acceptable Use Policy</Link>. In short: no phishing, fraud,
        malware, spam, attacks, illegal content, resource abuse or traffic-relay proxies. You are responsible for what
        your apps, tunnels and users do on the platform.
      </p>
    ),
  },
  {
    id: "content",
    title: "Your content",
    body: (
      <>
        <p>
          Your code, data and content stay yours. You give us permission to host, copy, run, transmit and display them
          only as needed to provide the Service to you, for example to build your app, store your database and serve
          your site.
        </p>
        <p>
          You confirm you have the rights to everything you upload or connect. If your app handles personal data about
          your own users, you are responsible for that data and for meeting the privacy laws that apply to it; we
          process it on your behalf, only to run the Service.
        </p>
      </>
    ),
  },
  {
    id: "byoc",
    title: "Bring your own server",
    body: (
      <p>
        When you connect your own server, you give us the access details we need (such as SSH credentials) and allow us
        to install software and run containers on it. We use that access only to operate the Service for you. The server,
        its security, its provider’s terms and its costs remain your responsibility. Remove the server in the
        dashboard to stop our access and delete the details we hold.
      </p>
    ),
  },
  {
    id: "plans",
    title: "Free plan, limits and fair use",
    body: (
      <ul>
        <li>Every plan has limits on projects, databases, bandwidth and resources, shown on the pricing and billing pages.</li>
        <li>Free apps may be put to sleep when idle and wake on the next request. Some features, such as private repositories, need a paid plan.</li>
        <li>To protect the platform, outbound mail on port 25 is blocked for everyone, and ports 465 and 587 are for paid plans only.</li>
        <li>If an account puts other customers or the platform at risk, we may limit, pause or move its workloads.</li>
      </ul>
    ),
  },
  {
    id: "billing",
    title: "Paid plans, credits and payments",
    body: (
      <>
        <ul>
          <li>Prices are shown before you pay. Card payments are processed by Polar, which acts as the merchant of record and handles tax; its terms also apply to the payment. Crypto payments are processed by InventPay.</li>
          <li>Card subscriptions renew automatically each billing period until you cancel. A crypto payment covers the period you paid for.</li>
          <li>You can cancel at any time. Your plan stays active until the end of the period you paid for, then your account moves to the free plan.</li>
          <li>If a renewal fails, we may move your account to the free plan after a short grace period. Projects over the free limits may be stopped.</li>
          <li>AI credits are prepaid, have no cash value, cannot be transferred, and are used up as you use AI features.</li>
        </ul>
        <p>
          Payments are not refundable except where the law requires it or we say otherwise when you buy. If you think
          you were charged by mistake, email <a href="mailto:support@deployzy.com">support@deployzy.com</a> and we will look into it.
        </p>
      </>
    ),
  },
  {
    id: "availability",
    title: "Availability and backups",
    body: (
      <p>
        We work hard to keep Deployzy fast and available, but we don’t promise it will be uninterrupted or
        error-free, and there is no uptime guarantee unless we agree one in writing. We take platform backups, but they
        are for our own disaster recovery and we can’t guarantee a restore. Keep your own backups of code and data
        that matter to you.
      </p>
    ),
  },
  {
    id: "termination",
    title: "Suspension and closing your account",
    body: (
      <>
        <p>
          You can delete your account at any time in <strong>Settings → Danger zone</strong>. This stops and deletes your
          projects, databases, tunnels, domains and keys.
        </p>
        <p>
          We may suspend or close an account, project or domain if it breaks these terms or the Acceptable Use Policy,
          if payment fails, if we are legally required to, or if it puts other customers or the platform at risk. Where
          we reasonably can, we will tell you first and give you a chance to fix it or export your data. Serious abuse
          may be stopped immediately.
        </p>
      </>
    ),
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    body: (
      <p>
        Apart from what these terms say, the Service is provided “as is” and “as available”,
        without warranties of any kind, including that it will meet your needs or be free of errors. Some places
        don’t allow these exclusions, so they apply only as far as the law permits.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Limitation of liability",
    body: (
      <p>
        As far as the law allows, we are not liable for indirect or consequential losses, or for lost profits, revenue
        or data. Our total liability for any claim about the Service is limited to the greater of what you paid us in
        the 12 months before the claim and US$50. Nothing in these terms limits liability that cannot be limited by law.
      </p>
    ),
  },
  {
    id: "indemnity",
    title: "Indemnity",
    body: (
      <p>
        If someone makes a claim against us because of your content, your apps, or your breach of these terms or the
        Acceptable Use Policy, you agree to cover our reasonable costs of dealing with it.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to these terms",
    body: (
      <p>
        We may update these terms as the Service changes. We will change the date at the top, and for significant
        changes we will tell you by email or in the dashboard before they take effect. Continuing to use Deployzy after
        that means you accept the updated terms.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        Questions about these terms: <a href="mailto:support@deployzy.com">support@deployzy.com</a>. To report abuse,
        use the <Link href="/report">report form</Link> or <a href="mailto:abuse@deployzy.com">abuse@deployzy.com</a>.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalShell
      active="terms"
      title={<>Terms of <span className="accent-serif">service</span></>}
      intro={<p>The plain-English agreement for using Deployzy: what you can expect from us, and what we expect from you.</p>}
      sections={SECTIONS}
    />
  );
}
