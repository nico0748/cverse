/**
 * 動きの値（docs/motion.md）を、styles.css の変数と突き合わせて確かめる。
 * 値を変えたときに TS と CSS がずれたり、生の長さや既定の曲線が紛れ込んだりしないようにするための検査。
 */
import { describe, expect, it } from "vitest";
import css from "../styles.css?raw";
import { DUR, EASE, bezier, ease } from "./motion";

function block(start: number): string {
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error("閉じ括弧が無い");
}

function vars(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--(?:dur|ease|dist|scale)-[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const root = vars(block(css.indexOf(":root {")));
const reduced = vars(block(css.indexOf(":root {", css.indexOf("@media (prefers-reduced-motion: reduce)"))));

describe("動きの値", () => {
  it("CSS の長さが motion.ts と同じ", () => {
    for (const [name, ms] of Object.entries(DUR)) expect(root[`--dur-${name}`], name).toBe(`${ms}ms`);
  });

  it("CSS の曲線が motion.ts と同じ", () => {
    for (const [name, pts] of Object.entries(EASE)) expect(root[`--ease-${name}`], name).toBe(`cubic-bezier(${pts.join(", ")})`);
  });

  it("長さの段は隣どうしで 1.3 倍以上離れ、中心の切り替えは 480ms 以内", () => {
    const steps = Object.values(DUR);
    for (let i = 1; i < steps.length; i++) expect(steps[i] / steps[i - 1]).toBeGreaterThanOrEqual(1.3);
    expect(DUR.scene).toBeLessThanOrEqual(480);
  });

  it("動きを減らす設定では、距離が 0・大きさが 1・長い動きが短くなる", () => {
    expect(reduced["--dist-nudge"]).toBe("0px");
    expect(reduced["--dist-s"]).toBe("0px");
    expect(reduced["--dist-m"]).toBe("0px");
    expect(reduced["--scale-from"]).toBe("1");
    expect(reduced["--scale-press"]).toBe("1");
    expect(reduced["--dur-slow"]).toBe(`${DUR.fast}ms`);
    expect(reduced["--dur-scene"]).toBe(`${DUR.fast}ms`);
  });
});

describe("曲線", () => {
  it("端は 0 と 1、直線の曲線はそのまま", () => {
    for (const f of Object.values(ease)) {
      expect(f(0)).toBe(0);
      expect(f(1)).toBe(1);
    }
    const linear = bezier(0, 0, 1, 1);
    for (const x of [0.1, 0.33, 0.5, 0.9]) expect(linear(x)).toBeCloseTo(x, 4);
  });

  it("入る・去る・移るは単調に増える", () => {
    for (const f of [ease.enter, ease.exit, ease.move]) {
      let prev = 0;
      for (let i = 1; i <= 100; i++) {
        const v = f(i / 100);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    }
  });

  it("出だしが速い（押した瞬間に動き出す）。去るのは最初ゆっくり", () => {
    expect(ease.move(0.25)).toBeGreaterThanOrEqual(0.55);
    expect(ease.enter(0.25)).toBeGreaterThanOrEqual(0.75);
    expect(ease.exit(0.5)).toBeLessThanOrEqual(0.4);
  });

  it("強調の行き過ぎは 6% まで", () => {
    let max = 0;
    for (let i = 0; i <= 200; i++) max = Math.max(max, ease.emphasis(i / 200));
    expect(max).toBeGreaterThan(1);
    expect(max).toBeLessThanOrEqual(1.06);
  });
});

describe("styles.css の書き方", () => {
  const decls = [...css.matchAll(/\b(transition|animation)(?:-duration|-timing-function)?:\s*([^;]+);/g)].map((m) => m[0]);

  it("transition と animation の長さはトークンで書く", () => {
    for (const d of decls) expect(d, d).not.toMatch(/(?<![\w-])\d+(?:\.\d+)?m?s\b/);
  });

  it("既定の曲線（ease など）と transition: all を使わない", () => {
    for (const d of decls) {
      expect(d, d).not.toMatch(/\b(?:ease|ease-in|ease-out|ease-in-out)\b(?!-)/);
      expect(d, d).not.toMatch(/transition:\s*all\b/);
    }
  });

  it("位置や幅を動かさない（シートの高さだけ Phase 2 まで例外）", () => {
    for (const d of decls) {
      if (!d.startsWith("transition")) continue;
      expect(d, d).not.toMatch(/(?:^|[\s:,])(?:top|left|right|bottom|width)\s/);
    }
  });
});
