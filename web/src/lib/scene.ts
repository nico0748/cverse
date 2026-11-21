/**
 * 描画する「場面」を組み立てる。エンジンの結果（近傍または経路）に、
 * 「他 N 件」のまとめノード・足跡の線・配置・色と形を足して、GraphView に渡せる形にする。
 */
import { layoutPath, layoutView, type Placed } from "./layout";
import { COLORS, KIND_STYLE, edgeColor } from "./theme";
import { KIND_LABEL, Slot, type Kind, type PathData, type ViewData, type ViewNode } from "./types";

export interface SceneNode {
  id: string;
  label: string;
  kind: Kind | "more";
  x: number;
  y: number;
  size: number;
  color: string;
  shape: "circle" | "square" | "rounded";
  opacity: number;
  borderColor: string;
  borderSize: number;
  labelColor: string;
  labelSize: number;
  /** ラベルを必ず出すか（中心・アンカー・経路）。それ以外は混み具合で間引く。 */
  forceLabel: boolean;
  /** アイコンの中に描く頭文字。 */
  initial: string;
  /** アイコンの上に小さく添える注記（担当声優の媒体など）。 */
  note?: string;
  tooltip?: string;
  /** 新しく現れるとき、どのノードの位置から出てくるか。 */
  origin?: string;
  /** クリックで中心にするノード。「他 N 件」は親を指す。 */
  target: string;
  zIndex: number;
}

export interface SceneEdge {
  a: string;
  b: string;
  color: string;
  size: number;
  zIndex: number;
}

export interface Scene {
  /** 場面の同一性。変わったら配置し直す。 */
  key: string;
  center: string | null;
  nodes: SceneNode[];
  edges: SceneEdge[];
  extent: number;
}

const initialOf = (label: string) => Array.from(label.trim())[0] ?? "?";

function tooltipOf(n: ViewNode): string | undefined {
  if (n.kind === "ch" && n.voices?.length) return `CV: ${n.voices.join(" / ")}`;
  if (n.kind === "wk" && n.note) return n.note;
  if (n.kind === "more") return "クリックで一覧を開く";
  return undefined;
}

function styleNode(n: ViewNode, p: Placed, trail: Set<string>): SceneNode {
  const style = KIND_STYLE[n.kind];
  const isCenter = n.slot === Slot.Center;
  const onTrail = !isCenter && trail.has(n.id);
  const anchored = n.slot === Slot.Top || n.slot === Slot.Bottom || n.slot === Slot.Context;
  return {
    id: n.id,
    label: n.label,
    kind: n.kind,
    x: p.x,
    y: p.y,
    size: p.size * style.scale,
    color: style.color,
    shape: style.shape,
    // 2 段目以降は小さく薄く描く。
    opacity: n.level >= 3 ? 0.5 : n.level === 2 ? 0.75 : 1,
    borderColor: isCenter ? COLORS.centerRing : onTrail ? COLORS.trailRing : style.color,
    borderSize: isCenter ? 3 : onTrail ? 2 : 0,
    labelColor: n.level >= 2 || n.kind === "more" ? COLORS.labelDim : COLORS.label,
    labelSize: isCenter ? 15 : n.level >= 2 ? 10 : 12,
    forceLabel: isCenter || anchored || n.kind === "more",
    initial: n.kind === "more" ? "…" : initialOf(n.label),
    note: n.slot === Slot.Top && n.kind === "va" ? n.note : undefined,
    tooltip: tooltipOf(n),
    origin: n.group ?? undefined,
    target: n.kind === "more" ? (n.group ?? n.id) : n.id,
    zIndex: isCenter ? 3 : n.level <= 1 ? 2 : 1,
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

export function sceneFromView(view: ViewData, trail: string[]): Scene {
  const nodes = [...view.nodes, ...moreNodes(view)];
  const { positions, extent } = layoutView({ ...view, nodes });
  const trailSet = new Set(trail);
  const level = new Map(nodes.map((n) => [n.id, n.level]));
  const sceneNodes = nodes.map((n) => {
    const s = styleNode(n, positions.get(n.id)!, trailSet);
    if (n.kind === "more") s.target = n.id.slice("more:".length);
    return s;
  });

  const edges: SceneEdge[] = view.edges.map((e) => {
    const dim = Math.max(level.get(e.a) ?? 0, level.get(e.b) ?? 0) >= 2;
    return { a: e.a, b: e.b, color: edgeColor(e.type, e.role, dim), size: dim ? 0.6 : e.role === 0 ? 1.4 : 1, zIndex: 0 };
  });
  for (const h of view.hidden) {
    edges.push({ a: h.parent, b: `more:${h.parent}`, color: "rgba(120, 132, 160, 0.3)", size: 1, zIndex: 0 });
  }
  // 足跡: 辿ってきたノードどうしを薄い線で結ぶ（実エッジが無くても残す）。
  const has = new Set(edges.flatMap((e) => [`${e.a}|${e.b}`, `${e.b}|${e.a}`]));
  for (let i = 1; i < trail.length; i++) {
    const [a, b] = [trail[i - 1], trail[i]];
    if (a !== b && positions.has(a) && positions.has(b) && !has.has(`${a}|${b}`)) {
      edges.push({ a, b, color: COLORS.trail, size: 1.2, zIndex: 1 });
      has.add(`${a}|${b}`).add(`${b}|${a}`);
    }
  }
  return { key: `view:${view.center}`, center: view.center, nodes: sceneNodes, edges, extent };
}

export function sceneFromPath(path: PathData): Scene {
  const { positions, extent } = layoutPath(path.nodes);
  const nodes: SceneNode[] = path.nodes.map((n, i) => {
    const p = positions.get(n.id)!;
    const style = KIND_STYLE[n.kind];
    const end = i === 0 || i === path.nodes.length - 1;
    return {
      id: n.id,
      label: n.label,
      kind: n.kind,
      ...p,
      size: p.size * style.scale,
      color: style.color,
      shape: style.shape,
      opacity: 1,
      borderColor: end ? COLORS.centerRing : COLORS.path,
      borderSize: end ? 3 : 1.5,
      labelColor: COLORS.label,
      labelSize: 12,
      forceLabel: true,
      initial: initialOf(n.label),
      tooltip: n.kind === "more" ? undefined : `${KIND_LABEL[n.kind]}${n.sub ? `・${n.sub}` : ""}（クリックで中心にする）`,
      target: n.id,
      zIndex: 2,
    };
  });
  const edges: SceneEdge[] = path.nodes.slice(1).map((n, i) => ({
    a: path.nodes[i].id,
    b: n.id,
    color: COLORS.path,
    size: 2.6,
    zIndex: 1,
  }));
  return { key: `path:${path.nodes.map((n) => n.id).join(">")}`, center: null, nodes, edges, extent };
}
