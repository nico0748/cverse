import { layerBorder } from "@sigma/node-border";
import Graph from "graphology";
import { useEffect, useRef } from "react";
import Sigma from "sigma";
import { layerFill, sdfCircle, sdfSquare } from "sigma/rendering";
import type { Scene, SceneNode } from "../lib/scene";
import { COLORS } from "../lib/theme";

interface Props {
  scene: Scene | null;
  onNodeClick: (node: SceneNode) => void;
  /** 経路の端点を選んでいる最中か（カーソルを変える）。 */
  picking: boolean;
}

const DURATION = 480;
const LONG_PRESS = 450;
const FONT = '"Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", "Meiryo", system-ui, sans-serif';

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 角丸の四角（キャラ用）。Sigma 組み込みの四角は角の丸みをノードごとに変えられないので別の形として定義する。 */
const ROUNDED_SQUARE = {
  name: "rounded",
  glsl: /* glsl */ `
float sdf_rounded(vec2 uv, float size) {
  float r = size * 0.36;
  vec2 d = abs(uv) - vec2(size - r);
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}`,
  inradiusFactor: Math.SQRT1_2,
};

function createSigma(graph: Graph, container: HTMLElement) {
  return new Sigma(graph, container, {
    primitives: {
      nodes: {
        // 種類は形でも区別する: 声優 = 丸、キャラ = 角丸、作品 = 四角。
        shapes: [sdfCircle(), sdfSquare(), ROUNDED_SQUARE],
        variables: {
          borderSize: { type: "number", default: 0 },
          borderColor: { type: "color", default: "#ffffff" },
        },
        layers: [
          layerFill(),
          layerBorder({
            borders: [
              { size: { attribute: "borderSize", default: 0 }, color: { attribute: "borderColor" }, mode: "pixels" },
              { size: 0, color: { attribute: "color" }, fill: true },
            ],
          }),
        ],
        label: { font: { family: FONT, size: 12 }, color: COLORS.label },
      },
    },
    styles: {
      nodes: {
        x: { attribute: "x" },
        y: { attribute: "y" },
        size: { attribute: "size", defaultValue: 10 },
        color: { attribute: "color", defaultValue: "#666" },
        opacity: { attribute: "opacity", defaultValue: 1 },
        shape: { attribute: "shape", defaultValue: "circle" },
        zIndex: { attribute: "zIndex", defaultValue: 0 },
        borderSize: { attribute: "borderSize", defaultValue: 0 },
        borderColor: { attribute: "borderColor", defaultValue: "#ffffff" },
        label: { attribute: "label" },
        labelColor: { attribute: "labelColor", defaultValue: COLORS.label },
        labelSize: { attribute: "labelSize", defaultValue: 12 },
        labelPosition: "below",
        labelVisibility: {
          whenState: "isHovered",
          then: "visible",
          else: { attribute: "labelVisibility", defaultValue: "auto" },
        },
        backdropVisibility: "hidden",
        cursor: "pointer",
        depth: { whenState: "isHovered", then: "topNodes", else: "nodes" },
      },
      edges: {
        size: { attribute: "size", defaultValue: 1 },
        color: { attribute: "color", defaultValue: "#445" },
        zIndex: { attribute: "zIndex", defaultValue: 0 },
      },
      stage: { background: COLORS.background },
    },
    settings: {
      // 大きさを座標と同じ単位で持ち、ズームに合わせて拡大縮小する（地図のように）。
      itemSizesReference: "positions",
      zoomToSizeRatioFunction: (ratio) => ratio,
      autoRescale: true,
      stagePadding: 28,
      labelDensity: 1.4,
      labelGridCellSize: 80,
      labelRenderedSizeThreshold: 4,
      enableNodeDrag: true,
      enableCameraRotation: false,
      minCameraRatio: 0.12,
      maxCameraRatio: 3,
    },
  });
}

