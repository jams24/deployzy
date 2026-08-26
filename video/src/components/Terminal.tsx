import React from "react";
import { useCurrentFrame, interpolate } from "remotion";
import { COLORS, jetbrains } from "../constants";

const STATUS = {
  idle: COLORS.textDim,
  running: COLORS.amber,
  done: COLORS.accent,
  error: COLORS.red,
};

interface TerminalLine {
  text: string;
  showFrame: number;
  color?: string;
  indent?: number;
}

const deployLines: TerminalLine[] = [
  { text: "$ git push origin main", showFrame: 0 },
  { text: "◷ Deployzy: webhook received", showFrame: 20, color: COLORS.textMuted },
  { text: "✓ Repo linked · branch main", showFrame: 35, color: COLORS.accent, indent: 1 },
  { text: "Detected: Node.js · npm", showFrame: 50, color: COLORS.blue, indent: 1 },
  { text: "✓ Building Docker image...", showFrame: 65, color: COLORS.accent, indent: 1 },
  { text: "✓ Layers cached · 6/6", showFrame: 85, color: COLORS.accent, indent: 2 },
  { text: "✓ Postgres attached", showFrame: 100, color: COLORS.accent, indent: 1 },
  { text: "Build 0:24 · 82%", showFrame: 115, color: COLORS.textMuted },
  { text: "✓ Health check /health 200 OK", showFrame: 130, color: COLORS.accent, indent: 1 },
  { text: "✓ TLS provisioned · HTTPS", showFrame: 145, color: COLORS.accent, indent: 1 },
  { text: "✓ DATABASE_URL injected", showFrame: 160, color: COLORS.accent, indent: 1 },
  { text: "", showFrame: 175 },
  { text: "https://my-saas.deployzy.com", showFrame: 185, color: COLORS.accent },
  { text: "Live · deployed in 28s", showFrame: 200, color: COLORS.green },
];

interface DeployTerminalProps {
  startFrame?: number;
  width?: number;
  height?: number;
}

export const DeployTerminal: React.FC<DeployTerminalProps> = ({
  startFrame = 0,
  width = 680,
  height = 460,
}) => {
  const frame = useCurrentFrame();
  const localFrame = frame - startFrame;

  const headerGradient = interpolate(
    localFrame,
    [0, 60],
    [0, 1],
    { extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        width,
        height,
        background: COLORS.bgTerminal,
        borderRadius: 12,
        border: `1px solid ${COLORS.border}`,
        overflow: "hidden",
        fontFamily: jetbrains,
        fontSize: 14,
        lineHeight: 1.7,
      }}
    >
      {/* Terminal header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 16px",
          background: COLORS.bgCard,
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: COLORS.red,
          }}
        />
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: COLORS.amber,
          }}
        />
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: COLORS.green,
          }}
        />
        <div
          style={{
            marginLeft: 12,
            fontSize: 12,
            color: COLORS.textDim,
          }}
        >
          deployzy build
        </div>
        <div
          style={{
            marginLeft: "auto",
            height: 4,
            background: `linear-gradient(90deg, ${COLORS.accent} ${headerGradient * 100}%, transparent 0%)`,
            borderRadius: 2,
            transition: "width 0.1s",
          }}
        />
      </div>

      {/* Terminal content */}
      <div style={{ padding: "12px 16px", overflow: "hidden" }}>
        {deployLines.map((line, i) => {
          const lineOpacity = interpolate(
            localFrame,
            [line.showFrame - 2, line.showFrame + 1],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );

          if (lineOpacity <= 0 && localFrame > line.showFrame + 5) return null;
          if (lineOpacity <= 0 && localFrame < line.showFrame - 2)
            return null;

          return (
            <div
              key={i}
              style={{
                color: line.color || COLORS.text,
                opacity: lineOpacity,
                paddingLeft: (line.indent || 0) * 16,
                whiteSpace: "nowrap",
              }}
            >
              {line.text || "\u00A0"}
            </div>
          );
        })}

        {/* Blinking cursor */}
        {localFrame > deployLines[deployLines.length - 1].showFrame + 10 && (
          <div
            style={{
              display: "inline-block",
              width: 8,
              height: 16,
              background: COLORS.accent,
              opacity: Math.sin(localFrame * 0.3) > 0 ? 1 : 0,
            }}
          />
        )}
      </div>
    </div>
  );
};

export const LiveIndicator: React.FC<{ show: boolean }> = ({ show }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      opacity: show ? 1 : 0,
    }}
  >
    <div
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: COLORS.green,
        boxShadow: `0 0 8px ${COLORS.green}`,
        animation: "pulse 2s infinite",
      }}
    />
    <span style={{ fontSize: 12, color: COLORS.green }}>Live</span>
  </div>
);
