import Graph from "graphology";
import { useEffect, useRef } from "react";
import Sigma from "sigma";
import { layerFill, sdfCircle } from "sigma/rendering";
import type { EdgeStyle, Scene, SceneEdge, SceneNode } from "../lib/scene";
import { FOCUS_Y, onSpriteReady, sprite } from "../lib/sprites";
import { CORNER, alpha, readPalette, type Palette, type Shape, type ThemeName } from "../lib/theme";
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

const DURATION = 480;
const LONG_PRESS = 450;
const FONT_UI = '"BIZ UDPGothic", "Hiragino Sans", "Yu Gothic UI", "Meiryo", system-ui, sans-serif';
const FONT_DISPLAY = '"Shippori Mincho B1", "Hiragino Mincho ProN", "Yu Mincho", serif';

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 角丸の四角。キャンバスの重ね描き（roundRect）と同じ丸みになるよう、比率を埋め込む。 */
const roundedShape = (name: Shape) => ({
  name,
  glsl: /* glsl */ `
float sdf_${name}(vec2 uv, float size) {
  float r = size * ${CORNER[name].toFixed(3)};
  vec2 d = abs(uv) - vec2(size - r);
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}`,
  inradiusFactor: Math.SQRT1_2,
});

function createSigma(graph: Graph, container: HTMLElement) {
  return new Sigma(graph, container, {
    primitives: {
      nodes: {
        // 種類は形でも区別する: 声優 = 丸、キャラ = 角丸、作品 = 四角。
        shapes: [sdfCircle(), roundedShape("rounded"), roundedShape("square")],
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
        zIndex: { attribute: "zIndex", defaultValue: 0 },
      },
    },
    settings: {
      // 大きさを座標と同じ単位で持ち、ズームに合わせて拡大縮小する（地図のように）。
      itemSizesReference: "positions",
      zoomToSizeRatioFunction: (ratio) => ratio,
      autoRescale: true,
      stagePadding: 28,
      enableNodeDrag: true,
      enableCameraRotation: false,
      minCameraRatio: 0.12,
      maxCameraRatio: 3,
    },
  });
}

/** 線の色と太さ。種類の色を薄く引き、主役の線は少し強くする。 */
function edgeLook(e: SceneEdge, p: Palette): { color: string; size: number; zIndex: number } {
  const fade = e.dim ? 0.5 : 1;
  const by: Record<EdgeStyle, { color: string; size: number; zIndex: number }> = {
    voices: { color: alpha(p.kinds.va.ring, 0.62 * fade), size: e.dim ? 0.7 : 1.4, zIndex: 0 },
    appears: { color: alpha(p.inkDim, (e.role === 0 ? 0.5 : 0.26) * fade), size: e.dim ? 0.6 : e.role === 0 ? 1.4 : 1, zIndex: 0 },
    series: { color: alpha(p.kinds.wk.ring, 0.7 * fade), size: e.dim ? 0.7 : 1.4, zIndex: 0 },
    relation: { color: alpha(p.accent, 0.5 * fade), size: 1, zIndex: 0 },
    more: { color: alpha(p.inkDim, 0.25), size: 1, zIndex: 0 },
    trail: { color: alpha(p.ink, 0.34), size: 1.3, zIndex: 1 },
    path: { color: p.accent, size: 2.8, zIndex: 1 },
  };
  return by[e.style];
}

const truncate = (text: string, max: number) => {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text;
};

