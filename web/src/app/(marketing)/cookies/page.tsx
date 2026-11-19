import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell, LegalTable, type LegalSection } from "@/components/legal/legal-shell";
import { CookieSettingsButton } from "@/components/cookie-notice";

export const metadata: Metadata = {
  title: "Cookie Policy",
  description: "Every cookie and browser-storage item Deployzy uses, what it's for and how long it lasts.",
  alternates: { canonical: "https://deployzy.com/cookies" },
};

const SECTIONS: LegalSection[] = [
  {
    id: "summary",
    title: "The short version",
    body: (
      <p>
        Deployzy only uses cookies and browser storage that are <strong>strictly necessary</strong>: to sign you in,
        keep the Service secure and remember your settings. We don’t use advertising cookies, cross-site trackers
        or third-party analytics, so there is nothing optional to accept. If that ever changes, we’ll ask first,
        and nothing optional will load until you say yes.
      </p>
    ),
  },
  {
    id: "what",
    title: "What cookies and storage are",
    body: (
      <p>
        Cookies are small files a website saves in your browser. Browser storage (“local storage”) works the
        same way but stays on your device and isn’t sent with every request. Both are used below; the same rules
        apply to each.
      </p>
    ),
  },
  {
    id: "cookies",
    title: "Cookies we set",
    body: (
      <LegalTable
        head={["Name", "Where", "Purpose", "Lasts"]}
        rows={[
          ["sm_gh_state", "deployzy.com", "Protects the GitHub connection step against forged requests.", "10 minutes"],
          ["__sm_session", "Tunnels with sign-in protection", "Keeps a visitor signed in to a tunnel its owner protected with Google or GitHub login.", "24 hours"],
          ["_dz_ack", "Tunnel and app addresses", "Remembers that you've seen the safety notice shown before some tunnels.", "24 hours"],
        ]}
      />
    ),
  },
  {
    id: "storage",
    title: "Browser storage we use",
    body: (
      <LegalTable
        head={["Key", "Purpose", "Lasts"]}
        rows={[
          ["sm_token", "Keeps you signed in to the dashboard.", "Until you sign out"],
          ["sm_team_id", "Remembers which workspace you're in.", "Until you clear it"],
          ["sm_projects_view", "Remembers grid or list view for projects.", "Until you clear it"],
          ["theme", "Remembers light, dark or system theme.", "Until you clear it"],
          ["dz_consent", "Remembers that you've seen this notice and any choices you made.", "Until you clear it"],
        ]}
      />
    ),
  },
  {
    id: "third-party",
    title: "Cloudflare",
    body: (
      <p>
        Our traffic passes through Cloudflare, which may set its own strictly necessary security cookies (such as{" "}
        <code>__cf_bm</code> or <code>cf_clearance</code>) to tell people from bots and block attacks. They don’t
        track you across sites. See Cloudflare’s cookie policy for details.
      </p>
    ),
  },
  {
    id: "analytics",
    title: "Analytics without cookies",
    body: (
      <p>
        Our own site statistics, and the optional analytics script customers can add to their apps, don’t use cookies
        or browser storage. Visitors are counted with an ID that changes every day and is never stored with an IP address.
      </p>
    ),
  },
  {
    id: "apps",
    title: "Apps hosted on Deployzy",
    body: (
      <p>
        Apps that customers deploy on <code>deployzy.app</code> or their own domains may set their own cookies. Those are
        controlled by the app’s owner, not by us; check that app’s own policies.
      </p>
    ),
  },
  {
    id: "control",
    title: "Your choices",
    body: (
      <>
        <p>
          You can see your choices at any time with <strong>Cookie settings</strong>, in the site footer and on this
          page. You can also delete cookies and site data in your browser’s settings. Blocking the items above will
          sign you out and stop parts of Deployzy from working.
        </p>
        <p>
          More on how we handle personal data is in the <Link href="/privacy">Privacy Policy</Link>. Questions:{" "}
          <a href="mailto:support@deployzy.com">support@deployzy.com</a>.
        </p>
      </>
    ),
  },
];

export default function CookiesPage() {
  return (
    <LegalShell
      active="cookies"
      title={<>Cookie <span className="accent-serif">policy</span></>}
      intro={<p>Every cookie and storage item we use, what it does and how long it lasts. All of them are essential.</p>}
      sections={SECTIONS}
      aside={<CookieSettingsButton className="pill pill-line pill-xs" />}
    />
  );
}
