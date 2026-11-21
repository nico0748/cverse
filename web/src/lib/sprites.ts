/**
 * グラフ上のノードに描く画像の読み込みと切り抜き。
 *
 * 画像は外部（AniList など）の URL を直接参照する。キャンバスへ描くだけで画素は読まないので、
 * 配信元が CORS を許可していなくても表示できる。読み込めたら、種類ごとの形（丸・角丸・縦長）に
 * 切り抜いた小さな絵（スプライト）を作っておき、毎フレームはそれを貼るだけにする。
 *
 * 絵の細かさは、画面に出る大きさ（端末の画素比込み）に合わせて段階的に選ぶ。中心のノードや
 * 拡大したときは大きな絵を作り直し、元の画像より細かくはしない（引き伸ばしても情報は増えない）。
 * 作り直しのあいだは手元の小さい絵を出し続けるので、ちらつかない。
 *
 * 長く辿り続けても重くならないよう、次の 3 つを守る。
 * - 元の画像は切り抜いたら手放し、スプライトは最近使った順に、合計の画素数が `MAX_PIXELS` に収まるまでしか持たない
 * - 読み込みの待ち行列は新しい要求が先。場面が変わったら、まだ始めていない要求は捨てる
 * - 失敗は覚えっぱなしにしない（しばらく置くか、回線が戻ったらやり直す）
 */
import { CORNER, HALF, type Shape } from "./theme";

/**
 * スプライトの高さの段（px）。画面上の高さ × 画素比を満たす最小の段を使う。
 * 小さなノードでも 128 から始める。ちょうどの大きさより少し大きい絵を縮めて描く方が輪郭がくっきりする。
 */
export const TIERS = [128, 256, 512] as const;
const MAX_PARALLEL = 6;
/** 持っておくスプライトの画素数の合計（およそ 4 バイト/画素なので約 100 MB）。 */
const MAX_PIXELS = 24_000_000;
const RETRY_AFTER = 30_000;
const LOAD_TIMEOUT = 12_000;

interface Entry {
  url: string;
  shape: Shape;
  focusY: number;
  state: "queued" | "loading" | "ready" | "error";
  sprite: HTMLCanvasElement | null;
  /** いまの絵の段（まだ無ければ 0）。 */
  tier: number;
  /** 求められている一番細かい段。 */
  want: number;
  /** 元の画像から作れる一番細かい段（読み込むまでは分からないので最大）。 */
  cap: number;
  /** 最後に使った順番（大きいほど新しい）。 */
  used: number;
  failedAt: number;
}

const entries = new Map<string, Entry>();
const queue: Entry[] = [];
/** 読み込み中のものと、その取り下げ方。 */
const loading = new Map<Entry, () => void>();
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

/** 画面上の高さ（端末の画素）を満たす段。一番上の段で頭打ちにする。 */
export function tierFor(px: number): number {
  return TIERS.find((t) => t >= px) ?? TIERS[TIERS.length - 1];
}

/** 切り抜いた範囲の高さ `sourceHeight` から作れる一番細かい段（それより上は引き伸ばしになる）。 */
export function capFor(sourceHeight: number): number {
  return tierFor(sourceHeight);
}

function makeSprite(img: HTMLImageElement, shape: Shape, focusY: number, tier: number): HTMLCanvasElement {
  const { w, h } = HALF[shape];
  const crop = coverCrop(img.naturalWidth, img.naturalHeight, focusY, w / h);
  // 元より細かくはしない。引き伸ばしは描くときに 1 回だけ行う。
  const height = Math.max(1, Math.min(tier, Math.round(crop.sh)));
  const canvas = document.createElement("canvas");
  canvas.height = height;
  canvas.width = Math.max(1, Math.round((height * w) / h));
  const ctx = canvas.getContext("2d")!;
  ctx.beginPath();
  if (shape === "circle") ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2);
  else ctx.roundRect(0, 0, canvas.width, canvas.height, (canvas.width / 2) * CORNER[shape]);
  ctx.clip();
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const pixels = (e: Entry) => (e.sprite ? e.sprite.width * e.sprite.height : 0);

