import React from "react";
import { useCurrentFrame, interpolate, spring, AbsoluteFill } from "remotion";
import { COLORS, inter, jetbrains } from "../constants";
import { FloatingParticles } from "../components/Particles";

const commands = [
  { text: "npm i -g deployzy", prefix: "$", delay: 20 },
  { text: "brew install deployzy", prefix: "$", delay: 50 },
  { text: "deployzy http 3000", prefix: "$", delay: 80 },
  { text: "deployzy deploy --repo jams24/api", prefix: "$", delay: 110 },
  { text: "deployzy servers add my-vps", prefix: "$", delay: 140 },
  { text: "deployzy logs my-saas -f", prefix: "$", delay: 170 },
];

const sdks = [
  { name: "npm i deployzy-sdk", lang: "JavaScript" },
  { name: "pip install deployzy", lang: "Python" },
  { name: "go get deployzy", lang: "Go" },
];

export const CLI: React.FC<{ startFrame: number; sceneFrames: number }> = ({
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

  const titleSpring = spring({
    frame: localFrame,
    fps: 60,
    config: { damping: 12, stiffness: 100 },
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
          display: "flex",
          alignItems: "center",
          gap: 80,
          zIndex: 1,
        }}
      >
        {/* Left: Title + commands */}
        <div
          style={{
            transform: `translateX(${(1 - titleSpring) * -40}px)`,
            opacity: titleSpring,
          }}
        >
          <div style={{ marginBottom: 36 }}>
            <h2
              style={{
                fontFamily: inter,
                fontSize: 44,
                fontWeight: 800,
                color: COLORS.white,
                lineHeight: 1.2,
                letterSpacing: "-0.03em",
                margin: 0,
              }}
            >
              One command.
            </h2>
            <h2
              style={{
                fontFamily: inter,
                fontSize: 44,
                fontWeight: 800,
                color: COLORS.accent,
                lineHeight: 1.2,
                letterSpacing: "-0.03em",
                margin: 0,
              }}
            >
              Any workflow.
            </h2>
          </div>

          {/* Terminal with commands */}
          <div
            style={{
              width: 440,
              padding: "20px 24px",
              borderRadius: 12,
              background: COLORS.bgTerminal,
              border: `1px solid ${COLORS.border}`,
            }}
          >
            {commands.map((cmd, i) => {
              const showFrame = cmd.delay;
              const cmdOpacity = interpolate(
                localFrame,
                [showFrame, showFrame + 6],
                [0, 1],
                { extrapolateRight: "clamp" }
              );
              if (localFrame < showFrame) return null;
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 10,
                    fontFamily: jetbrains,
                    fontSize: 14,
                    lineHeight: 2,
                    opacity: cmdOpacity,
                  }}
                >
                  <span style={{ color: COLORS.accent, flexShrink: 0 }}>{cmd.prefix}</span>
                  <span style={{ color: COLORS.text }}>{cmd.text}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: SDKs + stacks */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
            opacity: interpolate(localFrame, [30, 45], [0, 1], {
              extrapolateRight: "clamp",
            }),
          }}
        >
          <span
            style={{
              fontFamily: inter,
              fontSize: 18,
              fontWeight: 700,
              color: COLORS.textMuted,
            }}
          >
            SDKs &amp; integrations
          </span>
          {sdks.map((sdk, i) => {
            const showFrame = 40 + i * 25;
            const sdkOpacity = interpolate(
              localFrame,
              [showFrame, showFrame + 10],
              [0, 1],
              { extrapolateRight: "clamp" }
            );
            const sdkScale =
              localFrame > showFrame
                ? spring({
                    frame: localFrame - showFrame,
                    fps: 60,
                    config: { damping: 10, stiffness: 120 },
                  }) *
                    0.1 +
                  0.9
                : 0.9;

            return (
              <div
                key={sdk.lang}
                style={{
                  padding: "16px 24px",
                  borderRadius: 12,
                  background: COLORS.bgCard,
                  border: `1px solid ${COLORS.border}`,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  opacity: sdkOpacity,
                  transform: `scale(${sdkScale})`,
                  minWidth: 240,
                }}
              >
                <span
                  style={{
                    fontFamily: inter,
                    fontSize: 12,
                    fontWeight: 600,
                    color: COLORS.textDim,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {sdk.lang}
                </span>
                <span
                  style={{
                    fontFamily: jetbrains,
                    fontSize: 15,
                    color: COLORS.accent,
                  }}
                >
                  {sdk.name}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
