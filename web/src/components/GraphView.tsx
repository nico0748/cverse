import Graph from "graphology";
import { useEffect, useRef } from "react";
import Sigma from "sigma";
import { layerFill, sdfCircle } from "sigma/rendering";
import { DUR, HINGE_HOLD, REDUCED_FADE, clamp01, ease, lerp, prefersReducedMotion } from "../lib/motion";
import type { EdgeStyle, Scene, SceneEdge, SceneNode } from "../lib/scene";
import { planScene, progressAt, valueAt, type Attrs, type Tween } from "../lib/sceneMotion";
import { FOCUS_Y, dropQueued, onSpriteReady, sprite } from "../lib/sprites";
import { CORNER, HALF, alpha, readPalette, type Palette, type Shape, type ThemeName } from "../lib/theme";
import { KIND_LABEL } from "../lib/types";

interface Props {
  scene: Scene | null;
  onNodeClick: (node: SceneNode) => void;
  /** 経路の端点を選んでいる最中か（カーソルを変える）。 */
  picking?: boolean;
  /** 配色（変わったら描き直す）。 */
  theme: ThemeName;
  /** 拡大・縮小・全体表示のボタンを出すか。 */
  zoomControls?: boolean;
  /** 読み上げ用の説明。 */
  label: string;
}

const LONG_PRESS = 450;
const FONT_UI = '"BIZ UDPGothic", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Meiryo", "Noto Sans JP", system-ui, sans-serif';
// 名前と頭文字は見出しの書体の 700。無い字は本文のゴシックで出す（styles.css の --font-display と揃える）。
const FONT_DISPLAY = `"Zen Maru Gothic", ${FONT_UI}`;

/** 出始め・消えかけのノードは押せない（親に重なって見えない子を押させない）。 */
const CLICKABLE = 0.5;
/**
 * 線の不透明度をまとめて書き換えるときの印。Sigma 4.0.6 は印に zIndex が無いと「並べ直し不要」とみなし、
 * まだ並べていない（同じフレームに足した）線で例外を出すので、zIndex も含めて並べ直させる。
 */
const EDGE_HINTS = { attributes: ["opacity", "zIndex"] };

/** 角丸の四角（正方形と縦長）。キャンバスの重ね描き（roundRect）と同じ形になるよう、比率を埋め込む。 */
const boxShape = (name: Shape) => ({
  name,
  glsl: /* glsl */ `
float sdf_${name}(vec2 uv, float size) {
  vec2 ext = vec2(size * ${HALF[name].w.toFixed(3)}, size * ${HALF[name].h.toFixed(3)});
  float r = ext.x * ${CORNER[name].toFixed(3)};
  vec2 d = abs(uv) - (ext - vec2(r));
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}`,
  inradiusFactor: Math.min(HALF[name].w, Math.SQRT1_2),
});

function createSigma(graph: Graph, container: HTMLElement) {
  return new Sigma(graph, container, {
    primitives: {
      nodes: {
        // 種類は形でも区別する: 声優 = 丸、キャラ = 角丸の四角、作品 = 縦長の四角。
        shapes: [sdfCircle(), boxShape("rounded"), boxShape("poster")],
        layers: [layerFill()],
      },
    },
    styles: {
      nodes: {
        x: { attribute: "x" },
        y: { attribute: "y" },
        size: { attribute: "size", defaultValue: 10 },
        color: { attribute: "color", defaultValue: "#888" },
        opacity: { attribute: "opacity", defaultValue: 1 },
        shape: { attribute: "shape", defaultValue: "circle" },
        zIndex: { attribute: "zIndex", defaultValue: 0 },
        labelVisibility: "hidden",
        backdropVisibility: "hidden",
        cursor: "pointer",
      },
      edges: {
        size: { attribute: "size", defaultValue: 1 },
        color: { attribute: "color", defaultValue: "#888" },
        opacity: { attribute: "opacity", defaultValue: 1 },
        zIndex: { attribute: "zIndex", defaultValue: 0 },
      },
    },
    settings: {
      // 大きさを座標と同じ単位で持ち、ズームに合わせて拡大縮小する（地図のように）。
      itemSizesReference: "positions",
      zoomToSizeRatioFunction: (ratio) => ratio,
      autoRescale: true,
      stagePadding: 16,
      // 配置は計算で決まるので、ノードは動かせないようにする（指でなぞったら図が動く）。
      enableNodeDrag: false,
      // 枠の高さが 0 のとき（極端に低い窓など）も、例外にせず待つ。
      allowInvalidContainer: true,
      enableCameraRotation: false,
      minCameraRatio: 0.12,
      maxCameraRatio: 3,
    },
  });
}

