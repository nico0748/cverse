import { resolveImage } from "./images";
import type { Detail, Meta } from "./types";

/** FNV-1a（32 ビット）。crates/cverse-cli/src/build.rs の `fnv1a` と同じ計算。 */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) {
    h ^= b;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const dataUrl = (path: string) => `${import.meta.env.BASE_URL}data/${path}`;

/** 画像の URL。データに同梱された画像（相対パス）は、データの置き場所から解決する。 */
export const imageUrl = (url: string) => resolveImage(url, dataUrl(""));

/** データ由来のリンク先。`http(s):` 以外（`javascript:` など）はリンクにしない。 */
export function safeHref(url: string | null | undefined): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}

const shards = new Map<number, Promise<Record<string, Detail>>>();
/** 読み終えたシャード。手元にあれば、詳細を待たずに同じフレームで描ける。 */
const loaded = new Map<number, Record<string, Detail>>();

const shardOf = (meta: Meta, id: string) => fnv1a(id) % meta.shardCount;

function fetchShard(k: number): Promise<Record<string, Detail>> {
  let shard = shards.get(k);
  if (!shard) {
    shard = fetch(dataUrl(`nodes/${k}.json`)).then((r) => {
      if (!r.ok) throw new Error(`nodes/${k}.json: ${r.status}`);
      return r.json() as Promise<Record<string, Detail>>;
    });
    shards.set(k, shard);
    shard.then(
      (data) => loaded.set(k, data),
      () => shards.delete(k),
    );
  }
  return shard;
}

/** 詳細パネル用のデータを、必要なシャードだけ読んで返す。 */
export async function loadDetail(meta: Meta, id: string): Promise<Detail | null> {
  return (await fetchShard(shardOf(meta, id)))[id] ?? null;
}

/**
 * 手元にある詳細を同期で返す。シャードを読み終えていれば詳細（無ければ null）、まだなら undefined。
 */
export function peekDetail(meta: Meta, id: string): Detail | null | undefined {
  const data = loaded.get(shardOf(meta, id));
  return data ? (data[id] ?? null) : undefined;
}

/** 押し始めたとき・フォーカスしたときに、先に読み始めておく（失敗は本番の読み込みで扱う）。 */
export function prefetchDetail(meta: Meta, id: string): void {
  fetchShard(shardOf(meta, id)).catch(() => {});
}
