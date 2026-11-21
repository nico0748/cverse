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
export const imageUrl = (url: string) => (url.startsWith("https://") ? url : dataUrl(url));

const shards = new Map<number, Promise<Record<string, Detail>>>();

/** 詳細パネル用のデータを、必要なシャードだけ読んで返す。 */
export async function loadDetail(meta: Meta, id: string): Promise<Detail | null> {
  const k = fnv1a(id) % meta.shardCount;
  let shard = shards.get(k);
  if (!shard) {
    shard = fetch(dataUrl(`nodes/${k}.json`)).then((r) => {
      if (!r.ok) throw new Error(`nodes/${k}.json: ${r.status}`);
      return r.json();
    });
    shards.set(k, shard);
    shard.catch(() => shards.delete(k));
  }
  return (await shard)[id] ?? null;
}
