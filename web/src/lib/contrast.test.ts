/**
 * 配色のコントラストを、styles.css の変数から直接確かめる（WCAG 2.2 の AA）。
 * 色を変えたときに、読めない組み合わせが紛れ込まないようにするための検査。
 */
import { describe, expect, it } from "vitest";
import css from "../styles.css?raw";

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf("\n}", start));
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)) out[m[1]] = m[2];
  return out;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const light = tokens(":root");
const themes: [string, Record<string, string>][] = [
  ["明るい配色", light],
  // 暗い配色は、上書きしていない変数を明るい配色から引き継ぐ。
  ["暗い配色", { ...light, ...tokens(':root[data-theme="dark"]') }],
];

/** [前景, 背景, 必要な比]。文字は 4.5、輪郭や印などの文字以外は 3。 */
const PAIRS: [string, string, number][] = [
  // 本文と補足の文字
  ["--ink", "--surface", 7],
  ["--ink", "--ground", 7],
  ["--ink-2", "--surface", 4.5],
  ["--ink-2", "--ground", 4.5],
  ["--ink-2", "--surface-2", 4.5],
  ["--ink-2", "--surface-3", 4.5],
  ["--ink-3", "--surface", 4.5],
  ["--link", "--surface", 4.5],
  ["--link", "--ground", 4.5],
  // 選択中・強調
  ["--ground", "--ink", 7],
  ["--on-accent", "--accent", 4.5],
  ["--accent-ink", "--accent-soft", 4.5],
  ["--accent-ink", "--surface", 4.5],
  // 画像が無いときの頭文字
  ["--va-ink", "--va-tint", 4.5],
  ["--ch-ink", "--ch-tint", 4.5],
  ["--wk-ink", "--wk-tint", 4.5],
  ["--more-ink", "--more-tint", 4.5],
  // 文字以外（種類の輪郭・入力欄の枠・フォーカスの輪・経路の線）
  ["--va", "--ground", 3],
  ["--ch", "--ground", 3],
  ["--wk", "--ground", 3],
  ["--va", "--surface", 3],
  ["--ch", "--surface", 3],
  ["--wk", "--surface", 3],
  ["--line-strong", "--surface", 3],
  ["--line-strong", "--ground", 3],
  ["--accent", "--ground", 3],
  ["--accent", "--surface", 3],
];

describe.each(themes)("%s", (_name, t) => {
  it.each(PAIRS)("%s は %s の上で比 %d 以上", (fg, bg, min) => {
    expect(t[fg], `${fg} が定義されていない`).toBeDefined();
    expect(t[bg], `${bg} が定義されていない`).toBeDefined();
    const ratio = contrast(t[fg], t[bg]);
    expect(ratio, `${fg} ${t[fg]} / ${bg} ${t[bg]} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min);
  });
});
