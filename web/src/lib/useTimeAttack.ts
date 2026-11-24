import { useCallback, useEffect, useRef, useState } from "react";
import { engine } from "./engine";
import { bestTime, extendRoute, jstDate, recordTime, routeInView, type Difficulty, type GameRoute, type Puzzle } from "./timeattack";
import { DEFAULT_FILTER, type NodeBrief, type ViewData } from "./types";

export type Phase = "lobby" | "loading" | "ready" | "playing" | "cleared" | "gaveup" | "error";

export interface GameState {
  phase: Phase;
  puzzle: Puzzle | null;
  /** たどった道（始点から今いるノードまで。寄り道は消してある）。 */
  route: string[];
  /** スタートを押した時刻と、ゴールした（あきらめた）時刻（performance.now）。 */
  startedAt: number;
  endedAt: number;
  /** 今いるノードの相関図と、隣のノードの一覧。 */
  view: ViewData | null;
  neighbors: NodeBrief[] | null;
  /** この問題の自己ベスト（ms）と、今回それを更新したか。 */
  best: number | null;
  newBest: boolean;
  error: string | null;
}

const INITIAL: GameState = {
  phase: "lobby",
  puzzle: null,
  route: [],
  startedAt: 0,
  endedAt: 0,
  view: null,
  neighbors: null,
  best: null,
  newBest: false,
  error: null,
};

export const puzzleKey = (p: Puzzle) => `${p.from.id}~${p.to.id}`;

/**
 * つながりタイムアタックの進行。URL の出題（`game`）が変わったら問題を用意し、
 * 今日の 1 問・ランダムの問題は、共有できるよう始点と終点の URL に置き換える（`onPair`）。
 */
export function useTimeAttack(game: GameRoute | null, onPair: (from: string, to: string) => void) {
  const [state, setState] = useState<GameState>(INITIAL);
  const live = useRef(state);
  live.current = state;
  /** 一度でも見たノードの表示名・画像（結果の道を描くのに使う）。 */
  const briefs = useRef(new Map<string, NodeBrief>());
  const remember = (list: NodeBrief[]) => list.forEach((n) => briefs.current.set(n.id, n));
  const onPairRef = useRef(onPair);
  onPairRef.current = onPair;
  const request = useRef(0);

  const setPuzzle = useCallback((puzzle: Puzzle | null, error?: string) => {
    if (!puzzle) {
      setState({ ...INITIAL, phase: "error", error: error ?? "問題を作れませんでした。" });
      return;
    }
    remember([puzzle.from, puzzle.to, ...puzzle.shortest]);
    setState({ ...INITIAL, phase: "ready", puzzle, route: [puzzle.from.id], best: bestTime(puzzleKey(puzzle)) });
  }, []);

  const generate = useCallback(
    (difficulty: Difficulty, daily: boolean) => {
      const id = ++request.current;
      const date = jstDate();
      setState({ ...INITIAL, phase: "loading" });
      engine.makePuzzle(difficulty, daily ? `daily:${date}` : null).then(
        (p) => {
          if (id !== request.current) return;
          const puzzle = p ? { ...p, difficulty, daily: daily ? date : undefined } : null;
          setPuzzle(puzzle);
          if (puzzle) onPairRef.current(puzzle.from.id, puzzle.to.id);
        },
        (e: Error) => id === request.current && setPuzzle(null, e.message),
      );
    },
    [setPuzzle],
  );

  // URL の出題に合わせて問題を用意する。
  const gameKey = game ? (game.kind === "pair" ? `${game.from}~${game.to}` : game.kind) : "";
  useEffect(() => {
    if (!game) {
      request.current++;
      setState(INITIAL);
      return;
    }
    if (game.kind === "lobby") {
      request.current++;
      setState(INITIAL);
      return;
    }
    if (game.kind === "daily") {
      generate("normal", true);
      return;
    }
    // 今の問題と同じ組なら作り直さない（今日の 1 問を共有 URL に置き換えたとき）。
    const cur = live.current.puzzle;
    if (cur && cur.from.id === game.from && cur.to.id === game.to) return;
    const id = ++request.current;
    setState({ ...INITIAL, phase: "loading" });
    engine.puzzleOf(game.from, game.to).then(
      (p) => id === request.current && setPuzzle(p, "この組み合わせは、つながりが見つからないため出題できません。"),
      (e: Error) => id === request.current && setPuzzle(null, e.message),
    );
    // gameKey が同じなら同じ出題。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameKey, generate, setPuzzle]);

  // 今いるノードの相関図と、隣の一覧を引く。
  const current = state.route[state.route.length - 1];
  const playing = state.phase === "playing";
  useEffect(() => {
    if (!playing || !current) return;
    let stale = false;
    setState((s) => ({ ...s, view: s.view?.center === current ? s.view : null, neighbors: null }));
    engine.view(current, 1, DEFAULT_FILTER).then((v) => {
      if (stale) return;
      if (v) remember(v.nodes);
      setState((s) => ({ ...s, view: v }));
    });
    engine.neighbors(current).then((list) => {
      if (stale) return;
      remember(list);
      setState((s) => ({ ...s, neighbors: list }));
    });
    return () => {
      stale = true;
    };
  }, [playing, current]);

  const start = useCallback(() => {
    setState((s) => (s.puzzle ? { ...s, phase: "playing", route: [s.puzzle.from.id], startedAt: performance.now(), endedAt: 0, newBest: false } : s));
  }, []);

  /** 道を延ばす。終点に着いたらゴール。 */
  const advance = useCallback((steps: string[]) => {
    const s = live.current;
    if (s.phase !== "playing" || !s.puzzle || steps.length === 0) return;
    const route = extendRoute(s.route, steps);
    const goal = s.puzzle.to.id;
    if (route[route.length - 1] === goal) {
      const endedAt = performance.now();
      const newBest = recordTime(puzzleKey(s.puzzle), endedAt - s.startedAt);
      setState({ ...s, phase: "cleared", route, endedAt, newBest, best: bestTime(puzzleKey(s.puzzle)) });
    } else {
      setState({ ...s, route });
    }
  }, []);

  /** 図の上のノードへ進む（2 段目のノードなら間のノードも通る）。進めなければ false。 */
  const moveTo = useCallback(
    (id: string): boolean => {
      const s = live.current;
      const here = s.route[s.route.length - 1];
      if (!s.view || s.view.center !== here) return false;
      const steps = routeInView(s.view.edges, here, id);
      if (!steps) return false;
      advance(steps);
      return true;
    },
    [advance],
  );

  /** 隣の一覧から進む。 */
  const step = useCallback((id: string) => advance([id]), [advance]);

  /** 1 つ前のノードへ戻る（時間は止まらない）。 */
  const back = useCallback(() => {
    setState((s) => (s.phase === "playing" && s.route.length > 1 ? { ...s, route: s.route.slice(0, -1) } : s));
  }, []);

  const giveUp = useCallback(() => {
    setState((s) => (s.phase === "playing" ? { ...s, phase: "gaveup", endedAt: performance.now() } : s));
  }, []);

  /** 同じ問題をはじめから。 */
  const retry = useCallback(() => {
    setState((s) => (s.puzzle ? { ...s, phase: "ready", route: [s.puzzle.from.id], view: null, neighbors: null, newBest: false } : s));
  }, []);

  const briefOf = useCallback((id: string): NodeBrief => briefs.current.get(id) ?? { id, label: id, kind: "more" }, []);

  return { state, generate, start, moveTo, step, back, giveUp, retry, briefOf };
}
