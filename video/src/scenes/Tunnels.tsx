import React from "react";
import { useCurrentFrame, interpolate, spring, AbsoluteFill } from "remotion";
import { COLORS, inter, jetbrains } from "../constants";
import { FloatingParticles } from "../components/Particles";

export const Tunnels: React.FC<{ startFrame: number; sceneFrames: number }> = ({
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

  const contentDelay = 20;
  const contentOpacity = interpolate(
    localFrame,
    [contentDelay, contentDelay + 15],
    [0, 1],
    { extrapolateRight: "clamp" }
  );

  const tunnelProgress = interpolate(
    localFrame,
    [60, 140],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const requests: Array<{
    method: string;
    path: string;
    status: number;
    ms: number;
    delay: number;
  }> = [
    { method: "POST", path: "/api/checkout", status: 200, ms: 88, delay: 140 },
    { method: "GET", path: "/api/users?page=2", status: 200, ms: 8, delay: 170 },
    { method: "POST", path: "/webhook", status: 200, ms: 45, delay: 200 },
    { method: "GET", path: "/health", status: 200, ms: 1, delay: 230 },
    { method: "PUT", path: "/api/settings", status: 200, ms: 23, delay: 260 },
  ];

  const statusColor = (s: number) => {
    if (s < 300) return COLORS.accent;
    if (s < 400) return COLORS.blue;
    if (s < 500) return COLORS.amber;
    return COLORS.red;
  };

  const tunnelLineDraw = spring({
    frame: localFrame - 60,
    fps: 60,
    config: { damping: 15, stiffness: 60 },
  });

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
      <div style={{ position: "absolute", inset: 0, opacity: 0.3 }}>
        <FloatingParticles />
      </div>

      <div
        style={{
          transform: `translateY(${(1 - titleSpring) * 30}px)`,
          opacity: titleSpring,
          textAlign: "center",
          marginBottom: 60,
        }}
      >
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
          Localhost
          <span style={{ color: COLORS.textMuted }}> → </span>
          <span style={{ color: COLORS.accent }}>internet</span>
        </h2>
        <p
          style={{
            fontFamily: jetbrains,
            fontSize: 16,
            color: COLORS.textDim,
            margin: "12px 0 0",
          }}
        >
          $ deployzy http 3000
        </p>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 60,
          opacity: contentOpacity,
          zIndex: 1,
        }}
      >
        {/* Left: Localhost */}
        <div
          style={{
            width: 240,
            height: 200,
            borderRadius: 16,
            background: COLORS.bgCard,
            border: `1px solid ${COLORS.border}`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
          }}
        >
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="18" height="14" rx="2" stroke={COLORS.textMuted} strokeWidth="1.5" />
            <path d="M7 21h10" stroke={COLORS.textMuted} strokeWidth="1.5" />
            <path d="M12 17v4" stroke={COLORS.textMuted} strokeWidth="1.5" />
          </svg>
          <span
            style={{
              fontFamily: jetbrains,
              fontSize: 14,
              color: COLORS.textMuted,
            }}
          >
            localhost:3000
          </span>
        </div>

        {/* Tunnel connection line */}
        <div style={{ position: "relative", width: 160, height: 4 }}>
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              height: 4,
              width: `${tunnelLineDraw * 100}%`,
              background: COLORS.accent,
              borderRadius: 2,
              boxShadow: `0 0 12px ${COLORS.accent}`,
            }}
          />
          {/* Animated dots on the line */}
          {[0.2, 0.5, 0.8].map((pos, i) => {
            const dotOffset =
              ((localFrame * 3 + i * 60) % 160);
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  top: 0,
                  left: dotOffset,
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: COLORS.accent,
                  opacity: tunnelLineDraw * 0.8,
                  boxShadow: `0 0 6px ${COLORS.accent}`,
                }}
              />
            );
          })}
        </div>

        {/* Right: Internet / globe */}
        <div
          style={{
            width: 240,
            height: 200,
            borderRadius: 16,
            background: COLORS.bgCard,
            border: `1px solid ${COLORS.accent}`,
            boxShadow: `0 0 30px ${COLORS.accentGlow}`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
          }}
        >
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke={COLORS.accent} strokeWidth="1.5" />
            <ellipse cx="12" cy="12" rx="4" ry="9" stroke={COLORS.accent} strokeWidth="1" />
            <path d="M3 12h18" stroke={COLORS.accent} strokeWidth="1" />
            <path d="M12 3v18" stroke={COLORS.accent} strokeWidth="1" />
          </svg>
          <span
            style={{
              fontFamily: jetbrains,
              fontSize: 14,
              color: COLORS.accent,
            }}
          >
            app.deployzy.com
          </span>
        </div>
      </div>

      {/* Request inspector */}
      {tunnelProgress > 0.3 && (
        <div
          style={{
            marginTop: 50,
            width: 580,
            background: COLORS.bgTerminal,
            borderRadius: 10,
            border: `1px solid ${COLORS.border}`,
            overflow: "hidden",
            opacity: tunnelProgress,
          }}
        >
          <div
            style={{
              padding: "8px 14px",
              fontSize: 11,
              fontFamily: jetbrains,
              color: COLORS.textDim,
              borderBottom: `1px solid ${COLORS.border}`,
              background: COLORS.bgCard,
            }}
          >
            inspector · live
          </div>
          {requests.map((req, i) => {
            const show = localFrame > req.delay;
            if (!show) return null;
            const rowOpacity = interpolate(
              localFrame,
              [req.delay, req.delay + 8],
              [0, 1],
              { extrapolateRight: "clamp" }
            );
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "6px 14px",
                  gap: 12,
                  fontFamily: jetbrains,
                  fontSize: 12,
                  opacity: rowOpacity,
                  borderBottom: `1px solid ${COLORS.border}22`,
                }}
              >
                <span
                  style={{
                    color:
                      req.method === "POST"
                        ? COLORS.amber
                        : req.method === "PUT"
                        ? COLORS.blue
                        : COLORS.accent,
                    fontWeight: 600,
                    minWidth: 36,
                  }}
                >
                  {req.method}
                </span>
                <span style={{ color: COLORS.text }}>{req.path}</span>
                <span style={{ marginLeft: "auto", color: statusColor(req.status), minWidth: 28 }}>
                  {req.status}
                </span>
                <span style={{ color: COLORS.textDim, minWidth: 36, textAlign: "right" }}>
                  {req.ms}ms
                </span>
              </div>
            );
          })}
        </div>
      )}
    </AbsoluteFill>
  );
};
