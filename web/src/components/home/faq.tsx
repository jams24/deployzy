import Link from "next/link";
import { Plus } from "lucide-react";

const FAQS: { q: string; a: string; link?: { href: string; label: string } }[] = [
  {
    q: "Is there really a free plan?",
    a: "Yes. You can deploy projects, run a PostgreSQL database and open tunnels without a card. Free apps sleep after 30 minutes without traffic and wake on the next visit in a few seconds. Paid plans stay awake and raise every limit.",
  },
  {
    q: "What can I deploy?",
    a: "Anything that runs in a container. Next.js, Node, Python, Go and static sites are detected automatically; anything else (Rust, PHP, Ruby, Java…) works with a Dockerfile. Databases are one click: PostgreSQL, Redis, MongoDB and MySQL.",
  },
  {
    q: "Where do my apps run?",
    a: "On Deployzy Cloud in the US or Europe, or on your own server. With bring-your-own-server you attach a VPS (Ubuntu 22.04+ or Debian 12+), we install Docker over SSH, and your projects run on your hardware while we handle builds, routing, TLS and the dashboard.",
    link: { href: "/docs/guides/byoc", label: "Read the BYOC guide" },
  },
  {
    q: "How are tunnels different from ngrok?",
    a: "Same idea, in the same tool as your deploys: deployzy http 3000 gives localhost a public HTTPS URL, with a request inspector and one-click replay. TCP and TLS tunnels and custom domains are supported too.",
    link: { href: "/docs/cli", label: "CLI reference" },
  },
  {
    q: "Can I use my own domain?",
    a: "Yes. Add the domain, point a CNAME at us, and the certificate is issued and renewed automatically.",
  },
  {
    q: "Is there an API, a CLI and SDKs?",
    a: "Yes: an open-source CLI (npm, Homebrew or a one-line install), a REST API, and JavaScript and Python SDKs.",
    link: { href: "/docs/api", label: "API reference" },
  },
];

export function Faq() {
  return (
    <div className="divide-y rounded-[1.25rem] border bg-card">
      {FAQS.map((f) => (
        <details key={f.q} className="faq group px-5 sm:px-7">
          <summary className="flex items-center justify-between gap-6 py-5 text-left text-[16px] font-medium tracking-[-0.01em] sm:text-[17px]">
            {f.q}
            <span className="faq-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-muted-foreground group-hover:text-foreground">
              <Plus className="h-4 w-4" />
            </span>
          </summary>
          <div className="-mt-1 pb-6 pr-12 text-[15px] leading-relaxed text-muted-foreground">
            <p>{f.a}</p>
            {f.link && (
              <Link href={f.link.href} className="mt-3 inline-flex items-center gap-1 text-[14px] font-medium text-foreground underline-offset-4 hover:underline">
                {f.link.label} →
              </Link>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}
