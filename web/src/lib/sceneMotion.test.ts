import { describe, expect, it } from "vitest";
import { DUR, STAGGER } from "./motion";
import { LEAVE_DUR, planScene, progressAt, sweepDelay, valueAt, type Attrs, type TargetNode } from "./sceneMotion";

const at = (x: number, y: number, size = 10, opacity = 1): Attrs => ({ x, y, size, opacity });
const node = (id: string, x: number, y: number, level = 1, origin?: string): TargetNode => ({ id, x, y, size: 10, level, origin });

describe("planScene", () => {
  const before = new Map([
    ["a", at(0, 0)],
    ["b", at(50, 0)],
    ["gone", at(-50, 0)],
  ]);
  const nodes = [node("b", 0, 0, 0), node("a", 0, 60, 1), node("new", 60, 0, 1, "b")];
  const plan = planScene(before, nodes, { center: "b" });
  const by = new Map(plan.tweens.map((t) => [t.id, t]));

  it("前からいたノードは今の値から、新しいノードは親の位置から透明で、いなくなるノードは薄れる", () => {
    expect(by.get("a")!.kind).toBe("stay");
    expect(valueAt(by.get("a")!, 0)).toEqual(at(0, 0));
    const fresh = by.get("new")!;
    expect(fresh.kind).toBe("enter");
    expect(valueAt(fresh, 0)).toMatchObject({ x: 50, y: 0, opacity: 0 });
    expect(by.get("gone")!.kind).toBe("leave");
    expect(by.get("gone")!.dur).toBe(LEAVE_DUR);
  });

  it("終わりにはすべて行き先に着き、消えるノードは透明になる", () => {
    expect(valueAt(by.get("a")!, plan.total)).toEqual(at(0, 60));
    expect(valueAt(by.get("new")!, plan.total)).toEqual(at(60, 0));
    expect(valueAt(by.get("gone")!, plan.total).opacity).toBe(0);
  });

  it("段差込みでも中心の切り替えの長さに収まる", () => {
    for (const t of plan.tweens) expect(t.delay + t.dur).toBeLessThanOrEqual(DUR.scene);
    expect(plan.total).toBe(DUR.scene);
  });

  it("続けて押されたら短く、段差も付けない", () => {
    const quick = planScene(before, nodes, { center: "b", rapid: true });
    expect(quick.total).toBeLessThanOrEqual(DUR.base);
    for (const t of quick.tweens) expect(t.delay).toBe(0);
  });

  it("長さを指定したら、その長さで段差なしに着地する", () => {
    const rest = planScene(before, nodes, { center: "b", duration: 200 });
    expect(rest.total).toBe(200);
    for (const t of rest.tweens) expect(t.delay).toBe(0);
  });

  it("動きを減らす設定では位置が即時", () => {
    const still = planScene(before, nodes, { center: "b", reduced: true });
    expect(still.total).toBe(0);
    for (const t of still.tweens) {
      const v = valueAt(t, 0);
      expect(v.x).toBe(t.to.x);
      expect(v.y).toBe(t.to.y);
    }
    expect(progressAt(still, 0)).toBe(1);
  });

  it("途中で次の場面が来ても、今見えている値から動き出す（飛ばない、戻らない）", () => {
    const mid = new Map(plan.tweens.filter((t) => t.kind !== "leave").map((t) => [t.id, valueAt(t, 200)]));
    const second = planScene(mid, [node("a", -40, 0, 0), node("new", 0, 40, 1)], { center: "a" });
    for (const t of second.tweens) {
      if (t.kind === "leave") continue;
      expect(valueAt(t, 0)).toEqual(mid.get(t.id));
    }
  });

  it("新しいノードは面積で育つ（出始めは面積 16%、途中で半径が縮まない）", () => {
    const fresh = by.get("new")!;
    expect(valueAt(fresh, 0).size).toBeCloseTo(4);
    let prev = 0;
    for (let t = 0; t <= plan.total; t += 20) {
      const s = valueAt(fresh, t).size;
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it("ノードが多すぎるときは段差を付けない", () => {
    const many = Array.from({ length: STAGGER.maxNodes + 1 }, (_, i) => node(`n${i}`, Math.cos(i), Math.sin(i), 2));
    for (const t of planScene(new Map(), many, { center: null }).tweens) expect(t.delay).toBe(0);
  });
});

describe("sweepDelay", () => {
  it("中心は遅らせない", () => {
    expect(sweepDelay(10, 10, 0)).toBe(0);
  });

  it("12 時が最小で、時計回りに増え、同じ段の中は sweep 未満", () => {
    const north = sweepDelay(0, 10, 1);
    const east = sweepDelay(10, 0, 1);
    const south = sweepDelay(0, -10, 1);
    const west = sweepDelay(-10, 0, 1);
    expect(north).toBe(0);
    expect(east).toBeGreaterThan(north);
    expect(south).toBeGreaterThan(east);
    expect(west).toBeGreaterThan(south);
    expect(west).toBeLessThan(STAGGER.sweep);
  });

  it("画面の y が下向きなら、上は -y", () => {
    expect(sweepDelay(0, -10, 1, true)).toBe(0);
    expect(sweepDelay(10, 0, 1, true)).toBeCloseTo(STAGGER.sweep / 4);
  });

  it("段ごとに遅れ、上限で止まる", () => {
    expect(sweepDelay(0, 10, 2)).toBe(STAGGER.ring);
    expect(sweepDelay(-1, 10, 9)).toBe(STAGGER.maxDelay);
  });
});
