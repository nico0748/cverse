import { useEffect, useRef, useState } from "react";
import type { NodeBrief } from "../lib/types";
import { Icon } from "./Icon";
import { KindIcon } from "./KindIcon";

export interface Crumb {
  node: NodeBrief;
  /** 辿った道の中での位置（名前が引けなかった地点は抜けるので、並び順とは別に持つ）。 */
  index: number;
}

interface Props {
  crumbs: Crumb[];
  /** いま中心にしている地点の位置。 */
  current: number;
  onJump: (index: number) => void;
}

/** 長くなったら、先頭と直近だけ見せる。 */
const MAX = 5;

/** 辿った道（F-05）。押すとその地点に戻る。 */
export function Breadcrumbs({ crumbs, current, onJump }: Props) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const last = crumbs[crumbs.length - 1]?.node.id;
  // いまの地点（右端）がいつも見えるようにする。
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [last, crumbs.length, expanded]);
  // 辿り直したら、畳んだ状態に戻す。
  useEffect(() => setExpanded(false), [last]);

  // 1 つだけのときは、名前がすぐ下の図と詳細にあるので出さない。
  if (crumbs.length < 2) return null;
  const hiddenCount = expanded ? 0 : Math.max(0, crumbs.length - MAX);
  const shown = crumbs.filter((_, i) => i === 0 || i > hiddenCount);
  return (
    <nav className="crumbs" aria-label="辿った道" ref={ref}>
      <ol>
        {shown.map(({ node, index }, i) => (
          <li key={`${index}-${node.id}`}>
            {i > 0 && (
              <span className="crumbs__sep" aria-hidden="true">
                <Icon name="chevron" size={12} />
              </span>
            )}
            {i === 1 && hiddenCount > 0 && (
              <>
                <button type="button" className="crumbs__item crumbs__more" aria-label={`省略した ${hiddenCount} 件を表示`} onClick={() => setExpanded(true)}>
                  …
                </button>
                <span className="crumbs__sep" aria-hidden="true">
                  <Icon name="chevron" size={12} />
                </span>
              </>
            )}
            {index === current ? (
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
        ))}
      </ol>
    </nav>
  );
}
