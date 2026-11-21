import { useEffect, useId, useRef, useState } from "react";
import { engine } from "../lib/engine";
import { KIND_LABEL, type NodeBrief } from "../lib/types";
import { KindIcon } from "./KindIcon";

interface Props {
  onPick: (node: NodeBrief) => void;
  placeholder?: string;
  /** `/` キーでフォーカスする（画面に 1 つだけ指定する）。 */
  hotkey?: boolean;
  autoFocus?: boolean;
  label: string;
}

/** 名前検索（F-08）。ひらがな・カタカナ・読み・部分一致。↑↓ で選び Enter で決定。 */
export function SearchBox({ onPick, placeholder, hotkey, autoFocus, label }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NodeBrief[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      engine.search(query, 12).then(
        (r) => {
          if (stale) return;
          setResults(r);
          setActive(0);
        },
        () => !stale && setResults([]),
      );
    }, 60);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

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

  const showList = open && query.trim() !== "";
  return (
    <div className="search">
      <input
        ref={inputRef}
        className="search__input"
        type="search"
        role="combobox"
        aria-label={label}
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return; // 日本語入力の変換確定の Enter は無視
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && results[active]) {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
      />
      {hotkey && !query && <kbd className="search__kbd">/</kbd>}
      {showList && (
        <ul className="search__list" id={listId} role="listbox">
          {results.length === 0 && <li className="search__empty">見つかりません</li>}
          {results.map((r, i) => (
            <li
              key={r.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`search__item${i === active ? " is-active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(r);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <KindIcon kind={r.kind} />
              <span className="search__name">{r.label}</span>
              {r.sub && <span className="search__sub">{r.sub}</span>}
              <span className="search__kind">{r.kind === "more" ? "" : KIND_LABEL[r.kind]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
