import { useState } from "react";
import type { Kind } from "../lib/types";

interface Props {
  kind: Kind | "more";
  /** 画像の URL。無いか読み込めなければ、頭文字のアイコンになる。 */
  src?: string;
  /** 頭文字を取る名前。 */
  label: string;
  size?: number;
  /** 作品を縦長（ポスターの比率）で見せる。 */
  poster?: boolean;
  /** 画面外でも先に読み込む（最初に目に入る大きな画像）。 */
  eager?: boolean;
}

/**
 * ノードの絵。種類の形（丸・角丸・四角）に切り抜き、種類の色で縁取る。
 * 名前は必ず隣に文字で出すので、画像そのものには代替テキストを付けない。
 */
export function Thumb({ kind, src, label, size = 36, poster = false, eager = false }: Props) {
  const [failed, setFailed] = useState<string | null>(null);
  const show = src && failed !== src;
  const initial = kind === "more" ? "…" : (Array.from(label.trim())[0] ?? "?");
  return (
    <span
      className={`thumb thumb--${kind}${poster ? " thumb--poster" : ""}`}
      style={{ width: size, height: poster ? Math.round(size * 1.4) : size, fontSize: Math.round(size * 0.46) }}
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
        />
      ) : (
        initial
      )}
    </span>
  );
}
