import React from "react";
import { useCurrentFrame, interpolate, spring } from "remotion";
import { COLORS, inter, jetbrains } from "../constants";

export const LogoReveal: React.FC<{
  delay?: number;
  showTagline?: boolean;
}> = ({ delay = 0, showTagline = true }) => {
  const frame = useCurrentFrame();

  const logoScale = spring({
    frame: frame - delay,
    fps: 60,
    config: { damping: 12, stiffness: 120, mass: 0.8 },
  });

  const logoOpacity = interpolate(
    frame,
    [delay, delay + 8],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const taglineOpacity = interpolate(
    frame,
    [delay + 15, delay + 30],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const taglineY = interpolate(
    frame,
    [delay + 15, delay + 30],
    [20, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const glowScale = spring({
    frame: frame - delay - 5,
    fps: 60,
    config: { damping: 20, stiffness: 60 },
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 24,
      }}
    >
      <div style={{ position: "relative" }}>
        <div
          style={{
            position: "absolute",
            inset: -40,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${COLORS.accentGlow} 0%, transparent 70%)`,
            transform: `scale(${1 + glowScale * 0.5})`,
            opacity: glowScale * 0.6,
          }}
        />
        <svg
          width="80"
          height="80"
          viewBox="0 0 1024 1024"
          style={{
            transform: `scale(${logoScale})`,
            opacity: logoOpacity,
            position: "relative",
          }}
        >
          <defs>
            <linearGradient id="rocket-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={COLORS.accent} />
              <stop offset="100%" stopColor="#059669" />
            </linearGradient>
          </defs>
          <g transform="translate(512,512)">
            {/* Rocket body */}
            <path
              d="M-60,300 L-60,-50 C-60,-120 -30,-180 0,-200 C30,-180 60,-120 60,-50 L60,300 Z"
              fill="url(#rocket-grad)"
              transform="rotate(-45)"
            />
            {/* Window */}
            <circle cx="0" cy="0" r="30" fill={COLORS.bg} stroke={COLORS.accent} strokeWidth="8" transform="rotate(-45)" />
            <circle cx="0" cy="0" r="12" fill={COLORS.accent} transform="rotate(-45)" />
            {/* Fins */}
            <path
              d="M-60,250 L-120,400 L-40,350 Z"
              fill="#059669"
              transform="rotate(-45)"
            />
            <path
              d="M60,250 L120,400 L40,350 Z"
              fill="#059669"
              transform="rotate(-45)"
            />
            {/* Flame */}
            <path
              d="M-35,280 Q-50,380 0,420 Q50,380 35,280 Z"
              fill={COLORS.amber}
              opacity={0.9}
              transform="rotate(-45)"
            />
            <path
              d="M-20,300 Q-30,360 0,390 Q30,360 20,300 Z"
              fill={COLORS.red}
              opacity={0.7}
              transform="rotate(-45)"
            />
          </g>
        </svg>
      </div>

      {showTagline && (
        <div style={{ textAlign: "center" }}>
          <h1
            style={{
              fontFamily: inter,
              fontSize: 56,
              fontWeight: 800,
              color: COLORS.white,
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              margin: 0,
              opacity: taglineOpacity,
              transform: `translateY(${taglineY}px)`,
            }}
          >
            Deploy apps.
            <br />
            <span style={{ color: COLORS.accent }}>Ship faster.</span>
          </h1>
        </div>
      )}
    </div>
  );
};

export const SmallLogo: React.FC<{ size?: number }> = ({ size = 40 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 1024 1024"
    style={{ flexShrink: 0 }}
  >
    <defs>
      <linearGradient id={`rocket-sm-${size}`} x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor={COLORS.accent} />
        <stop offset="100%" stopColor="#059669" />
      </linearGradient>
    </defs>
    <g transform="translate(512,512)">
      <path
        d="M-45,225 L-45,-37 C-45,-90 -22,-135 0,-150 C22,-135 45,-90 45,-37 L45,225 Z"
        fill={`url(#rocket-sm-${size})`}
        transform="rotate(-45)"
      />
      <circle cx="0" cy="0" r="22" fill={COLORS.bg} stroke={COLORS.accent} strokeWidth="6" transform="rotate(-45)" />
      <circle cx="0" cy="0" r="9" fill={COLORS.accent} transform="rotate(-45)" />
      <path d="M-45,188 L-90,300 L-30,263 Z" fill="#059669" transform="rotate(-45)" />
      <path d="M45,188 L90,300 L30,263 Z" fill="#059669" transform="rotate(-45)" />
      <path d="M-26,210 Q-37,285 0,315 Q37,285 26,210 Z" fill={COLORS.amber} opacity={0.9} transform="rotate(-45)" />
      <path d="M-15,225 Q-22,270 0,293 Q22,270 15,225 Z" fill={COLORS.red} opacity={0.7} transform="rotate(-45)" />
    </g>
  </svg>
);
