import React from "react";
import { useCurrentFrame, spring, interpolate, AbsoluteFill } from "remotion";
import { COLORS, inter, jetbrains } from "../constants";
import { DotGrid } from "../components/Particles";

export const Intro: React.FC<{ startFrame: number; sceneFrames: number }> = ({
  startFrame,
  sceneFrames,
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame - startFrame;
  const endFrame = sceneFrames;

  const visible = localFrame >= 0 && localFrame < endFrame;
  if (!visible) return null;

  const sceneProgress = localFrame / endFrame;
  const fadeOut = sceneProgress > 0.8;
  const opacity = fadeOut
    ? interpolate(localFrame, [endFrame * 0.8, endFrame], [1, 0], {
        extrapolateRight: "clamp",
      })
    : 1;

  const logoScale = spring({
    frame: localFrame,
    fps: 60,
    config: { damping: 10, stiffness: 100, mass: 0.8 },
  });

  const titleOpacity = interpolate(
    localFrame,
    [15, 40],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const titleY = interpolate(
    localFrame,
    [15, 40],
    [30, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const subtitleOpacity = interpolate(
    localFrame,
    [50, 75],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const glowPulse = spring({
    frame: localFrame,
    fps: 60,
    config: { damping: 20, stiffness: 40 },
  });

  const bgOpacity = interpolate(
    localFrame,
    [0, endFrame * 0.15],
    [0.3, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        background: COLORS.bg,
        opacity,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", inset: 0, opacity: bgOpacity }}>
        <DotGrid />
      </div>

      <div
        style={{
          position: "absolute",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${COLORS.accentGlow} 0%, transparent 70%)`,
          transform: `scale(${1 + glowPulse * 0.8})`,
          opacity: 0.3 + glowPulse * 0.2,
          filter: "blur(40px)",
        }}
      />

      {/* Logo */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 40,
        }}
      >
        <div style={{ position: "relative" }}>
          <div
            style={{
              position: "absolute",
              inset: -60,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${COLORS.accentGlow} 0%, transparent 70%)`,
              transform: `scale(${1 + glowPulse * 0.6})`,
              opacity: glowPulse * 0.7,
            }}
          />
          <svg
            width="120"
            height="120"
            viewBox="0 0 1024 1024"
            style={{
              transform: `scale(${logoScale})`,
              position: "relative",
            }}
          >
            <defs>
              <linearGradient id="logo-grad" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={COLORS.accent} />
                <stop offset="100%" stopColor="#34d399" />
              </linearGradient>
            </defs>
            <g transform="translate(512,512)">
              <path
                d="M-80,400 L-80,-70 C-80,-160 -40,-240 0,-270 C40,-240 80,-160 80,-70 L80,400 Z"
                fill="url(#logo-grad)"
                transform="rotate(-45)"
              />
              <circle cx="0" cy="0" r="40" fill={COLORS.bg} stroke={COLORS.accent} strokeWidth="10" transform="rotate(-45)" />
              <circle cx="0" cy="0" r="16" fill={COLORS.accent} transform="rotate(-45)" />
              <path d="M-80,330 L-160,540 L-50,470 Z" fill="#059669" transform="rotate(-45)" />
              <path d="M80,330 L160,540 L50,470 Z" fill="#059669" transform="rotate(-45)" />
              <path d="M-46,370 Q-65,510 0,560 Q65,510 46,370 Z" fill={COLORS.amber} opacity={0.9} transform="rotate(-45)" />
              <path d="M-26,400 Q-38,480 0,520 Q38,480 26,400 Z" fill={COLORS.red} opacity={0.7} transform="rotate(-45)" />
            </g>
          </svg>
        </div>

        <div style={{ textAlign: "center" }}>
          <h1
            style={{
              fontFamily: inter,
              fontSize: 72,
              fontWeight: 800,
              color: COLORS.white,
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              margin: 0,
              opacity: titleOpacity,
              transform: `translateY(${titleY}px)`,
            }}
          >
            Deploy apps.
          </h1>
          <h1
            style={{
              fontFamily: inter,
              fontSize: 72,
              fontWeight: 800,
              color: COLORS.accent,
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              margin: 0,
              opacity: titleOpacity,
              transform: `translateY(${titleY}px)`,
              marginTop: -4,
            }}
          >
            Ship faster.
          </h1>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            opacity: subtitleOpacity,
          }}
        >
          <div
            style={{
              width: 40,
              height: 1,
              background: COLORS.border,
            }}
          />
          <span
            style={{
              fontFamily: jetbrains,
              fontSize: 16,
              color: COLORS.textMuted,
              letterSpacing: "0.05em",
            }}
          >
            Deploy · Databases · Tunnels · BYOC
          </span>
          <div
            style={{
              width: 40,
              height: 1,
              background: COLORS.border,
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
