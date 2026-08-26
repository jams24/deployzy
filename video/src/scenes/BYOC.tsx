import React from "react";
import { useCurrentFrame, interpolate, spring, AbsoluteFill } from "remotion";
import { COLORS, inter, jetbrains } from "../constants";
import { FloatingParticles } from "../components/Particles";
import { GlowBorder } from "../components/UI";

export const BYOC: React.FC<{ startFrame: number; sceneFrames: number }> = ({
  startFrame,
  sceneFrames,
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame - startFrame;
  const endFrame = sceneFrames;

  if (localFrame < 0 || localFrame >= endFrame) return null;

  const fadeOut = localFrame > endFrame - 20;
  const opacity = fadeOut
    ? interpolate(localFrame, [endFrame - 20, endFrame], [1, 0], {
        extrapolateRight: "clamp",
      })
    : 1;

  const titleSlide = spring({
    frame: localFrame,
    fps: 60,
    config: { damping: 12, stiffness: 100 },
  });

  const cmdDelay = 30;
  const cmdOpacity = interpolate(
    localFrame,
    [cmdDelay, cmdDelay + 12],
    [0, 1],
    { extrapolateRight: "clamp" }
  );

  const probeDelay = 100;
  const probeOpacity = interpolate(
    localFrame,
    [probeDelay, probeDelay + 10],
    [0, 1],
    { extrapolateRight: "clamp" }
  );

  const scaleDelay = 180;
  const scaleOpacity = interpolate(
    localFrame,
    [scaleDelay, scaleDelay + 15],
    [0, 1],
    { extrapolateRight: "clamp" }
  );

  const scaleProgress = interpolate(
    localFrame,
    [scaleDelay + 10, scaleDelay + 70],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const uncappedPulse = spring({
    frame: localFrame - scaleDelay - 70,
    fps: 60,
    config: { damping: 20, stiffness: 40 },
  });

  return (
    <AbsoluteFill
      style={{
        background: COLORS.bg,
        opacity,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", inset: 0, opacity: 0.3 }}>
        <FloatingParticles />
      </div>

      <div
        style={{
          transform: `translateX(${(1 - titleSlide) * -60}px)`,
          opacity: titleSlide,
          display: "flex",
          flexDirection: "column",
          gap: 48,
          zIndex: 1,
        }}
      >
        <div>
          <h2
            style={{
              fontFamily: inter,
              fontSize: 48,
              fontWeight: 800,
              color: COLORS.white,
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              margin: 0,
            }}
          >
            Your hardware.
          </h2>
          <h2
            style={{
              fontFamily: inter,
              fontSize: 48,
              fontWeight: 800,
              color: COLORS.accent,
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              margin: 0,
            }}
          >
            Uncapped power.
          </h2>
        </div>

        {/* Terminal command */}
        <div
          style={{
            padding: "16px 28px",
            borderRadius: 10,
            background: COLORS.bgTerminal,
            border: `1px solid ${COLORS.border}`,
            fontFamily: jetbrains,
            fontSize: 16,
            color: COLORS.accent,
            opacity: cmdOpacity,
            maxWidth: 600,
          }}
        >
          $ deployzy servers add my-vps --host 5.9.x.x
        </div>

        {/* Probe results */}
        <div
          style={{
            display: "flex",
            gap: 24,
            opacity: probeOpacity,
          }}
        >
          {[
            { label: "8 vCPU", icon: "⚡" },
            { label: "32 GB RAM", icon: "🧠" },
            { label: "Docker", icon: "🐳" },
            { label: "Ready", icon: "✓", accent: true },
          ].map((spec, i) => {
            const specDelay = probeDelay + i * 12;
            const specOpacity = interpolate(
              localFrame,
              [specDelay, specDelay + 8],
              [0, 1],
              { extrapolateRight: "clamp" }
            );
            return (
              <div
                key={spec.label}
                style={{
                  padding: "14px 24px",
                  borderRadius: 12,
                  background: COLORS.bgCard,
                  border: `1px solid ${spec.accent ? COLORS.accent : COLORS.border}`,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  opacity: specOpacity,
                  boxShadow: spec.accent
                    ? `0 0 20px ${COLORS.accentGlow}`
                    : "none",
                }}
              >
                <span style={{ fontSize: 18 }}>{spec.icon}</span>
                <span
                  style={{
                    fontFamily: inter,
                    fontSize: 16,
                    fontWeight: 700,
                    color: spec.accent ? COLORS.accent : COLORS.text,
                  }}
                >
                  {spec.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Scale comparison */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 40,
            opacity: scaleOpacity,
          }}
        >
          {/* Shared (platform) */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              opacity: 1 - scaleProgress * 0.7,
            }}
          >
            <div
              style={{
                width: 80,
                height: 80,
                borderRadius: 16,
                background: COLORS.bgCard,
                border: `1px solid ${COLORS.border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span
                style={{
                  fontFamily: inter,
                  fontSize: 13,
                  fontWeight: 600,
                  color: COLORS.textDim,
                  textAlign: "center",
                }}
              >
                platform
                <br />
                shared
              </span>
            </div>
            <span
              style={{
                fontFamily: jetbrains,
                fontSize: 11,
                color: COLORS.textDim,
              }}
            >
              0.5 vCPU
            </span>
          </div>

          {/* Scale bar */}
          <div
            style={{
              position: "relative",
              width: 300,
              height: 6,
              borderRadius: 3,
              background: COLORS.border,
              overflow: "visible",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                height: 6,
                borderRadius: 3,
                width: `${20 + scaleProgress * 80}%`,
                background: `linear-gradient(90deg, ${COLORS.textDim}, ${COLORS.accent})`,
              }}
            />
            <div
              style={{
                position: "absolute",
                top: -8,
                left: `${20 + scaleProgress * 80}%`,
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: COLORS.accent,
                boxShadow: `0 0 16px ${COLORS.accent}`,
                transform: "translateX(-50%)",
              }}
            />
          </div>

          {/* Uncapped (your VPS) */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              opacity: 0.3 + scaleProgress * 0.7,
              transform: `scale(${0.8 + scaleProgress * 0.2})`,
            }}
          >
            <GlowBorder glowColor={COLORS.accentGlow}>
              <div
                style={{
                  width: 100,
                  height: 100,
                  borderRadius: 16,
                  background: COLORS.bgCard,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span
                  style={{
                    fontFamily: inter,
                    fontSize: 16,
                    fontWeight: 800,
                    color: COLORS.accent,
                    textAlign: "center",
                  }}
                >
                  my-vps
                  <br />
                  <span style={{ fontSize: 12, color: COLORS.green }}>
                    uncapped
                  </span>
                </span>
              </div>
            </GlowBorder>
            <span
              style={{
                fontFamily: jetbrains,
                fontSize: 14,
                fontWeight: 800,
                color: COLORS.accent,
                textShadow: `0 0 20px ${COLORS.accent}`,
              }}
            >
              ∞ resources
            </span>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
