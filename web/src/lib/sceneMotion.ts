/**
 * 中心を切り替えるときの補間の計画（docs/motion.md「中心の切り替え」）。
 * 描画から切り離した純粋な関数なので、割り込み・段差・上限を試験で確かめられる。
 */
import { DUR, EXIT_RATIO, STAGGER, clamp01, ease, lerp } from "./motion";

/** ノードの見た目のうち、補間するもの（グラフ座標）。 */
export interface Attrs {
  x: number;
  y: number;
  size: number;
  opacity: number;
}

export interface TargetNode {
  id: string;
  x: number;
  y: number;
  size: number;
  /** 中心からの段（0 が中心）。 */
  level: number;
  /** 新しく現れるとき、どのノードの位置から出てくるか。 */
  origin?: string;
}

export type TweenKind = "stay" | "enter" | "leave";

export interface Tween {
  id: string;
  kind: TweenKind;
  from: Attrs;
  to: Attrs;
  delay: number;
  dur: number;
}

export interface Plan {
  tweens: Tween[];
  /** 最後の tween が終わる時刻（ms）。 */
  total: number;
}

export interface PlanOptions {
  /** 新しい中心（新しいノードの出どころの既定）。 */
  center: string | null;
  /** 動きを減らす設定。位置は即時にする。 */
  reduced?: boolean;
  /** 前の切り替えからすぐ次が来た（短くする）。 */
  rapid?: boolean;
  /** 画面の y が下向きか（時計回りの向きを決める）。 */
  yDown?: boolean;
  /** 長さを指定する（同じ中心のまま動きの途中で届いた更新は、残りの時間で着地させる）。段差は付けない。 */
  duration?: number;
}

/** 消えるノードが薄れる長さ。 */
export const LEAVE_DUR = Math.round(DUR.base * EXIT_RATIO);
/** 新しいノードの出始めの大きさ（行き先に対する比。面積で 16%）。 */
const ENTER_SIZE = 0.4;

/**
 * 時計回りの段差。12 時の向きが 0、時計回りに増えて `sweep` 未満、段ごとに `ring` を足し、`maxDelay` で止める。
 * 中心（段 0）は遅らせない。
 */
export function sweepDelay(x: number, y: number, level: number, yDown = false): number {
  if (level <= 0) return 0;
  // 12 時から時計回りの角度（0〜1）。画面の y が上向きなら、上が +y。
  const angle = Math.atan2(x, yDown ? -y : y);
  const turn = (angle < 0 ? angle + 2 * Math.PI : angle) / (2 * Math.PI);
  return Math.min(STAGGER.maxDelay, (level - 1) * STAGGER.ring + turn * STAGGER.sweep);
}

/**
 * 今見えている値（before）から、次の場面（nodes）へ動く計画を作る。
 * 前からいたノードは今の値から動き、新しいノードは親の位置から現れ、いなくなるノードは薄れる。
 */
export function planScene(before: ReadonlyMap<string, Attrs>, nodes: readonly TargetNode[], opts: PlanOptions): Plan {
  const total = opts.reduced ? 0 : (opts.duration ?? (opts.rapid ? DUR.base : DUR.scene));
  const stagger = !opts.reduced && !opts.rapid && opts.duration === undefined && nodes.length <= STAGGER.maxNodes;
  const next = new Set(nodes.map((n) => n.id));
  const fallback = (opts.center && before.get(opts.center)) || { x: 0, y: 0 };
  const tweens: Tween[] = [];
  for (const n of nodes) {
    const to = { x: n.x, y: n.y, size: n.size, opacity: 1 };
    const now = before.get(n.id);
    if (now) {
      tweens.push({ id: n.id, kind: "stay", from: now, to, delay: 0, dur: total });
      continue;
    }
    const origin = (n.origin && before.get(n.origin)) || fallback;
    const delay = stagger ? sweepDelay(n.x, n.y, n.level, opts.yDown) : 0;
    tweens.push({
      id: n.id,
      kind: "enter",
      from: { x: origin.x, y: origin.y, size: n.size * ENTER_SIZE, opacity: 0 },
      to,
      delay,
      dur: total - delay,
    });
  }
  for (const [id, now] of before) {
    if (next.has(id)) continue;
    tweens.push({ id, kind: "leave", from: now, to: { ...now, opacity: 0 }, delay: 0, dur: Math.min(total, LEAVE_DUR) });
  }
  return { tweens, total: Math.max(0, ...tweens.map((t) => t.delay + t.dur)) };
}

/** 時刻 t（ms、計画の始まりから）での 1 つのノードの値。 */
export function valueAt(tw: Tween, t: number): Attrs {
  const local = tw.dur <= 0 ? (t >= tw.delay ? 1 : 0) : clamp01((t - tw.delay) / tw.dur);
  const { from, to } = tw;
  if (tw.kind === "leave") {
    const k = ease.exit(local);
    return { x: from.x, y: from.y, size: from.size, opacity: from.opacity * (1 - k) };
  }
  if (tw.kind === "enter") {
    const k = ease.enter(local);
    // 大きさは面積で育てる（半径をそのまま補間すると、出始めが小さく見えすぎる）。
    const r0 = from.size / to.size;
    return {
      x: lerp(from.x, to.x, k),
      y: lerp(from.y, to.y, k),
      size: to.size * Math.sqrt(lerp(r0 * r0, 1, k)),
      opacity: lerp(from.opacity, to.opacity, k),
    };
  }
  const k = ease.move(local);
  return {
    x: lerp(from.x, to.x, k),
    y: lerp(from.y, to.y, k),
    size: lerp(from.size, to.size, k),
    opacity: lerp(from.opacity, to.opacity, k),
  };
}

/** カメラ・図の範囲のように、計画全体で 1 つの値の進み具合（0〜1）。 */
export const progressAt = (plan: Plan, t: number) => (plan.total <= 0 ? 1 : ease.move(clamp01(t / plan.total)));
