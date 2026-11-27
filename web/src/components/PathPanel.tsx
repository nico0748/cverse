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
  /** 経路を探している最中か。 */
  searching: boolean;
  /** 経路の探索に失敗したか。 */
  failed: boolean;
  /** 開いた URL の始点か終点が、データに無い。 */
  missing: boolean;
  /** 絞り込みの条件がかかっているか（経路の探索にも効く）。 */
  filtered: boolean;
  onClearFilter: () => void;
  /** この画面を閉じて、相関図に戻る。 */
  onClose: () => void;
}

const MODE_HELP: Record<PathMode, string> = {
  bfs: "いちばん短い道を探します。",
  main: "メインキャラとして出ている作品だけを通ります。",
  weighted: "メインキャラどうしのつながりを優先し、それ以外は遠回りとして扱います。",
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
              {picking ? "図のアイコンを押してください" : "図から選ぶ"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** 最短経路（F-10）。2 つのノードを選ぶと、つながる道と「共演で何ステップ」を表示する。 */
export function PathPanel({
  draft,
  onDraft,
  result,
  picking,
  onPicking,
  onNavigate,
  onClear,
  suggestions,
  canPick,
  searching,
  failed,
  missing,
  filtered,
  onClearFilter,
  onClose,
}: Props) {
  const [copied, setCopied] = useState(false);
  const ready = draft.from && draft.to;
  const same = ready && draft.from!.id === draft.to!.id;
  // 「共演」は声優どうしの数え方。作品やキャラが端のときは、たどる回数で言う。
  const people = draft.from?.kind === "va" && draft.to?.kind === "va";

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
      <div className="path__head">
        <h1 className="path__title">つながりを調べる</h1>
        <button type="button" className="icon-button" aria-label="つながりを調べるのをやめて、相関図に戻る" title="閉じる" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <p className="muted">2 つ選ぶと、共演や出演をたどって、いちばん近い道を探します。声優・キャラ・作品のどれでも選べます。</p>

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
      {filtered && (
        <p className="filter-note">
          相関図の絞り込みが、ここにも効いています。
          <button type="button" className="link" onClick={onClearFilter}>
            絞り込みを外す
          </button>
        </p>
      )}

      <div aria-live="polite" className="path__result">
        {missing && (
          <p className="panel__msg" role="alert">
            この URL の始点か終点が見つかりませんでした。データの更新で変わった可能性があります。選び直してください。
          </p>
        )}
        {same && <p className="panel__msg">始点と終点が同じです。別の相手を選んでください。</p>}
        {ready && !same && searching && <p className="panel__msg">探しています…</p>}
        {ready && !same && failed && (
          <p className="panel__msg" role="alert">
            探している途中で問題が起きました。ページを読み込み直してください。
          </p>
        )}
        {ready && !same && result && !result.found && (
          <p className="panel__msg">
            この条件ではつながる道が見つかりませんでした。
            {filtered
              ? "上の「絞り込みを外す」で見つかることがあります。"
              : draft.mode === "main"
                ? "探し方を「最短」か「メインキャラを優先」に変えると見つかることがあります。"
                : "この 2 つは、いまのデータの中ではつながっていません。"}
          </p>
        )}
        {result?.found && !same && (
          <>
            <p className="path__summary">
              {result.hops <= 1 ? (
                <strong>直接つながっています</strong>
              ) : people && result.costar > 0 ? (
                <strong>
                  共演<span className="path__steps">{result.costar}</span>回でつながります
                </strong>
              ) : (
                <strong>
                  <span className="path__steps">{result.hops}</span>回たどるとつながります
                </strong>
              )}
              <span className="muted">
                {people && result.costar > 0
                  ? `同じ作品に出た人を${result.costar}回たどった道です。`
                  : "下の順にたどれます。"}
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
