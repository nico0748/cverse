/**
 * 画像の URL の解決。外部の画像は `https://` の URL をそのまま使い、データに同梱された画像
 * （相対パス）はデータの置き場所から解決する。詳細パネルと Web Worker の両方で同じ決まりを使う。
 */
export function resolveImage(url: string, dataBase: string): string {
  return /^https:\/\//i.test(url) ? url : dataBase + url;
}

/**
 * images.json（`{ bases, refs }`）をノードごとの URL に戻す。
 * `refs[i]` は `"<bases の番号>:<残り>"`、画像が無ければ空文字列。読めない行は「画像なし」として扱う。
 */
export function expandImages(table: { bases?: unknown; refs?: unknown }, dataBase: string): string[] {
  if (!Array.isArray(table.bases) || !Array.isArray(table.refs)) return [];
  const bases = table.bases.map((b) => (typeof b === "string" ? resolveImage(b, dataBase) : null));
  return table.refs.map((ref) => {
    if (typeof ref !== "string" || !ref) return "";
    const cut = ref.indexOf(":");
    const base = cut > 0 && /^\d+$/.test(ref.slice(0, cut)) ? bases[Number(ref.slice(0, cut))] : null;
    return base == null ? "" : base + ref.slice(cut + 1);
  });
}