function evict() {
  let total = 0;
  for (const e of entries.values()) total += pixels(e);
  if (total <= MAX_PIXELS) return;
  const ready = [...entries.entries()].filter(([, e]) => e.state === "ready").sort((a, b) => a[1].used - b[1].used);
  for (const [key, e] of ready) {
    if (total <= MAX_PIXELS) break;
    total -= pixels(e);
    entries.delete(key);
  }
}

/** 読み込みが終わった、または取り下げたときに、手元の絵があれば「表示できる」に戻す。 */
function settle(entry: Entry) {
  entry.state = entry.sprite ? "ready" : "error";
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
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      loading.delete(entry);
      img.onload = img.onerror = null;
      active--;
      try {
        if (ok) {
          const { w, h } = HALF[entry.shape];
          entry.cap = capFor(coverCrop(img.naturalWidth, img.naturalHeight, entry.focusY, w / h).sh);
          const tier = Math.min(entry.want, entry.cap);
          entry.sprite = makeSprite(img, entry.shape, entry.focusY, tier);
          entry.tier = tier;
        }
      } catch {
        ok = false;
      }
      if (ok) {
        entry.state = "ready";
        evict();
        listeners.forEach((l) => l());
      } else if (entry.sprite) {
        // 細かい絵の作り直しに失敗しても、手元の絵は使い続ける。もう頼まない。
        entry.cap = entry.tier;
        entry.state = "ready";
      } else {
        entry.state = "error";
        entry.failedAt = Date.now();
      }
      img.src = "";
      pump();
    };
    // 応答の無い配信元に枠を取られ続けないよう、待つ時間に上限を置く。
    const timer = window.setTimeout(() => done(false), LOAD_TIMEOUT);
    loading.set(entry, () => {
      // 場面が変わって要らなくなった読み込みは、失敗扱いにせず取り下げる。
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      img.onload = img.onerror = null;
      img.src = "";
      active--;
      if (entry.sprite) settle(entry);
      else entries.delete(`${entry.shape}|${entry.url}`);
    });
    img.onload = () => done(img.naturalWidth > 0);
    img.onerror = () => done(false);
    img.src = entry.url;
  }
}

/**
 * 切り抜いた絵を返す。`px` は画面に出す高さ（端末の画素）。まだ読み込めていなければ読み込みを始めて
 * `null` を返す。手元の絵が `px` に足りなければ、それを返しつつ細かい絵を作り直す。
 */
export function sprite(url: string, shape: Shape, focusY: number, px: number = TIERS[0]): HTMLCanvasElement | null {
  const key = `${shape}|${url}`;
  const want = tierFor(px);
  let entry = entries.get(key);
  if (entry?.state === "error" && Date.now() - entry.failedAt > RETRY_AFTER) {
    entries.delete(key);
    entry = undefined;
  }
  if (!entry) {
    entry = { url, shape, focusY, state: "queued", sprite: null, tier: 0, want, cap: TIERS[TIERS.length - 1], used: 0, failedAt: 0 };
    entries.set(key, entry);
    queue.push(entry);
    pump();
  } else if (want > entry.want) {
    entry.want = want;
    if (entry.state === "ready" && entry.tier < Math.min(want, entry.cap)) {
      entry.state = "queued";
      queue.push(entry);
      pump();
    }
  }
  entry.used = ++clock;
  return entry.sprite;
}

/** 場面が変わったときに呼ぶ。まだ読み始めていない画像は、次に必要になったら改めて頼む。 */
export function dropQueued() {
  for (const entry of queue.splice(0)) {
    if (entry.state !== "queued") continue;
    if (entry.sprite) {
      // 作り直し待ちのものは、いまの絵のまま残す。次に大きく出たら改めて頼む。
      entry.want = entry.tier;
      settle(entry);
    } else entries.delete(`${entry.shape}|${entry.url}`);
  }
  // 読み込み中のものも取り下げて、新しい場面の画像にすぐ枠を回す。
  for (const [entry, cancel] of [...loading.entries()]) {
    cancel();
    if (entry.sprite) entry.want = entry.tier;
  }
  loading.clear();
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