/** Sigma のキャンバス（線と当たり判定）と、画像・頭文字・名前・ツールチップの重ね描き。 */
export function GraphView({ scene, onNodeClick, picking = false, theme, zoomControls = false, label }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph>(new Graph());
  const nodesRef = useRef(new Map<string, SceneNode>());
  const sceneRef = useRef<Scene | null>(null);
  const paletteRef = useRef<Palette | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const extentRef = useRef({ x: 200, y: 200 });
  const frameRef = useRef(0);
  const clickRef = useRef(onNodeClick);
  clickRef.current = onNodeClick;

  useEffect(() => {
    const container = containerRef.current!;
    const overlay = overlayRef.current!;
    const tip = tipRef.current!;
    const graph = graphRef.current;
    const sigma = createSigma(graph, container);
    sigmaRef.current = sigma;
    paletteRef.current = readPalette();
    const ctx = overlay.getContext("2d")!;

    /** ノードの画面上の位置と半径。 */
    const onScreen = (id: string) => {
      const { x, y, size } = graph.getNodeAttributes(id) as { x: number; y: number; size: number };
      const p = sigma.graphToViewport({ x, y });
      const q = sigma.graphToViewport({ x: x + size, y });
      return { x: p.x, y: p.y, r: Math.abs(q.x - p.x) };
    };

    const shapePath = (shape: Shape, x: number, y: number, r: number) => {
      ctx.beginPath();
      if (shape === "circle") ctx.arc(x, y, r, 0, Math.PI * 2);
      else ctx.roundRect(x - r, y - r, r * 2, r * 2, r * CORNER[shape]);
    };

    interface Item {
      node: SceneNode;
      x: number;
      y: number;
      r: number;
      opacity: number;
    }

    // 1 つのノード: 強調の輪 → 種類の色の輪郭 → 画像（無ければ淡い地に頭文字）。
    const drawTile = ({ node, x, y, r, opacity }: Item, p: Palette, hovered: boolean) => {
      if (r < 3.5) return; // 小さすぎるときは WebGL の点だけ
      const colors = p.kinds[node.kind];
      ctx.globalAlpha = Math.min(1, opacity);
      const halo =
        node.emphasis === "center" ? p.ink : node.emphasis === "end" || node.emphasis === "path" || hovered ? p.accent : null;
      if (halo && r >= 6) {
        const gap = node.emphasis === "center" ? 3 : 2;
        const width = node.emphasis === "center" || node.emphasis === "end" ? 2.5 : 1.75;
        shapePath(node.shape, x, y, r + gap + width);
        ctx.fillStyle = halo;
        ctx.fill();
        shapePath(node.shape, x, y, r + gap);
        ctx.fillStyle = p.ground;
        ctx.fill();
      } else if (node.emphasis === "trail" && r >= 6) {
        // 辿ってきたノードは破線の輪で示す。
        shapePath(node.shape, x, y, r + 3);
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = p.inkDim;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      shapePath(node.shape, x, y, r);
      ctx.fillStyle = colors.ring;
      ctx.fill();
      if (r < 6) return;
      const inner = r - Math.max(1.5, Math.min(3, r * 0.1));
      const picture = node.image ? sprite(node.image, node.shape, FOCUS_Y[node.kind]) : null;
      if (picture) {
        ctx.drawImage(picture, x - inner, y - inner, inner * 2, inner * 2);
        return;
      }
      shapePath(node.shape, x, y, inner);
      ctx.fillStyle = colors.tint;
      ctx.fill();
      if (inner < 7) return;
      ctx.fillStyle = colors.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.round(inner * 1.02)}px ${FONT_DISPLAY}`;
      ctx.fillText(node.initial, x, y + inner * 0.05);
    };

    // 名前と注記。重なるものは優先度の低いほうを省く（中心・アンカー・ホバー中は必ず出す）。
    const drawLabels = (items: Item[], p: Palette, hovered: string | null) => {
      // 名前は、ほかの名前にも、ほかのノードの絵にも重ねない。
      const placed: [number, number, number, number][] = items
        .filter((it) => it.r >= 5)
        .map((it) => [it.x - it.r, it.y - it.r, it.x + it.r, it.y + it.r]);
      const hits = (x0: number, y0: number, x1: number, y1: number) =>
        placed.some(([a, b, c, d]) => x0 < c && x1 > a && y0 < d && y1 > b);
      const priority = (it: Item) =>
        (it.node.id === hovered ? 0 : it.node.emphasis === "center" ? 1 : it.node.forceLabel ? 2 : 3 + it.node.level) * 1000 - it.r;
      ctx.textAlign = "center";
      ctx.lineJoin = "round";
      for (const it of [...items].sort((a, b) => priority(a) - priority(b))) {
        const { node, x, y, r } = it;
        const forced = node.forceLabel || node.id === hovered;
        if (!forced && r < (node.level >= 2 ? 7 : 8)) continue;
        if (it.opacity < 0.5) continue;
        const center = node.emphasis === "center";
        const size = center ? 16 : node.level >= 2 ? 11 : 12;
        ctx.font = center ? `700 ${size}px ${FONT_DISPLAY}` : `${node.level >= 2 ? 400 : 700} ${size}px ${FONT_UI}`;
        const full = center || node.id === hovered || node.emphasis === "path" || node.emphasis === "end";
        const text = full ? node.label : truncate(node.label, node.forceLabel ? 14 : 11);
        const width = ctx.measureText(text).width;
        const top = y + r + (node.emphasis ? 9 : 5);
        const rect: [number, number, number, number] = [x - width / 2 - 3, top - 1, x + width / 2 + 3, top + size + 3];
        if (!forced && hits(...rect)) continue;
        placed.push(rect);
        ctx.globalAlpha = Math.min(1, it.opacity);
        ctx.textBaseline = "top";
        ctx.lineWidth = 4;
        ctx.strokeStyle = p.ground;
        ctx.strokeText(text, x, top);
        ctx.fillStyle = node.level >= 2 || node.kind === "more" ? p.inkDim : p.ink;
        ctx.fillText(text, x, top);
        if (node.note && r >= 9) {
          ctx.font = `400 11px ${FONT_UI}`;
          ctx.textBaseline = "bottom";
          ctx.lineWidth = 3;
          ctx.strokeText(node.note, x, y - r - 6);
          ctx.fillStyle = p.inkDim;
          ctx.fillText(node.note, x, y - r - 6);
        }
      }
    };

    const drawOverlay = () => {
      const p = paletteRef.current;
      if (!p) return;
      const { width, height } = sigma.getDimensions();
      const ratio = window.devicePixelRatio || 1;
      if (overlay.width !== Math.round(width * ratio) || overlay.height !== Math.round(height * ratio)) {
        overlay.width = Math.round(width * ratio);
        overlay.height = Math.round(height * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const hovered = hoveredRef.current;
      const items: Item[] = [];
      graph.forEachNode((id, attrs) => {
        const node = nodesRef.current.get(id);
        if (!node) return;
        const { x, y, r } = onScreen(id);
        const margin = r + 60;
        if (x < -margin || y < -margin || x > width + margin || y > height + margin) return;
        items.push({ node, x, y, r, opacity: attrs.opacity ?? 1 });
      });
      // 奥（遠い段）から描き、中心とホバー中のノードを最後に重ねる。
      const order = (it: Item) => (it.node.id === hovered ? 9 : it.node.emphasis === "center" ? 8 : 4 - Math.min(it.node.level, 3));
      items.sort((a, b) => order(a) - order(b));
      for (const it of items) drawTile(it, p, it.node.id === hovered);
      drawLabels(items, p, hovered);
      ctx.globalAlpha = 1;
    };
    sigma.on("afterRender", drawOverlay);
    const redraw = () => sigma.scheduleRender();
    const offSprite = onSpriteReady(redraw);
    // Web フォントは使う文字の分だけ後から届くので、届いたら名前を描き直す。
    document.fonts?.addEventListener?.("loadingdone", redraw);

    const showTip = (id: string) => {
      const node = nodesRef.current.get(id);
      if (!node) return;
      const { x, y, r } = onScreen(id);
      const { width } = sigma.getDimensions();
      const kind = node.kind === "more" ? "" : KIND_LABEL[node.kind];
      tip.replaceChildren();
      const name = document.createElement("strong");
      name.textContent = node.label;
      tip.append(name);
      const sub = [kind, node.tooltip].filter(Boolean).join("・");
      if (sub) {
        const line = document.createElement("span");
        line.textContent = sub;
        tip.append(line);
      }
      // 上に出す余地が無ければ下に出す。左右は画面からはみ出さないよう寄せる。
      const above = y - r - 12 > 64;
      const left = Math.max(96, Math.min(width - 96, x));
      tip.style.transform = above
        ? `translate(-50%, -100%) translate(${left}px, ${y - r - 12}px)`
        : `translate(-50%, 0) translate(${left}px, ${y + r + 30}px)`;
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
    sigma.on("enterNode", ({ node }) => {
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
      pressTimer = window.setTimeout(() => {
        suppressClick = true;
        setHovered(node);
        showTip(node);
      }, LONG_PRESS);
    });
    sigma.on("nodeDragStart", () => {
      window.clearTimeout(pressTimer);
      hideTip();
    });
    sigma.on("clickNode", ({ node }) => {
      window.clearTimeout(pressTimer);
      if (suppressClick) return;
      hideTip();
      setHovered(null);
      const data = nodesRef.current.get(node);
      if (data) clickRef.current(data);
    });
    sigma.on("clickStage", () => {
      hideTip();
      setHovered(null);
    });

    const resize = new ResizeObserver(() => sigma.resize());
    resize.observe(container);
    return () => {
      resize.disconnect();
      offSprite();
      document.fonts?.removeEventListener?.("loadingdone", redraw);
      cancelAnimationFrame(frameRef.current);
      sigma.kill();
      sigmaRef.current = null;
    };
  }, []);

  // 配色が変わったら、線とノードの色を塗り直す。
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma) return;
    const p = readPalette();
    paletteRef.current = p;
    graph.forEachNode((id) => {
      const node = nodesRef.current.get(id);
      if (node) graph.setNodeAttribute(id, "color", p.kinds[node.kind].ring);
    });
    for (const e of sceneRef.current?.edges ?? []) {
      if (graph.hasEdge(e.a, e.b)) graph.mergeEdgeAttributes(e.a, e.b, edgeLook(e, p));
    }
    sigma.scheduleRender();
  }, [theme]);

  // 場面が変わったら、前の画面にもいたノードは今の位置から滑らかに動かす（メンタルマップの維持）。
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    const p = paletteRef.current;
    if (!sigma || !p) return;
    cancelAnimationFrame(frameRef.current);
    if (tipRef.current) tipRef.current.hidden = true;
    hoveredRef.current = null;
    sceneRef.current = scene;
    if (!scene) {
      graph.clear();
      nodesRef.current = new Map();
      return;
    }

    const before = new Map<string, { x: number; y: number; size: number; opacity: number }>();
    graph.forEachNode((id, a) => before.set(id, { x: a.x, y: a.y, size: a.size, opacity: a.opacity ?? 1 }));
    const next = new Map(scene.nodes.map((n) => [n.id, n]));
    // 新しく現れるノードは、親（無ければ新しい中心）が元いた場所から出てくる。
    const centerBefore = (scene.center && before.get(scene.center)) || { x: 0, y: 0 };
    const tweens: { id: string; from: { x: number; y: number; size: number; opacity: number }; to: SceneNode }[] = [];

    graph.clearEdges();
    for (const id of graph.nodes()) if (!next.has(id)) graph.dropNode(id);
    for (const n of scene.nodes) {
      const visual = {
        color: p.kinds[n.kind].ring,
        shape: n.shape,
        zIndex: n.emphasis === "center" ? 3 : n.level <= 1 ? 2 : 1,
      };
      let from = before.get(n.id);
      if (from) {
        graph.mergeNodeAttributes(n.id, visual);
      } else {
        const origin = (n.origin && before.get(n.origin)) || centerBefore;
        from = { x: origin.x, y: origin.y, size: n.size * 0.4, opacity: 0 };
        graph.addNode(n.id, { ...visual, ...from });
      }
      tweens.push({ id: n.id, from, to: n });
    }
    for (const e of scene.edges) {
      if (graph.hasNode(e.a) && graph.hasNode(e.b) && !graph.hasEdge(e.a, e.b)) graph.addEdge(e.a, e.b, edgeLook(e, p));
    }
    nodesRef.current = next;

    // 名前に使う文字の分のフォントを先に取りに行く（届いたら loadingdone で描き直す）。
    const text = scene.nodes.map((n) => n.label).join("");
    void document.fonts?.load?.(`700 12px ${FONT_UI}`, text);
    void document.fonts?.load?.(`700 16px ${FONT_DISPLAY}`, scene.nodes.map((n) => n.initial).join("") + (next.get(scene.center ?? "")?.label ?? ""));

    const extentFrom = extentRef.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduced || before.size === 0 ? 0 : DURATION;
    const started = performance.now();
    void sigma.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1, angle: 0 }, { duration });

    const step = (now: number) => {
      const t = duration === 0 ? 1 : Math.min(1, (now - started) / duration);
      const k = ease(t);
      for (const { id, from, to } of tweens) {
        if (!graph.hasNode(id)) continue;
        graph.mergeNodeAttributes(id, {
          x: lerp(from.x, to.x, k),
          y: lerp(from.y, to.y, k),
          size: lerp(from.size, to.size, k),
          opacity: lerp(from.opacity, 1, k),
        });
      }
      const extent = { x: lerp(extentFrom.x, scene.extent.x, k), y: lerp(extentFrom.y, scene.extent.y, k) };
      extentRef.current = extent;
      sigma.setCustomBBox({ x: [-extent.x, extent.x], y: [-extent.y, extent.y] });
      sigma.scheduleRender();
      if (t < 1) frameRef.current = requestAnimationFrame(step);
    };
    step(started);
  }, [scene]);

  const camera = () => sigmaRef.current?.getCamera();
  return (
    <div className={`graph${picking ? " graph--picking" : ""}`}>
      <div ref={containerRef} className="graph__stage" role="img" aria-label={label} />
      <canvas ref={overlayRef} className="graph__overlay" aria-hidden="true" />
      <div ref={tipRef} className="graph__tip" role="tooltip" hidden />
      {zoomControls && (
        <div className="zoom" role="group" aria-label="グラフの表示">
          <button type="button" aria-label="拡大" title="拡大" onClick={() => void camera()?.zoomIn({ duration: 200 })}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
          </button>
          <button type="button" aria-label="縮小" title="縮小" onClick={() => void camera()?.zoomOut({ duration: 200 })}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg>
          </button>
          <button type="button" aria-label="全体を表示" title="全体を表示" onClick={() => void camera()?.reset({ duration: 200 })}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}
