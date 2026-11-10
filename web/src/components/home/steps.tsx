import { GitBranch, Hammer, Rocket } from "lucide-react";

const STEPS = [
  {
    icon: GitBranch,
    title: "Connect a repo",
    body: "Pick a GitHub repo, or run deployzy deploy from any folder. Private repos work on paid plans.",
    code: "deployzy deploy",
  },
  {
    icon: Hammer,
    title: "We build it",
    body: "Framework and port are detected for you, or bring a Dockerfile. Env vars, release commands and health checks are one click away.",
    code: "Next.js · Node 20 · port 3000",
  },
  {
    icon: Rocket,
    title: "It's live on HTTPS",
    body: "A live URL with TLS in about 30 seconds. Add your own domain, watch logs and metrics, and roll back from the dashboard.",
    code: "https://shop.deployzy.app",
  },
];

export function Steps() {
  return (
    <ol className="relative grid gap-3 md:grid-cols-3">
      {/* Connector line on wide screens */}
      <div aria-hidden className="pointer-events-none absolute left-[16%] right-[16%] top-[42px] hidden h-px bg-gradient-to-r from-transparent via-border to-transparent md:block" />
      {STEPS.map((s, i) => (
        <li key={s.title} className="panel reveal-up relative p-6 sm:p-7" style={{ animationDelay: `${i * 80}ms` }}>
          <div className="flex items-center gap-3">
            <span className="relative z-10 flex h-11 w-11 items-center justify-center rounded-full border bg-background">
              <s.icon className="h-[18px] w-[18px]" />
            </span>
            <span className="figure text-[13px] text-muted-foreground">0{i + 1}</span>
          </div>
          <h3 className="mt-5 text-[20px] font-semibold tracking-[-0.02em]">{s.title}</h3>
          <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">{s.body}</p>
          <code className="mt-5 inline-flex max-w-full items-center gap-2 truncate rounded-lg border bg-muted/50 px-2.5 py-1.5 font-mono text-[12px] text-muted-foreground">
            <span className="text-brand">›</span>
            {s.code}
          </code>
        </li>
      ))}
    </ol>
  );
}
