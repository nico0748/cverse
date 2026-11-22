/**
 * つながりタイムアタック（1 問完結）の、画面に依らない部分。
 *
 * 出題で始点（声優かキャラ）と終点（声優かキャラ）が示され、相関図のノードを押して
 * 自分でつながりをたどり、終点に着くまでのタイムを競う。最短経路は答え合わせにだけ使う。
 */
import type { Kind, NodeBrief, ViewEdge } from "./types";

export type Difficulty = "easy" | "normal" | "hard";

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: "やさしい", normal: "ふつう", hard: "むずかしい" };

/** 難易度ごとの、最短でたどったときの段数の範囲（両端を含む）。 */
export const DIFFICULTY_HOPS: Record<Difficulty, [number, number]> = { easy: [3, 4], normal: [5, 6], hard: [7, 9] };

export const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"];

/** 1 問。始点・終点と、答え合わせ用の最短経路。 */
export interface Puzzle {
  from: NodeBrief;
  to: NodeBrief;
  /** 最短経路（始点と終点を含む）。 */
  shortest: NodeBrief[];
  /** 今日の 1 問なら、その日付（YYYY-MM-DD、日本時間）。 */
  daily?: string;
  difficulty?: Difficulty;
}

/** URL に載せる出題（`?ta=...`）。 */
export type GameRoute = { kind: "lobby" } | { kind: "daily" } | { kind: "pair"; from: string; to: string };

export function parseGame(value: string | null): GameRoute | null {
  if (value == null) return null;
  if (value === "daily") return { kind: "daily" };
  const [from, to] = value.split("~");
  if (from && to && from !== to) return { kind: "pair", from, to };
  return { kind: "lobby" };
}

export function serializeGame(g: GameRoute): string {
  if (g.kind === "daily") return "daily";
  if (g.kind === "pair") return `${g.from}~${g.to}`;
  return "1";
}

/** 日本時間の日付（YYYY-MM-DD）。今日の 1 問の種にする。 */
export function jstDate(now = Date.now()): string {
  return new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** 文字列から 32 ビットの種を作る（FNV-1a）。 */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 種から再現できる乱数（mulberry32）。同じ日の 1 問を、誰が開いても同じにする。 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** 経過時間を「1:23.4」の形に。1 時間を超えたら「1:02:03」。 */
export function formatTime(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100);
  const s = Math.floor(tenths / 10);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}.${tenths % 10}`;
}

/**
 * 図の上で押したノードまで、図に描かれている線だけを通って行く道（今いるノードは含めない）。
 * 2 段目のノード（声優の図での作品など）を押したときは、間のノードも通ったことにする。
 * 図の中でつながっていなければ null。
 */
export function routeInView(edges: ViewEdge[], from: string, to: string): string[] | null {
  if (from === to) return [];
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    let list = adj.get(a);
    if (!list) adj.set(a, (list = []));
    list.push(b);
  };
  for (const e of edges) {
    link(e.a, e.b);
    link(e.b, e.a);
  }
  const prev = new Map<string, string>([[from, from]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const u = queue[i];
    if (u === to) break;
    for (const v of adj.get(u) ?? []) {
      if (prev.has(v)) continue;
      prev.set(v, u);
      queue.push(v);
    }
  }
  if (!prev.has(to)) return null;
  const out: string[] = [];
  for (let v = to; v !== from; v = prev.get(v)!) out.push(v);
  return out.reverse();
}

/** たどった道にノードを足す。前に通ったノードへ戻ったら、そこまでの寄り道は消す（ループを残さない）。 */
export function extendRoute(route: string[], steps: string[]): string[] {
  let next = route;
  for (const id of steps) {
    const at = next.indexOf(id);
    next = at >= 0 ? next.slice(0, at + 1) : [...next, id];
  }
  return next;
}

const KIND_MARK: Record<Kind, string> = { va: "🟠", ch: "🟦", wk: "🟩" };

/** 結果を X に投稿する文。経路の中身は伏せ、種類の並びだけを絵文字で見せる。 */
export function shareText(args: {
  puzzle: Puzzle;
  ms: number;
  kinds: (Kind | "more")[];
}): string {
  const { puzzle, ms, kinds } = args;
  const hops = kinds.length - 1;
  const best = puzzle.shortest.length - 1;
  const title = puzzle.daily ? `CVerse つながりタイムアタック ${Number(puzzle.daily.slice(5, 7))}/${Number(puzzle.daily.slice(8))}の1問` : "CVerse つながりタイムアタック";
  const verdict = hops <= best ? `${hops}手（最短！）` : `${hops}手（最短${best}手）`;
  return [
    title,
    `${puzzle.from.label} → ${puzzle.to.label}`,
    `⏱ ${formatTime(ms)}｜${verdict}`,
    kinds.map((k) => (k === "more" ? "⬜" : KIND_MARK[k])).join(""),
    "#CVerse",
  ].join("\n");
}

/** X の投稿画面を開く URL（Web Intent）。 */
export function intentUrl(text: string, url: string): string {
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

// ---- 自己ベスト（この端末だけに覚える） ----

const BEST_KEY = "cverse:ta-best:v1";

function readBest(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(BEST_KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function bestTime(key: string): number | null {
  const v = readBest()[key];
  return typeof v === "number" ? v : null;
}

/** 自己ベストなら記録して true。 */
export function recordTime(key: string, ms: number): boolean {
  const all = readBest();
  const prev = all[key];
  if (typeof prev === "number" && prev <= ms) return false;
  all[key] = Math.round(ms);
  try {
    // 古い記録から捨てて、多くても 200 問ぶんに抑える。
    const entries = Object.entries(all).slice(-200);
    localStorage.setItem(BEST_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // 保存できなくても遊べる。
  }
  return true;
}
