import React from "react";
import { useCurrentFrame, interpolate, spring, AbsoluteFill } from "remotion";
import { COLORS, inter, jetbrains } from "../constants";
import { FloatingParticles } from "../components/Particles";

const dbs = [
  { name: "PostgreSQL", icon: "🐘", color: "#336791", x: 0, y: -100 },
  { name: "Redis", icon: "⬆", color: "#DC382D", x: 140, y: -40 },
  { name: "MySQL", icon: "🐬", color: "#00758F", x: -140, y: -40 },
  { name: "MongoDB", icon: "🍃", color: "#47A248", x: 0, y: 60 },
];

export const Databases: React.FC<{
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

  const titleSpring = spring({
    frame: localFrame,
    fps: 60,
    config: { damping: 12, stiffness: 100 },
  });

  const centerPulse = spring({
    frame: localFrame - 30,
    fps: 60,
    config: { damping: 20, stiffness: 40 },
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
          zIndex: 1,
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
          Managed
          <span style={{ color: COLORS.accent }}> databases</span>
        </h2>
        <p
          style={{
            fontFamily: inter,
            fontSize: 20,
            color: COLORS.textMuted,
            margin: "12px 0 0",
            fontWeight: 400,
          }}
        >
          Auto-attached. DATABASE_URL injected. Zero config.
        </p>
      </div>

      {/* Central project hub with DBs orbiting */}
      <div
        style={{
          position: "relative",
          width: 500,
          height: 400,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1,
        }}
      >
        {/* Center hub */}
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: "50%",
            background: COLORS.bgCard,
            border: `2px solid ${COLORS.accent}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 0 40px ${COLORS.accentGlow}`,
            position: "relative",
            zIndex: 2,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: -20 - centerPulse * 30,
              borderRadius: "50%",
              border: `1px solid ${COLORS.accent}33`,
              opacity: centerPulse * 0.5,
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: -40 - centerPulse * 60,
              borderRadius: "50%",
              border: `1px solid ${COLORS.accent}15`,
              opacity: centerPulse * 0.3,
            }}
          />
          <span
            style={{
              fontFamily: inter,
              fontSize: 14,
              fontWeight: 800,
              color: COLORS.accent,
              textAlign: "center",
            }}
          >
            Your
            <br />
            Project
          </span>
        </div>

        {/* DB nodes */}
        {dbs.map((db, i) => {
          const delay = 40 + i * 20;
          const showFrame = localFrame - delay;
          const visible = showFrame > 0;

          const dbScale = visible
            ? spring({
                frame: showFrame,
                fps: 60,
                config: { damping: 10, stiffness: 120 },
              })
            : 0;

          const orbitAngle = (localFrame * 0.5 + i * 90) * (Math.PI / 180);
          const orbitRadius = 210;
          const dbX = Math.cos(orbitAngle) * orbitRadius;
          const dbY = Math.sin(orbitAngle) * orbitRadius;

          return (
            <div
              key={db.name}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                marginLeft: -50,
                marginTop: -50,
                transform: `translate(${dbX}px, ${dbY}px) scale(${dbScale})`,
                width: 100,
                height: 100,
                borderRadius: 20,
                background: COLORS.bgCard,
                border: `1px solid ${COLORS.border}`,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                opacity: visible ? 1 : 0,
                zIndex: 1,
              }}
            >
              <span style={{ fontSize: 28 }}>{db.icon}</span>
              <span
                style={{
                  fontFamily: inter,
                  fontSize: 12,
                  fontWeight: 600,
                  color: COLORS.text,
                }}
              >
                {db.name}
              </span>
            </div>
          );
        })}

        {/* Connection lines from center to DBs */}
        {dbs.map((db, i) => {
          const visible = localFrame > 50 + i * 20;
          if (!visible) return null;
          const lineOpacity = interpolate(
            localFrame,
            [50 + i * 20, 60 + i * 20],
            [0, 0.3],
            { extrapolateRight: "clamp" }
          );
          return (
            <div
              key={`line-${i}`}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 180,
                height: 1,
                background: COLORS.accent,
                opacity: lineOpacity,
                transformOrigin: "0 0",
                transform: `rotate(${45 + i * 90}deg)`,
              }}
            />
          );
        })}
      </div>

      {/* DATABASE_URL injection */}
      {localFrame > 140 && (
        <div
          style={{
            marginTop: 30,
            padding: "12px 24px",
            borderRadius: 8,
            background: COLORS.bgTerminal,
            border: `1px solid ${COLORS.border}`,
            fontFamily: jetbrains,
            fontSize: 14,
            color: COLORS.accent,
            zIndex: 1,
            opacity: interpolate(localFrame, [140, 155], [0, 1], {
              extrapolateRight: "clamp",
            }),
          }}
        >
          DATABASE_URL=postgres://...
        </div>
      )}
    </AbsoluteFill>
  );
};
