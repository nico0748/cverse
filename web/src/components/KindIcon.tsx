import type { Kind } from "../lib/types";

/** 種類を色と形で示す小さな印（グラフ上のノードと同じ約束: 声優 = 丸、キャラ = 角丸、作品 = 四角）。 */
export function KindIcon({ kind, size = 12 }: { kind: Kind | "more"; size?: number }) {
  return <span className={`kind-icon kind-icon--${kind}`} aria-hidden="true" style={{ width: size, height: size }} />;
}
