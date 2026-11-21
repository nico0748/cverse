import type { NodeBrief } from "../lib/types";
import { Icon } from "./Icon";
import { KindIcon } from "./KindIcon";

interface Props {
  trail: NodeBrief[];
  onJump: (index: number) => void;
}

/** 辿った道（F-05）。押すとその地点に戻る。 */
export function Breadcrumbs({ trail, onJump }: Props) {
  if (trail.length === 0) return null;
  // 長くなったら直近だけ見せる（先頭は残す）。
  const MAX = 6;
  const hiddenCount = Math.max(0, trail.length - MAX);
  const shown = trail.map((node, index) => ({ node, index })).filter(({ index }) => index === 0 || index > hiddenCount);
  return (
    <nav className="crumbs" aria-label="辿った道">
      <ol>
        {shown.map(({ node, index }, i) => {
          const last = index === trail.length - 1;
          return (
            <li key={`${index}-${node.id}`}>
              {i > 0 && (
                <span className="crumbs__sep" aria-hidden="true">
                  <Icon name="chevron" size={12} />
                </span>
              )}
              {i === 1 && hiddenCount > 0 && (
                <span className="crumbs__gap">
                  <span aria-hidden="true">…</span>
                  <span className="sr-only">{hiddenCount} 件を省略</span>
                  <span className="crumbs__sep" aria-hidden="true">
                    <Icon name="chevron" size={12} />
                  </span>
                </span>
              )}
              {last ? (
                <span className="crumbs__item is-current" aria-current="page">
                  <KindIcon kind={node.kind} size={10} />
                  {node.label}
                </span>
              ) : (
                <button type="button" className="crumbs__item" onClick={() => onJump(index)}>
                  <KindIcon kind={node.kind} size={10} />
                  {node.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
