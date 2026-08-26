import React from "react";
import { useCurrentFrame, spring, interpolate, AbsoluteFill } from "remotion";
import { COLORS, inter } from "../constants";
import { FloatingParticles } from "../components/Particles";

const tools = [
  { name: "Vercel", color: "#000" },
  { name: "Railway", color: "#8b5cf6" },
  { name: "ngrok", color: "#3b82f6" },
  { name: "Supabase", color: "#22c55e" },
  { name: "VPS", color: "#f59e0b" },
];

const pillars = [
  { label: "Deploy", value: "git push → live" },
  { label: "Tunnels", value: "localhost → web" },
  { label: "Databases", value: "managed & auto" },
  { label: "BYOC", value: "your VPS, uncapped" },
];

export const ProblemSolution: React.FC<{
  startFrame: number;
  sceneFrames: number;
}> = ({ startFrame, sceneFrames }) => {
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
      <div style={{ position: "absolute", inset: 0, opacity: 0.4 }}>
        <FloatingParticles />
      </div>

      {/* Phase 1: The problem - 5 tools */}
      {localFrame < 180 && (
        <>
          <h2
            style={{
              fontFamily: inter,
              fontSize: 44,
              fontWeight: 800,
              color: COLORS.white,
              textAlign: "center",
              margin: 0,
              letterSpacing: "-0.03em",
              opacity: interpolate(localFrame, [0, 15], [0, 1], {
                extrapolateRight: "clamp",
              }),
            }}
          >
            Your backend is
            <br />
            <span style={{ color: COLORS.textMuted }}>
              five different tools
            </span>
          </h2>

          <div
            style={{
              display: "flex",
              gap: 20,
              marginTop: 60,
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            {tools.map((tool, i) => {
              const delay = 40 + i * 25;
              const toolOpacity =
                localFrame < 160
                  ? interpolate(localFrame, [delay, delay + 10], [0, 1], {
                      extrapolateRight: "clamp",
                    })
                  : interpolate(localFrame, [160, 180], [1, 0], {
                      extrapolateRight: "clamp",
                    });

              const y =
                localFrame < 160
                  ? spring({
                      frame: localFrame - delay,
                      fps: 60,
                      config: { damping: 12, stiffness: 100 },
                    }) * 30 - 30
                  : 0;

              return (
                <div
                  key={tool.name}
                  style={{
                    padding: "12px 28px",
                    borderRadius: 12,
                    border: `1px solid ${COLORS.border}`,
                    background: COLORS.bgCard,
                    fontFamily: inter,
                    fontSize: 18,
                    fontWeight: 600,
                    color: COLORS.text,
                    opacity: toolOpacity,
                    transform: `translateY(${y}px)`,
                  }}
                >
                  {tool.name}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Phase 2: Transition - "One platform" */}
      {localFrame >= 160 && localFrame < 220 && (
        <h2
          style={{
            fontFamily: inter,
            fontSize: 56,
            fontWeight: 800,
            color: COLORS.accent,
            textAlign: "center",
            margin: 0,
            letterSpacing: "-0.03em",
            opacity: interpolate(localFrame, [160, 180], [0, 1], {
              extrapolateRight: "clamp",
            }),
            transform: `scale(${spring({
              frame: localFrame - 160,
              fps: 60,
              config: { damping: 10, stiffness: 120 },
            }) * 0.3 + 0.7})`,
          }}
        >
          One platform.
        </h2>
      )}

      {/* Phase 3: The 4 pillars */}
      {localFrame >= 210 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 50,
          }}
        >
          <h2
            style={{
              fontFamily: inter,
              fontSize: 40,
              fontWeight: 800,
              color: COLORS.white,
              textAlign: "center",
              margin: 0,
              letterSpacing: "-0.03em",
              opacity: interpolate(localFrame, [210, 225], [0, 1], {
                extrapolateRight: "clamp",
              }),
            }}
          >
            Four things, one platform
          </h2>

          <div
            style={{
              display: "flex",
              gap: 32,
              justifyContent: "center",
            }}
          >
            {pillars.map((pillar, i) => {
              const delay = 230 + i * 20;
              const pOpacity = interpolate(
                localFrame,
                [delay, delay + 12],
                [0, 1],
                { extrapolateRight: "clamp" }
              );
              const pScale = spring({
                frame: localFrame - delay,
                fps: 60,
                config: { damping: 10, stiffness: 120 },
              });

              return (
                <div
                  key={pillar.label}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 16,
                    opacity: pOpacity,
                    transform: `scale(${pScale * 0.15 + 0.85})`,
                  }}
                >
                  <div
                    style={{
                      width: 160,
                      height: 120,
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
                        fontSize: 18,
                        fontWeight: 800,
                        color: COLORS.accent,
                      }}
                    >
                      {pillar.label}
                    </span>
                  </div>
                  <span
                    style={{
                      fontFamily: inter,
                      fontSize: 13,
                      color: COLORS.textMuted,
                      textAlign: "center",
                    }}
                  >
                    {pillar.value}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
