import type { NodeBrief } from "../lib/types";
import { KindIcon } from "./KindIcon";

interface Props {
  trail: NodeBrief[];
  onJump: (index: number) => void;
}

/** パンくず（F-05）。辿った道を表示し、押すとその地点に戻る。 */
export function Breadcrumbs({ trail, onJump }: Props) {
  if (trail.length === 0) return null;
  // 長くなったら直近だけ見せる（先頭は残す）。
  const MAX = 7;
  const hiddenCount = Math.max(0, trail.length - MAX);
  const shown = trail.map((node, index) => ({ node, index })).filter(({ index }) => index === 0 || index > hiddenCount);
  return (
    <nav className="crumbs" aria-label="辿った道">
      <ol>
        {shown.map(({ node, index }, i) => {
          const last = index === trail.length - 1;
          return (
            <li key={`${index}-${node.id}`}>
              {i > 0 && <span className="crumbs__sep" aria-hidden="true">›</span>}
              {i === 1 && hiddenCount > 0 && <span className="crumbs__gap" title={`${hiddenCount} 件を省略`}>…›</span>}
              <button
                type="button"
                className={`crumbs__item${last ? " is-current" : ""}`}
                aria-current={last ? "page" : undefined}
                onClick={() => !last && onJump(index)}
              >
                <KindIcon kind={node.kind} size={10} />
                {node.label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
