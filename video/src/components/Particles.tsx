import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { COLORS } from "../constants";

export const DotGrid: React.FC = () => {
  const frame = useCurrentFrame();
  const dots: React.ReactNode[] = [];

  for (let x = 0; x < 40; x++) {
    for (let y = 0; y < 22; y++) {
      const cx = (x / 40) * 1920;
      const cy = (y / 22) * 1080;
      const distanceFromCenter = Math.sqrt(
        Math.pow((x - 20) / 40, 2) + Math.pow((y - 11) / 22, 2)
      );
      const pulse = Math.sin(frame * 0.02 + x * 0.3 + y * 0.3) * 0.5 + 0.5;
      const opacity = interpolate(
        distanceFromCenter,
        [0, 0.3, 1],
        [0.06, 0.03, 0.01],
        { extrapolateRight: "clamp" }
      ) * (0.5 + pulse * 0.5);

      dots.push(
        <circle
          key={`${x}-${y}`}
          cx={cx}
          cy={cy}
          r={1}
          fill={COLORS.accent}
          opacity={opacity}
        />
      );
    }
  }

  return (
    <svg
      width="1920"
      height="1080"
      style={{ position: "absolute", inset: 0, zIndex: 0 }}
    >
      {dots}
    </svg>
  );
};

const particles = Array.from({ length: 30 }, (_, i) => ({
  id: i,
  x: Math.random() * 1920,
  y: Math.random() * 1080,
  size: Math.random() * 2 + 1,
  speed: Math.random() * 0.3 + 0.1,
  phase: Math.random() * Math.PI * 2,
}));

export const FloatingParticles: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <svg
      width="1920"
      height="1080"
      style={{ position: "absolute", inset: 0, zIndex: 0 }}
    >
      {particles.map((p) => {
        const y =
          (Math.sin(frame * p.speed + p.phase) * 0.5 + 0.5) * 1080;
        const opacity = 0.1 + Math.sin(frame * 0.02 + p.phase) * 0.05;
        return (
          <circle
            key={p.id}
            cx={p.x}
            cy={y}
            r={p.size}
            fill={COLORS.accent}
            opacity={opacity}
          />
        );
      })}
    </svg>
  );
};
