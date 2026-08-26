import React from "react";
import { useCurrentFrame, interpolate, spring, AbsoluteFill } from "remotion";
import { COLORS, inter } from "../constants";
import { DotGrid } from "../components/Particles";

const plans = [
  {
    name: "Free",
    price: "$0",
    features: ["3 projects", "1 DB", "5 tunnels", "1 BYOC"],
    accent: false,
    delay: 30,
  },
  {
    name: "Hobby",
    price: "$5/mo",
    features: ["5 projects", "3 DBs", "8 tunnels", "2 BYOC"],
    accent: false,
    delay: 45,
  },
  {
    name: "Pro",
    price: "$12/mo",
    features: ["10 projects", "5 DBs", "15 tunnels", "5 BYOC"],
    accent: true,
    delay: 60,
  },
];

export const Pricing: React.FC<{
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

  const badgeDelay = 130;
  const badgesOpacity = interpolate(
    localFrame,
    [badgeDelay, badgeDelay + 12],
    [0, 1],
    { extrapolateRight: "clamp" }
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
      <div style={{ position: "absolute", inset: 0, opacity: 0.3 }}>
        <DotGrid />
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 48,
          zIndex: 1,
        }}
      >
        <div
          style={{
            transform: `translateY(${(1 - titleSpring) * 20}px)`,
            opacity: titleSpring,
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
            Start free,
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
            scale when ready
          </h2>
        </div>

        {/* Pricing cards */}
        <div style={{ display: "flex", gap: 20 }}>
          {plans.map((plan, i) => {
            const showFrame = plan.delay;
            const cardVisible = localFrame > showFrame;
            const cardOpacity = interpolate(
              localFrame,
              [showFrame, showFrame + 10],
              [0, 1],
              { extrapolateRight: "clamp" }
            );
            const cardScale = cardVisible
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
                key={plan.name}
                style={{
                  width: 200,
                  padding: "28px 24px",
                  borderRadius: 16,
                  background: plan.accent ? `${COLORS.accent}10` : COLORS.bgCard,
                  border: `1px solid ${plan.accent ? COLORS.accent : COLORS.border}`,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 16,
                  opacity: cardOpacity,
                  transform: `scale(${cardScale})`,
                  boxShadow: plan.accent
                    ? `0 0 30px ${COLORS.accentGlow}`
                    : "none",
                }}
              >
                <span
                  style={{
                    fontFamily: inter,
                    fontSize: 14,
                    fontWeight: 700,
                    color: plan.accent ? COLORS.accent : COLORS.textMuted,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {plan.name}
                  {plan.accent && (
                    <span
                      style={{
                        marginLeft: 8,
                        padding: "2px 8px",
                        borderRadius: 10,
                        background: COLORS.accent,
                        color: COLORS.bg,
                        fontSize: 10,
                        fontWeight: 800,
                      }}
                    >
                      POPULAR
                    </span>
                  )}
                </span>
                <div>
                  <span
                    style={{
                      fontFamily: inter,
                      fontSize: 36,
                      fontWeight: 800,
                      color: COLORS.white,
                    }}
                  >
                    {plan.price}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  {plan.features.map((f) => (
                    <span
                      key={f}
                      style={{
                        fontFamily: inter,
                        fontSize: 13,
                        color: COLORS.textMuted,
                      }}
                    >
                      {f}
                    </span>
                  ))}
                </div>
                {plan.name === "Free" && (
                  <span
                    style={{
                      fontFamily: inter,
                      fontSize: 12,
                      fontWeight: 600,
                      color: COLORS.accent,
                    }}
                  >
                    No credit card
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Trust badges */}
        <div
          style={{
            display: "flex",
            gap: 24,
            opacity: badgesOpacity,
          }}
        >
          {["Free tier", "No credit card", "Self-hostable", "MIT license"].map(
            (badge, i) => {
              const badgeDelay_i = badgeDelay + i * 10;
              const bOpacity = interpolate(
                localFrame,
                [badgeDelay_i, badgeDelay_i + 8],
                [0, 1],
                { extrapolateRight: "clamp" }
              );
              return (
                <div
                  key={badge}
                  style={{
                    padding: "10px 20px",
                    borderRadius: 8,
                    background: COLORS.bgCard,
                    border: `1px solid ${COLORS.border}`,
                    opacity: bOpacity,
                  }}
                >
                  <span
                    style={{
                      fontFamily: inter,
                      fontSize: 14,
                      fontWeight: 600,
                      color: COLORS.text,
                    }}
                  >
                    {badge}
                  </span>
                </div>
              );
            }
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
