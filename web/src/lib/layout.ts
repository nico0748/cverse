/**
 * 中心切替の制約付きレイアウト（F-02, F-03）。
 *
 * まず「どこにあるべきか」を決定的に決め（アンカー・扇形・同心円）、そのあとで
 * 重なりだけを力学的にほどく。普通の力学レイアウトは毎回形が変わるが、こうすると
 * 「声優は上、作品は下」が必ず守られ、同じ中心なら同じ絵になる。
 *
 * | 中心 | 配置 |
 * |---|---|
 * | キャラ | 担当声優を真上、登場作品を真下に固定。同じ作品の他キャラを左右の弧に |
 * | 声優 | 演じたキャラを円周に、作品ごとの扇形にまとめる。作品はその外側 |
 * | 作品 | 主役を内側の円、脇役を外側の円。シリーズの前後作を上に |
 *
 * 座標は y が上向き（Sigma のグラフ座標）。純粋関数なので単体テストできる。
 */
import { Slot, type NodeBrief, type ViewData, type ViewNode } from "./types";

export interface Placed {
  x: number;
  y: number;
  size: number;
}

export interface LayoutResult {
  positions: Map<string, Placed>;
  /** 原点を中心に全ノード（とラベルの余白）が収まる範囲（横・縦それぞれの半分の長さ）。 */
  extent: { x: number; y: number };
}

export interface LayoutOptions {
  /** 縦長の画面（スマホ）向けに、横を詰めて縦に伸ばす。 */
  portrait?: boolean;
}

// 画像（顔）が見分けられるよう、1 段目のノードは間隔に対して大きめに取る。
const SIZE = { center: 32, anchor: 22, context: 18, main: 18, ring: 16, more: 10, level2: 9.5, level3: 5 };
const ANCHOR_Y = 172;
const ANCHOR_DX = 116;
const SPACING = 46;
/** 外側の輪を内側の輪からどれだけ離すか。 */
const ROW_GAP = 68;
const TAU = Math.PI * 2;
const deg = (d: number) => (d * Math.PI) / 180;

export function nodeSize(n: ViewNode): number {
  if (n.slot === Slot.Center) return SIZE.center;
  if (n.level >= 3) return SIZE.level3;
  if (n.level === 2) return SIZE.level2;
  if (n.kind === "more") return SIZE.more;
  if (n.slot === Slot.Top || n.slot === Slot.Bottom) return SIZE.anchor;
  if (n.slot === Slot.Context) return SIZE.context;
  return n.role === 0 ? SIZE.main : SIZE.ring;
}

/** 横一列に並べる（アンカー用）。数が多いときは上下に千鳥にしてラベルの重なりを減らす。 */
function row(nodes: ViewNode[], y: number, out: Map<string, Placed>) {
  const stagger = nodes.length > 4 ? 40 : 0;
  nodes.forEach((n, i) => {
    const dy = stagger && i % 2 === 1 ? Math.sign(y) * stagger : 0;
    out.set(n.id, { x: (i - (nodes.length - 1) / 2) * ANCHOR_DX, y: y + dy, size: nodeSize(n) });
  });
}

/**
 * 弧に沿って並べる。1 行に入りきらなければ外側の行へ送る。
 * `from` → `to` の向きに詰める。数が少ないときは弧の中央に寄せ、`spread` なら弧いっぱいに広げる。
 */
