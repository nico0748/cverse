import type { NodeBrief } from "../lib/types";
import { KIND_LABEL } from "../lib/types";
import { Thumb } from "./Thumb";

/** 画像・名前・補足を 1 行にまとめた項目。押すとそのノードが中心になる。 */
export function NodeRow({ node, onPick, sub }: { node: NodeBrief; onPick: (id: string) => void; sub?: string }) {
  const note = sub ?? node.sub ?? (node.kind === "more" ? "" : KIND_LABEL[node.kind]);
  return (
    <button type="button" className="node-row" onClick={() => onPick(node.id)}>
      <Thumb kind={node.kind} src={node.image} label={node.label} size={36} />
      <span className="node-row__text">
        <span className="node-row__name">{node.label}</span>
        {note && <span className="node-row__sub">{note}</span>}
      </span>
    </button>
  );
}

/** 画像を大きく見せるカード（トップ画面の入口）。 */
export function NodeCard({ node, onPick }: { node: NodeBrief; onPick: (id: string) => void }) {
  return (
    <button type="button" className={`node-card node-card--${node.kind}`} onClick={() => onPick(node.id)}>
      <Thumb kind={node.kind} src={node.image} label={node.label} size={node.kind === "wk" ? 78 : 80} />
      <span className="node-card__name">{node.label}</span>
      {node.sub && <span className="node-card__sub">{node.sub}</span>}
    </button>
  );
}
