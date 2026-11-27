import { describe, expect, it } from "vitest";
import { relativeLabel, sceneFromPath, sceneFromView } from "./scene";
import { createIdList } from "./store";
import { Slot, type Kind, type PathData, type ViewData, type ViewNode } from "./types";

const node = (id: string, kind: Kind, slot: Slot, extra: Partial<ViewNode> = {}): ViewNode => ({
  id,
  label: id,
  kind,
  level: slot === Slot.Center ? 0 : 1,
  slot,
  group: null,
  role: 3,
  ...extra,
});

const view: ViewData = {
  center: "va:a",
  nodes: [
    node("va:a", "va", Slot.Center),
    node("ch:x", "ch", Slot.Ring, { role: 0 }),
    node("ch:y", "ch", Slot.Ring, { role: 1 }),
    node("wk:1", "wk", Slot.Outer, { level: 2, group: "ch:x" }),
  ],
  edges: [
    { a: "va:a", b: "ch:x", type: "voices", role: 0 },
    { a: "va:a", b: "ch:y", type: "voices", role: 0 },
    { a: "ch:x", b: "wk:1", type: "appears", role: 0 },
  ],
  hidden: [{ parent: "va:a", count: 12 }],
};

describe("相関図の場面", () => {
  it("省いた件数は「他N件」のノードになり、親と線で結ばれる", () => {
    const scene = sceneFromView(view, []);
    const more = scene.nodes.find((n) => n.id === "more:va:a");
    expect(more?.label).toBe("他12件");
    expect(scene.edges).toContainEqual({ a: "va:a", b: "more:va:a", style: "more", role: 0, dim: false });
    expect(scene.nodes).toHaveLength(view.nodes.length + 1);
  });

  it("中心ごとに鍵が変わり、2 段目へ伸びる線は控えめにする", () => {
    const scene = sceneFromView(view, []);
    expect(scene.key).toBe("view:va:a");
    expect(scene.center).toBe("va:a");
    expect(scene.edges.find((e) => e.b === "wk:1")?.dim).toBe(true);
    expect(scene.edges.find((e) => e.b === "ch:x")?.dim).toBe(false);
  });

  it("足跡は、実際の線が無い組にだけ引く", () => {
    const scene = sceneFromView(view, ["wk:1", "ch:y", "va:a", "zz:gone"]);
    const trail = scene.edges.filter((e) => e.style === "trail");
    // wk:1 と ch:y の間に線は無いので足跡を足す。ch:y と va:a は元の線があるので足さない。
    expect(trail).toEqual([{ a: "wk:1", b: "ch:y", style: "trail", role: 0, dim: false }]);
  });

  it("すべてのノードに位置と大きさがある", () => {
    for (const n of sceneFromView(view, []).nodes) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.y), n.id).toBe(true);
      expect(n.size, n.id).toBeGreaterThan(0);
    }
  });
});

describe("つながりの場面", () => {
  const path: PathData = {
    found: true,
    nodes: [
      { id: "va:a", label: "あ", kind: "va" },
      { id: "ch:x", label: "い", kind: "ch" },
      { id: "wk:1", label: "う", kind: "wk", sub: "2009年・TV" },
      { id: "ch:z", label: "え", kind: "ch" },
      { id: "va:b", label: "お", kind: "va" },
    ],
    hops: 4,
    costar: 1,
    visited: 9,
    ms: 0.1,
  };

  it("両端を強調し、隣どうしを順に結ぶ", () => {
    const scene = sceneFromPath(path);
    expect(scene.nodes.map((n) => n.emphasis)).toEqual(["end", "path", "path", "path", "end"]);
    expect(scene.edges.map((e) => `${e.a}>${e.b}`)).toEqual(["va:a>ch:x", "ch:x>wk:1", "wk:1>ch:z", "ch:z>va:b"]);
    expect(scene.nodes.every((n) => n.forceLabel)).toBe(true);
    expect(scene.center).toBeNull();
  });

  it("経路が変われば鍵も変わる（カメラを合わせ直す合図）", () => {
    const other = { ...path, nodes: [...path.nodes].reverse() };
    expect(sceneFromPath(path).key).not.toBe(sceneFromPath(other).key);
  });
});

describe("お気に入りと履歴の保存", () => {
  it("保存できない環境でも、開いている間は覚えている", () => {
    const list = createIdList("cverse:test", 3);
    expect(list.read()).toEqual([]);
    let calls = 0;
    const stop = list.subscribe(() => calls++);
    list.write(["a", "b", "c", "d"]);
    expect(list.read()).toEqual(["a", "b", "c"]);
    expect(calls).toBe(1);
    stop();
    list.write([]);
    expect(calls).toBe(1);
  });
});

describe("relativeLabel", () => {
  it("同じ題名で始まる関連作は、続きだけを名札にする", () => {
    expect(relativeLabel("僕のヒーローアカデミア THE MOVIE", "僕のヒーローアカデミア")).toBe("…THE MOVIE");
    expect(relativeLabel("進撃の巨人：後編", "進撃の巨人")).toBe("…後編");
  });
  it("頭が違う・続きが短すぎるときはそのまま", () => {
    expect(relativeLabel("ワンパンマン", "僕のヒーローアカデミア")).toBe("ワンパンマン");
    expect(relativeLabel("鬼滅の刃2", "鬼滅の刃")).toBe("鬼滅の刃2");
    expect(relativeLabel("鬼滅の刃", undefined)).toBe("鬼滅の刃");
  });
});
