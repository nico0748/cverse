import { describe, expect, it } from "vitest";
import { layoutPath, layoutView } from "./layout";
import { Slot, type Kind, type ViewData, type ViewNode } from "./types";

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

function noOverlap(view: ViewData) {
  const { positions } = layoutView(view);
  const list = [...positions.entries()];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [a, b] = [list[i][1], list[j][1]];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      expect(d, `${list[i][0]} と ${list[j][0]} が重なっている`).toBeGreaterThan(a.size + b.size);
    }
  }
  return positions;
}

describe("キャラ中心", () => {
  const view: ViewData = {
    center: "ch:c",
    nodes: [
      node("ch:c", "ch", Slot.Center),
      node("va:1", "va", Slot.Top),
      node("va:2", "va", Slot.Top),
      node("wk:1", "wk", Slot.Bottom),
      node("wk:2", "wk", Slot.Bottom),
      ...Array.from({ length: 30 }, (_, i) =>
        node(`ch:${i}`, "ch", Slot.Ring, { group: i % 2 ? "wk:1" : "wk:2", role: i < 6 ? 0 : 1 }),
      ),
    ],
    edges: [],
    hidden: [],
  };

  it("声優は真上、作品は真下に固定される", () => {
    const p = noOverlap(view);
    expect(p.get("ch:c")).toMatchObject({ x: 0, y: 0 });
    for (const id of ["va:1", "va:2"]) expect(p.get(id)!.y).toBeGreaterThan(100);
    for (const id of ["wk:1", "wk:2"]) expect(p.get(id)!.y).toBeLessThan(-100);
    // 横並びで左右対称
    expect(p.get("va:1")!.x).toBeCloseTo(-p.get("va:2")!.x);
  });

  it("他キャラは左右に散り、所属作品と同じ側に寄る", () => {
    const p = noOverlap(view);
    const side = (id: string) => Math.sign(p.get(id)!.x);
    for (let i = 0; i < 30; i++) {
      const pos = p.get(`ch:${i}`)!;
      expect(Math.abs(pos.x)).toBeGreaterThan(90);
      expect(side(`ch:${i}`)).toBe(side(i % 2 ? "wk:1" : "wk:2"));
    }
  });
});

describe("声優中心", () => {
  it("同じ作品のキャラが隣り合い、作品はその外側に来る", () => {
    const works = ["wk:a", "wk:b", "wk:c"];
    const view: ViewData = {
      center: "va:v",
      nodes: [
        node("va:v", "va", Slot.Center),
        ...works.map((w) => node(w, "wk", Slot.Context, { group: w })),
        // わざと作品を交互に並べる
        ...Array.from({ length: 12 }, (_, i) => node(`ch:${i}`, "ch", Slot.Ring, { group: works[i % 3], role: 0 })),
      ],
      edges: [],
      hidden: [],
    };
    const p = noOverlap(view);
    const angle = (id: string) => Math.atan2(p.get(id)!.y, p.get(id)!.x);
    const radius = (id: string) => Math.hypot(p.get(id)!.x, p.get(id)!.y);
    for (const w of works) {
      const members = Array.from({ length: 12 }, (_, i) => i).filter((i) => works[i % 3] === w);
      for (const i of members) {
        expect(radius(w)).toBeGreaterThan(radius(`ch:${i}`));
        // 作品との角度差が扇形 1 つぶん（120°）の半分に収まる
        const diff = Math.abs(((angle(`ch:${i}`) - angle(w) + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        expect(diff).toBeLessThan(Math.PI / 3);
      }
    }
  });
});

describe("作品中心", () => {
  it("主役が内側、脇役が外側、シリーズ作は上", () => {
    const view: ViewData = {
      center: "wk:w",
      nodes: [
        node("wk:w", "wk", Slot.Center),
        node("wk:s", "wk", Slot.Top),
        ...Array.from({ length: 5 }, (_, i) => node(`ch:m${i}`, "ch", Slot.Ring, { role: 0 })),
        ...Array.from({ length: 40 }, (_, i) => node(`ch:s${i}`, "ch", Slot.Ring, { role: 1 })),
      ],
      edges: [],
      hidden: [],
    };
    const p = noOverlap(view);
    const radius = (id: string) => Math.hypot(p.get(id)!.x, p.get(id)!.y);
    const maxMain = Math.max(...Array.from({ length: 5 }, (_, i) => radius(`ch:m${i}`)));
    const minSupport = Math.min(...Array.from({ length: 40 }, (_, i) => radius(`ch:s${i}`)));
    expect(maxMain).toBeLessThan(minSupport);
    expect(p.get("wk:s")!.y).toBeGreaterThan(100);
    expect(p.get("wk:s")!.x).toBeCloseTo(0);
  });

  it("同じ入力なら同じ配置になり、2 段目は親の外側に出る", () => {
    const view: ViewData = {
      center: "wk:w",
      nodes: [
        node("wk:w", "wk", Slot.Center),
        node("ch:1", "ch", Slot.Ring, { role: 0 }),
        node("va:1", "va", Slot.Outer, { level: 2, group: "ch:1" }),
        node("va:2", "va", Slot.Outer, { level: 2, group: "ch:1" }),
      ],
      edges: [],
      hidden: [],
    };
    const a = layoutView(view);
    const b = layoutView(view);
    expect([...a.positions]).toEqual([...b.positions]);
    const r = (id: string) => Math.hypot(a.positions.get(id)!.x, a.positions.get(id)!.y);
    expect(r("va:1")).toBeGreaterThan(r("ch:1"));
    expect(a.extent).toBeGreaterThan(r("va:1"));
  });
});

describe("経路", () => {
  it("左から右へ並び、声優は上段・作品は下段", () => {
    const { positions } = layoutPath([
      { id: "va:1", label: "", kind: "va" },
      { id: "ch:1", label: "", kind: "ch" },
      { id: "wk:1", label: "", kind: "wk" },
      { id: "ch:2", label: "", kind: "ch" },
      { id: "va:2", label: "", kind: "va" },
    ]);
    const xs = [...positions.values()].map((p) => p.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(positions.get("va:1")!.y).toBeGreaterThan(positions.get("ch:1")!.y);
    expect(positions.get("wk:1")!.y).toBeLessThan(positions.get("ch:1")!.y);
  });
});