/** Sigma のキャンバスと、頭文字・注記・ツールチップの重ね描き。 */
export function GraphView({ scene, onNodeClick, picking }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph>(new Graph());
  const nodesRef = useRef(new Map<string, SceneNode>());
  const extentRef = useRef(200);
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
    const ctx = overlay.getContext("2d")!;

    /** ノードの画面上の位置と半径。 */
    const onScreen = (id: string) => {
      const { x, y, size } = graph.getNodeAttributes(id) as { x: number; y: number; size: number };
      const p = sigma.graphToViewport({ x, y });
      const q = sigma.graphToViewport({ x: x + size, y });
      return { x: p.x, y: p.y, r: Math.abs(q.x - p.x) };
    };

    // 頭文字（画像の代わりのアイコン）と注記を重ね描きする。
    const drawOverlay = () => {
      const { width, height } = sigma.getDimensions();
      const ratio = window.devicePixelRatio || 1;
      if (overlay.width !== Math.round(width * ratio) || overlay.height !== Math.round(height * ratio)) {
        overlay.width = Math.round(width * ratio);
        overlay.height = Math.round(height * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      graph.forEachNode((id, attrs) => {
        const node = nodesRef.current.get(id);
        if (!node) return;
        const { x, y, r } = onScreen(id);
        if (r < 7 || x < -r || y < -r || x > width + r || y > height + r) return;
        ctx.globalAlpha = Math.min(1, attrs.opacity ?? 1);
        ctx.fillStyle = COLORS.ink;
        ctx.font = `700 ${Math.round(r * 1.05)}px ${FONT}`;
        ctx.fillText(node.initial, x, y + r * 0.06);
        if (node.note && r >= 9) {
          ctx.fillStyle = COLORS.labelDim;
          ctx.font = `500 11px ${FONT}`;
          ctx.fillText(node.note, x, y - r - 10);
        }
      });
      ctx.globalAlpha = 1;
    };
    sigma.on("afterRender", drawOverlay);

    const showTip = (id: string) => {
      const node = nodesRef.current.get(id);
      if (!node?.tooltip) return;
      const { x, y, r } = onScreen(id);
      tip.textContent = node.tooltip;
      tip.style.transform = `translate(-50%, -100%) translate(${x}px, ${y - r - 8}px)`;
      tip.hidden = false;
    };
    const hideTip = () => {
      tip.hidden = true;
    };

    // スマホではホバーが無いので、長押しで担当声優を出す。
    let pressTimer = 0;
    let suppressClick = false;
    sigma.on("enterNode", ({ node }) => showTip(node));
    sigma.on("leaveNode", hideTip);
    sigma.on("downNode", ({ node, event }) => {
      suppressClick = false;
      if (!("touches" in event.original)) return;
      window.clearTimeout(pressTimer);
      pressTimer = window.setTimeout(() => {
        suppressClick = true;
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
      const data = nodesRef.current.get(node);
      if (data) clickRef.current(data);
    });
    sigma.on("clickStage", hideTip);

    const resize = new ResizeObserver(() => sigma.resize());
    resize.observe(container);
    return () => {
      resize.disconnect();
      cancelAnimationFrame(frameRef.current);
      sigma.kill();
      sigmaRef.current = null;
    };
  }, []);

  // 場面が変わったら、前の画面にもいたノードは今の位置から滑らかに動かす（メンタルマップの維持）。
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma) return;
    cancelAnimationFrame(frameRef.current);
    if (tipRef.current) tipRef.current.hidden = true;
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
        label: n.label,
        color: n.color,
        shape: n.shape,
        borderColor: n.borderColor,
        borderSize: n.borderSize,
        labelColor: n.labelColor,
        labelSize: n.labelSize,
        labelVisibility: n.forceLabel ? "visible" : "auto",
        zIndex: n.zIndex,
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
      if (graph.hasNode(e.a) && graph.hasNode(e.b) && !graph.hasEdge(e.a, e.b)) {
        graph.addEdge(e.a, e.b, { color: e.color, size: e.size, zIndex: e.zIndex });
      }
    }
    nodesRef.current = next;

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
          opacity: lerp(from.opacity, to.opacity, k),
        });
      }
      const extent = lerp(extentFrom, scene.extent, k);
      extentRef.current = extent;
      sigma.setCustomBBox({ x: [-extent, extent], y: [-extent, extent] });
      sigma.scheduleRender();
      if (t < 1) frameRef.current = requestAnimationFrame(step);
    };
    step(started);
  }, [scene]);

  return (
    <div className={`graph${picking ? " graph--picking" : ""}`}>
      <div ref={containerRef} className="graph__stage" role="img" aria-label="声優・キャラ・作品のグラフ" />
      <canvas ref={overlayRef} className="graph__overlay" aria-hidden="true" />
      <div ref={tipRef} className="graph__tip" role="tooltip" hidden />
    </div>
  );
}
