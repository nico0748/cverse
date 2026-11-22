/// <reference lib="webworker" />
/**
 * グラフエンジン（Web Worker）。
 *
 * graph.bin（CSR）と検索索引を読み込み、近傍抽出・最短経路・検索を WASM で実行する。
 * 探索をメインスレッドから切り離すので、計算中も描画が固まらない。
 */
import init, { Engine } from "../wasm/pkg/cverse_wasm";
import wasmUrl from "../wasm/pkg/cverse_wasm_bg.wasm?url";
import { FORMAT_LABEL, type EdgeType, type Kind, type Meta, type NodeBrief, type PathData, type PathMode, type ViewData } from "../lib/types";
import { expandImages } from "../lib/images";
import { DIFFICULTY_HOPS, hashSeed, rng, type Difficulty } from "../lib/timeattack";
import { NO_NODE, decodePath, decodeView, edgeIrregular, edgeMedia, edgeRole, edgeType } from "./decode";

const KIND: Kind[] = ["va", "ch", "wk"];
const EDGE_TYPE: EdgeType[] = ["voices", "appears", "series", "relation"];
const FORMAT = ["", "TV", "TV_SHORT", "MOVIE", "OVA", "ONA", "SPECIAL", "GAME"];
const PATH_MODE: Record<PathMode, number> = { bfs: 0, main: 1, weighted: 2 };

type FilterArgs = [number, number, number, number, boolean];

let engine: Engine;
let meta: Meta;
let ids: string[] = [];
let labels: string[] = [];
let kinds: Uint8Array;
let formats: Uint8Array;
let years: Uint16Array;
let scores: Uint32Array;
/** ノード番号 → 画像 URL（無ければ空文字列）。 */
let images: string[] = [];
const indexOf = new Map<string, number>();

/** 画像の表を待つ長さ（ms）。これより遅ければ、まず頭文字のアイコンで見せる。 */
const IMAGES_WAIT = 1500;

async function boot(base: string) {
  const get = async (path: string) => {
    const r = await fetch(`${base}data/${path}`);
    if (!r.ok) throw new Error(`${path} を読み込めません (${r.status})`);
    return r;
  };
  const dataBase = new URL(`${base}data/`, self.location.href).href;
  const imagesReady = get("images.json")
    .then((r) => r.json())
    .then((t) => expandImages(t, dataBase))
    .catch((e: unknown) => {
      console.warn("画像の一覧を読み込めませんでした。頭文字のアイコンで表示します。", e);
      return [] as string[];
    });
  void imagesReady.then((list) => {
    if (list.length) images = list;
  });
  const [, metaJson, graph, index, search, imageList] = await Promise.all([
    init({ module_or_path: wasmUrl }),
    get("meta.json").then((r) => r.json()),
    get("graph.bin").then((r) => r.arrayBuffer()),
    get("index.json").then((r) => r.json()),
    get("search.txt").then((r) => r.text()),
    // 画像の表は無くても動く（頭文字のアイコンになる）ので、読めなくても起動は続ける。
    // ただし届くのが遅いときは待たずに起動し、届いたところから使う。
    Promise.race([
      imagesReady,
      new Promise<string[]>((resolve) => setTimeout(() => resolve([]), IMAGES_WAIT)),
    ]),
  ]);
  meta = metaJson;
  if (imageList.length) images = imageList;
  ids = index.ids;
  labels = index.labels;
  engine = new Engine(new Uint8Array(graph), search);
  kinds = engine.kinds();
  formats = engine.formats();
  years = engine.years();
  scores = engine.scores();
  ids.forEach((id, i) => indexOf.set(id, i));
  return meta;
}

/** 隣接ノードを [番号, 属性] の組で返す。 */
function neighbors(u: number): [number, number][] {
  const raw = engine.neighbors(u);
  const out: [number, number][] = [];
  for (let i = 0; i < raw.length; i += 2) out.push([raw[i], raw[i + 1]]);
  return out;
}

function workSub(w: number): string {
  return [years[w] || "", FORMAT_LABEL[FORMAT[formats[w]]] ?? ""].filter(Boolean).join("・");
}

