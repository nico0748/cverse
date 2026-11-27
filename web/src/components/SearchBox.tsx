import { useEffect, useId, useRef, useState } from "react";
import { engine } from "../lib/engine";
import { scrollBehavior } from "../lib/motion";
import { KINDS, KIND_LABEL, type Kind, type NodeBrief } from "../lib/types";
import { Icon } from "./Icon";
import { Thumb } from "./Thumb";

interface Props {
  onPick: (node: NodeBrief) => void;
  placeholder?: string;
  /** `/` キーでフォーカスする（画面に 1 つだけ指定する）。 */
  hotkey?: boolean;
  autoFocus?: boolean;
  label: string;
  /** 入力が空のときに候補として出すもの（最近見たものなど）。 */
  suggestions?: NodeBrief[];
  suggestionsLabel?: string;
  /** 大きく見せる（トップ画面）。 */
  large?: boolean;
}

const KIND_BIT: Record<Kind, number> = { va: 1, ch: 2, wk: 4 };

/** 名前検索（F-08）。ひらがな・カタカナ・読み・部分一致。↑↓ で選び Enter で決定。 */
export function SearchBox({ onPick, placeholder, hotkey, autoFocus, label, suggestions = [], suggestionsLabel, large }: Props) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind | null>(null);
  const [results, setResults] = useState<NodeBrief[]>([]);
  const [searched, setSearched] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  /** 結果が届く前に Enter が押されたら、届いたときに先頭を選ぶ。 */
  const pendingEnter = useRef(false);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const listId = useId();
  const typed = query.trim() !== "";

  useEffect(() => {
    pendingEnter.current = false;
    if (!typed) {
      setResults([]);
      setSearched("");
      setFailed(false);
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      engine.search(query, 12, kind ? KIND_BIT[kind] : 0).then(
        (r) => {
          if (stale) return;
          setResults(r);
          setSearched(query);
          setFailed(false);
          setActive(0);
          if (pendingEnter.current && r[0]) {
            pendingEnter.current = false;
            setQuery("");
            setOpen(false);
            inputRef.current?.blur();
            onPickRef.current(r[0]);
          }
        },
        () => {
          if (stale) return;
          setResults([]);
          setSearched(query);
          setFailed(true);
        },
      );
    }, 60);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query, kind, typed]);

  useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey]);

  const pick = (node: NodeBrief) => {
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
    onPick(node);
  };

  const items = typed ? results : suggestions;
  const showList = open && (typed || suggestions.length > 0);
  const waiting = typed && searched !== query;

  // ↑↓ で選んでいる候補が、一覧の見えている範囲に入るようにする。
  useEffect(() => {
    if (showList) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, showList, listId]);

  return (
    <div
      ref={boxRef}
      className={`search${large ? " search--large" : ""}`}
      // 種類のボタンへ Tab で移っても開いたままにし、検索欄の外へ出たら閉じる。
      onBlur={(e) => {
        if (!boxRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && e.target !== inputRef.current && open) {
          e.stopPropagation();
          setOpen(false);
          inputRef.current?.focus();
        }
      }}
    >
      <span className="search__icon">
        <Icon name="search" size={large ? 20 : 16} />
      </span>
      <input
        ref={inputRef}
        className="search__input"
        type="search"
        role="combobox"
        aria-label={label}
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && items[active] ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="search"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
          // スマホの入口では、候補がキーボードの裏に隠れないよう、検索欄を画面の上へ寄せる。
          if (large && !open && window.matchMedia("(max-width: 560px)").matches) {
            e.currentTarget.scrollIntoView({ block: "start", behavior: scrollBehavior() });
          }
        }}
        // フォーカスが当たっただけでは開かない（トップ画面を開くたびに候補が被さらないように）。
        // 押す・入力する・↓ で開く。
        onMouseDown={() => setOpen(true)}
        onKeyDown={(e) => {
          // 日本語入力の変換確定の Enter は無視する。Safari は確定の keydown を変換終了のあとに送るので、keyCode も見る。
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && waiting) {
            // まだ前の文字の結果が出ている。新しい結果が届いてから先頭を選ぶ。
            e.preventDefault();
            pendingEnter.current = true;
          } else if (e.key === "Enter" && showList && items[active]) {
            e.preventDefault();
            pick(items[active]);
          } else if (e.key === "Escape") {
            // 1 回目で候補を閉じ、2 回目で入力を消し、3 回目で検索欄から出る。
            e.preventDefault();
            if (showList) setOpen(false);
            else if (query) setQuery("");
            else inputRef.current?.blur();
          }
        }}
      />
      {hotkey && !query && <kbd className="search__kbd">/</kbd>}
      {showList && (
        // 一覧の中を押しても入力欄のフォーカスを保つ（blur で閉じてしまわないように）。
        <div className="search__pop" onMouseDown={(e) => e.preventDefault()}>
          {typed ? (
            <div className="search__kinds" role="group" aria-label="種類で絞る">
              {[null, ...KINDS].map((k) => (
                <button
                  key={k ?? "all"}
                  type="button"
                  className={`seg${kind === k ? " is-on" : ""}`}
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                >
                  {k ? KIND_LABEL[k] : "すべて"}
                </button>
              ))}
            </div>
          ) : (
            suggestionsLabel && <p className="search__heading">{suggestionsLabel}</p>
          )}
          <ul className="search__list" id={listId} role="listbox" aria-label={typed ? "検索結果" : suggestionsLabel}>
            {items.map((r, i) => (
              <li
                key={r.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`search__item${i === active ? " is-active" : ""}`}
                onClick={() => pick(r)}
                onMouseEnter={() => setActive(i)}
              >
                <Thumb kind={r.kind} src={r.image} label={r.label} size={32} />
                <span className="search__text">
                  <span className="search__name">{r.label}</span>
                  {r.sub && <span className="search__sub">{r.sub}</span>}
                </span>
                <span className="search__kind">{r.kind === "more" ? "" : KIND_LABEL[r.kind]}</span>
              </li>
            ))}
          </ul>
          {typed && !waiting && failed && (
            <p className="search__empty" role="alert">
              検索できませんでした。ページを読み込み直してください。
            </p>
          )}
          {typed && !waiting && !failed && results.length === 0 && (
            <p className="search__empty" role="status">
              「{query.trim()}」に一致する{kind ? KIND_LABEL[kind] : "名前"}はありません。
              <br />
              ひらがなの読みや、名前の一部でも探せます。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
