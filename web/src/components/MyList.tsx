import { useState } from "react";
import { usePopover } from "../lib/hooks";
import type { ThemeName } from "../lib/theme";
import type { NodeBrief } from "../lib/types";
import { Icon } from "./Icon";
import { NodeRow } from "./NodeChip";

interface Props {
  favorites: NodeBrief[];
  history: NodeBrief[];
  onPick: (id: string) => void;
  onClearHistory: () => void;
  theme: ThemeName;
  onToggleTheme: () => void;
  onAbout: () => void;
}

/** お気に入りと最近見たもの。スマホでは配色の切り替えと「このサイトについて」もここに入る。 */
export function MyList({ favorites, history, onPick, onClearHistory, theme, onToggleTheme, onAbout }: Props) {
  const [open, setOpen, ref] = usePopover<HTMLDivElement>();
  const [tab, setTab] = useState<"favorites" | "history">("favorites");
  const list = tab === "favorites" ? favorites : history;
  const pick = (id: string) => {
    setOpen(false);
    onPick(id);
  };
  return (
    <div className="popover-anchor" ref={ref}>
      <button type="button" className="nav-button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        <Icon name="star" />
        <span className="nav-button__label">マイリスト</span>
      </button>
      {open && (
        <div className="popover mylist" role="dialog" aria-label="マイリスト">
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "favorites"} onClick={() => setTab("favorites")}>
              お気に入り<span className="count">{favorites.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>
              最近見た<span className="count">{history.length}</span>
            </button>
          </div>
          <div className="mylist__body" role="tabpanel">
            {list.length === 0 ? (
              <p className="empty">
                {tab === "favorites"
                  ? "まだありません。詳細の「お気に入り」を押すと、ここからすぐ開けます。"
                  : "まだありません。開いた声優・キャラ・作品がここに並びます。"}
              </p>
            ) : (
              <ul className="rows">
                {list.map((n) => (
                  <li key={n.id}>
                    <NodeRow node={n} onPick={pick} />
                  </li>
                ))}
              </ul>
            )}
            {tab === "history" && history.length > 0 && (
              <button type="button" className="link" onClick={onClearHistory}>
                履歴を消す
              </button>
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