/** 検索結果やパンくずに添える補足。声優は代表的な役、キャラは代表作（主役 → 番号の若い＝人気の高い作品）。 */
function sub(u: number): string | undefined {
  if (kinds[u] === 2) return workSub(u) || undefined;
  if (kinds[u] === 0) {
    let best = -1;
    let count = 0;
    for (const [v, attr] of neighbors(u)) {
      if (edgeType(attr) !== 0) continue;
      count++;
      if (best < 0 || scores[v] > scores[best]) best = v;
    }
    return best < 0 ? undefined : `${labels[best]}役${count > 1 ? "など" : ""}`;
  }
  if (kinds[u] === 1) {
    let best: [number, number] | null = null;
    for (const [v, attr] of neighbors(u)) {
      if (edgeType(attr) !== 1) continue;
      const key: [number, number] = [edgeRole(attr), v];
      if (!best || key[0] < best[0] || (key[0] === best[0] && key[1] < best[1])) best = key;
    }
    return best ? labels[best[1]] : undefined;
  }
  return undefined;
}

function brief(u: number): NodeBrief {
  return { id: ids[u], label: labels[u], kind: KIND[kinds[u]], sub: sub(u), image: images[u] || undefined };
}

function voicesOf(ch: number): string[] {
  return neighbors(ch)
    .filter(([, attr]) => edgeType(attr) === 0)
    .sort((a, b) => Number(edgeIrregular(a[1])) - Number(edgeIrregular(b[1])))
    .map(([v]) => labels[v]);
}

function view(centerId: string, levels: number, f: FilterArgs): ViewData | null {
  const center = indexOf.get(centerId);
  if (center === undefined) return null;
  const raw = decodeView(engine.view(center, levels, ...f));
  if (!raw) return null;
  // キャラ中心のとき、担当声優に媒体（アニメ/ゲーム）を添える。
  const mediaOfTop = new Map<number, number>();
  if (kinds[center] === 1) {
    for (const [v, attr] of neighbors(center)) {
      if (edgeType(attr) === 0) mediaOfTop.set(v, edgeMedia(attr) | (edgeIrregular(attr) ? 4 : 0));
    }
  }
  return {
    center: centerId,
    nodes: raw.nodes.map((n) => {
      const kind = KIND[kinds[n.idx]];
      let note: string | undefined;
      const media = mediaOfTop.get(n.idx);
      if (kind === "va" && media !== undefined && n.level === 1) {
        note = [media & 1 ? "アニメ" : "", media & 2 ? "ゲーム" : ""].filter(Boolean).join("・");
        if (media & 4) note += "（交代・代役）";
      } else if (kind === "wk") {
        note = workSub(n.idx);
      }
      return {
        id: ids[n.idx],
        label: labels[n.idx],
        kind,
        level: n.level,
        slot: n.slot,
        group: n.group === NO_NODE ? null : ids[n.group],
        role: n.role,
        voices: kind === "ch" ? voicesOf(n.idx) : undefined,
        note,
        // 声優の補足（代表的な役）は 1 段目までにとどめる（隣接を数えるので、数百ノード分は重い）。
        sub: kind === "va" && n.level <= 1 ? sub(n.idx) : undefined,
        image: images[n.idx] || undefined,
      };
    }),
    edges: raw.edges.map((e) => ({
      a: ids[e.a],
      b: ids[e.b],
      type: EDGE_TYPE[edgeType(e.attr)],
      role: edgeType(e.attr) === 1 ? edgeRole(e.attr) : 0,
    })),
    hidden: raw.hidden.map((h) => ({ parent: ids[h.parent], count: h.count })),
  };
}

function path(fromId: string, toId: string, mode: PathMode, f: FilterArgs): PathData {
  const a = indexOf.get(fromId);
  const b = indexOf.get(toId);
  const empty: PathData = { found: false, nodes: [], hops: 0, costar: 0, visited: 0, ms: 0 };
  if (a === undefined || b === undefined) return empty;
  const started = performance.now();
  const raw = decodePath(engine.path(a, b, PATH_MODE[mode], ...f));
  const ms = performance.now() - started;
  if (!raw.found) return { ...empty, ms };
  return {
    found: true,
    nodes: raw.nodes.map(brief),
    hops: raw.nodes.length - 1,
    costar: raw.costar,
    visited: raw.visited,
    ms,
  };
}

function search(query: string, kindMask: number, limit: number): NodeBrief[] {
  return Array.from(engine.search(query, kindMask, limit), brief);
}

function briefs(list: string[]): (NodeBrief | null)[] {
  return list.map((id) => {
    const u = indexOf.get(id);
    return u === undefined ? null : brief(u);
  });
}

