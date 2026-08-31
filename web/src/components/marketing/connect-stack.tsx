import { STACK_LOGOS, type StackLogo } from "@/lib/stack-logos";

// "Connect your stack to Deployzy" — real tech logos across the top with glowing
// emerald cables that flow down and converge into a central Deployzy hub. Pure
// SVG so it scales perfectly (no HTML/SVG alignment math) and the "current
// flowing toward the hub" effect is a cheap CSS stroke-dashoffset animation.
// Respects prefers-reduced-motion.

const pick = (slugs: string[]) =>
  slugs.map((s) => STACK_LOGOS.find((l) => l.slug === s)).filter(Boolean) as StackLogo[];

// A recognizable, evenly-spread set.
const LOGOS = pick(["nextdotjs", "postgresql", "python", "docker", "nodedotjs", "go", "redis"]);

const CSS = `
@keyframes dz-flow { to { stroke-dashoffset: -34; } }
.dz-cable-flow { stroke-dasharray: 3 14; animation: dz-flow 1.1s linear infinite; }
.dz-pulse { animation: dz-pulse 2.6s ease-in-out infinite; }
@keyframes dz-pulse { 0%,100% { opacity: .35; } 50% { opacity: .9; } }
@media (prefers-reduced-motion: reduce) {
  .dz-cable-flow { animation: none; }
  .dz-pulse { animation: none; }
}
`;

export function ConnectStack() {
  const W = 1000, H = 360;
  const topY = 46;                       // logo row y
  const hub = { x: W / 2, y: 312 };      // convergence point
  const n = LOGOS.length;
  const gap = W / (n + 1);

  return (
    <section aria-label="Connect your stack to Deployzy" className="border-b border-border/40 py-20 sm:py-28 overflow-hidden">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="mx-auto max-w-3xl px-5 sm:px-6 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Any stack</p>
        <h2 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight">Connect your stack to Deployzy</h2>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          Node, Python, Go, Docker, Postgres, Redis and more — auto-detected and wired together.
          One platform for every part of your app.
        </p>
      </div>

      <div className="mx-auto mt-12 max-w-4xl px-5 sm:px-6">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-hidden>
          <defs>
            <radialGradient id="dz-hub-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Cables (drawn first, behind nodes) */}
          {LOGOS.map((_, i) => {
            const x = gap * (i + 1);
            const d = `M ${x} ${topY + 26} C ${x} ${H * 0.5}, ${hub.x} ${H * 0.55}, ${hub.x} ${hub.y - 22}`;
            return (
              <g key={`cable-${i}`}>
                <path d={d} fill="none" className="stroke-emerald-500/15" strokeWidth={2} />
                <path d={d} fill="none" className="dz-cable-flow stroke-emerald-500/80" strokeWidth={2} strokeLinecap="round" />
              </g>
            );
          })}

          {/* Hub glow */}
          <circle cx={hub.x} cy={hub.y} r={80} fill="url(#dz-hub-glow)" className="dz-pulse" />

          {/* Logo nodes */}
          {LOGOS.map((l, i) => {
            const x = gap * (i + 1);
            return (
              <g key={l.slug} transform={`translate(${x - 26} ${topY - 26})`}>
                <rect width={52} height={52} rx={13} className="fill-background stroke-border" strokeWidth={1} />
                <g transform="translate(15 15) scale(0.92)">
                  <path d={l.path} className="fill-current text-muted-foreground" style={{ color: l.hex }} />
                </g>
              </g>
            );
          })}

          {/* Deployzy hub node */}
          <g transform={`translate(${hub.x - 30} ${hub.y - 30})`}>
            <rect width={60} height={60} rx={16} className="fill-emerald-500" />
            {/* rocket glyph (lucide 'rocket' path, 24x24) */}
            <g transform="translate(16 16) scale(1.16)" className="stroke-white" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
              <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
              <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
              <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
            </g>
          </g>
        </svg>

        <p className="mt-2 text-center text-[13px] font-medium text-muted-foreground">
          Everything ships through <span className="text-emerald-500">Deployzy</span>
        </p>
      </div>
    </section>
  );
}
