import { KIND_STYLE } from "../lib/theme";
import type { Kind } from "../lib/types";

/** 種類を色と形で示す小さなアイコン（グラフ上のノードと同じ約束）。 */
export function KindIcon({ kind, size = 12 }: { kind: Kind | "more"; size?: number }) {
  const s = KIND_STYLE[kind];
  return (
    <span
      className="kind-icon"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        background: s.color,
        borderRadius: s.shape === "circle" ? "50%" : s.shape === "rounded" ? "32%" : 1,
      }}
    />
  );
}
