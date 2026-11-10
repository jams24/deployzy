"use client";

import * as React from "react";
import createGlobe from "cobe";
import { useReducedMotion } from "framer-motion";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

type Phenomenon = ReturnType<typeof createGlobe> & { toggle?: (on: boolean) => void };

// Our managed regions (bigger) and examples of where people bring servers.
const MARKERS: { location: [number, number]; size: number }[] = [
  { location: [39.0, -95.0], size: 0.09 }, // Deployzy Cloud · US
  { location: [48.97, 8.18], size: 0.09 }, // Deployzy Cloud · Europe
  { location: [6.52, 3.38], size: 0.045 }, // Lagos
  { location: [50.11, 8.68], size: 0.04 }, // Frankfurt
  { location: [1.35, 103.82], size: 0.045 }, // Singapore
  { location: [-23.55, -46.63], size: 0.045 }, // São Paulo
  { location: [19.08, 72.88], size: 0.04 }, // Mumbai
  { location: [35.68, 139.69], size: 0.04 }, // Tokyo
  { location: [-26.2, 28.04], size: 0.04 }, // Johannesburg
  { location: [43.65, -79.38], size: 0.04 }, // Toronto
  { location: [-33.87, 151.21], size: 0.04 }, // Sydney
  { location: [51.51, -0.13], size: 0.04 }, // London
];

/**
 * Dotted globe (cobe, one WebGL canvas). Drag to spin; it eases back to
 * auto-rotation on release. Created the first time it scrolls near view and
 * paused whenever it leaves.
 */
export function Globe({ className }: { className?: string }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const wrap = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<number | null>(null);
  const offset = React.useRef(0);
  const velocity = React.useRef(0);
  const reduce = useReducedMotion();
  const { resolvedTheme } = useTheme();
  const light = resolvedTheme === "light";
  const [visible, setVisible] = React.useState(false);
  const [seen, setSeen] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const globeRef = React.useRef<Phenomenon | null>(null);

  React.useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        setVisible(e.isIntersecting);
        if (e.isIntersecting) setSeen(true);
      },
      { rootMargin: "160px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  React.useEffect(() => {
    if (!seen || !canvas.current) return;
    let phi = 5.2; // open over the Atlantic: both regions in view
    let width = canvas.current.offsetWidth;
    const onResize = () => canvas.current && (width = canvas.current.offsetWidth);
    window.addEventListener("resize", onResize);
    let globe: Phenomenon;
    try {
      globe = createGlobe(canvas.current, {
        devicePixelRatio: 2,
        width: width * 2,
        height: width * 2,
        phi,
        theta: 0.3,
        ...(light
          ? {
              dark: 0,
              diffuse: 1.1,
              mapSamples: 18000,
              mapBrightness: 2.2,
              mapBaseBrightness: 0,
              baseColor: [0.97, 0.97, 0.96] as [number, number, number],
              markerColor: [0.05, 0.62, 0.43] as [number, number, number],
              glowColor: [0.93, 0.95, 0.94] as [number, number, number],
            }
          : {
              dark: 1,
              diffuse: 1.5,
              mapSamples: 18000,
              mapBrightness: 6.5,
              mapBaseBrightness: 0.04,
              baseColor: [0.24, 0.27, 0.31] as [number, number, number],
              markerColor: [0.2, 0.83, 0.6] as [number, number, number],
              glowColor: [0.08, 0.2, 0.18] as [number, number, number],
            }),
        markers: MARKERS,
        onRender: (state) => {
          if (drag.current === null) {
            if (!reduce) phi += 0.0025;
            velocity.current *= 0.92;
            offset.current += velocity.current;
          }
          state.phi = phi + offset.current;
          state.width = width * 2;
          state.height = width * 2;
        },
      }) as Phenomenon;
    } catch {
      return () => window.removeEventListener("resize", onResize); // no WebGL: leave the glow
    }
    globeRef.current = globe;
    const t = setTimeout(() => setReady(true), 60);
    return () => {
      clearTimeout(t);
      globeRef.current = null;
      globe.destroy();
      window.removeEventListener("resize", onResize);
    };
  }, [seen, reduce, light]);

  React.useEffect(() => {
    globeRef.current?.toggle?.(visible);
  }, [visible, ready]);

  return (
    <div ref={wrap} className={cn("relative aspect-square w-full", className)}>
      <div aria-hidden className="absolute inset-[12%] rounded-full bg-brand/10 blur-3xl" />
      <canvas
        ref={canvas}
        aria-label="Globe showing Deployzy regions in the US and Europe, and servers people bring worldwide"
        role="img"
        className={cn(
          "relative h-full w-full cursor-grab touch-pan-y transition-opacity duration-1000 active:cursor-grabbing",
          ready ? "opacity-100" : "opacity-0",
        )}
        onPointerDown={(e) => {
          drag.current = e.clientX;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onPointerMove={(e) => {
          if (drag.current === null) return;
          const dx = e.clientX - drag.current;
          drag.current = e.clientX;
          offset.current += dx / 180;
          velocity.current = dx / 180;
        }}
      />
    </div>
  );
}
