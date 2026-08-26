import { loadFont } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

export const { fontFamily: inter } = loadFont("normal", {
  weights: ["400", "600", "800"],
  subsets: ["latin"],
});

export const { fontFamily: jetbrains } = loadMono("normal", {
  weights: ["400", "600", "800"],
  subsets: ["latin"],
});

export const COLORS = {
  bg: "#09090b",
  bgCard: "#131316",
  bgTerminal: "#0d0d10",
  border: "#27272a",
  text: "#fafafa",
  textMuted: "#a1a1aa",
  textDim: "#71717a",
  accent: "#10b981",
  accentGlow: "rgba(16, 185, 129, 0.35)",
  accentDim: "rgba(16, 185, 129, 0.15)",
  red: "#ef4444",
  amber: "#f59e0b",
  blue: "#3b82f6",
  purple: "#8b5cf6",
  green: "#22c55e",
  white: "#ffffff",
};

export const FPS = 60;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const SCENES = {
  intro: { start: 0, duration: 6 },
  problem: { start: 6, duration: 8 },
  deploy: { start: 14, duration: 10 },
  tunnels: { start: 24, duration: 8 },
  databases: { start: 32, duration: 8 },
  byoc: { start: 40, duration: 10 },
  dashboard: { start: 50, duration: 8 },
  pricing: { start: 58, duration: 8 },
  cli: { start: 66, duration: 8 },
  outro: { start: 74, duration: 16 },
};
