/**
 * グラフ上のノードに描く画像の読み込みと切り抜き。
 *
 * 画像は外部（AniList など）の URL を直接参照する。キャンバスへ描くだけで画素は読まないので、
 * 配信元が CORS を許可していなくても表示できる。読み込めたら、種類ごとの形（丸・角丸・縦長）に
 * 切り抜いた小さな絵（スプライト）を作っておき、毎フレームはそれを貼るだけにする。
 *
 * 長く辿り続けても重くならないよう、次の 3 つを守る。
 * - 元の画像は切り抜いたら手放し、スプライトは最近使った順に `MAX_SPRITES` 枚までしか持たない
 * - 読み込みの待ち行列は新しい要求が先。場面が変わったら、まだ始めていない要求は捨てる
 * - 失敗は覚えっぱなしにしない（しばらく置くか、回線が戻ったらやり直す）
 */
import { CORNER, HALF, type Shape } from "./theme";

/** スプライトの高さ（px）。グラフ上では中心でも 80px 前後なので、2 倍の解像度でも足りる。 */
const SPRITE = 128;
const MAX_PARALLEL = 6;
const MAX_SPRITES = 480;
const RETRY_AFTER = 30_000;

interface Entry {
  url: string;
  shape: Shape;
  focusY: number;
  state: "queued" | "loading" | "ready" | "error";
  sprite: HTMLCanvasElement | null;
  /** 最後に使った順番（大きいほど新しい）。 */
  used: number;
  failedAt: number;
}

const entries = new Map<string, Entry>();
const queue: Entry[] = [];
const listeners = new Set<() => void>();
let active = 0;
let clock = 0;

/** 画像が 1 枚読み込めるたびに呼ばれる（再描画のきっかけ）。 */
export function onSpriteReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 画像のうち、`aspect`（幅 ÷ 高さ）の枠に収める範囲。短い辺をいっぱいに使い、
 * 余る方向は `focusY`（0 = 上端、1 = 下端）に寄せる。人物の画像は顔が上寄りにあるので上を残す。
 */
export function coverCrop(width: number, height: number, focusY: number, aspect = 1) {
  const sw = Math.min(width, height * aspect);
  const sh = sw / aspect;
  return { sx: (width - sw) / 2, sy: (height - sh) * focusY, sw, sh };
}

function makeSprite(img: HTMLImageElement, shape: Shape, focusY: number): HTMLCanvasElement {
  const { w, h } = HALF[shape];
  const canvas = document.createElement("canvas");
  canvas.height = SPRITE;
  canvas.width = Math.round((SPRITE * w) / h);
  const ctx = canvas.getContext("2d")!;
  ctx.beginPath();
  if (shape === "circle") ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2);
  else ctx.roundRect(0, 0, canvas.width, canvas.height, (canvas.width / 2) * CORNER[shape]);
  ctx.clip();
  ctx.imageSmoothingQuality = "high";
  const { sx, sy, sw, sh } = coverCrop(img.naturalWidth, img.naturalHeight, focusY, w / h);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function evict() {
  if (entries.size <= MAX_SPRITES) return;
  const ready = [...entries.entries()].filter(([, e]) => e.state === "ready").sort((a, b) => a[1].used - b[1].used);
  for (const [key] of ready.slice(0, entries.size - MAX_SPRITES)) entries.delete(key);
}

function pump() {
  while (active < MAX_PARALLEL && queue.length > 0) {
    // 新しい要求（いま見ている場面）を先に読む。
    const entry = queue.pop()!;
    if (entry.state !== "queued") continue;
    active++;
    entry.state = "loading";
    const img = new Image();
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    const done = (ok: boolean) => {
      active--;
      if (ok) {
        entry.sprite = makeSprite(img, entry.shape, entry.focusY);
        entry.state = "ready";
        evict();
        listeners.forEach((l) => l());
      } else {
        entry.state = "error";
        entry.failedAt = Date.now();
      }
      pump();
    };
    img.onload = () => done(img.naturalWidth > 0);
    img.onerror = () => done(false);
    img.src = entry.url;
  }
}

/** 切り抜いた絵を返す。まだ読み込めていなければ読み込みを始めて `null` を返す。 */
export function sprite(url: string, shape: Shape, focusY: number): HTMLCanvasElement | null {
  const key = `${shape}|${url}`;
  let entry = entries.get(key);
  if (entry?.state === "error" && Date.now() - entry.failedAt > RETRY_AFTER) {
    entries.delete(key);
    entry = undefined;
  }
  if (!entry) {
    entry = { url, shape, focusY, state: "queued", sprite: null, used: 0, failedAt: 0 };
    entries.set(key, entry);
    queue.push(entry);
    pump();
  }
  entry.used = ++clock;
  return entry.sprite;
}

/** 場面が変わったときに呼ぶ。まだ読み始めていない画像は、次に必要になったら改めて頼む。 */
export function dropQueued() {
  for (const entry of queue.splice(0)) {
    if (entry.state === "queued") entries.delete(`${entry.shape}|${entry.url}`);
  }
}

// 回線が戻ったら、失敗した画像をやり直せるようにする。
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    for (const [key, entry] of entries) if (entry.state === "error") entries.delete(key);
    listeners.forEach((l) => l());
  });
}

/** 画像の中で顔（主題）がある縦位置の目安。 */
export const FOCUS_Y = { va: 0.12, ch: 0.1, wk: 0.3, more: 0.5 } as const;
