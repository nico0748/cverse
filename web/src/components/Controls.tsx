import { useState } from "react";
import { KIND_STYLE } from "../lib/theme";
import { DEFAULT_FILTER, FORMAT_GROUPS, KINDS, KIND_LABEL, isDefaultFilter, type Filter } from "../lib/types";
import { KindIcon } from "./KindIcon";

interface Props {
  depth: number;
  onDepth: (depth: number) => void;
  filter: Filter;
  onFilter: (filter: Filter) => void;
}

const DECADES = [1970, 1980, 1990, 2000, 2010, 2020];

/** 表示段数スライダー（F-06）と絞り込み（F-09）。 */
export function Controls({ depth, onDepth, filter, onFilter }: Props) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<Filter>) => onFilter({ ...filter, ...patch });
  const active = !isDefaultFilter(filter);
  const decade = filter.yearMin != null && filter.yearMax === filter.yearMin + 9 ? filter.yearMin : null;

  return (
    <div className="controls">
      <label className="controls__depth">
        <span>表示段数</span>
        <input
          type="range"
          min={1}
          max={3}
          step={1}
          value={depth}
          aria-valuetext={`${depth} 段`}
          onChange={(e) => onDepth(Number(e.target.value))}
        />
        <output>{depth}</output>
      </label>
      <button
        type="button"
        className={`chip${active ? " is-on" : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        絞り込み{active ? " ●" : ""}
      </button>
      {open && (
        <div className="filters" role="group" aria-label="絞り込み">
          <fieldset>
            <legend>媒体</legend>
            {/* 両方オフにはできない（何も表示されなくなるため）。 */}
            <label className="check">
              <input
                type="checkbox"
                checked={filter.anime}
                onChange={(e) => set({ anime: e.target.checked, game: e.target.checked ? filter.game : true })}
              />
              アニメ
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={filter.game}
                onChange={(e) => set({ game: e.target.checked, anime: e.target.checked ? filter.anime : true })}
              />
              ゲーム
            </label>
          </fieldset>
          <fieldset>
            <legend>形態</legend>
            {FORMAT_GROUPS.map((g) => (
              <label className="check" key={g.key}>
                <input
                  type="checkbox"
                  checked={filter.formats.includes(g.key)}
                  onChange={(e) =>
                    set({
                      formats: e.target.checked
                        ? [...filter.formats, g.key]
                        : filter.formats.filter((f) => f !== g.key),
                    })
                  }
                />
                {g.label}
              </label>
            ))}
            <p className="filters__hint">未選択はすべて</p>
          </fieldset>
          <fieldset>
            <legend>年代</legend>
            <select
              aria-label="年代"
              value={decade ?? ""}
              onChange={(e) => {
                const y = Number(e.target.value);
                set(e.target.value ? { yearMin: y, yearMax: y + 9 } : { yearMin: null, yearMax: null });
              }}
            >
              <option value="">すべて</option>
              {DECADES.map((d) => (
                <option key={d} value={d}>
                  {d} 年代
                </option>
              ))}
            </select>
          </fieldset>
          <fieldset>
            <legend>役</legend>
            <label className="check">
              <input type="checkbox" checked={filter.mainOnly} onChange={(e) => set({ mainOnly: e.target.checked })} />
              主役のみ
            </label>
          </fieldset>
          <button type="button" className="link" disabled={!active} onClick={() => onFilter(DEFAULT_FILTER)}>
            条件をリセット
          </button>
        </div>
      )}
    </div>
  );
}

/** 凡例（F-04）。色と形の両方を示す。 */
export function Legend() {
  return (
    <ul className="legend" aria-label="凡例">
      {KINDS.map((k) => (
        <li key={k}>
          <KindIcon kind={k} size={13} />
          {KIND_LABEL[k]}
          <span className="legend__shape">{KIND_STYLE[k].shapeLabel}</span>
        </li>
      ))}
    </ul>
  );
}