/** つながりを持つ声優を 1 人、無作為に選ぶ（「おまかせ」用）。 */
function randomVoiceActor(): string | null {
  const count = meta.counts.voiceActors;
  for (let tries = 0; tries < 20 && count > 0; tries++) {
    const u = Math.floor(Math.random() * count);
    if (kinds[u] === 0 && engine.neighbors(u).length > 0) return ids[u];
  }
  return null;
}

// ---- つながりタイムアタック ----

/** 絞り込みなしで探すときの引数。 */
const NO_FILTER: FilterArgs = [3, 0, 0, 0, false];

/** 隣のノードを、種類（声優 → キャラ → 作品）と人気の順に並べて返す。 */
function neighborList(id: string): NodeBrief[] {
  const u = indexOf.get(id);
  if (u === undefined) return [];
  const seen = new Set<number>();
  const list: number[] = [];
  for (const [v] of neighbors(u)) {
    if (!seen.has(v)) {
      seen.add(v);
      list.push(v);
    }
  }
  list.sort((a, b) => kinds[a] - kinds[b] || scores[b] - scores[a] || a - b);
  return list.map(brief);
}

/** 出題に使う、名前の知られた声優とキャラ（人気の上位）。一度作れば使い回す。 */
let pool: { va: number[]; ch: number[] } | null = null;
function puzzlePool() {
  if (pool) return pool;
  const top = (kind: number, count: number) => {
    const list: number[] = [];
    for (let u = 0; u < kinds.length; u++) if (kinds[u] === kind && engine.neighbors(u).length > 0) list.push(u);
    return list.sort((a, b) => scores[b] - scores[a] || a - b).slice(0, count);
  };
  pool = { va: top(0, 300), ch: top(1, 1200) };
  return pool;
}

/** 始点からの段数（`limit` 段まで。届かなければ -1）。 */
function distances(src: number, limit: number): Int16Array {
  const dist = new Int16Array(kinds.length).fill(-1);
  dist[src] = 0;
  let frontier = [src];
  for (let d = 1; d <= limit && frontier.length; d++) {
    const next: number[] = [];
    for (const u of frontier) {
      const raw = engine.neighbors(u);
      for (let i = 0; i < raw.length; i += 2) {
        const v = raw[i];
        if (dist[v] >= 0) continue;
        dist[v] = d;
        next.push(v);
      }
    }
    frontier = next;
  }
  return dist;
}

interface PuzzleData {
  from: NodeBrief;
  to: NodeBrief;
  shortest: NodeBrief[];
}

/** 2 つのノードを出題にする。最短経路で解けなければ null。 */
function puzzleOf(fromId: string, toId: string): PuzzleData | null {
  const p = path(fromId, toId, "bfs", NO_FILTER);
  if (!p.found || p.nodes.length < 2) return null;
  return { from: p.nodes[0], to: p.nodes[p.nodes.length - 1], shortest: p.nodes };
}

/**
 * 1 問作る。始点と終点は、人気の上位の声優・キャラから選び、最短で難易度の段数になる組にする。
 * `seed` を渡すと（今日の 1 問）、同じデータなら誰が開いても同じ問題になる。
 */
function makePuzzle(difficulty: Difficulty, seed: string | null): PuzzleData | null {
  const random = seed ? rng(hashSeed(seed)) : Math.random;
  const { va, ch } = puzzlePool();
  const [lo, hi] = DIFFICULTY_HOPS[difficulty];
  const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length)];
  for (let tries = 0; tries < 40; tries++) {
    // 声優とキャラを半々で始点・終点にする。
    const fromList = random() < 0.5 ? va : ch;
    const toList = random() < 0.5 ? va : ch;
    const src = pick(fromList);
    if (src === undefined) return null;
    const dist = distances(src, hi);
    const goals = toList.filter((v) => v !== src && dist[v] >= lo && dist[v] <= hi);
    if (goals.length === 0) continue;
    const dst = pick(goals);
    const p = puzzleOf(ids[src], ids[dst]);
    if (p) return p;
  }
  return null;
}

const handlers = { boot, view, path, search, briefs, randomVoiceActor, neighborList, puzzleOf, makePuzzle };
export type Handlers = typeof handlers;

self.onmessage = async (e: MessageEvent<{ id: number; method: keyof Handlers; args: unknown[] }>) => {
  const { id, method, args } = e.data;
  try {
    const result = await (handlers[method] as (...a: unknown[]) => unknown)(...args);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