/** これより線が多い図は、線を 1 段引いて描く。 */
const CROWDED = 60;
const crowdedScene = (scene: Scene | null) => (scene?.edges.length ?? 0) > CROWDED;

/**
 * 線の色と太さ。「演じる」は声優の色、「登場する」は墨色で、メインキャラは太く、それ以外は細く引く。
 * 地の上で線として読める濃さ（3:1 前後）を保ち、2 段目より先だけ少し引く。
 */
function edgeLook(e: SceneEdge, p: Palette, crowded = false): { color: string; size: number; zIndex: number } {
  // 線が多い図（出演の多い声優など）は、放射状の線が絵と名札を覆わないよう 1 段引く。
  const fade = (e.dim ? 0.6 : 1) * (crowded ? 0.62 : 1);
  const by: Record<EdgeStyle, { color: string; size: number; zIndex: number }> = {
    voices: { color: alpha(p.kinds.va.ring, 0.92 * fade), size: e.dim ? 0.9 : 1.8, zIndex: 0 },
    appears: { color: alpha(p.inkDim, (e.role === 0 ? 0.78 : 0.5) * fade), size: e.dim ? 0.8 : e.role === 0 ? 1.7 : 1.1, zIndex: 0 },
    series: { color: alpha(p.kinds.wk.ring, 0.9 * fade), size: e.dim ? 0.9 : 1.8, zIndex: 0 },
    relation: { color: alpha(p.accent, 0.7 * fade), size: 1.2, zIndex: 0 },
    more: { color: alpha(p.inkDim, 0.4), size: 1, zIndex: 0 },
    trail: { color: alpha(p.ink, 0.45), size: 1.3, zIndex: 1 },
    path: { color: p.accent, size: 3.2, zIndex: 1 },
  };
  return by[e.style];
}

type Rect = [number, number, number, number];

