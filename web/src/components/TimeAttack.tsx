import { useEffect, useMemo, useState } from "react";
import { DIFFICULTIES, DIFFICULTY_HOPS, DIFFICULTY_LABEL, formatTime, intentUrl, jstDate, shareText, type Difficulty, type Puzzle } from "../lib/timeattack";
import { KIND_LABEL, type NodeBrief } from "../lib/types";
import type { GameState } from "../lib/useTimeAttack";
import { Icon } from "./Icon";
import { Thumb } from "./Thumb";

/** 経過時間。自分で 0.1 秒ごとに描き直す（親を毎回描き直さないため）。 */
export function Timer({ startedAt, endedAt, className }: { startedAt: number; endedAt: number; className?: string }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (endedAt) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [endedAt]);
  return (
    <span className={className} role="timer" aria-live="off">
      {formatTime((endedAt || now) - startedAt)}
    </span>
  );
}

function EndCard({ label, node }: { label: string; node: NodeBrief }) {
  return (
    <div className={`ta-end ta-end--${node.kind}`}>
      <span className="ta-end__label">{label}</span>
      <Thumb kind={node.kind} src={node.image} label={node.label} size={72} eager />
      <span className="ta-end__name">{node.label}</span>
      <span className="ta-end__sub">
        {node.kind !== "more" && KIND_LABEL[node.kind]}
        {node.sub && `・${node.sub}`}
      </span>
    </div>
  );
}

function Matchup({ puzzle }: { puzzle: Puzzle }) {
  return (
    <div className="ta-matchup">
      <EndCard label="スタート" node={puzzle.from} />
      <span className="ta-matchup__arrow" aria-hidden="true">
        <Icon name="chevron" size={28} />
      </span>
      <span className="sr-only">から</span>
      <EndCard label="ゴール" node={puzzle.to} />
    </div>
  );
}

interface IntroProps {
  state: GameState;
  onGenerate: (difficulty: Difficulty, daily: boolean) => void;
  onStart: () => void;
  onLobby: () => void;
}

