/** ノードの種類。ID のプレフィックスと対応する。 */
export type Kind = "va" | "ch" | "wk";

export const KINDS: Kind[] = ["va", "ch", "wk"];

export const KIND_LABEL: Record<Kind, string> = { va: "声優", ch: "キャラ", wk: "作品" };

export type Role = "MAIN" | "SUPPORTING" | "BACKGROUND";

export const ROLE_LABEL: Record<Role, string> = { MAIN: "主役", SUPPORTING: "脇役", BACKGROUND: "その他" };

export const FORMAT_LABEL: Record<string, string> = {
  TV: "TV",
  TV_SHORT: "TVショート",
  MOVIE: "劇場版",
  OVA: "OVA",
  ONA: "Web",
  SPECIAL: "スペシャル",
  GAME: "ゲーム",
};

/** レイアウト上の役割。crates/cverse-core/src/view.rs の `Slot` と同じ並び。 */
export const enum Slot {
  Center = 0,
  Top = 1,
  Bottom = 2,
  Ring = 3,
  Context = 4,
  Outer = 5,
}

export type EdgeType = "voices" | "appears" | "series" | "relation";

export interface NodeBrief {
  id: string;
  label: string;
  /** "more" は「他 N 件」のまとめノード（画面側で足す）。 */
  kind: Kind | "more";
  /** 検索結果などで添える補足（声優なら代表的な役、キャラなら代表作、作品なら年・形態）。 */
  sub?: string;
  /** 画像の URL（無ければ頭文字のアイコンで表示する）。 */
  image?: string;
}

export interface ViewNode extends NodeBrief {
  level: number;
  slot: Slot;
  /** まとまりの親の ID。 */
  group: string | null;
  /** group の作品での役（0 主役 / 1 脇役 / 2 その他 / 3 なし）。 */
  role: number;
  /** キャラの担当声優（ホバー表示用）。 */
  voices?: string[];
  /** 声優・作品に添える媒体などの短い注記。 */
  note?: string;
}

export interface ViewEdge {
  a: string;
  b: string;
  type: EdgeType;
  /** appears の役（0 主役 / 1 脇役 / 2 その他）。 */
  role: number;
}

export interface ViewData {
  center: string;
  nodes: ViewNode[];
  edges: ViewEdge[];
  /** 描ききれず省いた件数（parent の「他 N 件」）。 */
  hidden: { parent: string; count: number }[];
}

export type PathMode = "bfs" | "main" | "weighted";

export const PATH_MODE_LABEL: Record<PathMode, string> = {
  bfs: "最短",
  main: "主役のみ",
  weighted: "主役を優先",
};

export interface PathData {
  found: boolean;
  nodes: NodeBrief[];
  hops: number;
  /** 「声優 → キャラ → 作品 → キャラ → 声優」を 1 と数えた共演ステップ数。 */
  costar: number;
  visited: number;
  ms: number;
}

export interface Meta {
  version: number;
  generatedAt: string;
  dataDate: string;
  counts: { voiceActors: number; characters: number; works: number; edges: number };
  shardCount: number;
  /** 画像つきのノード数。0 なら images.json は無い。 */
  images?: number;
  featured: string[];
  featuredWorks?: string[];
}

/** 絞り込み条件（F-09）。 */
export interface Filter {
  anime: boolean;
  game: boolean;
  /** 形態グループ。空は「すべて」。 */
  formats: FormatGroup[];
  yearMin: number | null;
  yearMax: number | null;
  mainOnly: boolean;
}

export type FormatGroup = "tv" | "movie" | "ova" | "web" | "game";

export const FORMAT_GROUPS: { key: FormatGroup; label: string; codes: number[] }[] = [
  { key: "tv", label: "TV", codes: [1, 2] },
  { key: "movie", label: "劇場版", codes: [3] },
  { key: "ova", label: "OVA", codes: [4, 6] },
  { key: "web", label: "Web", codes: [5] },
  { key: "game", label: "ゲーム", codes: [7] },
];

export const DEFAULT_FILTER: Filter = {
  anime: true,
  game: true,
  formats: [],
  yearMin: null,
  yearMax: null,
  mainOnly: false,
};

export function isDefaultFilter(f: Filter): boolean {
  return f.anime && f.game && f.formats.length === 0 && f.yearMin == null && f.yearMax == null && !f.mainOnly;
}

/** WASM に渡す形（媒体ビット, 形態マスク, 年下限, 年上限, 主役のみ）。 */
export function filterArgs(f: Filter): [number, number, number, number, boolean] {
  const media = (f.anime ? 1 : 0) | (f.game ? 2 : 0);
  let formats = 0;
  for (const g of FORMAT_GROUPS) {
    if (f.formats.includes(g.key)) for (const c of g.codes) formats |= 1 << c;
  }
  return [media, formats, f.yearMin ?? 0, f.yearMax ?? 0, f.mainOnly];
}

// ---- 詳細パネル用（nodes/<k>.json） ----

export interface Source {
  source: string;
  url: string;
  fetchedAt: string;
}

/** ノードに添える画像と、その出どころ。画像は再配布せず URL を直接参照する。 */
export interface ImageInfo {
  url: string;
  source?: string;
  pageUrl?: string;
  license?: string;
  attribution?: string;
  width?: number;
  height?: number;
}

export interface WorkRef {
  id: string;
  name: string;
  year?: number;
  format?: string;
  role?: Role;
  relation?: string;
}

export interface CastRef {
  id: string;
  name: string;
  medium?: "anime" | "game";
  kind?: string;
  period?: { from?: number | null; to?: number | null };
  work?: string;
}

interface DetailBase {
  id: string;
  name: string;
  reading?: string;
  nameEn?: string;
  aliases?: string[];
  anilistId?: number;
  wikipediaTitle?: string;
  sources?: Source[];
  image?: ImageInfo;
}

export interface VoiceActorDetail extends DetailBase {
  kind: "va";
  agency?: string;
  debutYear?: number;
  roles?: { id: string; name: string; media?: string[]; kind?: string; works?: WorkRef[] }[];
}

export interface CharacterDetail extends DetailBase {
  kind: "ch";
  voicedBy?: CastRef[];
  works?: WorkRef[];
  relations?: { id: string; name: string; label?: string }[];
}

export interface WorkDetail extends DetailBase {
  kind: "wk";
  format?: string;
  year?: number;
  series?: string;
  cast?: { id: string; name: string; role: Role; vas?: CastRef[] }[];
  related?: WorkRef[];
}

export type Detail = VoiceActorDetail | CharacterDetail | WorkDetail;
