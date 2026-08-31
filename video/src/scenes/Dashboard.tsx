import React from "react";
import { useCurrentFrame, interpolate, spring, AbsoluteFill } from "remotion";
import { COLORS, inter, jetbrains } from "../constants";
import { FloatingParticles } from "../components/Particles";

export const Dashboard: React.FC<{
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

  const titleSlide = spring({
    frame: localFrame,
    fps: 60,
    config: { damping: 12, stiffness: 100 },
  });

  const dashDelay = 20;
  const dashOpacity = interpolate(
    localFrame,
    [dashDelay, dashDelay + 15],
    [0, 1],
    { extrapolateRight: "clamp" }
  );

  const projects = [
    { name: "my-saas", stack: "Next.js", status: "running", url: "my-saas.deployzy.com" },
    { name: "api", stack: "Node", status: "running", url: "api.deployzy.com" },
    { name: "analytics", stack: "Python", status: "building", url: "analytics.deployzy.com" },
  ];

  const metrics = [
    { label: "CPU", value: "23%", width: 23 },
    { label: "Memory", value: "412 MB", width: 52 },
    { label: "Network", value: "1.2 MB/s", width: 12 },
  ];

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
          flexDirection: "column",
          alignItems: "center",
          gap: 40,
          zIndex: 1,
        }}
      >
        <div
          style={{
            transform: `translateY(${(1 - titleSlide) * 20}px)`,
            opacity: titleSlide,
            textAlign: "center",
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
            Everything in
            <span style={{ color: COLORS.accent }}> one tab</span>
          </h2>
          <p
            style={{
              fontFamily: inter,
              fontSize: 18,
              color: COLORS.textMuted,
              margin: "8px 0 0",
              fontWeight: 400,
            }}
          >
            No Grafana. No Datadog. No five-tool stack.
          </p>
        </div>

        {/* Dashboard mockup */}
        <div
          style={{
            width: 800,
            height: 380,
            borderRadius: 16,
            background: COLORS.bgCard,
            border: `1px solid ${COLORS.border}`,
            overflow: "hidden",
            opacity: dashOpacity,
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 24px",
              borderBottom: `1px solid ${COLORS.border}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="20" height="20" viewBox="0 0 1024 1024">
                <g transform="translate(512,512) scale(0.14)">
                  <path d="M-60,300 L-60,-50 C-60,-120 -30,-180 0,-200 C30,-180 60,-120 60,-50 L60,300 Z" fill={COLORS.accent} transform="rotate(-45)" />
                </g>
              </svg>
              <span style={{ fontFamily: inter, fontSize: 16, fontWeight: 700, color: COLORS.white }}>
                Deployzy
              </span>
            </div>
            <div style={{ display: "flex", gap: 16 }}>
              {["Overview", "Projects", "Tunnels", "Analytics"].map((tab) => (
                <span
                  key={tab}
                  style={{
                    fontFamily: inter,
                    fontSize: 13,
                    fontWeight: 600,
                    color: tab === "Projects" ? COLORS.white : COLORS.textDim,
                    borderBottom: tab === "Projects" ? `2px solid ${COLORS.accent}` : "2px solid transparent",
                    paddingBottom: 4,
                  }}
                >
                  {tab}
                </span>
              ))}
            </div>
          </div>

          {/* Content */}
          <div style={{ padding: 20, display: "flex", gap: 20 }}>
            {/* Projects list */}
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ fontFamily: inter, fontSize: 14, fontWeight: 700, color: COLORS.white }}>
                  Projects
                </span>
                <span style={{ fontFamily: jetbrains, fontSize: 11, color: COLORS.textDim }}>
                  3 running · 1 building
                </span>
              </div>
              {projects.map((p, i) => {
                const showFrame = dashDelay + 20 + i * 25;
                const projOpacity = interpolate(
                  localFrame,
                  [showFrame, showFrame + 10],
                  [0, 1],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
                );
                if (localFrame < showFrame) return null;
                return (
                  <div
                    key={p.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "10px 14px",
                      borderRadius: 10,
                      background: COLORS.bg,
                      border: `1px solid ${COLORS.border}`,
                      opacity: projOpacity,
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: inter, fontSize: 14, fontWeight: 600, color: COLORS.white }}>
                        {p.name}
                      </div>
                      <div style={{ fontFamily: jetbrains, fontSize: 11, color: COLORS.textDim, marginTop: 2 }}>
                        {p.url}
                      </div>
                    </div>
                    <span style={{ fontFamily: inter, fontSize: 11, fontWeight: 600, color: COLORS.textMuted }}>
                      {p.stack}
                    </span>
                    <div
                      style={{
                        marginLeft: 12,
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: p.status === "running" ? COLORS.accent : COLORS.amber,
                        boxShadow: `0 0 6px ${p.status === "running" ? COLORS.accent : COLORS.amber}`,
                      }}
                    />
                  </div>
                );
              })}
            </div>

            {/* Metrics panel */}
            <div
              style={{
                width: 240,
                display: "flex",
                flexDirection: "column",
                gap: 16,
                opacity: interpolate(localFrame, [dashDelay + 30, dashDelay + 50], [0, 1], {
                  extrapolateRight: "clamp",
                }),
              }}
            >
              <span style={{ fontFamily: inter, fontSize: 14, fontWeight: 700, color: COLORS.white }}>
                my-saas · metrics
              </span>
              {metrics.map((m, i) => {
                const barProgress = interpolate(
                  localFrame,
                  [dashDelay + 40 + i * 15, dashDelay + 60 + i * 15],
                  [0, m.width],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
                );
                return (
                  <div key={m.label}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: 6,
                      }}
                    >
                      <span style={{ fontFamily: jetbrains, fontSize: 11, color: COLORS.textDim }}>
                        {m.label}
                      </span>
                      <span style={{ fontFamily: jetbrains, fontSize: 11, color: COLORS.text }}>
                        {m.value}
                      </span>
                    </div>
                    <div
                      style={{
                        height: 6,
                        borderRadius: 3,
                        background: COLORS.bg,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${barProgress}%`,
                          borderRadius: 3,
                          background: m.label === "Network" ? COLORS.blue : COLORS.accent,
                        }}
                      />
                    </div>
                  </div>
                );
              })}

              {/* Logs preview */}
              <div
                style={{
                  marginTop: 4,
                  padding: 10,
                  borderRadius: 8,
                  background: COLORS.bg,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                {[
                  { text: "12:04:31 GET /api/orders 200 24ms", color: COLORS.text },
                  { text: "12:04:31 GET /health 200 3ms", color: COLORS.textDim },
                  { text: "12:04:30 POST /webhook 200 88ms", color: COLORS.text },
                ].map((log, i) => (
                  <div
                    key={i}
                    style={{
                      fontFamily: jetbrains,
                      fontSize: 10,
                      color: log.color,
                      lineHeight: 1.8,
                      opacity: interpolate(
                        localFrame,
                        [dashDelay + 70 + i * 12, dashDelay + 80 + i * 12],
                        [0, 1],
                        { extrapolateRight: "clamp" }
                      ),
                    }}
                  >
                    {log.text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
