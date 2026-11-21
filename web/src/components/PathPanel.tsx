import { useState } from "react";
import { KIND_LABEL, PATH_MODE_LABEL, type NodeBrief, type PathData, type PathMode } from "../lib/types";
import { Icon } from "./Icon";
import { SearchBox } from "./SearchBox";
import { Thumb } from "./Thumb";

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
  /** 相手の候補（最近見たもの・お気に入り）。 */
  suggestions: NodeBrief[];
  /** グラフが表示されているか（「グラフから選ぶ」を出すか）。 */
  canPick: boolean;
}

const MODE_HELP: Record<PathMode, string> = {
  bfs: "いちばん短い道を探します。",
  main: "主役として出ている作品だけを通ります。",
  weighted: "脇役でのつながりを遠回りとして扱い、主役どうしの道を優先します。",
};

function Endpoint({
  label,
  which,
  node,
  picking,
  onSet,
  onPicking,
  suggestions,
  canPick,
}: {
  label: string;
  which: "from" | "to";
  node: NodeBrief | null;
  picking: boolean;
  onSet: (node: NodeBrief | null) => void;
  onPicking: (which: "from" | "to" | null) => void;
  suggestions: NodeBrief[];
  canPick: boolean;
}) {
  return (
    <div className="endpoint">
      <span className="endpoint__label">{label}</span>
      {node ? (
        <span className="endpoint__value">
          <Thumb kind={node.kind} src={node.image} label={node.label} size={32} />
          <span className="endpoint__name">
            {node.label}
            {node.kind !== "more" && <small>{KIND_LABEL[node.kind]}</small>}
          </span>
          <button type="button" className="icon-button" aria-label={`${label}の ${node.label} を外す`} onClick={() => onSet(null)}>
            <Icon name="close" />
          </button>
        </span>
      ) : (
        <div className="endpoint__pick">
          <SearchBox label={`${label}を検索`} placeholder="名前で探す" onPick={onSet} suggestions={suggestions} suggestionsLabel="最近見た・お気に入り" />
          {canPick && (
            <button type="button" className={`button${picking ? " is-on" : ""}`} aria-pressed={picking} onClick={() => onPicking(picking ? null : which)}>
              <Icon name="target" />
              {picking ? "図のノードを押してください" : "図から選ぶ"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** 最短経路（F-10）。2 つのノードを選ぶと、つながる道と「共演で何ステップ」を表示する。 */
export function PathPanel({ draft, onDraft, result, picking, onPicking, onNavigate, onClear, suggestions, canPick }: Props) {
  const [copied, setCopied] = useState(false);
  const ready = draft.from && draft.to;
  const same = ready && draft.from!.id === draft.to!.id;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="path">
      <h2 className="path__title">つながりを調べる</h2>
      <p className="muted">2 つ選ぶと、共演や出演をたどっていちばん近い道を探します。声優・キャラ・作品のどれでも選べます。</p>

      <div className="path__ends">
        <Endpoint
          label="始点"
          which="from"
          node={draft.from}
          picking={picking === "from"}
          onPicking={onPicking}
          onSet={(from) => onDraft({ ...draft, from })}
          suggestions={suggestions.filter((s) => s.id !== draft.to?.id)}
          canPick={canPick}
        />
        <button
          type="button"
          className="icon-button path__swap"
          aria-label="始点と終点を入れ替える"
          title="入れ替える"
          disabled={!draft.from && !draft.to}
          onClick={() => onDraft({ ...draft, from: draft.to, to: draft.from })}
        >
          <Icon name="swap" />
        </button>
        <Endpoint
          label="終点"
          which="to"
          node={draft.to}
          picking={picking === "to"}
          onPicking={onPicking}
          onSet={(to) => onDraft({ ...draft, to })}
          suggestions={suggestions.filter((s) => s.id !== draft.from?.id)}
          canPick={canPick}
        />
      </div>

      <fieldset className="path__modes">
        <legend>探し方</legend>
        <div className="segmented">
          {(Object.keys(PATH_MODE_LABEL) as PathMode[]).map((m) => (
            <label key={m} className={`seg${draft.mode === m ? " is-on" : ""}`}>
              <input type="radio" name="path-mode" className="sr-only" checked={draft.mode === m} onChange={() => onDraft({ ...draft, mode: m })} />
              {PATH_MODE_LABEL[m]}
            </label>
          ))}
        </div>
        <p className="hint">{MODE_HELP[draft.mode]}</p>
      </fieldset>

      <div aria-live="polite" className="path__result">
        {same && <p className="panel__msg">始点と終点が同じです。別の相手を選んでください。</p>}
        {ready && !same && !result && <p className="panel__msg">探しています…</p>}
        {ready && !same && result && !result.found && (
          <p className="panel__msg">
            この条件ではつながる道が見つかりませんでした。
            {draft.mode === "main" ? "探し方を「最短」か「主役を優先」に変えると見つかることがあります。" : "絞り込みを外すと見つかることがあります。"}
          </p>
        )}
        {result?.found && !same && (
          <>
            <p className="path__summary">
              <strong>
                {result.costar > 0 ? (
                  <>
                    共演で <span className="path__steps">{result.costar}</span> ステップ
                  </>
                ) : (
                  "直接つながっています"
                )}
              </strong>
              <span className="muted">
                ノードを {result.hops} 回たどります（{result.visited.toLocaleString()} ノードを{" "}
                {result.ms < 1 ? "1 ミリ秒未満" : `${result.ms.toFixed(1)} ミリ秒`}で探索）
              </span>
            </p>
            <ol className="chain">
              {result.nodes.map((n) => (
                <li key={n.id}>
                  <button type="button" className="go" onClick={() => onNavigate(n.id)}>
                    <Thumb kind={n.kind} src={n.image} label={n.label} size={36} />
                    <span className="go__text">
                      <span className="go__name">{n.label}</span>
                      <small>{[n.kind !== "more" && KIND_LABEL[n.kind], n.kind !== "va" && n.sub].filter(Boolean).join("・")}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="detail__actions">
              <button type="button" className="button" onClick={copy}>
                <Icon name={copied ? "check" : "share"} />
                {copied ? "URL をコピーしました" : "この経路の URL をコピー"}
              </button>
            </div>
          </>
        )}
      </div>
      {(draft.from || draft.to) && (
        <button type="button" className="link" onClick={onClear}>
          選び直す
        </button>
      )}
    </div>
  );
}
