import { useState } from "react";
import { isWide } from "../lib/sprites";
import type { Kind } from "../lib/types";

interface Props {
  kind: Kind | "more";
  /** 画像の URL。無いか読み込めなければ、頭文字のアイコンになる。 */
  src?: string;
  /** 頭文字を取る名前。 */
  label: string;
  size?: number;
  /** 名鑑の写真のように、縦長（3:4）の枠で見せる（詳細の見出し）。 */
  portrait?: boolean;
  /** 画面外でも先に読み込む（最初に目に入る大きな画像）。 */
  eager?: boolean;
}

/**
 * ノードの絵。種類の形（丸・角丸の四角・縦長の四角）に切り抜き、種類の色で縁取る。
 * `size` は幅。作品はポスターの比率（3:4）なので、高さはその 4/3 になる。
 * 名前は必ず隣に文字で出すので、画像そのものには代替テキストを付けない。
 */
export function Thumb({ kind, src, label, size = 36, portrait = false, eager = false }: Props) {
  const [failed, setFailed] = useState<string | null>(null);
  // ロゴのような横長の画像は、切り抜かずに台紙へ収める（lib/sprites の isWide）。
  const [wide, setWide] = useState<string | null>(null);
  const show = src && failed !== src;
  const initial = kind === "more" ? "…" : (Array.from(label.trim())[0] ?? "?");
  const tall = kind === "wk" || portrait;
  return (
    <span
      className={`thumb thumb--${kind}${portrait ? " thumb--portrait" : ""}${show && wide === src ? " thumb--wide" : ""}`}
      style={{ width: size, height: tall ? Math.round((size * 4) / 3) : size, fontSize: Math.round(size * 0.46) }}
      aria-hidden="true"
    >
      {show ? (
        <img
          src={src}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailed(src)}
          onLoad={(e) => {
            const img = e.currentTarget;
            setWide(isWide(img.naturalWidth, img.naturalHeight, tall ? 3 / 4 : 1) ? src : null);
          }}
        />
      ) : (
        initial
      )}
    </span>
  );
}
