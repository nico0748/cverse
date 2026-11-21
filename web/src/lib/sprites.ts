/**
 * グラフ上のノードに描く画像の読み込みと切り抜き。
 *
 * 画像は外部（AniList など）の URL を直接参照する。キャンバスへ描くだけで画素は読まないので、
 * 配信元が CORS を許可していなくても表示できる。読み込めたら、種類ごとの形（丸・角丸・四角）に
 * 切り抜いた小さな絵（スプライト）を作っておき、毎フレームはそれを貼るだけにする。
 */
import { CORNER, type Shape } from "./theme";

const SPRITE = 160;
const MAX_PARALLEL = 6;

interface Entry {
  state: "queued" | "loading" | "ready" | "error";
  img: HTMLImageElement | null;
  sprites: Map<string, HTMLCanvasElement>;
}

const entries = new Map<string, Entry>();
const queue: string[] = [];
const listeners = new Set<() => void>();
let active = 0;

/** 画像が 1 枚読み込めるたびに呼ばれる（再描画のきっかけ）。 */
export function onSpriteReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function pump() {
  while (active < MAX_PARALLEL && queue.length > 0) {
    const url = queue.shift()!;
    const entry = entries.get(url);
    if (!entry || entry.state !== "queued") continue;
    active++;
    entry.state = "loading";
    const img = new Image();
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    const done = (ok: boolean) => {
      active--;
      entry.state = ok ? "ready" : "error";
      entry.img = ok ? img : null;
      if (ok) listeners.forEach((l) => l());
      pump();
    };
    img.onload = () => done(img.naturalWidth > 0);
    img.onerror = () => done(false);
    img.src = url;
  }
}

/**
 * 正方形に切り抜く位置。人物の画像は縦長で顔が上寄りにあるので、上から少し下を取る。
 * 作品の絵（キービジュアル）は中央寄りを取る。
 */
export function coverCrop(width: number, height: number, focusY: number) {
  const side = Math.min(width, height);
  return { sx: (width - side) / 2, sy: (height - side) * focusY, side };
}

function makeSprite(img: HTMLImageElement, shape: Shape, focusY: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SPRITE;
  const ctx = canvas.getContext("2d")!;
  ctx.beginPath();
  if (shape === "circle") ctx.arc(SPRITE / 2, SPRITE / 2, SPRITE / 2, 0, Math.PI * 2);
  else ctx.roundRect(0, 0, SPRITE, SPRITE, (SPRITE / 2) * CORNER[shape]);
  ctx.clip();
  ctx.imageSmoothingQuality = "high";
  const { sx, sy, side } = coverCrop(img.naturalWidth, img.naturalHeight, focusY);
  ctx.drawImage(img, sx, sy, side, side, 0, 0, SPRITE, SPRITE);
  return canvas;
}

/** 切り抜いた絵を返す。まだ読み込めていなければ読み込みを始めて `null` を返す。 */
export function sprite(url: string, shape: Shape, focusY: number): HTMLCanvasElement | null {
  let entry = entries.get(url);
  if (!entry) {
    entry = { state: "queued", img: null, sprites: new Map() };
    entries.set(url, entry);
    queue.push(url);
    pump();
  }
  if (entry.state !== "ready" || !entry.img) return null;
  const key = `${shape}:${focusY}`;
  let made = entry.sprites.get(key);
  if (!made) {
    made = makeSprite(entry.img, shape, focusY);
    entry.sprites.set(key, made);
  }
  return made;
}

/** 画像の中で顔（主題）がある縦位置の目安。 */
export const FOCUS_Y = { va: 0.12, ch: 0.1, wk: 0.3, more: 0.5 } as const;
