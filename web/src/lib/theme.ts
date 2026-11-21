import type { EdgeType, Kind } from "./types";

/**
 * 種類ごとの色と形（F-04）。色だけに頼らず形でも区別する。
 * 四角は同じ「大きさ」でも丸より広く見えるので、少し縮めて見た目の大きさを揃える（scale）。
 * 色は色覚多様性に配慮した Okabe-Ito 配色の 3 色（橙・空色・青緑）を暗い背景向けに明るくしたもの。
 */
export const KIND_STYLE: Record<Kind | "more", { color: string; shape: "circle" | "square" | "rounded"; scale: number; shapeLabel: string }> = {
  va: { color: "#f0a93b", shape: "circle", scale: 1, shapeLabel: "丸" },
  ch: { color: "#5bb8f5", shape: "rounded", scale: 0.92, shapeLabel: "角丸" },
  wk: { color: "#2fbf8f", shape: "square", scale: 0.86, shapeLabel: "四角" },
  more: { color: "#59637d", shape: "circle", scale: 1, shapeLabel: "" },
};

export const COLORS = {
  background: "#0b1020",
  label: "#dce4f5",
  labelDim: "#8f9bb8",
  ink: "#0b1020",
  centerRing: "#ffffff",
  trailRing: "#aab6d6",
  path: "#ffd166",
  trail: "rgba(210, 222, 255, 0.34)",
};

export function edgeColor(type: EdgeType, role: number, dim: boolean): string {
  const alpha = (a: number) => (dim ? a * 0.45 : a).toFixed(2);
  switch (type) {
    case "voices":
      return `rgba(240, 169, 59, ${alpha(0.5)})`;
    case "series":
      return `rgba(47, 191, 143, ${alpha(0.6)})`;
    case "relation":
      return `rgba(240, 130, 180, ${alpha(0.6)})`;
    default:
      return `rgba(150, 170, 215, ${alpha(role === 0 ? 0.5 : 0.24)})`;
  }
}
