import { useState } from "react";
import { PATH_MODE_LABEL, type NodeBrief, type PathData, type PathMode } from "../lib/types";
import { KindIcon } from "./KindIcon";
import { SearchBox } from "./SearchBox";

export interface PathDraft {
  from: NodeBrief | null;
  to: NodeBrief | null;
  mode: PathMode;
}

interface Props {
  draft: PathDraft;
  onDraft: (draft: PathDraft) => void;
  result: PathData | null;
  /** グラフ上のノードを押して端点を選ぶモード。 */
  picking: "from" | "to" | null;
  onPicking: (which: "from" | "to" | null) => void;
  onNavigate: (id: string) => void;
  onClear: () => void;
}

const MODE_HELP: Record<PathMode, string> = {
  bfs: "いちばん短い道（双方向の幅優先探索）",
  main: "主役として出ている作品だけを通る",
  weighted: "脇役のつながりを遠回り扱いにして、主役どうしの道を優先する",
};

function Endpoint({
  label,
  which,
  node,
  picking,
  onSet,
  onPicking,
}: {
  label: string;
  which: "from" | "to";
  node: NodeBrief | null;
  picking: boolean;
  onSet: (node: NodeBrief | null) => void;
  onPicking: (which: "from" | "to" | null) => void;
}) {
  return (
    <div className="endpoint">
      <span className="endpoint__label">{label}</span>
      {node ? (
        <span className="endpoint__value">
          <KindIcon kind={node.kind} />
          <span>{node.label}</span>
          <button type="button" className="icon-button" aria-label={`${label}を選び直す`} onClick={() => onSet(null)}>
            ×
          </button>
        </span>
      ) : (
        <>
          <SearchBox label={`${label}を検索`} placeholder="名前で検索" onPick={onSet} />
          <button
            type="button"
            className={`chip${picking ? " is-on" : ""}`}
            aria-pressed={picking}
            onClick={() => onPicking(picking ? null : which)}
          >
            {picking ? "グラフのノードを押してください" : "グラフから選ぶ"}
          </button>
        </>
      )}
    </div>
  );
}

/** 最短経路（F-10）。2 つのノードを選ぶと、つながる道と「共演で何ステップ」を表示する。 */
export function PathPanel({ draft, onDraft, result, picking, onPicking, onNavigate, onClear }: Props) {
  const [copied, setCopied] = useState(false);
  const ready = draft.from && draft.to;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="path">
      <p className="muted">2 つのノードを選ぶと、つながる最短の道を表示します。</p>
      <Endpoint label="始点" which="from" node={draft.from} picking={picking === "from"} onPicking={onPicking} onSet={(from) => onDraft({ ...draft, from })} />
      <Endpoint label="終点" which="to" node={draft.to} picking={picking === "to"} onPicking={onPicking} onSet={(to) => onDraft({ ...draft, to })} />

      <fieldset className="path__modes">
        <legend>探し方</legend>
        {(Object.keys(PATH_MODE_LABEL) as PathMode[]).map((m) => (
          <label key={m} className="check" title={MODE_HELP[m]}>
            <input type="radio" name="path-mode" checked={draft.mode === m} onChange={() => onDraft({ ...draft, mode: m })} />
            {PATH_MODE_LABEL[m]}
          </label>
        ))}
        <p className="filters__hint">{MODE_HELP[draft.mode]}</p>
      </fieldset>

      <div aria-live="polite">
        {ready && !result && <p className="panel__msg">探索中…</p>}
        {ready && result && !result.found && (
          <p className="panel__msg">
            この条件ではつながる道が見つかりませんでした。
            {draft.mode === "main" ? "「最短」か「主役を優先」に切り替えると見つかることがあります。" : "絞り込みを緩めると見つかることがあります。"}
          </p>
        )}
        {result?.found && (
          <>
            <p className="path__summary">
              <strong>共演で {result.costar} ステップ</strong>
              <span className="muted">
                {result.hops} ホップ・{result.ms < 1 ? "1 ミリ秒未満" : `${result.ms.toFixed(1)} ミリ秒`}・{result.visited.toLocaleString()} ノードを探索
              </span>
            </p>
            <ol className="path__chain">
              {result.nodes.map((n) => (
                <li key={n.id}>
                  <button type="button" className="go" onClick={() => onNavigate(n.id)}>
                    <KindIcon kind={n.kind} size={10} />
                    <span>
                      {n.label}
                      {n.sub && <small>{n.sub}</small>}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="detail__actions">
              <button type="button" className="chip" onClick={copy}>
                {copied ? "コピーしました" : "この経路の URL をコピー"}
              </button>
            </div>
          </>
        )}
      </div>
      {(draft.from || draft.to) && (
        <button type="button" className="link" onClick={onClear}>
          経路を閉じる
        </button>
      )}
    </div>
  );
}
