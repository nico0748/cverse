import { parseGame, serializeGame, type GameRoute } from "./timeattack";
import { DEFAULT_FILTER, FORMAT_GROUPS, type Filter, type FormatGroup, type PathMode } from "./types";

/** URL に載せる画面状態。中心ノード・段数・絞り込み・経路をすべて URL で再現できる。 */
export interface RouteState {
  center: string | null;
  depth: number;
  filter: Filter;
  path: { from: string; to: string; mode: PathMode } | null;
  /** 「つながりを調べる」の画面を開いているか。経路が決まっていれば常に開いている。 */
  pathOpen: boolean;
  /** つながりタイムアタックを開いているか（開いているあいだは、中心と経路を使わない）。 */
  game: GameRoute | null;
}

export const EMPTY_ROUTE: RouteState = { center: null, depth: 1, filter: DEFAULT_FILTER, path: null, pathOpen: false, game: null };

const PATH_MODES: PathMode[] = ["bfs", "main", "weighted"];

function year(v: string | undefined): number | null {
  const n = Number(v);
  return v && Number.isInteger(n) && n >= 1900 && n <= 2100 ? n : null;
}

export function parseRoute(search: string): RouteState {
  const q = new URLSearchParams(search);
  const depth = Number(q.get("d"));
  const media = q.get("media");
  const [yMin, yMax] = (q.get("y") ?? "").split("-");
  const formats = (q.get("fmt") ?? "")
    .split(",")
    .filter((f): f is FormatGroup => FORMAT_GROUPS.some((g) => g.key === f));
  const filter: Filter = {
    anime: media !== "game",
    game: media !== "anime",
    formats,
    yearMin: year(yMin),
    yearMax: year(yMax),
    mainOnly: q.get("main") === "1",
  };
  const game = parseGame(q.get("ta"));
  if (game) return { center: null, depth: 1, filter: DEFAULT_FILTER, path: null, pathOpen: false, game };
  const [from, to] = (q.get("p") ?? "").split("~");
  const mode = q.get("pm") as PathMode;
  const path = from && to ? { from, to, mode: PATH_MODES.includes(mode) ? mode : "bfs" } : null;
  return {
    center: q.get("c") || null,
    depth: depth === 2 || depth === 3 ? depth : 1,
    filter,
    path,
    pathOpen: path !== null || q.get("t") === "path",
    game: null,
  };
}

export function serializeRoute(s: RouteState): string {
  const q = new URLSearchParams();
  if (s.game) {
    q.set("ta", serializeGame(s.game));
    return `?${q.toString().replace(/%3A/g, ":").replace(/%7E/g, "~")}`;
  }
  if (s.center) q.set("c", s.center);
  if (s.depth !== 1) q.set("d", String(s.depth));
  const f = s.filter;
  if (f.anime !== f.game) q.set("media", f.anime ? "anime" : "game");
  if (f.formats.length) q.set("fmt", f.formats.join(","));
  if (f.yearMin != null || f.yearMax != null) q.set("y", `${f.yearMin ?? ""}-${f.yearMax ?? ""}`);
  if (f.mainOnly) q.set("main", "1");
  if (s.path) {
    q.set("p", `${s.path.from}~${s.path.to}`);
    if (s.path.mode !== "bfs") q.set("pm", s.path.mode);
  } else if (s.pathOpen) {
    q.set("t", "path");
  }
  const text = q.toString().replace(/%3A/g, ":").replace(/%7E/g, "~").replace(/%2C/g, ",");
  return text ? `?${text}` : "";
}
