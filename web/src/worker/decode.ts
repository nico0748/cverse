/**
 * WASM が返す数値配列を読む。並びは crates/cverse-wasm/src/lib.rs と対になる。
 */

export const NO_NODE = 0xffffffff;

export interface RawView {
  nodes: { idx: number; level: number; slot: number; group: number; role: number }[];
  edges: { a: number; b: number; attr: number }[];
  hidden: { parent: number; count: number }[];
}

export function decodeView(raw: Uint32Array): RawView | null {
  if (raw.length < 3) return null;
  const [n, m, h] = raw;
  const view: RawView = { nodes: [], edges: [], hidden: [] };
  let p = 3;
  for (let i = 0; i < n; i++, p += 5) {
    view.nodes.push({ idx: raw[p], level: raw[p + 1], slot: raw[p + 2], group: raw[p + 3], role: raw[p + 4] });
  }
  for (let i = 0; i < m; i++, p += 3) {
    view.edges.push({ a: raw[p], b: raw[p + 1], attr: raw[p + 2] });
  }
  for (let i = 0; i < h; i++, p += 2) {
    view.hidden.push({ parent: raw[p], count: raw[p + 1] });
  }
  return view;
}

export interface RawPath {
  found: boolean;
  cost: number;
  visited: number;
  costar: number;
  nodes: number[];
}

export function decodePath(raw: Uint32Array): RawPath {
  return {
    found: raw[0] === 1,
    cost: raw[1] ?? 0,
    visited: raw[2] ?? 0,
    costar: raw[3] ?? 0,
    nodes: Array.from(raw.subarray(4)),
  };
}

/** エッジ属性バイトの読み取り（crates/cverse-core/src/graph.rs の `EdgeAttr`）。 */
export const edgeType = (attr: number) => attr & 3;
export const edgeMedia = (attr: number) => (attr >> 2) & 3;
export const edgeRole = (attr: number) => (attr >> 2) & 3;
export const edgeIrregular = (attr: number) => (attr & 0x10) !== 0;