/** Sigma のキャンバス（線と当たり判定）と、画像・頭文字・名札・ツールチップの重ね描き。 */
export function GraphView({ scene, onNodeClick, picking = false, theme, zoomControls = false, label }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  if (!graphRef.current) graphRef.current = new Graph({ type: "undirected" });
  const nodesRef = useRef(new Map<string, SceneNode>());
  /** 前の場面にいて、薄れて消えていく途中のノード。描くが、押せない。 */
  const leavingRef = useRef(new Map<string, SceneNode>());
  /** 中心の切り替えで動いている途中か。動いているあいだは必ず出す名札だけを描く。 */
  const movingRef = useRef(false);
  /** 着地した時刻。残りの名札はここから短く浮かび上がる。 */
  const landedAtRef = useRef(0);
  /** 前の切り替えを始めた時刻（続けて押されたら短くする）。 */
  const lastStartRef = useRef(-Infinity);
  /** 今の動きが着地する時刻。 */
  const landAtRef = useRef(0);
  /** 蝶番の線（前の中心と新しい中心をつなぐ線）と、元の色に戻すタイマー。 */
  const hingeRef = useRef<SceneEdge | null>(null);
  const hingeTimerRef = useRef(0);
  const sceneRef = useRef<Scene | null>(null);
  const paletteRef = useRef<Palette | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const extentRef = useRef({ x: 200, y: 200 });
  const frameRef = useRef(0);
  /** 名札の文字（幅に合わせて省略したもの）と幅の控え。場面や書体が変わったら捨てる。 */
  const labelCacheRef = useRef(new Map<string, { text: string; width: number }>());
  const clickRef = useRef(onNodeClick);
  clickRef.current = onNodeClick;

  useEffect(() => {
    const container = containerRef.current!;
    const overlay = overlayRef.current!;
    const tip = tipRef.current!;
    const graph = graphRef.current!;
    const sigma = createSigma(graph, container);
    sigmaRef.current = sigma;
    paletteRef.current = readPalette();
    const ctx = overlay.getContext("2d")!;

    /** グラフ座標から画面座標へ（回転しないので、原点と 1 単位ぶんの位置から求められる）。 */
    const projection = () => {
      const o = sigma.graphToViewport({ x: 0, y: 0 });
      const u = sigma.graphToViewport({ x: 1, y: 0 });
      const v = sigma.graphToViewport({ x: 0, y: 1 });
      return { o, ux: u.x - o.x, vy: v.y - o.y, scale: Math.abs(u.x - o.x) };
    };
    /** ノードの画面上の位置と大きさ（半径にあたる長さ）。 */
    const onScreen = (id: string, pr = projection()) => {
      const { x, y, size } = graph.getNodeAttributes(id) as { x: number; y: number; size: number };
      return { x: pr.o.x + x * pr.ux, y: pr.o.y + y * pr.vy, r: size * pr.scale };
    };

    const shapePath = (shape: Shape, x: number, y: number, r: number, grow = 0) => {
      ctx.beginPath();
      if (shape === "circle") {
        ctx.arc(x, y, Math.max(0, r + grow), 0, Math.PI * 2);
        return;
      }
      const w = Math.max(0, r * HALF[shape].w + grow);
      const h = Math.max(0, r * HALF[shape].h + grow);
      ctx.roundRect(x - w, y - h, w * 2, h * 2, Math.max(0, Math.min(w, r * HALF[shape].w * CORNER[shape] + grow)));
    };

    interface Item {
      node: SceneNode;
      x: number;
      y: number;
      r: number;
      /** 形の幅と高さの半分（画面上）。 */
      w: number;
      h: number;
      opacity: number;
      priority: number;
      /** 動き終えたときの大きさ（画面上）。絵の細かさはこれで決め、動いている途中に頼み直さない。 */
      rest: number;
    }

    // 1 つのノード: 強調の輪 → 種類の色の輪郭 → 画像（無ければ淡い地に頭文字）。
    const drawTile = ({ node, x, y, r, opacity, rest }: Item, p: Palette, hovered: boolean) => {
      if (r < 3.5) return; // 小さすぎるときは WebGL の点だけ
      const colors = p.kinds[node.kind];
      ctx.globalAlpha = Math.min(1, opacity);
      const halo =
        node.emphasis === "center" ? p.ink : node.emphasis === "end" || node.emphasis === "path" || hovered ? p.accent : null;
      if (halo && r >= 6) {
        const gap = node.emphasis === "center" ? 3 : 2;
        const width = node.emphasis === "center" ? 2.5 : 3;
        shapePath(node.shape, x, y, r, gap + width);
        ctx.fillStyle = halo;
        ctx.fill();
        shapePath(node.shape, x, y, r, gap);
        ctx.fillStyle = p.ground;
        ctx.fill();
      } else if (node.emphasis === "trail" && r >= 6) {
        // 辿ってきたノードは破線の輪で示す。
        shapePath(node.shape, x, y, r, 3.5);
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = p.inkDim;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      shapePath(node.shape, x, y, r);
      ctx.fillStyle = colors.ring;
      ctx.fill();
      // 小さいとき（3 段目など）は種類の色の印だけにする。頭文字の読めない淡い札は出さない。
      if (r < 8) return;
      const edge = Math.max(1.5, Math.min(3, r * 0.09));
      // 画面に出る高さ（端末の画素）に合う細かさの絵を頼む。中心や拡大時は細かい絵に差し替わる。
      const px = 2 * Math.max(r, rest) * HALF[node.shape].h * (window.devicePixelRatio || 1);
      const picture = node.image ? sprite(node.image, node.shape, FOCUS_Y[node.kind], px) : null;
      shapePath(node.shape, x, y, r, -edge);
      ctx.fillStyle = colors.tint;
      ctx.fill();
      if (picture) {
        // 透過のある画像でも、輪郭の色ではなく淡い地が透けるようにしてある。
        const w = r * HALF[node.shape].w - edge;
        const h = r * HALF[node.shape].h - edge;
        ctx.drawImage(picture, x - w, y - h, w * 2, h * 2);
        return;
      }
      ctx.fillStyle = colors.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // 書体の指定は 2px 刻みにして、拡大縮小の途中で作り直す回数を抑える。
      const fontSize = Math.max(8, Math.round((r * HALF[node.shape].w * 0.98) / 2) * 2);
      ctx.font = `700 ${fontSize}px ${FONT_DISPLAY}`;
      ctx.fillText(node.initial, x, y + fontSize * 0.05);
    };

    const measured = (key: string, font: string, text: string, max: number) => {
      const cache = labelCacheRef.current;
      let hit = cache.get(key);
      if (hit) return hit;
      ctx.font = font;
      let width = ctx.measureText(text).width;
      if (width > max) {
        // 幅に収まるところまで削って「…」を付ける。
        const chars = Array.from(text);
        let lo = 1;
        let hi = chars.length - 1;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          if (ctx.measureText(`${chars.slice(0, mid).join("")}…`).width <= max) lo = mid;
          else hi = mid - 1;
        }
        text = `${chars.slice(0, lo).join("")}…`;
        width = ctx.measureText(text).width;
      }
      hit = { text, width };
      cache.set(key, hit);
      return hit;
    };

    // 名札と注記。重なるものは優先度の低いほうを省く（中心・アンカー・ホバー中は必ず出す）。
    const drawLabels = (items: Item[], p: Palette, hovered: string | null, viewWidth: number) => {
      // 名札は、ほかの名札にも、ほかのノードの絵にも重ねない。
      const placed: Rect[] = items.filter((it) => it.r >= 5).map((it) => [it.x - it.w, it.y - it.h, it.x + it.w, it.y + it.h]);
      const hits = (r: Rect) => placed.some(([a, b, c, d]) => r[0] < c && r[2] > a && r[1] < d && r[3] > b);
      ctx.textAlign = "center";
      ctx.lineJoin = "round";
      // 動いているあいだは必ず出す名札だけ。着地したら残りを短く浮かび上がらせる（飛び移って見えないように）。
      const moving = movingRef.current;
      const settle = clamp01((performance.now() - landedAtRef.current) / DUR.fast);
      for (const it of [...items].sort((a, b) => a.priority - b.priority)) {
        const { node, x, y, r, h } = it;
        const isHovered = node.id === hovered;
        const forced = node.forceLabel || isHovered;
        if (!forced && moving) continue;
        // 2 段目より先の名前は、拡大して絵が見える大きさになったとき（か、指したとき）だけ出す。
        if (!forced && r < (node.level >= 2 ? 13 : 8)) continue;
        if (it.opacity < 0.5) continue;
        const center = node.emphasis === "center";
        const outer = node.level >= 2 && !isHovered;
        const size = center ? 17 : outer ? 12 : 13;
        const font = center ? `700 ${size}px ${FONT_DISPLAY}` : `400 ${size}px ${FONT_UI}`;
        const full = center || isHovered || node.emphasis === "path" || node.emphasis === "end";
        const max = Math.min(viewWidth - 24, full ? 260 : outer ? 96 : node.forceLabel ? 176 : 140);
        const { text, width } = measured(`${node.id}|${size}|${max}`, font, node.label, max);
        const padX = outer ? 3 : center ? 9 : 6;
        const height = size + (outer ? 4 : center ? 10 : 7);
        const gap = node.emphasis || isHovered ? 9 : 4;
        const half = width / 2 + padX;
        // 上下の札は、画面の端からはみ出すぶんだけ内側へ寄せる。
        const shift = Math.max(4 - (x - half), 0) + Math.min(viewWidth - 4 - (x + half), 0);
        const below: Rect = [x - half + shift, y + h + gap, x + half + shift, y + h + gap + height];
        const above: Rect = [x - half + shift, y - h - gap - height, x + half + shift, y - h - gap];
        const side = it.w + gap + 2;
        const right: Rect = [x + side, y - height / 2, x + side + half * 2, y + height / 2];
        const left: Rect = [x - side - half * 2, y - height / 2, x - side, y + height / 2];
        // 下が空いていなければ、ほかの置き場所を試す。必ず出す名札は横も試す。どこも空いていないときに
        // 重ねてでも出すのは、中心・指しているノード・経路だけ（ほかは詳細の一覧で読める）。
        const inside = (c: Rect) => c[0] >= 4 && c[2] <= viewWidth - 4;
        const candidates = outer ? [below] : forced ? (node.note ? [below, right, left] : [below, right, left, above]) : [below, above];
        const free = candidates.find((c) => inside(c) && !hits(c));
        if (!free && !full) continue;
        const rect = free ?? below;
        const cx = (rect[0] + rect[2]) / 2;
        placed.push(rect);
        ctx.globalAlpha = Math.min(1, it.opacity) * (forced ? 1 : settle);
        ctx.font = font;
        ctx.textBaseline = "middle";
        const midY = (rect[1] + rect[3]) / 2 + 0.5;
        if (outer) {
          // 2 段目より先は札にせず、地の色で縁取った小さな文字にする。
          ctx.lineWidth = 3.5;
          ctx.strokeStyle = p.ground;
          ctx.strokeText(text, cx, midY);
          ctx.fillStyle = p.inkDim;
          ctx.fillText(text, cx, midY);
        } else {
          ctx.beginPath();
          ctx.roundRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1], 5);
          ctx.fillStyle = p.surface;
          ctx.fill();
          ctx.lineWidth = center || isHovered ? 1.5 : 1;
          ctx.strokeStyle = isHovered || node.emphasis === "path" || node.emphasis === "end" ? p.accent : center ? p.ink : p.lineStrong;
          ctx.stroke();
          ctx.fillStyle = node.kind === "more" ? p.inkDim : p.ink;
          ctx.fillText(text, cx, midY);
        }
        if (node.note && r >= 9) {
          const noteFont = `400 12px ${FONT_UI}`;
          const note = measured(`${node.id}|note`, noteFont, node.note, 120);
          ctx.font = noteFont;
          ctx.textBaseline = "bottom";
          ctx.lineWidth = 3.5;
          ctx.strokeStyle = p.ground;
          ctx.strokeText(note.text, x, y - h - 6);
          ctx.fillStyle = p.inkDim;
          ctx.fillText(note.text, x, y - h - 6);
          placed.push([x - note.width / 2, y - h - 20, x + note.width / 2, y - h - 6]);
        }
      }
    };

    const drawOverlay = () => {
      const p = paletteRef.current;
      if (!p) return;
      const { width, height } = sigma.getDimensions();
      if (width <= 1 || height <= 1) return;
      const ratio = window.devicePixelRatio || 1;
      if (overlay.width !== Math.round(width * ratio) || overlay.height !== Math.round(height * ratio)) {
        overlay.width = Math.round(width * ratio);
        overlay.height = Math.round(height * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      // キャンバスの大きさを変えると描画の設定が戻るので、毎回指定する。
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.clearRect(0, 0, width, height);
      const hovered = hoveredRef.current;
      const pr = projection();
      const items: Item[] = [];
      graph.forEachNode((id, attrs) => {
        const node = nodesRef.current.get(id) ?? leavingRef.current.get(id);
        if (!node) return;
        const x = pr.o.x + attrs.x * pr.ux;
        const y = pr.o.y + attrs.y * pr.vy;
        const r = attrs.size * pr.scale;
        const margin = r + 80;
        if (x < -margin || y < -margin || x > width + margin || y > height + margin) return;
        const rank = node.id === hovered ? 0 : node.emphasis === "center" ? 1 : node.forceLabel ? 2 : 3 + node.level;
        items.push({
          node,
          x,
          y,
          r,
          w: r * HALF[node.shape].w,
          h: r * HALF[node.shape].h,
          opacity: attrs.opacity ?? 1,
          priority: rank * 1000 - r,
          rest: node.size * pr.scale,
        });
      });
      // 奥（遠い段）から描き、中心とホバー中のノードを最後に重ねる。
      const order = (it: Item) => (it.node.id === hovered ? 9 : it.node.emphasis === "center" ? 8 : 4 - Math.min(it.node.level, 3));
      items.sort((a, b) => order(a) - order(b));
      for (const it of items) drawTile(it, p, it.node.id === hovered);
      drawLabels(items, p, hovered, width);
      ctx.globalAlpha = 1;
    };
    sigma.on("afterRender", drawOverlay);
    // 描画の土台（WebGL）が失われたら、古い絵を残さない。戻ったら描き直す。
    sigma.on("webglContextLost", () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, overlay.width, overlay.height);
    });
    sigma.on("webglContextRestored", () => sigma.scheduleRender());
    const redraw = () => sigma.scheduleRender();
    const offSprite = onSpriteReady(redraw);
    // Web フォントは使う文字の分だけ後から届くので、届いたら幅を測り直して描き直す。
    const onFonts = () => {
      labelCacheRef.current.clear();
      redraw();
    };
    document.fonts?.addEventListener?.("loadingdone", onFonts);

    const showTip = (id: string) => {
      const node = nodesRef.current.get(id);
      if (!node) return;
      const { x, y, r } = onScreen(id);
      const h = r * HALF[node.shape].h;
      const { width } = sigma.getDimensions();
      const kind = node.kind === "more" ? "" : KIND_LABEL[node.kind];
      const sub = [kind, node.tooltip].filter(Boolean).join("・");
      if (!sub) {
        tip.hidden = true;
        return;
      }
      // 名前は名札に全文が出るので、ここには種類と補足だけを出す。
      tip.textContent = sub;
      // 上に出す余地が無ければ、名札の下に出す。左右は画面からはみ出さないよう寄せる。
      const above = y - h - 14 > 64;
      const left = Math.max(96, Math.min(width - 96, x));
      tip.style.transform = above
        ? `translate(-50%, -100%) translate(${left}px, ${y - h - 14}px)`
        : `translate(-50%, 0) translate(${left}px, ${y + h + 42}px)`;
      tip.hidden = false;
    };
    const hideTip = () => {
      tip.hidden = true;
    };
    const setHovered = (id: string | null) => {
      if (hoveredRef.current === id) return;
      hoveredRef.current = id;
      redraw();
    };

    // スマホではホバーが無いので、長押しで補足を出す。
    let pressTimer = 0;
    let suppressClick = false;
    let pressStart = { x: 0, y: 0 };
    // タッチでは「指す」が無い。触れただけで補足が出たり、動いてきたノードに補足が移ったりしないようにする。
    let touching = false;
    const onPointerDown = (e: PointerEvent) => {
      touching = e.pointerType === "touch";
    };
    container.addEventListener("pointerdown", onPointerDown, true);
    /** 押せるノードか（薄れていく途中や、出始めで見えないノードは押せない）。 */
    const clickable = (id: string) =>
      nodesRef.current.has(id) && (graph.getNodeAttribute(id, "opacity") ?? 1) >= CLICKABLE;
    sigma.on("enterNode", ({ node }) => {
      if (touching || !clickable(node)) return;
      setHovered(node);
      showTip(node);
    });
    sigma.on("leaveNode", () => {
      setHovered(null);
      hideTip();
    });
    sigma.on("downNode", ({ node, event }) => {
      suppressClick = false;
      if (!("touches" in event.original)) return;
      window.clearTimeout(pressTimer);
      pressStart = { x: event.x, y: event.y };
      pressTimer = window.setTimeout(() => {
        suppressClick = true;
        setHovered(node);
        showTip(node);
      }, LONG_PRESS);
    });
    // 指が動いたら（図を動かす操作なので）長押しにしない。離したときも同じ。
    const cancelPress = () => window.clearTimeout(pressTimer);
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || e.touches.length > 1) return cancelPress();
      const box = container.getBoundingClientRect();
      if (Math.hypot(t.clientX - box.left - pressStart.x, t.clientY - box.top - pressStart.y) > 8) {
        cancelPress();
        hideTip();
        setHovered(null);
      }
    };
    container.addEventListener("touchmove", onTouchMove, { passive: true });
    container.addEventListener("touchend", cancelPress, { passive: true });
    container.addEventListener("touchcancel", cancelPress, { passive: true });
    sigma.on("clickNode", ({ node }) => {
      window.clearTimeout(pressTimer);
      if (suppressClick || !clickable(node)) return;
      hideTip();
      setHovered(null);
      const data = nodesRef.current.get(node);
      if (data) clickRef.current(data);
    });
    sigma.on("clickStage", () => {
      hideTip();
      setHovered(null);
    });

    // 枠の大きさが変わったら（スマホのシートの開閉など）描き直す。Sigma の resize() は消すだけで描かない。
    const resize = new ResizeObserver(() => {
      if (!container.offsetWidth || !container.offsetHeight) return;
      sigma.resize();
      sigma.scheduleRender();
    });
    resize.observe(container);
    // 画面の密度が変わったら（別のモニターへ移したときなど）、WebGL 側も作り直す。
    let dpr: MediaQueryList | null = null;
    const onDpr = () => {
      dpr?.removeEventListener("change", onDpr);
      dpr = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dpr.addEventListener("change", onDpr);
      sigma.resize(true);
      sigma.scheduleRender();
    };
    dpr = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dpr.addEventListener("change", onDpr);
    return () => {
      window.clearTimeout(pressTimer);
      container.removeEventListener("pointerdown", onPointerDown, true);
      dpr?.removeEventListener("change", onDpr);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", cancelPress);
      container.removeEventListener("touchcancel", cancelPress);
      resize.disconnect();
      offSprite();
      document.fonts?.removeEventListener?.("loadingdone", onFonts);
      cancelAnimationFrame(frameRef.current);
      window.clearTimeout(hingeTimerRef.current);
      sigma.kill();
      sigmaRef.current = null;
    };
  }, []);

  // 配色が変わったら、線とノードの色を塗り直す。
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current!;
    if (!sigma) return;
    const p = readPalette();
    paletteRef.current = p;
    graph.forEachNode((id) => {
      const node = nodesRef.current.get(id);
      if (node) graph.setNodeAttribute(id, "color", p.kinds[node.kind].ring);
    });
    for (const e of sceneRef.current?.edges ?? []) {
      if (graph.hasEdge(e.a, e.b)) graph.mergeEdgeAttributes(e.a, e.b, edgeLook(e, p, crowdedScene(sceneRef.current)));
    }
    sigma.scheduleRender();
  }, [theme]);

  // 場面が変わったら、前の画面にもいたノードは今の位置から滑らかに動かす（メンタルマップの維持）。
  // 動きの決まりは docs/motion.md。計画は lib/sceneMotion.ts の純粋な関数で立てる。
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current!;
    const p = paletteRef.current;
    const root = rootRef.current;
    if (!sigma || !p) return;
    cancelAnimationFrame(frameRef.current);
    window.clearTimeout(hingeTimerRef.current);
    const keyChanged = sceneRef.current?.key !== scene?.key;
    /** 蝶番の線を元の色に戻す。 */
    const unhinge = () => {
      const e = hingeRef.current;
      hingeRef.current = null;
      if (!e || !graph.hasEdge(e.a, e.b)) return;
      graph.mergeEdgeAttributes(e.a, e.b, edgeLook(e, paletteRef.current ?? p, crowdedScene(sceneRef.current)));
      sigma.scheduleRender();
    };
    if (keyChanged || !scene) unhinge();
    if (tipRef.current) tipRef.current.hidden = true;
    hoveredRef.current = null;
    const previous = sceneRef.current;
    sceneRef.current = scene;
    labelCacheRef.current.clear();
    // 前の場面のために待っていた画像は後回しにして、今の場面の画像から読む。
    dropQueued();
    if (!scene) {
      graph.clear();
      nodesRef.current = new Map();
      leavingRef.current = new Map();
      movingRef.current = false;
      return;
    }

    const next = new Map(scene.nodes.map((n) => [n.id, n]));
    const reduced = prefersReducedMotion();
    const started = performance.now();
    const first = graph.order === 0;
    // 同じ中心のまま、動きの途中で届いた更新（足跡・絞り込み）は、残りの時間で着地させる。
    const remaining = landAtRef.current - started;
    const duration = !keyChanged && movingRef.current && remaining > 0 ? Math.max(DUR.fast, remaining) : undefined;
    // 中心の切り替えが終わる前に次の中心が来たら、次は短く動かす（続けて押す人を待たせない）。
    // 同じ中心のまま足跡や絞り込みだけが変わった更新は数えない（1 回の操作で 2 回届くことがある）。
    const rapid = keyChanged && started - lastStartRef.current < DUR.scene;
    if (keyChanged) lastStartRef.current = started;

    // 前の場面のノードのうち、次にいないものは薄れて消える。前の切り替えで消えかけていたものは、すぐ落とす。
    const prevNodes = nodesRef.current;
    const leaving = new Map<string, SceneNode>();
    for (const id of graph.nodes()) {
      if (next.has(id)) continue;
      const old = prevNodes.get(id);
      if (!old || reduced || leavingRef.current.has(id)) graph.dropNode(id);
      else leaving.set(id, old);
    }
    const before = new Map<string, Attrs>();
    graph.forEachNode((id, a) => before.set(id, { x: a.x, y: a.y, size: a.size, opacity: a.opacity ?? 1 }));
    const o = sigma.graphToViewport({ x: 0, y: 0 });
    const yDown = sigma.graphToViewport({ x: 0, y: 1 }).y > o.y;
    const plan = planScene(before, scene.nodes, { center: scene.center, reduced: reduced || first, rapid, yDown, duration });
    const tweens = new Map<string, Tween>(plan.tweens.map((tw) => [tw.id, tw]));

    for (const n of scene.nodes) {
      const visual = {
        color: p.kinds[n.kind].ring,
        shape: n.shape,
        zIndex: n.emphasis === "center" ? 3 : n.level <= 1 ? 2 : 1,
      };
      if (graph.hasNode(n.id)) graph.mergeNodeAttributes(n.id, visual);
      else graph.addNode(n.id, { ...visual, ...valueAt(tweens.get(n.id)!, 0) });
    }
    for (const id of leaving.keys()) graph.setNodeAttribute(id, "zIndex", 0);

    // 線も残せるものは残す。消えるノードの線はノードと一緒に薄れ、ほかの古い線は落とす。
    const pair = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
    const wanted = new Set(scene.edges.map((e) => pair(e.a, e.b)));
    const crowded = crowdedScene(scene);
    graph.forEachEdge((key, _attrs, a, b) => {
      if (!wanted.has(pair(a, b)) && !leaving.has(a) && !leaving.has(b)) graph.dropEdge(key);
    });
    for (const e of scene.edges) {
      if (!graph.hasNode(e.a) || !graph.hasNode(e.b)) continue;
      const look = edgeLook(e, p, crowded);
      if (graph.hasEdge(e.a, e.b)) graph.mergeEdgeAttributes(e.a, e.b, look);
      else graph.addEdge(e.a, e.b, look);
    }
    nodesRef.current = next;
    leavingRef.current = leaving;

    // 見せ場「縁が蝶番になる」: 前の中心と新しい中心をつなぐ線（いまたどった縁）を、動いているあいだ牡丹にする。
    // つながっていない人へ飛んだときは線が無いので、何もしない。動きを減らす設定でも残す（色は前庭に負担をかけない）。
    const from = keyChanged ? previous?.center : null;
    const hinge =
      from && scene.center && from !== scene.center && graph.hasEdge(from, scene.center)
        ? scene.edges.find((e) => pair(e.a, e.b) === pair(from, scene.center!))
        : undefined;
    if (hinge) {
      hingeRef.current = hinge;
      graph.mergeEdgeAttributes(hinge.a, hinge.b, { color: p.accent, size: 3.2, zIndex: 2 });
    }
    // 線を引き直したときに色が戻らないよう、まだ蝶番が残っていれば塗り直す。
    const held = hingeRef.current;
    if (held && graph.hasEdge(held.a, held.b)) {
      if (!hinge) graph.mergeEdgeAttributes(held.a, held.b, { color: p.accent, size: 3.2, zIndex: 2 });
      // 着地して少したったら戻す。動きを減らす設定でも、色の変化だけは見えるだけの時間を残す。
      hingeTimerRef.current = window.setTimeout(unhinge, Math.max(plan.total, reduced ? DUR.scene : 0) + HINGE_HOLD);
    }

    // 見出しの書体は、実際に描く文字（中心の名前と、画像が無いノードの頭文字）の分だけ取りに行く。
    const display = scene.nodes.filter((n) => !n.image).map((n) => n.initial).join("") + (next.get(scene.center ?? "")?.label ?? "");
    if (display) void document.fonts?.load?.(`700 17px ${FONT_DISPLAY}`, display)?.catch(() => {});

    // 動きを減らす設定: 位置もカメラも即時にして、図全体を短い透明度で切り替える。
    if (reduced && !first) root?.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: REDUCED_FADE, easing: "linear" });

    const extentFrom = extentRef.current;
    // 中心が変わったときだけ視点を戻す。段数や絞り込みを変えただけなら、利用者の拡大・位置を保つ。
    // カメラもノードと同じ曲線・同じ時計（この rAF）で動かす。
    const cam = sigma.getCamera();
    cam.cancelAnimation();
    const camFrom = keyChanged ? cam.getState() : null;
    movingRef.current = plan.total > 0;
    landAtRef.current = started + plan.total;
    if (root) root.dataset.motion = movingRef.current ? "moving" : "idle";

    const settle = (now: number) => {
      // 着地のあと、名札が浮かび上がるあいだだけ描き続ける。
      sigma.scheduleRender();
      if (now - landedAtRef.current < DUR.fast) frameRef.current = requestAnimationFrame(settle);
    };
    const step = (now: number) => {
      const t = now - started;
      graph.updateEachNodeAttributes((id, a) => {
        const tw = tweens.get(id);
        if (!tw) return a;
        const v = valueAt(tw, t);
        a.x = v.x;
        a.y = v.y;
        a.size = v.size;
        a.opacity = v.opacity;
        return a;
      });
      // 線は両端の薄い方に合わせる（線だけ先に出たり、宙に残ったりしない）。
      graph.updateEachEdgeAttributes((_e, a, _s, _t, sa, ta) => {
        a.opacity = Math.min(sa.opacity ?? 1, ta.opacity ?? 1);
        return a;
      }, EDGE_HINTS);
      const k = progressAt(plan, t);
      const extent = { x: lerp(extentFrom.x, scene.extent.x, k), y: lerp(extentFrom.y, scene.extent.y, k) };
      extentRef.current = extent;
      sigma.setCustomBBox({ x: [-extent.x, extent.x], y: [-extent.y, extent.y] });
      if (camFrom) {
        cam.setState({ x: lerp(camFrom.x, 0.5, k), y: lerp(camFrom.y, 0.5, k), ratio: lerp(camFrom.ratio, 1, k), angle: 0 });
      }
      if (t < plan.total) {
        sigma.scheduleRender();
        frameRef.current = requestAnimationFrame(step);
        return;
      }
      for (const id of leavingRef.current.keys()) if (graph.hasNode(id)) graph.dropNode(id);
      leavingRef.current = new Map();
      movingRef.current = false;
      landedAtRef.current = now;
      if (root) root.dataset.motion = "idle";
      settle(now);
    };
    step(started);
  }, [scene]);

  const camera = () => sigmaRef.current?.getCamera();
  return (
    <div ref={rootRef} className={`graph${picking ? " graph--picking" : ""}`} data-motion="idle">
      <div ref={containerRef} className="graph__stage" role="img" aria-label={label} />
      <canvas ref={overlayRef} className="graph__overlay" aria-hidden="true" />
      <div ref={tipRef} className="graph__tip" aria-hidden="true" hidden />
      {zoomControls && (
        <div className="zoom" role="group" aria-label="グラフの表示">
          <button type="button" aria-label="拡大" title="拡大" onClick={() => void camera()?.zoomIn({ duration: DUR.base, easing: ease.move })}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
          </button>
          <button type="button" aria-label="縮小" title="縮小" onClick={() => void camera()?.zoomOut({ duration: DUR.base, easing: ease.move })}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg>
          </button>
          <button type="button" aria-label="全体を表示" title="全体を表示" onClick={() => void camera()?.reset({ duration: DUR.base, easing: ease.move })}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}
