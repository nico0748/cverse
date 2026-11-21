/**
 * 描画する「場面」を組み立てる。エンジンの結果（近傍または経路）に、
 * 「他 N 件」のまとめノード・足跡の線・配置を足して、GraphView に渡せる形にする。
 * 色は持たない（配色は GraphView が今のテーマから決める）。
 */
import { layoutPath, layoutView, type LayoutOptions, type Placed } from "./layout";
import { KIND_SHAPE, type Shape } from "./theme";
import { KIND_LABEL, Slot, type EdgeType, type Kind, type PathData, type ViewData, type ViewNode } from "./types";

/** ノードの強調: 中心 / 辿ってきた道 / 経路の途中 / 経路の端。 */
export type Emphasis = "center" | "trail" | "path" | "end" | null;

export interface SceneNode {
  id: string;
  label: string;
  kind: Kind | "more";
  x: number;
  y: number;
  size: number;
  shape: Shape;
  /** 中心からの段（0 が中心）。 */
  level: number;
  emphasis: Emphasis;
  /** ラベルを必ず出すか（中心・アンカー・経路）。それ以外は混み具合で間引く。 */
  forceLabel: boolean;
  /** 画像の URL。無ければ頭文字を描く。 */
  image?: string;
  /** 画像が無いときにアイコンの中に描く文字。 */
  initial: string;
  /** アイコンの上に小さく添える注記（担当声優の媒体など）。 */
  note?: string;
  /** ホバー（長押し）で出す補足。 */
  tooltip?: string;
  /** 新しく現れるとき、どのノードの位置から出てくるか。 */
  origin?: string;
  /** クリックで中心にするノード。「他 N 件」は親を指す。 */
  target: string;
}

export type EdgeStyle = EdgeType | "trail" | "path" | "more";

export interface SceneEdge {
  a: string;
  b: string;
  style: EdgeStyle;
  /** appears の役（0 主役 / 1 脇役 / 2 その他）。 */
  role: number;
  /** 2 段目以降の線は細く薄く描く。 */
  dim: boolean;
}

export interface Scene {
  /** 場面の同一性。変わったら配置し直す。 */
  key: string;
  center: string | null;
  nodes: SceneNode[];
  edges: SceneEdge[];
  /** 全体が収まる範囲（横・縦それぞれの半分の長さ）。 */
  extent: { x: number; y: number };
}

const initialOf = (label: string) => Array.from(label.trim())[0] ?? "?";

function tooltipOf(n: ViewNode): string | undefined {
  if (n.kind === "ch" && n.voices?.length) return `CV ${n.voices.join(" / ")}`;
  if (n.kind === "wk" && n.note) return n.note;
  if (n.kind === "va" && n.sub) return n.sub;
  if (n.kind === "more") return "押すと一覧を開きます";
  return undefined;
}

function sceneNode(n: ViewNode, p: Placed, trail: Set<string>): SceneNode {
  const { shape, scale } = KIND_SHAPE[n.kind];
  const isCenter = n.slot === Slot.Center;
  const anchored = n.slot === Slot.Top || n.slot === Slot.Bottom || n.slot === Slot.Context;
  const more = n.kind === "more";
  return {
    id: n.id,
    label: n.label,
    kind: n.kind,
    x: p.x,
    y: p.y,
    size: p.size * scale,
    shape,
    level: n.level,
    emphasis: isCenter ? "center" : trail.has(n.id) ? "trail" : null,
    forceLabel: isCenter || anchored || more,
    image: n.image,
    initial: more ? "…" : initialOf(n.label),
    note: n.slot === Slot.Top && n.kind === "va" ? n.note : undefined,
    tooltip: tooltipOf(n),
    origin: n.group ?? undefined,
    target: more ? n.id.slice("more:".length) : n.id,
  };
}

/** 省いた件数を「他 N 件」のノードにする。 */
function moreNodes(view: ViewData): ViewNode[] {
  const center = view.nodes[0];
  return view.hidden.map(({ parent, count }) => {
    const ofCenter = parent === view.center;
    // キャラ中心で省かれるのは登場作品（下のアンカー列）、それ以外は周囲のキャラ。
    const slot = ofCenter && center?.kind === "ch" ? Slot.Bottom : Slot.Ring;
    return {
      id: `more:${parent}`,
      label: `他 ${count} 件`,
      kind: "more",
      level: 1,
      slot,
      group: ofCenter && center?.kind !== "wk" ? null : parent,
      role: 2,
    };
  });
}

export function sceneFromView(view: ViewData, trail: string[], options: LayoutOptions = {}): Scene {
  const nodes = [...view.nodes, ...moreNodes(view)];
  const { positions, extent } = layoutView({ ...view, nodes }, options);
  const trailSet = new Set(trail);
  const level = new Map(nodes.map((n) => [n.id, n.level]));
  const sceneNodes = nodes.map((n) => sceneNode(n, positions.get(n.id)!, trailSet));

  const edges: SceneEdge[] = view.edges.map((e) => ({
    a: e.a,
    b: e.b,
    style: e.type,
    role: e.role,
    dim: Math.max(level.get(e.a) ?? 0, level.get(e.b) ?? 0) >= 2,
  }));
  for (const h of view.hidden) {
    edges.push({ a: h.parent, b: `more:${h.parent}`, style: "more", role: 0, dim: false });
  }
  // 足跡: 辿ってきたノードどうしを結ぶ（実エッジが無くても残す）。
  const has = new Set(edges.flatMap((e) => [`${e.a}|${e.b}`, `${e.b}|${e.a}`]));
  for (let i = 1; i < trail.length; i++) {
    const [a, b] = [trail[i - 1], trail[i]];
    if (a !== b && positions.has(a) && positions.has(b) && !has.has(`${a}|${b}`)) {
      edges.push({ a, b, style: "trail", role: 0, dim: false });
      has.add(`${a}|${b}`).add(`${b}|${a}`);
    }
  }
  return { key: `view:${view.center}`, center: view.center, nodes: sceneNodes, edges, extent };
}

export function sceneFromPath(path: PathData, options: LayoutOptions = {}): Scene {
  const { positions, extent } = layoutPath(path.nodes, options);
  const nodes: SceneNode[] = path.nodes.map((n, i) => {
    const p = positions.get(n.id)!;
    const { shape, scale } = KIND_SHAPE[n.kind];
    const end = i === 0 || i === path.nodes.length - 1;
    return {
      id: n.id,
      label: n.label,
      kind: n.kind,
      ...p,
      size: p.size * scale,
      shape,
      level: 1,
      emphasis: end ? "end" : "path",
      forceLabel: true,
      image: n.image,
      initial: initialOf(n.label),
      tooltip: n.kind === "more" ? undefined : `${KIND_LABEL[n.kind]}${n.sub ? `・${n.sub}` : ""}`,
      target: n.id,
    };
  });
  const edges: SceneEdge[] = path.nodes.slice(1).map((n, i) => ({
    a: path.nodes[i].id,
    b: n.id,
    style: "path",
    role: 0,
    dim: false,
  }));
  return { key: `path:${path.nodes.map((n) => n.id).join(">")}`, center: null, nodes, edges, extent };
}