/** 出題を選ぶ・始める前の画面（相関図の代わりに真ん中に出す）。 */
export function TimeAttackIntro({ state, onGenerate, onStart, onLobby }: IntroProps) {
  const { phase, puzzle } = state;
  return (
    <div className="ta-intro" id="home" tabIndex={-1}>
      <div className="ta-intro__card">
        <p className="ta-kicker">
          <Icon name="timer" /> つながりタイムアタック
        </p>
        {phase === "lobby" && (
          <>
            <h1 className="ta-title">スタートから、ゴールまで。</h1>
            <p className="ta-lead">
              出題された声優（またはキャラ）から、相関図のアイコンを押して隣へ隣へと渡り、ゴールの声優（またはキャラ）に着くまでのタイムを競います。検索は使えません。
            </p>
            <button type="button" className="button button--primary ta-daily" onClick={() => onGenerate("normal", true)}>
              今日の1問に挑戦（{Number(jstDate().slice(5, 7))}/{Number(jstDate().slice(8))}・ふつう）
            </button>
            <p className="ta-label">ランダムの問題</p>
            <div className="ta-levels">
              {DIFFICULTIES.map((d) => (
                <button key={d} type="button" className="button" onClick={() => onGenerate(d, false)}>
                  <strong>{DIFFICULTY_LABEL[d]}</strong>
                  <small>最短{DIFFICULTY_HOPS[d][0]}〜{DIFFICULTY_HOPS[d][1]}手</small>
                </button>
              ))}
            </div>
          </>
        )}
        {phase === "loading" && <p className="ta-lead" role="status">問題を作っています…</p>}
        {phase === "error" && (
          <>
            <p className="ta-lead" role="alert">
              {state.error}
            </p>
            <button type="button" className="button" onClick={onLobby}>
              問題を選び直す
            </button>
          </>
        )}
        {phase === "ready" && puzzle && (
          <>
            <h1 className="ta-title ta-title--small">
              {puzzle.daily ? `${Number(puzzle.daily.slice(5, 7))}/${Number(puzzle.daily.slice(8))}の1問` : puzzle.difficulty ? `${DIFFICULTY_LABEL[puzzle.difficulty]}の問題` : "この問題"}
            </h1>
            <Matchup puzzle={puzzle} />
            <ul className="ta-rules">
              <li>相関図のアイコンを押すと、そこへ進みます。「ここから進める先」の一覧からも選べます。</li>
              <li>作品をはさんで、キャラ → 作品 → キャラ、と渡っていきます。</li>
              <li>最短なら {puzzle.shortest.length - 1} 手で着きます。</li>
            </ul>
            {state.best != null && <p className="ta-best">自己ベスト {formatTime(state.best)}</p>}
            <div className="ta-actions">
              <button type="button" className="button button--primary ta-start" onClick={onStart} autoFocus>
                スタート
              </button>
              <button type="button" className="button" onClick={onLobby}>
                別の問題にする
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface PanelProps {
  state: GameState;
  briefOf: (id: string) => NodeBrief;
  onStep: (id: string) => void;
  onBack: () => void;
  onGiveUp: () => void;
  onRetry: () => void;
  onLobby: () => void;
  /** 結果の図に出している道。 */
  showing: "mine" | "shortest";
  onShowing: (which: "mine" | "shortest") => void;
  /** 共有する問題の URL。 */
  shareUrl: string;
}

const LIST_STEP = 60;

function RouteList({ nodes, goal }: { nodes: NodeBrief[]; goal?: string }) {
  return (
    <ol className="ta-route">
      {nodes.map((n, i) => (
        <li key={`${n.id}-${i}`} className={n.id === goal ? "is-goal" : undefined}>
          <Thumb kind={n.kind} src={n.image} label={n.label} size={24} />
          <span>{n.label}</span>
        </li>
      ))}
    </ol>
  );
}

/** 遊んでいる最中と、結果の画面（右のパネル／スマホでは下のシート）。 */
export function TimeAttackPanel({ state, briefOf, onStep, onBack, onGiveUp, onRetry, onLobby, showing, onShowing, shareUrl }: PanelProps) {
  const { puzzle, phase, route } = state;
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(LIST_STEP);
  const [copied, setCopied] = useState(false);
  const here = route[route.length - 1];
  useEffect(() => {
    setQuery("");
    setLimit(LIST_STEP);
  }, [here]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = state.neighbors ?? [];
    return q ? list.filter((n) => n.label.toLowerCase().includes(q) || n.sub?.toLowerCase().includes(q)) : list;
  }, [state.neighbors, query]);

  if (!puzzle) return null;
  const routeNodes = route.map(briefOf);
  const ms = state.endedAt - state.startedAt;
  const hops = route.length - 1;
  const best = puzzle.shortest.length - 1;

  if (phase === "cleared" || phase === "gaveup") {
    const cleared = phase === "cleared";
    const text = cleared ? shareText({ puzzle, ms, kinds: routeNodes.map((n) => n.kind) }) : "";
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(`${text}\n${shareUrl}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        setCopied(false);
      }
    };
    return (
      <div className="ta-panel">
        <div className={`ta-result${cleared ? "" : " ta-result--gaveup"}`} role="status">
          <p className="ta-result__head">{cleared ? "ゴール！" : "ギブアップ"}</p>
          {cleared && <p className="ta-result__time">{formatTime(ms)}</p>}
          {cleared && (
            <p className="ta-result__hops">
              {hops}手{hops <= best ? "（最短！）" : `（最短は${best}手）`}
            </p>
          )}
          {cleared && state.newBest && <p className="ta-best ta-best--new">自己ベスト更新</p>}
          {cleared && !state.newBest && state.best != null && <p className="ta-best">自己ベスト {formatTime(state.best)}</p>}
          {!cleared && <p className="ta-result__hops">最短なら{best}手でつながります</p>}
        </div>
        <p className="ta-result__pair">
          {puzzle.from.label} → {puzzle.to.label}
        </p>
        {cleared && (
          <div className="ta-share">
            <a className="button button--primary" href={intentUrl(text, shareUrl)} target="_blank" rel="noreferrer">
              <XMark /> X で結果を共有
            </a>
            <button type="button" className="button" onClick={copy}>
              <Icon name={copied ? "check" : "share"} />
              {copied ? "コピーしました" : "結果をコピー"}
            </button>
          </div>
        )}
        <div className="segmented ta-toggle" role="group" aria-label="図に出す道">
          <button type="button" className={showing === "mine" ? "is-on" : undefined} aria-pressed={showing === "mine"} onClick={() => onShowing("mine")}>
            {cleared ? "あなたの道" : "たどった道"}
          </button>
          <button type="button" className={showing === "shortest" ? "is-on" : undefined} aria-pressed={showing === "shortest"} onClick={() => onShowing("shortest")}>
            最短の道
          </button>
        </div>
        <RouteList nodes={showing === "mine" ? routeNodes : puzzle.shortest} goal={puzzle.to.id} />
        <div className="ta-actions">
          <button type="button" className="button" onClick={onRetry}>
            同じ問題をもう一度
          </button>
          <button type="button" className="button" onClick={onLobby}>
            別の問題
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ta-panel">
      <div className="ta-status">
        <Timer className="ta-clock" startedAt={state.startedAt} endedAt={state.endedAt} />
        <span className="ta-status__hops">{hops}手目</span>
      </div>
      <div className="ta-goal">
        <span className="ta-goal__label">
          <Icon name="target" /> ゴール
        </span>
        <Thumb kind={puzzle.to.kind} src={puzzle.to.image} label={puzzle.to.label} size={36} />
        <span className="ta-goal__name">
          {puzzle.to.label}
          {puzzle.to.sub && <small>{puzzle.to.sub}</small>}
        </span>
      </div>
      <RouteList nodes={routeNodes} />
      <div className="ta-actions">
        <button type="button" className="button" onClick={onBack} disabled={route.length <= 1}>
          1つ戻る
        </button>
        <button type="button" className="button" onClick={onGiveUp}>
          ギブアップ
        </button>
      </div>
      <h2 className="ta-label" id="ta-next">
        ここから進める先{state.neighbors && `（${state.neighbors.length}件）`}
      </h2>
      <input
        className="ta-filter"
        type="search"
        id="ta-filter"
        placeholder="一覧を名前で絞り込む"
        aria-labelledby="ta-next"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLimit(LIST_STEP);
        }}
      />
      {!state.neighbors ? (
        <p className="panel__msg">読み込み中…</p>
      ) : (
        <ul className="ta-next" aria-labelledby="ta-next">
          {matches.slice(0, limit).map((n) => (
            <li key={n.id}>
              <button type="button" className={`node-row${n.id === puzzle.to.id ? " is-goal" : ""}`} onClick={() => onStep(n.id)}>
                <Thumb kind={n.kind} src={n.image} label={n.label} size={32} />
                <span className="node-row__text">
                  <span className="node-row__name">{n.label}</span>
                  <span className="node-row__sub">{n.kind !== "more" && KIND_LABEL[n.kind]}{n.sub && `・${n.sub}`}</span>
                </span>
              </button>
            </li>
          ))}
          {matches.length > limit && (
            <li>
              <button type="button" className="link ta-more" onClick={() => setLimit((l) => l + LIST_STEP)}>
                さらに表示（残り{matches.length - limit}件）
              </button>
            </li>
          )}
          {matches.length === 0 && <li className="muted">見つかりません</li>}
        </ul>
      )}
    </div>
  );
}

/** X のロゴ（文字色で塗る）。 */
function XMark() {
  return (
    <svg className="icon" viewBox="0 0 24 24" width={14} height={14} aria-hidden="true" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
