/**
 * 動きの値（docs/motion.md）。CSS の `:root` にも同じ名前・同じ値の変数があり、motion.test.ts が一致を確かめる。
 * 読み込んだだけでは window に触らない（試験は node で動く）。
 */

/** 長さ（ms）。隣どうしの比は 1.3 以上。 */
export const DUR = { instant: 90, fast: 150, base: 240, slow: 360, scene: 480 } as const;
/** 去る動きは入る動きの 0.7 倍の長さ。 */
export const EXIT_RATIO = 0.7;
/** 3 次ベジェの制御点（CSS の cubic-bezier と同じ並び）。 */
export const EASE = {
  enter: [0.16, 1, 0.3, 1],
  exit: [0.4, 0, 1, 1],
  move: [0.2, 0, 0, 1],
  emphasis: [0.34, 1.36, 0.64, 1],
} as const;
/** 段差（ms）。図は同じ段の中で `sweep`、段ごとに `ring` 遅らせ、遅れは `maxDelay` まで。 */
export const STAGGER = { sweep: 60, ring: 60, maxDelay: 120, maxNodes: 400 } as const;
/** 動きを減らす設定で、場面を切り替えるときの透明度の長さ。 */
export const REDUCED_FADE = DUR.fast;
/** 蝶番の線を、着地してから元の色に戻すまでの長さ。 */
export const HINGE_HOLD = DUR.fast;

export type Easing = (t: number) => number;

/** CSS の cubic-bezier(x1, y1, x2, y2) と同じ曲線。x から t を二分法で求める。 */
export function bezier(x1: number, y1: number, x2: number, y2: number): Easing {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    let t = x;
    for (let i = 0; i < 24; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

/** 曲線は 1 回だけ作って使い回す（毎フレーム閉包を作らない）。 */
export const ease = {
  enter: bezier(...EASE.enter),
  exit: bezier(...EASE.exit),
  move: bezier(...EASE.move),
  emphasis: bezier(...EASE.emphasis),
} satisfies Record<keyof typeof EASE, Easing>;

export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const QUERY = "(prefers-reduced-motion: reduce)";

/** 端末の「動きを減らす」設定。毎回読むので、途中で変えても次の動きから効く。 */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia(QUERY).matches;
}

/** 滑らかなスクロール。動きを減らす設定では即時にする。 */
export const scrollBehavior = (): ScrollBehavior => (prefersReducedMotion() ? "auto" : "smooth");
