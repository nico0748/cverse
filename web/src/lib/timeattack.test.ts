import { describe, expect, it } from "vitest";
import { extendRoute, formatTime, hashSeed, intentUrl, jstDate, rng, routeInView, shareText, type Puzzle } from "./timeattack";
import type { ViewEdge } from "./types";

const e = (a: string, b: string): ViewEdge => ({ a, b, type: "voices", role: 0 });

describe("つながりタイムアタック", () => {
  it("経過時間を 0.1 秒まで表す", () => {
    expect(formatTime(0)).toBe("0:00.0");
    expect(formatTime(83_456)).toBe("1:23.4");
    expect(formatTime(3_723_000)).toBe("1:02:03");
  });

  it("今日の 1 問は日本時間の日付で切り替わる", () => {
    expect(jstDate(Date.UTC(2026, 10, 22, 14, 59))).toBe("2026-11-22");
    expect(jstDate(Date.UTC(2026, 10, 22, 15, 0))).toBe("2026-11-23");
  });

  it("同じ種からは同じ乱数が出る", () => {
    const a = rng(hashSeed("daily:2026-11-23"));
    const b = rng(hashSeed("daily:2026-11-23"));
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(rng(hashSeed("daily:2026-11-24"))()).not.toBe(xs[0]);
  });

  it("図の線だけを通って、押したノードまでの道を出す", () => {
    const edges = [e("va:1", "ch:1"), e("ch:1", "wk:1"), e("ch:2", "wk:1")];
    expect(routeInView(edges, "va:1", "ch:1")).toEqual(["ch:1"]);
    expect(routeInView(edges, "va:1", "wk:1")).toEqual(["ch:1", "wk:1"]);
    expect(routeInView(edges, "va:1", "va:9")).toBeNull();
    expect(routeInView(edges, "va:1", "va:1")).toEqual([]);
  });

  it("前に通ったノードへ戻ったら、寄り道を消す", () => {
    expect(extendRoute(["a"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(extendRoute(["a", "b", "c"], ["b"])).toEqual(["a", "b"]);
    expect(extendRoute(["a", "b", "c"], ["a", "d"])).toEqual(["a", "d"]);
  });

  it("共有する文は経路の名前を伏せ、種類の並びだけを出す", () => {
    const puzzle: Puzzle = {
      from: { id: "va:1", label: "声優A", kind: "va" },
      to: { id: "va:2", label: "声優B", kind: "va" },
      shortest: [
        { id: "va:1", label: "声優A", kind: "va" },
        { id: "ch:1", label: "キャラ1", kind: "ch" },
        { id: "wk:1", label: "作品1", kind: "wk" },
        { id: "ch:2", label: "キャラ2", kind: "ch" },
        { id: "va:2", label: "声優B", kind: "va" },
      ],
      daily: "2026-11-23",
    };
    const text = shareText({ puzzle, ms: 42_300, kinds: ["va", "ch", "wk", "ch", "wk", "ch", "va"] });
    expect(text).toContain("11/23の1問");
    expect(text).toContain("声優A → 声優B");
    expect(text).toContain("0:42.3｜6手（最短4手）");
    expect(text).toContain("🟠🟦🟩🟦🟩🟦🟠");
    expect(text).not.toContain("キャラ1");
    expect(shareText({ puzzle, ms: 1000, kinds: ["va", "ch", "wk", "ch", "va"] })).toContain("4手（最短！）");
    expect(intentUrl("a b", "https://example.com/?ta=x~y")).toBe("https://x.com/intent/tweet?text=a%20b&url=https%3A%2F%2Fexample.com%2F%3Fta%3Dx~y");
  });
});