function arcRows(
  nodes: ViewNode[],
  from: number,
  to: number,
  radius: number,
  out: Map<string, Placed>,
  { rowGap = ROW_GAP, spread = false, phase = 0 } = {},
) {
  const span = Math.abs(to - from);
  const dir = Math.sign(to - from) || 1;
  const mid = (from + to) / 2;
  const full = span >= TAU - 1e-6;
  let i = 0;
  // 輪を重ねるときは、外の輪を半歩ずらす。内と外が同じ角度に並ぶと、中心からの線が
  // 内側のノードを貫いて「数珠つなぎ」に見えてしまうため。
  for (let r = radius, line = 0; i < nodes.length; r += rowGap, line++) {
    const capacity = Math.max(1, Math.floor((span * r) / SPACING) + (full ? 0 : 1));
    const count = Math.min(capacity, nodes.length - i);
    // 少ないときに弧いっぱいへ広げすぎない。
    const even = span / Math.max(count - 1, 1);
    const step = full ? TAU / count : spread ? span / count : Math.min(even, (SPACING * 1.6) / r);
    const shift = ((line + phase) % 2) * 0.5;
    for (let k = 0; k < count; k++, i++) {
      // 弧いっぱいに広げた輪は、内を 1/4 歩戻し外を 1/4 歩進めて、弧の中に収めたまま半歩ずらす。
      const a = full
        ? from + dir * step * (k + shift)
        : mid + dir * step * (k - (count - 1) / 2 + (spread ? (shift ? 0.25 : -0.25) : 0));
      out.set(nodes[i].id, { x: Math.cos(a) * r, y: Math.sin(a) * r, size: nodeSize(nodes[i]) });
    }
  }
}

/** キャラ中心: 声優を上、作品を下、同じ作品の他キャラを左右へ。 */
function characterCenter(nodes: ViewNode[], out: Map<string, Placed>) {
  const tops = nodes.filter((n) => n.slot === Slot.Top);
  const bottoms = nodes.filter((n) => n.slot === Slot.Bottom);
  row(tops, ANCHOR_Y, out);
  row(bottoms, -ANCHOR_Y, out);

  // 作品が左寄りなら左の弧、右寄りなら右の弧へ。真下の作品は少ない側へ。
  const ring = nodes.filter((n) => n.slot === Slot.Ring);
  const left: ViewNode[] = [];
  const right: ViewNode[] = [];
  const workX = (id: string | null) => (id && out.get(id)?.x) || 0;
  const byWork = new Map<string | null, ViewNode[]>();
  for (const n of ring) byWork.set(n.group, [...(byWork.get(n.group) ?? []), n]);
  const groups = [...byWork.entries()].sort((a, b) => Math.abs(workX(a[0])) - Math.abs(workX(b[0])));
  for (const [work, members] of groups) {
    const x = workX(work);
    if (x < -1) left.push(...members);
    else if (x > 1) right.push(...members);
    // 真下の作品（作品が 1 つだけのときなど）のキャラは、左右に振り分ける。
    else for (const m of members) (left.length <= right.length ? left : right).push(m);
  }
  // 下（作品に近い側）から上へ詰める。
  arcRows(right, deg(-50), deg(50), 244, out);
  arcRows(left, deg(230), deg(130), 244, out);
}

/** 声優中心: キャラを円周に、作品ごとの扇形にまとめる。作品はその外側。 */
function voiceActorCenter(nodes: ViewNode[], out: Map<string, Placed>) {
  const ring = nodes.filter((n) => n.slot === Slot.Ring);
  const works = nodes.filter((n) => n.slot === Slot.Context);
  // ring は作品ごとに連続するよう並べ直す（作品の並び＝優先度順を保つ）。
  const order = new Map<string | null, number>(works.map((w, i) => [w.id, i]));
  const sorted = [...ring].sort(
    (a, b) => (order.get(a.group) ?? works.length) - (order.get(b.group) ?? works.length),
  );
  // 多いときは内と外の 2 つの輪に互い違いに置く。1 つの輪に並べると輪が大きくなり、顔が小さくなる。
  const zigzag = sorted.length > 22;
  const radius = Math.max(176, (sorted.length * SPACING) / (zigzag ? TAU * 1.75 : TAU));
  const outerRadius = zigzag ? radius + 50 : radius;
  // 真上から時計回り。
  const step = TAU / Math.max(sorted.length, 1);
  const angles = new Map<string, number[]>();
  sorted.forEach((n, i) => {
    const a = Math.PI / 2 - step * i;
    const r = zigzag && i % 2 === 1 ? outerRadius : radius;
    out.set(n.id, { x: Math.cos(a) * r, y: Math.sin(a) * r, size: nodeSize(n) });
    if (n.group) angles.set(n.group, [...(angles.get(n.group) ?? []), a]);
  });
  for (const w of works) {
    const list = angles.get(w.id) ?? [0];
    const a = list.reduce((s, v) => s + v, 0) / list.length;
    const r = outerRadius + 84;
    out.set(w.id, { x: Math.cos(a) * r, y: Math.sin(a) * r, size: nodeSize(w) });
  }
}

