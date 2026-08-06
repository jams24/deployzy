import { STACK_LOGOS, type StackLogo } from "@/lib/stack-logos";

// Animated "deploy any stack" logo cloud. Two rows scrolling in opposite
// directions with real brand logos (simple-icons, rendered inline). Pure CSS
// transform animation — GPU-composited, no JS, no layout thrash. Logos sit muted
// and light up to their brand colour on hover; the whole row pauses on hover.
// Respects prefers-reduced-motion (falls back to a static, wrapped grid feel).

const CSS = `
@keyframes dz-marquee { from { transform: translate3d(0,0,0); } to { transform: translate3d(-50%,0,0); } }
.dz-track {
  display: flex;
  width: max-content;
  animation: dz-marquee 46s linear infinite;
  will-change: transform;
}
.dz-track.rev { animation-direction: reverse; }
.dz-row:hover .dz-track { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) {
  .dz-track { animation: none; }
  .dz-row { overflow-x: auto; }
}
`;

function Chip({ logo }: { logo: StackLogo }) {
  return (
    <div
      className="group mx-2 flex h-[52px] shrink-0 items-center gap-2.5 rounded-xl border border-border/60 bg-background/70 px-5 shadow-sm backdrop-blur-sm transition-colors hover:border-foreground/20"
      style={{ ["--brand" as string]: logo.hex }}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className="h-[22px] w-[22px] shrink-0 text-muted-foreground/60 transition-colors duration-300 group-hover:text-[color:var(--brand)]"
      >
        <path d={logo.path} fill="currentColor" />
      </svg>
      <span className="whitespace-nowrap text-[13.5px] font-medium text-muted-foreground/90 transition-colors group-hover:text-foreground">
        {logo.title}
      </span>
    </div>
  );
}

function Row({ logos, reverse }: { logos: StackLogo[]; reverse?: boolean }) {
  // Duplicate the set so the -50% keyframe wraps seamlessly.
  const doubled = [...logos, ...logos];
  return (
    <div className="dz-row overflow-hidden py-1.5">
      <div className={`dz-track${reverse ? " rev" : ""}`}>
        {doubled.map((l, i) => (
          <Chip key={`${l.slug}-${i}`} logo={l} />
        ))}
      </div>
    </div>
  );
}

export function LogoCloud() {
  const half = Math.ceil(STACK_LOGOS.length / 2);
  const rowA = STACK_LOGOS.slice(0, half);
  const rowB = STACK_LOGOS.slice(half);

  return (
    <section aria-label="Supported stacks and services" className="border-b border-border/40 py-14 sm:py-16">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <p className="mb-8 text-center text-[12px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
          Deploy any stack — auto-detected, zero config
        </p>
      </div>
      {/* Full-bleed marquee with soft edge fades */}
      <div
        className="relative"
        style={{
          WebkitMaskImage:
            "linear-gradient(to right, transparent, #000 6%, #000 94%, transparent)",
          maskImage:
            "linear-gradient(to right, transparent, #000 6%, #000 94%, transparent)",
        }}
      >
        <Row logos={rowA} />
        <Row logos={rowB} reverse />
      </div>
    </section>
  );
}
