import { STACK_LOGOS } from "@/lib/stack-logos";

/** One row of the stacks people deploy, scrolling; logos light up on hover. */
export function StackMarquee() {
  const row = [...STACK_LOGOS, ...STACK_LOGOS];
  return (
    <div className="marquee relative overflow-hidden py-2 [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
      <ul className="marquee-track gap-2.5" aria-label="Frameworks and databases you can deploy">
        {row.map((l, i) => (
          <li
            key={`${l.slug}-${i}`}
            aria-hidden={i >= STACK_LOGOS.length}
            className="group flex h-12 shrink-0 items-center gap-2.5 rounded-full border bg-card px-4"
          >
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] text-muted-foreground/70 transition-colors duration-300 group-hover:text-[color:var(--logo)] dark:group-hover:text-white" style={{ ["--logo" as string]: l.hex }} aria-hidden>
              <path d={l.path} fill="currentColor" />
            </svg>
            <span className="whitespace-nowrap text-[14px] font-medium text-muted-foreground transition-colors group-hover:text-foreground">{l.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
