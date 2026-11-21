import { usePopover } from "../lib/hooks";
import { KIND_SHAPE } from "../lib/theme";
import { DEFAULT_FILTER, FORMAT_GROUPS, KINDS, KIND_LABEL, isDefaultFilter, type Filter } from "../lib/types";
import { Icon } from "./Icon";
import { KindIcon } from "./KindIcon";

interface Props {
  depth: number;
  onDepth: (depth: number) => void;
  filter: Filter;
  onFilter: (filter: Filter) => void;
}

const DECADES = [1970, 1980, 1990, 2000, 2010, 2020];
const DEPTH_HELP = ["", "直接つながるものだけ", "その先のつながりまで", "さらにもう1段先まで"];

/** かかっている条件の数。 */
function activeCount(f: Filter): number {
  return Number(f.anime !== f.game) + f.formats.length + Number(f.yearMin != null || f.yearMax != null) + Number(f.mainOnly);
}

/** 表示段数（F-06）と絞り込み（F-09）。 */
export function Controls({ depth, onDepth, filter, onFilter }: Props) {
  const [open, setOpen, ref] = usePopover<HTMLDivElement>();
  const set = (patch: Partial<Filter>) => onFilter({ ...filter, ...patch });
  const active = activeCount(filter);
  const decade = filter.yearMin != null && filter.yearMax === filter.yearMin + 9 ? filter.yearMin : null;
  const anyYear = filter.yearMin == null && filter.yearMax == null;

  return (
    <div className="controls">
      <div className="depth" role="group" aria-label="表示する段数">
        <span className="depth__label" aria-hidden="true">
          段数
        </span>
        {[1, 2, 3].map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={depth === d}
            aria-label={`${d}段（${DEPTH_HELP[d]}）`}
            title={DEPTH_HELP[d]}
            className={`seg${depth === d ? " is-on" : ""}`}
            onClick={() => onDepth(d)}
          >
            {d}
          </button>
        ))}
      </div>
      <div className="popover-anchor" ref={ref}>
        <button type="button" className={`tool-button${active ? " is-on" : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name="filter" />
          絞り込み
          {active > 0 && (
            <span className="badge">
              {active}
              <span className="sr-only"> 件の条件</span>
            </span>
          )}
        </button>
        {open && (
          <div className="popover filters" role="group" aria-label="絞り込み">
            <fieldset>
              <legend>媒体</legend>
              {/* 両方オフにはできない（何も表示されなくなるため）。 */}
              <div className="chips">
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
              </div>
            </fieldset>
            <fieldset>
              <legend>
                アニメの形態 <small>選ばなければすべて</small>
              </legend>
              <div className="chips">
                {/* ゲームは上の「媒体」で選ぶので、ここには出さない。 */}
                {FORMAT_GROUPS.filter((g) => g.key !== "game").map((g) => (
                  <label className="check" key={g.key}>
                    <input
                      type="checkbox"
                      checked={filter.formats.includes(g.key)}
                      onChange={(e) =>
                        set({
                          formats: e.target.checked ? [...filter.formats, g.key] : filter.formats.filter((f) => f !== g.key),
                        })
                      }
                    />
                    {g.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>年代</legend>
              <div className="chips">
                <label className="check">
                  <input type="radio" name="filter-decade" checked={anyYear} onChange={() => set({ yearMin: null, yearMax: null })} />
                  すべて
                </label>
                {DECADES.map((d) => (
                  <label className="check" key={d}>
                    <input type="radio" name="filter-decade" checked={decade === d} onChange={() => set({ yearMin: d, yearMax: d + 9 })} />
                    {d}年代
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>役</legend>
              <div className="chips">
                <label className="check">
                  <input type="checkbox" checked={filter.mainOnly} onChange={(e) => set({ mainOnly: e.target.checked })} />
                  主役だけ
                </label>
              </div>
            </fieldset>
            <div className="filters__foot">
              <button type="button" className="link" disabled={isDefaultFilter(filter)} onClick={() => onFilter(DEFAULT_FILTER)}>
                条件をすべて外す
              </button>
              <button type="button" className="button button--quiet" onClick={() => setOpen(false)}>
                閉じる
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 凡例（F-04）。種類は色と形の両方で、線は色で示す。 */
export function Legend() {
  return (
    <ul className="legend" aria-label="凡例">
      {KINDS.map((k) => (
        <li key={k}>
          <KindIcon kind={k} size={12} />
          {KIND_LABEL[k]}
          <span className="sr-only">（{KIND_SHAPE[k].shapeLabel}）</span>
        </li>
      ))}
      <li className="legend__sep" aria-hidden="true" />
      <li className="legend__line legend__line--voices">演じる</li>
      <li className="legend__line">登場する</li>
      <li className="legend__line legend__line--series">シリーズ</li>
    </ul>
  );
}
