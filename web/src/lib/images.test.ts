import { describe, expect, it } from "vitest";
import { expandImages, resolveImage } from "./images";
import { safeHref } from "./shard";
import { TIERS, capFor, coverCrop, tierFor } from "./sprites";

describe("画像の URL", () => {
  it("外部の画像はそのまま、同梱の画像はデータの置き場所から解決する", () => {
    expect(resolveImage("https://img.example/a.jpg", "/data/")).toBe("https://img.example/a.jpg");
    expect(resolveImage("local/va/a.webp", "/cverse/data/")).toBe("/cverse/data/local/va/a.webp");
  });

  it("images.json の表をノードごとの URL に戻す", () => {
    const table = { bases: ["https://img.example/staff/", "local/"], refs: ["0:a.jpg", "", "1:ch/b.png", "0:"] };
    expect(expandImages(table, "/data/")).toEqual([
      "https://img.example/staff/a.jpg",
      "",
      "/data/local/ch/b.png",
      "https://img.example/staff/",
    ]);
  });

  it("壊れた行は画像なしにして、ほかの行は生かす", () => {
    const table = { bases: ["https://img.example/", 7], refs: ["9:a.jpg", "x:a.jpg", "a.jpg", 3, null, "1:b.jpg", "0:ok.jpg"] };
    expect(expandImages(table, "/data/")).toEqual(["", "", "", "", "", "", "https://img.example/ok.jpg"]);
    expect(expandImages({}, "/data/")).toEqual([]);
    expect(expandImages({ bases: "x", refs: [] }, "/data/")).toEqual([]);
  });
});

describe("データ由来のリンク", () => {
  it("http と https だけをリンクにする", () => {
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHref("HTTP://example.com")).toBe("HTTP://example.com");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "//example.com", "/local", "", null, undefined]) {
      expect(safeHref(bad)).toBeUndefined();
    }
  });
});

describe("画像の切り抜き", () => {
  it("正方形の枠: 縦長の画像は幅いっぱい、上寄りに切る", () => {
    expect(coverCrop(200, 300, 0, 1)).toEqual({ sx: 0, sy: 0, sw: 200, sh: 200 });
    expect(coverCrop(200, 300, 0.1, 1)).toEqual({ sx: 0, sy: 10, sw: 200, sh: 200 });
    expect(coverCrop(200, 300, 1, 1)).toEqual({ sx: 0, sy: 100, sw: 200, sh: 200 });
  });

  it("正方形の枠: 横長の画像は高さいっぱい、左右は中央", () => {
    expect(coverCrop(400, 200, 0.3, 1)).toEqual({ sx: 100, sy: 0, sw: 200, sh: 200 });
  });

  it("縦長（3:4）の枠でも、切り抜きは画像の中に収まり比率を保つ", () => {
    for (const [w, h] of [[230, 325], [460, 650], [600, 300], [300, 900], [90, 120]]) {
      const c = coverCrop(w, h, 0.3, 3 / 4);
      expect(c.sw / c.sh).toBeCloseTo(3 / 4, 6);
      expect(c.sx).toBeGreaterThanOrEqual(0);
      expect(c.sy).toBeGreaterThanOrEqual(0);
      expect(c.sx + c.sw).toBeLessThanOrEqual(w + 1e-9);
      expect(c.sy + c.sh).toBeLessThanOrEqual(h + 1e-9);
    }
  });
});

describe("絵の細かさの段", () => {
  it("画面上の高さを満たす最小の段を選び、一番上で頭打ちにする", () => {
    expect(tierFor(10)).toBe(128);
    expect(tierFor(128)).toBe(128);
    expect(tierFor(129)).toBe(256);
    expect(tierFor(170)).toBe(256);
    expect(tierFor(5000)).toBe(TIERS[TIERS.length - 1]);
  });
  it("元の画像の高さを超える段は作らない", () => {
    // AniList のキャラ画像（230×345）を正方形に切ると高さ 230。256 の段まで（実際の絵は 230px）。
    expect(capFor(230)).toBe(256);
    expect(capFor(100)).toBe(128);
  });
});
