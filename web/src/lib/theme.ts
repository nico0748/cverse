import { useCallback, useSyncExternalStore } from "react";
import type { Kind } from "./types";

/**
 * 種類ごとの形（F-04）。色だけに頼らず形でも区別する: 声優 = 丸、キャラ = 角丸、作品 = 四角。
 * 四角は同じ「大きさ」でも丸より広く見えるので、少し縮めて見た目の大きさを揃える（scale）。
 * 色は styles.css の変数（--va / --ch / --wk など）が正で、キャンバスへはそこから読み取る。
 */
export type Shape = "circle" | "rounded" | "square";

export const KIND_SHAPE: Record<Kind | "more", { shape: Shape; scale: number; shapeLabel: string }> = {
  va: { shape: "circle", scale: 1, shapeLabel: "丸" },
  ch: { shape: "rounded", scale: 0.92, shapeLabel: "角丸" },
  wk: { shape: "square", scale: 0.86, shapeLabel: "四角" },
  more: { shape: "circle", scale: 1, shapeLabel: "" },
};

/** 角の丸み（辺の半分に対する比）。CSS とキャンバスと WebGL で同じ値を使う。 */
export const CORNER: Record<Shape, number> = { circle: 1, rounded: 0.36, square: 0.1 };

export interface KindColors {
  /** 輪郭・小さな印に使う色。 */
  ring: string;
  /** 画像が無いときの地の色。 */
  tint: string;
  /** 地の上に載せる頭文字の色。 */
  ink: string;
}

/** キャンバス（グラフ）で使う色。CSS 変数から読む。 */
export interface Palette {
  ground: string;
  surface: string;
  ink: string;
  inkDim: string;
  line: string;
  accent: string;
  kinds: Record<Kind | "more", KindColors>;
}

export function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const kind = (k: string): KindColors => ({ ring: v(`--${k}`), tint: v(`--${k}-tint`), ink: v(`--${k}-ink`) });
  return {
    ground: v("--ground"),
    surface: v("--surface"),
    ink: v("--ink"),
    inkDim: v("--ink-2"),
    line: v("--line"),
    accent: v("--accent"),
    kinds: { va: kind("va"), ch: kind("ch"), wk: kind("wk"), more: kind("more") },
  };
}

/** `#rrggbb` に不透明度を付ける。 */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// ---- 明るい / 暗い の切り替え ----
// 既定は端末の設定に従い、切り替えたらこの端末に覚える。index.html の先頭でも同じ判定をして、
// 読み込み直後に一瞬だけ別の配色が見えるのを防いでいる。

export type ThemeName = "light" | "dark";
const KEY = "cverse:theme";
const listeners = new Set<() => void>();
const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

function stored(): ThemeName | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function current(): ThemeName {
  return stored() ?? (media?.matches ? "dark" : "light");
}

function apply() {
  const theme = current();
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#12172a" : "#eef1f6");
  listeners.forEach((l) => l());
}

media?.addEventListener("change", apply);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, current, () => "light" as ThemeName);
  const toggle = useCallback(() => {
    try {
      localStorage.setItem(KEY, current() === "dark" ? "light" : "dark");
    } catch {
      // 保存できない環境では切り替えられない（端末の設定に従う）。
    }
    apply();
  }, []);
  return { theme, toggle };
}
