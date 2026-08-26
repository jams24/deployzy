import React from "react";
import { useCurrentFrame, interpolate, spring, AbsoluteFill } from "remotion";
import { COLORS, inter, jetbrains } from "../constants";
import { DotGrid } from "../components/Particles";

export const Outro: React.FC<{ startFrame: number; sceneFrames: number }> = ({
  startFrame,
  sceneFrames,
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame - startFrame;
  const endFrame = sceneFrames;

  if (localFrame < 0 || localFrame >= endFrame) return null;

  const opacity = interpolate(
    localFrame,
    [0, 15],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const mainSpring = spring({
    frame: localFrame,
    fps: 60,
    config: { damping: 10, stiffness: 100, mass: 0.9 },
  });

  const ctaSpring = spring({
    frame: localFrame - 40,
    fps: 60,
    config: { damping: 12, stiffness: 100 },
  });

  const urlSpring = spring({
    frame: localFrame - 60,
    fps: 60,
    config: { damping: 10, stiffness: 120 },
  });

  const ctaGlow = spring({
    frame: localFrame - 80,
    fps: 60,
    config: { damping: 20, stiffness: 40 },
  });

  const footerOpacity = interpolate(
    localFrame,
    [80, 110],
    [0, 1],
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
      <div style={{ position: "absolute", inset: 0, opacity: 0.5 }}>
        <DotGrid />
      </div>

      {/* Background glow */}
      <div
        style={{
          position: "absolute",
          width: 800,
          height: 800,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${COLORS.accentGlow} 0%, transparent 70%)`,
          opacity: 0.15 + ctaGlow * 0.15,
          filter: "blur(60px)",
          transform: `scale(${1 + ctaGlow * 0.5})`,
        }}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 48,
          zIndex: 1,
        }}
      >
        {/* Logo + tagline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 24,
            transform: `scale(${mainSpring * 0.1 + 0.9})`,
            opacity: mainSpring,
          }}
        >
          <div style={{ position: "relative" }}>
            <div
              style={{
                position: "absolute",
                inset: -30,
                borderRadius: "50%",
                background: `radial-gradient(circle, ${COLORS.accentGlow} 0%, transparent 70%)`,
              }}
            />
            <svg width="70" height="70" viewBox="0 0 1024 1024">
              <defs>
                <linearGradient id="outro-grad" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={COLORS.accent} />
                  <stop offset="100%" stopColor="#34d399" />
                </linearGradient>
              </defs>
              <g transform="translate(512,512)">
                <path d="M-60,300 L-60,-50 C-60,-120 -30,-180 0,-200 C30,-180 60,-120 60,-50 L60,300 Z" fill="url(#outro-grad)" transform="rotate(-45)" />
                <circle cx="0" cy="0" r="30" fill={COLORS.bg} stroke={COLORS.accent} strokeWidth="8" transform="rotate(-45)" />
                <circle cx="0" cy="0" r="12" fill={COLORS.accent} transform="rotate(-45)" />
                <path d="M-60,250 L-120,400 L-40,350 Z" fill="#059669" transform="rotate(-45)" />
                <path d="M60,250 L120,400 L40,350 Z" fill="#059669" transform="rotate(-45)" />
                <path d="M-35,280 Q-50,380 0,420 Q50,380 35,280 Z" fill={COLORS.amber} opacity={0.9} transform="rotate(-45)" />
                <path d="M-20,300 Q-30,360 0,390 Q30,360 20,300 Z" fill={COLORS.red} opacity={0.7} transform="rotate(-45)" />
              </g>
            </svg>
          </div>

          <h1
            style={{
              fontFamily: inter,
              fontSize: 56,
              fontWeight: 800,
              color: COLORS.white,
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              margin: 0,
              textAlign: "center",
            }}
          >
            Ship your first project
            <br />
            <span style={{ color: COLORS.accent }}>in 30 seconds</span>
          </h1>
        </div>

        {/* CTA button */}
        <div
          style={{
            position: "relative",
            transform: `scale(${ctaSpring * 0.1 + 0.9})`,
            opacity: ctaSpring,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: -4,
              borderRadius: 16,
              background: COLORS.accent,
              opacity: 0.3,
              filter: `blur(20px)`,
              transform: `scale(${1 + ctaGlow * 0.3})`,
            }}
          />
          <div
            style={{
              padding: "18px 48px",
              borderRadius: 14,
              background: COLORS.accent,
              color: COLORS.bg,
              fontFamily: inter,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              position: "relative",
            }}
          >
            deployzy.com
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            textAlign: "center",
            opacity: footerOpacity,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            marginTop: 20,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 20,
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontFamily: jetbrains,
                fontSize: 15,
                color: COLORS.textMuted,
              }}
            >
              Free tier
            </span>
            <div style={{ width: 4, height: 4, borderRadius: "50%", background: COLORS.border }} />
            <span
              style={{
                fontFamily: jetbrains,
                fontSize: 15,
                color: COLORS.textMuted,
              }}
            >
              No credit card
            </span>
            <div style={{ width: 4, height: 4, borderRadius: "50%", background: COLORS.border }} />
            <span
              style={{
                fontFamily: jetbrains,
                fontSize: 15,
                color: COLORS.textMuted,
              }}
            >
              MIT license
            </span>
          </div>
          <span
            style={{
              fontFamily: inter,
              fontSize: 13,
              color: COLORS.textDim,
              marginTop: 8,
            }}
          >
            Made with care for the developer community
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
