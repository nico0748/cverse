import { useState } from "react";
import { usePopover } from "../lib/hooks";
import type { ThemeName } from "../lib/theme";
import type { NodeBrief } from "../lib/types";
import { Icon } from "./Icon";
import { NodeRow } from "./NodeChip";

interface Props {
  favorites: NodeBrief[];
  history: NodeBrief[];
  /** 履歴の ID（消したあと元に戻すために控える）。 */
  historyIds: string[];
  onPick: (id: string) => void;
  onRemoveFavorite: (id: string) => void;
  onClearHistory: () => void;
  onRestoreHistory: (ids: string[]) => void;
  theme: ThemeName;
  onToggleTheme: () => void;
  onAbout: () => void;
}

/** お気に入りと最近見たもの。スマホでは配色の切り替えと「このサイトについて」もここに入る。 */
export function MyList({ favorites, history, historyIds, onPick, onRemoveFavorite, onClearHistory, onRestoreHistory, theme, onToggleTheme, onAbout }: Props) {
  const [open, setOpen, ref] = usePopover<HTMLDivElement>();
  const [tab, setTab] = useState<"favorites" | "history">("favorites");
  const [cleared, setCleared] = useState<string[] | null>(null);
  const list = tab === "favorites" ? favorites : history;
  const pick = (id: string) => {
    setOpen(false);
    onPick(id);
  };
  return (
    <div className="popover-anchor" ref={ref}>
      <button
        type="button"
        className="nav-button"
        aria-expanded={open}
        aria-label="マイリスト"
        title="マイリスト（お気に入りと最近見たもの）"
        onClick={() => {
          setOpen(!open);
          setCleared(null);
        }}
      >
        <Icon name="star" />
        <span className="nav-button__label" aria-hidden="true">
          マイリスト
        </span>
      </button>
      {open && (
        <div className="popover mylist" role="group" aria-label="マイリスト">
          <div className="tabs" role="group" aria-label="表示する一覧">
            <button type="button" aria-pressed={tab === "favorites"} onClick={() => setTab("favorites")}>
              お気に入り
              <span className="count" aria-label={`${favorites.length} 件`}>
                {favorites.length}
              </span>
            </button>
            <button type="button" aria-pressed={tab === "history"} onClick={() => setTab("history")}>
              最近見た
              <span className="count" aria-label={`${history.length} 件`}>
                {history.length}
              </span>
            </button>
          </div>
          <div className="mylist__body">
            {list.length === 0 ? (
              <p className="empty">
                {tab === "favorites"
                  ? "まだありません。詳細の「お気に入り」を押すと、ここからすぐ開けます。"
                  : "まだありません。開いた声優・キャラ・作品がここに並びます。"}
              </p>
            ) : (
              <ul className="rows">
                {list.map((n) => (
                  <li key={n.id} className="mylist__row">
                    <NodeRow node={n} onPick={pick} />
                    {tab === "favorites" && (
                      <button type="button" className="icon-button" aria-label={`${n.label}をお気に入りから外す`} title="お気に入りから外す" onClick={() => onRemoveFavorite(n.id)}>
                        <Icon name="close" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {tab === "history" && history.length > 0 && (
              <button
                type="button"
                className="link"
                onClick={() => {
                  setCleared(historyIds);
                  onClearHistory();
                }}
              >
                履歴を消す
              </button>
            )}
            {tab === "history" && cleared && history.length === 0 && (
              <p className="mylist__undo" role="status">
                履歴を消しました。
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    onRestoreHistory(cleared);
                    setCleared(null);
                  }}
                >
                  元に戻す
                </button>
              </p>
            )}
          </div>
          <p className="mylist__note">この端末にだけ保存されます。</p>
          <div className="mylist__extra">
            <button type="button" className="menu-item" onClick={onToggleTheme}>
              <Icon name={theme === "dark" ? "sun" : "moon"} />
              {theme === "dark" ? "明るい配色にする" : "暗い配色にする"}
            </button>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                onAbout();
              }}
            >
              <Icon name="help" />
              使い方とデータについて
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
