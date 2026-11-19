import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell, LegalTable, type LegalSection } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What personal data Deployzy collects, why, who we share it with, how long we keep it and your rights.",
  alternates: { canonical: "https://deployzy.com/privacy" },
};

const SECTIONS: LegalSection[] = [
  {
    id: "who",
    title: "Who we are",
    body: (
      <>
        <p>
          Deployzy (“we”, “us”) runs deployzy.com, the dashboard, the CLI, the API and SDKs. We
          decide how your account data is used, and this policy explains it. Contact us about privacy at{" "}
          <a href="mailto:support@deployzy.com">support@deployzy.com</a>.
        </p>
        <p>
          Apps, databases and tunnels you run on Deployzy may hold data about <em>your</em> users. For that data you
          are in charge and we only process it on your behalf to run the Service. Visitors of those apps should read the
          app owner’s privacy policy.
        </p>
      </>
    ),
  },
  {
    id: "collect",
    title: "What we collect",
    body: (
      <ul>
        <li><strong>Account.</strong> Email, name and password, stored only as a one-way bcrypt hash. If you sign in with Google, we receive your name and email from Google.</li>
        <li><strong>Connected services.</strong> If you connect GitHub, your GitHub username and an access token so we can read repositories and receive push events. If you connect Telegram alerts, your chat ID.</li>
        <li><strong>What you create.</strong> Projects, repository links, environment variables, build and deploy logs, databases and their contents, domains, webhooks, API keys, team members, and servers you connect, including their access details. AI provider keys you add are encrypted at rest.</li>
        <li><strong>AI and email tools.</strong> Prompts you send to the AI builder, and email addresses you submit to the email verifier.</li>
        <li><strong>Billing.</strong> Your plan, payment status, amounts, invoices and order IDs from our payment providers. We never see or store full card numbers.</li>
        <li><strong>Security and abuse prevention.</strong> The IP address and country you sign up and sign in from, IP addresses of CLI tunnel sessions, and request details for traffic through our proxy.</li>
        <li><strong>Website analytics.</strong> Cookieless page counts: page, referring site, country, device, browser and operating system. Visitors are counted with an ID that changes every day and is not stored with your IP address.</li>
        <li><strong>Messages.</strong> What you send us by email or through the abuse report form.</li>
      </ul>
    ),
  },
  {
    id: "use",
    title: "How we use it",
    body: (
      <>
        <ul>
          <li>To run the Service: build and host your apps, run your databases and tunnels, and show you logs, metrics and analytics.</li>
          <li>To keep the platform safe: detect fraud, spam, phishing and abuse, enforce our policies and block bad actors.</li>
          <li>To bill you and keep financial records.</li>
          <li>To email you about your account: verification, security, failed deploys, billing, and important product changes. You can choose which optional emails you get in <strong>Notifications</strong>.</li>
          <li>To improve Deployzy using aggregated usage information.</li>
        </ul>
        <p>
          Under the GDPR and similar laws, we rely on: performing our contract with you; our legitimate interests in
          securing and improving the Service; legal obligations such as keeping tax records; and your consent where we
          ask for it. We don’t sell personal data and we don’t show ads.
        </p>
      </>
    ),
  },
  {
    id: "share",
    title: "Who we share it with",
    body: (
      <>
        <p>We use a small set of providers to run Deployzy. Each gets only what it needs for its job:</p>
        <LegalTable
          head={["Provider", "What for"]}
          rows={[
            ["Cloudflare", "DNS, network protection and routing of our support email."],
            ["Brevo", "Sending account, alert and billing emails."],
            ["Polar", "Card payments, subscriptions and tax, as merchant of record."],
            ["InventPay", "Crypto payments."],
            ["GitHub, Google", "Sign-in and repository access that you choose to connect."],
            ["AI model providers", "Answering AI builder prompts. If you add your own key, your prompts go to the provider you chose."],
            ["Telegram", "Delivering alerts, only if you connect it."],
            ["Hosting providers", "The servers that run the platform and your apps."],
          ]}
        />
        <p>
          We may also share information when the law requires it, to protect people or the platform from harm, or with a
          buyer if Deployzy is sold or merged (this policy would keep applying). Some providers process data outside your
          country; where the law requires, we rely on appropriate safeguards such as standard contractual clauses.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    title: "How long we keep it",
    body: (
      <ul>
        <li><strong>Account and project data:</strong> while your account is open. When you delete your account, we stop your workloads and delete the account and what’s in it straight away.</li>
        <li><strong>Backups:</strong> deleted data can remain in platform backups for up to 7 days, then it’s gone.</li>
        <li><strong>Deploy logs and analytics:</strong> for the retention period of your plan, then deleted automatically.</li>
        <li><strong>Security records</strong> (such as sign-in IPs, tunnel sessions and ban lists): only as long as needed to protect the platform.</li>
        <li><strong>Billing records:</strong> as long as tax and accounting laws require.</li>
      </ul>
    ),
  },
  {
    id: "rights",
    title: "Your rights",
    body: (
      <>
        <p>
          Depending on where you live, you can ask to access, correct, export or delete your personal data, object to or
          restrict how we use it, and withdraw consent you gave. Most of this you can do yourself in the dashboard: edit
          your profile in <strong>Settings</strong> and delete everything under <strong>Settings → Danger zone</strong>.
        </p>
        <p>
          For anything else, email <a href="mailto:support@deployzy.com">support@deployzy.com</a>. We may need to
          confirm it’s you, and we’ll reply within one month. You can also complain to your local data
          protection authority.
        </p>
      </>
    ),
  },
  {
    id: "security",
    title: "Security",
    body: (
      <p>
        We use HTTPS everywhere, hash passwords, encrypt sensitive keys, restrict internal access and isolate customer
        workloads in containers. No system is perfectly secure, so please use a strong password and keep your API keys
        private. If you find a vulnerability, tell us at <a href="mailto:support@deployzy.com">support@deployzy.com</a>.
      </p>
    ),
  },
  {
    id: "cookies",
    title: "Cookies",
    body: (
      <p>
        We only use cookies and browser storage that are needed to sign you in, keep the Service secure and remember
        your settings. See the <Link href="/cookies">Cookie Policy</Link> for the full list.
      </p>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: <p>Deployzy is not meant for anyone under 16, and we don’t knowingly collect their data. If you think a child has signed up, tell us and we’ll delete the account.</p>,
  },
  {
    id: "changes",
    title: "Changes",
    body: <p>When we change this policy we’ll update the date at the top. For significant changes we’ll also tell you by email or in the dashboard.</p>,
  },
];

export default function PrivacyPage() {
  return (
    <LegalShell
      active="privacy"
      title={<>Privacy <span className="accent-serif">policy</span></>}
      intro={<p>What we collect, why, who sees it and how long we keep it. No ads, no selling data, no tracking cookies.</p>}
      sections={SECTIONS}
    />
  );
}
