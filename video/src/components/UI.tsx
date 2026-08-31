import React from "react";
import { COLORS } from "../constants";

export const GlowBorder: React.FC<{
  children: React.ReactNode;
  borderRadius?: number;
  glowColor?: string;
  padding?: number;
}> = ({ children, borderRadius = 16, glowColor = COLORS.accentGlow, padding = 1 }) => (
  <div
    style={{
      position: "relative",
      borderRadius,
      padding,
      background: `linear-gradient(135deg, ${glowColor}, ${COLORS.accentDim}, ${glowColor})`,
    }}
  >
    <div
      style={{
        borderRadius: borderRadius - padding,
        background: COLORS.bgCard,
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  </div>
);

const lines = Array.from({ length: 6 }, (_, i) => ({
  id: i,
  offset: i * 60,
  width: 100 + Math.random() * 200,
}));

export const ConnectionLines: React.FC<{
  active: boolean;
  color?: string;
}> = ({ active, color = COLORS.accent }) => (
  <svg
    width="200"
    height="120"
    style={{ position: "absolute" }}
  >
    {lines.map((line) => (
      <line
        key={line.id}
        x1={0}
        y1={line.offset}
        x2={active ? line.width : 10}
        y2={line.offset}
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray="4 4"
        opacity={active ? 0.6 : 0.1}
      >
        {active && (
          <animate
            attributeName="stroke-dashoffset"
            from="0"
            to="-8"
            dur="0.5s"
            repeatCount="indefinite"
          />
        )}
      </line>
    ))}
  </svg>
);

export const FeatureBadge: React.FC<{
  text: string;
  active: boolean;
  color?: string;
}> = ({ text, active, color = COLORS.accent }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      padding: "6px 16px",
      borderRadius: 20,
      background: active ? `${color}22` : "transparent",
      border: `1px solid ${active ? color : COLORS.border}`,
      color: active ? color : COLORS.textMuted,
      fontSize: 14,
      fontWeight: 600,
      fontFamily: "Inter, sans-serif",
      transition: "all 0.3s ease",
    }}
  >
    {active && (
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
          marginRight: 8,
          boxShadow: `0 0 6px ${color}`,
        }}
      />
    )}
    {text}
  </div>
);

export const MetricCircle: React.FC<{
  value: string;
  label: string;
  color?: string;
}> = ({ value, label, color = COLORS.accent }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 8,
    }}
  >
    <div
      style={{
        width: 96,
        height: 96,
        borderRadius: "50%",
        border: `2px solid ${color}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: `${color}11`,
        boxShadow: `0 0 30px ${color}33`,
      }}
    >
      <span
        style={{
          fontSize: 28,
          fontWeight: 800,
          color,
          fontFamily: "Inter, sans-serif",
        }}
      >
        {value}
      </span>
    </div>
    <span
      style={{
        fontSize: 13,
        color: COLORS.textMuted,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        fontFamily: "JetBrains Mono, monospace",
      }}
    >
      {label}
    </span>
  </div>
);

export const SectionTitle: React.FC<{
  children: React.ReactNode;
  textAlign?: "center" | "left";
  size?: "small" | "medium" | "large";
}> = ({ children, textAlign = "center", size = "medium" }) => (
  <h2
    style={{
      fontFamily: "Inter, sans-serif",
      fontSize: size === "large" ? 48 : size === "small" ? 28 : 36,
      fontWeight: 800,
      color: COLORS.white,
      lineHeight: 1.2,
      letterSpacing: "-0.03em",
      margin: 0,
      textAlign,
    }}
  >
    {children}
  </h2>
);
