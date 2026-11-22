import { describe, expect, it } from "vitest";
import { fnv1a } from "./shard";
import { DEFAULT_FILTER, filterArgs } from "./types";
import { EMPTY_ROUTE, parseRoute, serializeRoute, type RouteState } from "./url";

describe("URL と画面状態", () => {
  it("初期状態は空の URL になる", () => {
    expect(serializeRoute(EMPTY_ROUTE)).toBe("");
    expect(parseRoute("")).toEqual(EMPTY_ROUTE);
  });

  it("タイムアタックの出題を URL で再現できる", () => {
    const pair: RouteState = { ...EMPTY_ROUTE, game: { kind: "pair", from: "va:al-1", to: "ch:wp-原神-パイモン" } };
    expect(serializeRoute(pair)).toBe("?ta=va:al-1~ch:wp-%E5%8E%9F%E7%A5%9E-%E3%83%91%E3%82%A4%E3%83%A2%E3%83%B3");
    expect(parseRoute(serializeRoute(pair))).toEqual(pair);
    expect(parseRoute("?ta=daily").game).toEqual({ kind: "daily" });
    expect(parseRoute("?ta=1").game).toEqual({ kind: "lobby" });
    // 始点と終点が同じなら、問題を選ぶ画面にする。
    expect(parseRoute("?ta=va:1~va:1").game).toEqual({ kind: "lobby" });
    // タイムアタック中は、中心や経路を使わない。
    expect(parseRoute("?ta=1&c=va:1").center).toBeNull();
  });

  it("往復しても変わらない", () => {
    const state: RouteState = {
      center: "va:al-95185",
      depth: 2,
      filter: { anime: true, game: false, formats: ["tv", "movie"], yearMin: 2010, yearMax: null, mainOnly: true },
      path: { from: "va:al-1", to: "wk:wp-原神", mode: "weighted" },
      pathOpen: true,
      game: null,
    };
    const url = serializeRoute(state);
    expect(url).toContain("c=va:al-95185");
    expect(parseRoute(url)).toEqual(state);
  });

  it("不正な値は既定値に落とす", () => {
    const s = parseRoute("?c=va:1&d=9&fmt=tv,bogus&y=abc-3000&pm=nope&p=a~b");
    expect(s.depth).toBe(1);
    expect(s.filter.formats).toEqual(["tv"]);
    expect(s.filter.yearMin).toBeNull();
    expect(s.filter.yearMax).toBeNull();
    expect(s.path).toEqual({ from: "a", to: "b", mode: "bfs" });
  });
});

describe("「つながりを調べる」の画面", () => {
  it("経路が決まる前でも、開いていることを URL に持てる（戻るで閉じられるように）", () => {
    const open: RouteState = { ...EMPTY_ROUTE, center: "va:1", pathOpen: true };
    expect(serializeRoute(open)).toBe("?c=va:1&t=path");
    expect(parseRoute("?c=va:1&t=path")).toEqual(open);
    expect(parseRoute("?t=path").pathOpen).toBe(true);
  });

  it("経路があれば、開いているとみなす", () => {
    expect(parseRoute("?p=va:1~va:2").pathOpen).toBe(true);
    expect(serializeRoute({ ...EMPTY_ROUTE, path: { from: "va:1", to: "va:2", mode: "bfs" }, pathOpen: true })).toBe("?p=va:1~va:2");
  });
});

describe("Rust 側との取り決め", () => {
  it("FNV-1a が Rust 実装と同じ値になる", () => {
    // crates/cverse-cli のテストと同じ期待値
    expect(fnv1a("")).toBe(0x811c9dc5);
    expect(fnv1a("a")).toBe(0xe40c292c);
    expect(fnv1a("声優")).toBe(0xf271c860);
  });

  it("絞り込みを WASM の引数に直す", () => {
    expect(filterArgs(DEFAULT_FILTER)).toEqual([3, 0, 0, 0, false]);
    expect(
      filterArgs({ anime: true, game: false, formats: ["tv", "game"], yearMin: 2000, yearMax: 2010, mainOnly: true }),
    ).toEqual([1, (1 << 1) | (1 << 2) | (1 << 7), 2000, 2010, true]);
    // 形態はアニメだけを絞る: ゲームを残していればゲームは落とさない。アニメを外したら形態は無視する。
    expect(filterArgs({ ...DEFAULT_FILTER, formats: ["tv"] })[1]).toBe((1 << 1) | (1 << 2) | (1 << 7));
    expect(filterArgs({ ...DEFAULT_FILTER, anime: false, formats: ["tv"] })[1]).toBe(0);
  });
});
