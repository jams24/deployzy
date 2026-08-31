import React from "react";
import { useCurrentFrame, interpolate, spring, AbsoluteFill } from "remotion";
import { COLORS, inter, jetbrains } from "../constants";
import { DeployTerminal, LiveIndicator } from "../components/Terminal";
import { MetricCircle } from "../components/UI";
import { FloatingParticles } from "../components/Particles";

export const Deploy: React.FC<{ startFrame: number; sceneFrames: number }> = ({
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

  const terminalDelay = 30;
  const terminalOpacity = interpolate(
    localFrame,
    [terminalDelay, terminalDelay + 10],
    [0, 1],
    { extrapolateRight: "clamp" }
  );

  const metricsDelay = 470;
  const metricsOpacity = interpolate(
    localFrame,
    [metricsDelay, metricsDelay + 15],
    [0, 1],
    { extrapolateRight: "clamp" }
  );

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
        {/* Left: Title + metrics */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 40,
            alignItems: "flex-start",
            transform: `translateX(${(1 - titleSlide) * -60}px)`,
            opacity: titleSlide,
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
              git push
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
              → live in 30s
            </h2>
          </div>

          <div style={{ display: "flex", gap: 24 }}>
            <LiveIndicator show={localFrame > 60} />
          </div>

          <div
            style={{
              display: "flex",
              gap: 32,
              opacity: metricsOpacity,
            }}
          >
            <MetricCircle value="<30s" label="git push → live" />
            <MetricCircle value="0" label="cold starts" />
            <MetricCircle value="100%" label="uptime" color={COLORS.green} />
          </div>
        </div>

        {/* Right: Terminal */}
        <div style={{ opacity: terminalOpacity }}>
          <DeployTerminal startFrame={startFrame + terminalDelay} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