/** 作品中心: 主役を内側、脇役を外側。シリーズ作があれば上を空けて置く。 */
function workCenter(nodes: ViewNode[], out: Map<string, Placed>) {
  const tops = nodes.filter((n) => n.slot === Slot.Top);
  const ring = nodes.filter((n) => n.slot === Slot.Ring);
  const mains = ring.filter((n) => n.role === 0);
  const others = ring.filter((n) => n.role !== 0);
  // シリーズ作の列の幅ぶん、上の扇形を空ける。
  const gap = tops.length ? deg(Math.min(38 + tops.length * 10, 80)) : 0;
  const from = Math.PI / 2 - gap;
  const to = Math.PI / 2 - TAU + gap;
  const span = TAU - gap * 2;
  const inner = Math.max(164, (mains.length * SPACING) / span);
  if (tops.length) row(tops, Math.max(ANCHOR_Y, inner + 28), out);
  arcRows(mains, from, to, inner, out, { spread: true });
  if (!mains.length) {
    arcRows(others, from, to, inner, out, { spread: true });
    return;
  }
  // 脇役は、主役と主役のあいだ（すき間の真ん中）の外側に置く。主役と同じ角度に置くと、
  // 中心からの線が主役を貫いて、脇役が主役にぶら下がっているように見えてしまう。
  const outerRadius = inner + ROW_GAP + 14;
  const step = span / mains.length;
  const slots = mains.map((m) => {
    const p = out.get(m.id)!;
    return Math.atan2(p.y, p.x) - step / 2;
  });
  if (others.length <= slots.length) {
    others.forEach((n, i) => {
      const a = slots[Math.floor(((i + 0.5) * slots.length) / others.length)];
      out.set(n.id, { x: Math.cos(a) * outerRadius, y: Math.sin(a) * outerRadius, size: nodeSize(n) });
    });
  } else {
    arcRows(others, from, to, outerRadius, out, { spread: true, phase: 1 });
  }
}

/** 2 段目以降: 親の外側へ、扇状に開いて置く。 */
function outer(nodes: ViewNode[], out: Map<string, Placed>) {
  for (const level of [2, 3]) {
    const byParent = new Map<string, ViewNode[]>();
    for (const n of nodes) {
      if (n.level === level && n.group) byParent.set(n.group, [...(byParent.get(n.group) ?? []), n]);
    }
    const dist = level === 2 ? 80 : 42;
    for (const [parent, children] of byParent) {
      const p = out.get(parent) ?? { x: 0, y: 0, size: 0 };
      const base = Math.atan2(p.y, p.x);
      const spread = Math.min(0.46, 1.8 / children.length);
      children.forEach((n, i) => {
        const a = base + (i - (children.length - 1) / 2) * spread;
        out.set(n.id, { x: p.x + Math.cos(a) * dist, y: p.y + Math.sin(a) * dist, size: nodeSize(n) });
      });
    }
  }
}

/**
 * 重なりをほどく（制約付きの力学ステップ）。
 * 中心とアンカーは動かさず、ほかのノードは「元の位置へ戻るばね」と「衝突の反発」で落ち着かせる。
 */
function relax(nodes: ViewNode[], out: Map<string, Placed>, iterations = 50) {
  const items = nodes
    .map((n) => ({ n, p: out.get(n.id)! }))
    .filter((it) => it.p)
    .map(({ n, p }) => ({
      p,
      tx: p.x,
      ty: p.y,
      pinned: n.slot === Slot.Center || n.slot === Slot.Top || n.slot === Slot.Bottom,
      pad: n.level >= 2 ? 3 : 7,
    }));
  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j];
        if (a.pinned && b.pinned) continue;
        let dx = b.p.x - a.p.x;
        let dy = b.p.y - a.p.y;
        const min = a.p.size + b.p.size + Math.max(a.pad, b.pad);
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-6) {
          // 完全に重なったら、番号から決まる向きへずらす（結果を決定的に保つ）。
          const ang = (i * 2.399963 + j) % TAU;
          dx = Math.cos(ang);
          dy = Math.sin(ang);
          d = 1;
        }
        const push = (min - d) / d;
        const wa = a.pinned ? 0 : b.pinned ? 1 : 0.5;
        const wb = b.pinned ? 0 : a.pinned ? 1 : 0.5;
        a.p.x -= dx * push * wa;
        a.p.y -= dy * push * wa;
        b.p.x += dx * push * wb;
        b.p.y += dy * push * wb;
        moved = true;
      }
    }
    for (const it of items) {
      if (it.pinned) continue;
      it.p.x += (it.tx - it.p.x) * 0.06;
      it.p.y += (it.ty - it.p.y) * 0.06;
    }
    if (!moved) break;
  }
}

function extentOf(out: Map<string, Placed>, portrait = false): { x: number; y: number } {
  // つながりが無い（少ない）ときに、中心だけが画面いっぱいに拡大されないよう、最小の範囲を決めておく。
  const ext = { x: 190, y: 170 };
  for (const p of out.values()) {
    ext.x = Math.max(ext.x, Math.abs(p.x) + p.size);
    ext.y = Math.max(ext.y, Math.abs(p.y) + p.size);
  }
  // 名前の分の余白。縦長の画面では、上の操作部と下のシートに隠れないよう縦を多めに空ける。
  return { x: ext.x + 56, y: ext.y + (portrait ? 120 : 48) };
}

/** ノードが少ないときは、顔が見やすいよう 1 段目を大きくする。 */
function boost(count: number): number {
  return count <= 8 ? 1.3 : count <= 16 ? 1.15 : 1;
}

export function layoutView(view: ViewData, { portrait = false }: LayoutOptions = {}): LayoutResult {
  const out = new Map<string, Placed>();
  const center = view.nodes.find((n) => n.slot === Slot.Center);
  if (!center) return { positions: out, extent: { x: 120, y: 120 } };
  out.set(center.id, { x: 0, y: 0, size: nodeSize(center) });
  const first = view.nodes.filter((n) => n.level === 1);
  if (center.kind === "ch") characterCenter(first, out);
  else if (center.kind === "va") voiceActorCenter(first, out);
  else workCenter(first, out);
  const scale = boost(first.length);
  for (const n of first) {
    const p = out.get(n.id);
    if (!p) continue;
    // 縦長の画面（スマホ）は 1 ノードあたりの画面が小さいので、押しやすいようさらに大きくする。
    p.size *= scale * (portrait ? 1.18 : 1);
    if (portrait) {
      // 縦長の画面では横を詰めて縦に伸ばす。上下に並べたアンカーの列は、名前が重ならないよう横は詰めない。
      if (n.slot !== Slot.Top && n.slot !== Slot.Bottom) p.x *= 0.76;
      p.y *= 1.5;
    }
  }
  outer(view.nodes, out);
  // 念のため、置き場所が決まらなかったノードも原点付近に出す。
  for (const n of view.nodes) {
    if (!out.has(n.id)) out.set(n.id, { x: 0, y: -60, size: nodeSize(n) });
  }
  relax(view.nodes, out);
  return { positions: out, extent: extentOf(out, portrait) };
}

/**
 * 最短経路の表示。左から右へ並べ、声優は上段・キャラは中段・作品は下段に置く
 * （通常画面の「声優は上、作品は下」と同じ約束）。
 * 縦長の画面では上から下へ並べ、声優は左・キャラは中央・作品は右に置く。
 */
export function layoutPath(nodes: NodeBrief[], { portrait = false }: LayoutOptions = {}): LayoutResult {
  const out = new Map<string, Placed>();
  const step = portrait ? 104 : 118;
  const offset = { va: 92, ch: 0, wk: -92, more: 0 } as const;
  nodes.forEach((n, i) => {
    const along = (i - (nodes.length - 1) / 2) * step;
    out.set(n.id, portrait ? { x: -offset[n.kind], y: -along, size: 24 } : { x: along, y: offset[n.kind], size: 24 });
  });
  return { positions: out, extent: extentOf(out, portrait) };
}
