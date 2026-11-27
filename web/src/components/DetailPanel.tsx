import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useBriefs } from "../lib/hooks";
import { scrollBehavior } from "../lib/motion";
import { imageUrl, loadDetail, peekDetail, prefetchDetail, safeHref } from "../lib/shard";
import {
  FORMAT_LABEL,
  KIND_LABEL,
  ROLE_LABEL,
  type CastRef,
  type Detail,
  type ImageInfo,
  type Kind,
  type Meta,
  type WorkRef,
} from "../lib/types";
import { timelineYears, type Role } from "../lib/timeline";
import { Icon } from "./Icon";
import { KindIcon } from "./KindIcon";
import { Thumb } from "./Thumb";

const REPO = "https://github.com/nico0748/cverse";
const SOURCE_LABEL: Record<string, string> = {
  anilist: "AniList",
  bangumi: "Bangumi",
  schaledb: "SchaleDB",
  wikipedia: "Wikipedia",
  wikidata: "Wikidata",
  "wikimedia-commons": "Wikimedia Commons",
  official: "公式サイト",
  manual: "手入力",
  sample: "サンプル",
};
const ANILIST_PATH: Record<Kind, string> = { va: "staff", ch: "character", wk: "anime" };
const MEDIUM_LABEL: Record<string, string> = { anime: "アニメ", game: "ゲーム" };
const KIND_NOTE: Record<string, string> = { replacement: "交代", substitute: "代役" };
const RELATION_LABEL: Record<string, string> = {
  SEQUEL: "続編",
  PREQUEL: "前作",
  SIDE_STORY: "外伝",
  SPIN_OFF: "スピンオフ",
  PARENT: "本編",
  ADAPTATION: "翻案",
  SOURCE: "原作",
  ALTERNATIVE: "別版",
  OTHER: "関連",
};
/** 長い一覧は、まずこの件数だけ出す。 */
const PAGE = 24;

interface Props {
  meta: Meta;
  id: string;
  onNavigate: (id: string) => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  /** このノードを始点にして、つながり（最短経路）を調べる。 */
  onStartPath: () => void;
  /** 相関図に絞り込みがかかっているか（一覧には効かないので、そのことを伝える）。 */
  filtered: boolean;
  onClearFilter: () => void;
}

const workMeta = (w: WorkRef) => [w.year, w.format && (FORMAT_LABEL[w.format] ?? w.format)].filter(Boolean).join("・");

function period(p: CastRef["period"]) {
  if (!p || (p.from == null && p.to == null)) return "";
  return `${p.from ?? ""}〜${p.to ?? ""}`;
}

function castNote(c: CastRef) {
  return [c.medium && MEDIUM_LABEL[c.medium], c.kind && (KIND_NOTE[c.kind] ?? c.kind), period(c.period)].filter(Boolean).join("・");
}

function issueUrl(d: Detail) {
  const title = `[データ誤り] ${d.name} (${d.id})`;
  const body = [
    `対象: ${d.name}`,
    `ID: ${d.id}`,
    `種類: ${KIND_LABEL[d.kind]}`,
    `ページ: ${location.href}`,
    "",
    "### 誤っている内容",
    "",
    "### 正しい内容と根拠（URL など）",
    "",
  ].join("\n");
  return `${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

/** 詳細に出てくる相手の ID をすべて集める（小さな画像を引くため）。 */
function refIds(d: Detail): string[] {
  if (d.kind === "va") return (d.roles ?? []).flatMap((r) => [r.id, ...(r.works ?? []).slice(0, 1).map((w) => w.id)]);
  if (d.kind === "ch") return [...(d.voicedBy ?? []), ...(d.works ?? []), ...(d.relations ?? [])].map((r) => r.id);
  return [...(d.related ?? []).map((w) => w.id), ...(d.cast ?? []).flatMap((c) => [c.id, ...(c.vas ?? []).map((v) => v.id)])];
}

/** 見出しと件数つきの一覧。長いときは絞り込みと「もっと見る」を付ける。 */
function ListSection<T>({
  title,
  items,
  text,
  children,
  empty,
  className = "rows",
  toggle,
  showCount = true,
}: {
  title: string;
  items: T[];
  /** 絞り込みの対象にする文字列。 */
  text: (item: T) => string;
  children: (item: T, index: number) => ReactNode;
  empty?: string;
  className?: string;
  /** 見出しの横に置く切り替え（声優ページのキャラ順／年表）。 */
  toggle?: ReactNode;
  /** 件数の札を出すか。収集した分だけなので、出演やキャストの全部と取り違えやすい一覧では出さない。 */
  showCount?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const q = query.trim().toLowerCase();
  const filtered = q ? items.filter((it) => text(it).toLowerCase().includes(q)) : items;
  const shown = filtered.slice(0, limit);
  return (
    <section>
      <div className="section-head">
        <h2>
          {title}
          {showCount && items.length > 0 && (
            <span className="count" aria-label={`${items.length} 件`}>
              {items.length}
            </span>
          )}
        </h2>
        <div className="section-head__tools">
          {toggle}
          {items.length > 12 && (
          <input
            className="mini-filter"
            type="search"
            aria-label={`${title}を絞り込む`}
            placeholder="絞り込む"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
          />
          )}
        </div>
      </div>
      {items.length === 0 && <p className="empty">{empty ?? "データがありません。"}</p>}
      {items.length > 0 && filtered.length === 0 && <p className="empty">「{query.trim()}」を含むものはありません。</p>}
      <ul className={className}>{shown.map(children)}</ul>
      {filtered.length > limit && (
        <button type="button" className="more-button" onClick={() => setLimit(limit + PAGE * 2)}>
          残り{filtered.length - limit}件を表示
        </button>
      )}
    </section>
  );
}

type RoleView = "list" | "timeline";
/** 声優ページの並べ方。ほかの声優へ移っても同じ並べ方のままにする。 */
let lastRoleView: RoleView = "list";

type Go = (ref: { id: string; name: string }, kind: Kind, note?: string, opts?: { right?: boolean }) => ReactNode;
/** 年表で最初に出す年の数。 */
const YEARS_PAGE = 8;

/** 声優の出演年表。上の帯で年ごとの出演作の多さを見せ、押すとその年へ移る。 */
function Timeline({ roles, go, toggle }: { roles: Role[]; go: Go; toggle: ReactNode }) {
  const years = useMemo(() => timelineYears(roles), [roles]);
  const [limit, setLimit] = useState(YEARS_PAGE);
  const dated = years.filter((y) => y.year != null) as { year: number; rows: { role: Role; work: WorkRef }[] }[];
  if (!years.length) {
    return (
      <section>
        <div className="section-head">
          <h2>出演年表</h2>
          {toggle}
        </div>
        <p className="empty">出演の記録がありません。</p>
      </section>
    );
  }
  // 帯は最初の年から最後の年まで、出演の無い年も空けて並べる。
  const first = dated.length ? dated[dated.length - 1].year : 0;
  const last = dated.length ? dated[0].year : 0;
  const perYear = new Map(dated.map((y) => [y.year, y.rows]));
  const works = (rows: { work: WorkRef }[]) => new Set(rows.map((r) => r.work.id)).size;
  const peak = Math.max(1, ...dated.map((y) => works(y.rows)));
  const jump = (year: number) => {
    const at = years.findIndex((y) => y.year === year);
    if (at >= limit) setLimit(at + 1);
    requestAnimationFrame(() => document.getElementById(`tl-${year}`)?.scrollIntoView({ behavior: scrollBehavior(), block: "start" }));
  };
  const shown = years.slice(0, limit);
  return (
    <section className="timeline">
      <div className="section-head">
        <h2>
          出演年表
          {dated.length > 0 && <span className="timeline__span">{first === last ? `${first}年` : `${first}〜${last}年`}</span>}
        </h2>
        {toggle}
      </div>
      {dated.length > 1 && (
        <div className="timeline__bars" role="group" aria-label="年ごとの出演作">
          {Array.from({ length: last - first + 1 }, (_, i) => first + i).map((year) => {
            const rows = perYear.get(year);
            const n = rows ? works(rows) : 0;
            const main = rows?.some((r) => r.work.role === "MAIN");
            return n ? (
              <button
                key={year}
                type="button"
                className={`timeline__bar${main ? " is-main" : ""}`}
                style={{ height: `${Math.max(14, (n / peak) * 100)}%` }}
                title={`${year}年`}
                aria-label={`${year}年へ移る`}
                onClick={() => jump(year)}
              />
            ) : (
              <span key={year} className="timeline__bar timeline__bar--empty" aria-hidden="true" />
            );
          })}
        </div>
      )}
      {dated.length > 1 && (
        <p className="timeline__legend muted">
          <span className="timeline__key is-main" aria-hidden="true" />
          メインキャラのある年
        </p>
      )}
      {dated.length > 0 && (
        <p className="timeline__note muted">作品の開始年で並べています。シーズンや劇場版をまとめた作品は、最初の作品の年に入ります。</p>
      )}
      {shown.map(({ year, rows }) => (
        <div className="timeline__year" key={year ?? "unknown"} id={year != null ? `tl-${year}` : undefined}>
          <h3 className="timeline__label">{year != null ? `${year}年` : "年の記録なし"}</h3>
          <ul className="cast">
            {rows.map(({ role, work }) => (
              <li key={`${role.id}-${work.id}`}>
                {go(role, "ch", [role.kind && (KIND_NOTE[role.kind] ?? role.kind), work.role && ROLE_LABEL[work.role]].filter(Boolean).join("・"))}
                <span className="cast__dots" aria-hidden="true" />
                {go(work, "wk", work.format && (FORMAT_LABEL[work.format] ?? work.format), { right: true })}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {years.length > limit && (
        <button type="button" className="more-button" onClick={() => setLimit(limit + YEARS_PAGE * 2)}>
          さらに前の年を表示
        </button>
      )}
    </section>
  );
}

/** 画像の出典とクレジット。出典の欄に、ほかの出典と並べて出す。 */
function ImageCredit({ image }: { image: ImageInfo }) {
  const source = image.source ? (SOURCE_LABEL[image.source] ?? image.source) : "出典";
  const page = safeHref(image.pageUrl);
  return (
    <li>
      <span>
        画像:{" "}
        {page ? (
          <a href={page} target="_blank" rel="noreferrer">
            {source}
            <Icon name="external" size={12} />
          </a>
        ) : (
          source
        )}
      </span>
      <span className="muted">{[image.attribution, image.license].filter(Boolean).join(" ／ ")}</span>
    </li>
  );
}

/** 詳細パネル（F-07）。出演一覧・外部リンク・出典・取得日。一覧から中心を切り替えられる。 */
export function DetailPanel({ meta, id, onNavigate, isFavorite, onToggleFavorite, onStartPath, filtered, onClearFilter }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [shared, setShared] = useState(false);
  const [roleView, setRoleView] = useState<RoleView>(lastRoleView);
  const chooseRoleView = (view: RoleView) => {
    lastRoleView = view;
    setRoleView(view);
  };

  // 読み終えたシャードにあれば、骨組みを挟まずにこのフレームで描く。
  const peeked = peekDetail(meta, id);
  useEffect(() => {
    let stale = false;
    const ready = peekDetail(meta, id);
    if (ready !== undefined) {
      setDetail(ready);
      setState(ready ? "ready" : "missing");
      return;
    }
    setState("loading");
    loadDetail(meta, id).then(
      (d) => {
        if (stale) return;
        setDetail(d);
        setState(d ? "ready" : "missing");
      },
      () => !stale && setState("error"),
    );
    return () => {
      stale = true;
    };
  }, [meta, id, attempt]);

  const current = detail && detail.id === id ? detail : peeked;
  const ids = useMemo(() => (current ? refIds(current) : []), [current]);
  const briefs = useBriefs(ids);
  const image = (ref: string) => briefs.get(ref)?.image;

  if (state === "error" && !current) {
    return (
      <div className="panel__msg" role="alert">
        <p>詳細を読み込めませんでした。通信状況を確認してください。</p>
        <button type="button" className="button" onClick={() => setAttempt((n) => n + 1)}>
          もう一度読み込む
        </button>
      </div>
    );
  }
  if (current === null) return <p className="panel__msg">このノードの詳細データがありません。</p>;
  if (!current) {
    return (
      <div className="skeleton" role="status" aria-label="読み込み中">
        <div className="skeleton__head" />
        <div className="skeleton__line" />
        <div className="skeleton__line" />
        <div className="skeleton__line" />
      </div>
    );
  }

  const d = current;
  // 名鑑の項目のように、見出しの下へ「項目名: 値」で並べる。
  const facts: [string, string][] = [];
  if (d.kind === "va") {
    if (d.agency) facts.push(["所属", d.agency]);
    if (d.debutYear) facts.push(["活動開始", `${d.debutYear}年`]);
  } else if (d.kind === "ch") {
    // アニメとゲームで同じ声優なら 1 人に数える。
    const people = [...new Map((d.voicedBy ?? []).map((v) => [v.id, v.name])).values()];
    if (people.length) facts.push(["声優", people.length === 1 ? people[0] : `${people.length}人`]);
    if (d.works?.length) facts.push(["登場", `${d.works.length}作品`]);
  } else {
    if (d.format) facts.push(["形態", FORMAT_LABEL[d.format] ?? d.format]);
    if (d.year) facts.push(["開始", `${d.year}年`]);
    if (d.series && d.series !== d.name) facts.push(["シリーズ", d.series]);
    if (d.parts && d.parts.length > 1) facts.push(["シーズン", `${d.parts.length}作をまとめて表示（${d.parts.join("、")}）`]);
  }
  if (d.aliases?.length) facts.push(["別名", d.aliases.join("、")]);
  const hasWikipedia = d.sources?.some((s) => s.source === "wikipedia");
  const hasAnilist = d.sources?.some((s) => s.source === "anilist");

  const go = (ref: { id: string; name: string }, kind: Kind, note?: string, opts: { right?: boolean } = {}) => (
    <button
      type="button"
      className={`go${opts.right ? " go--right" : ""}`}
      onPointerDown={() => prefetchDetail(meta, ref.id)}
      onFocus={() => prefetchDetail(meta, ref.id)}
      onClick={() => onNavigate(ref.id)}
    >
      <Thumb kind={kind} src={image(ref.id)} label={ref.name} size={kind === "wk" ? 30 : 32} />
      <span className="go__text">
        <span className="go__name">{ref.name}</span>
        {note && <small>{note}</small>}
      </span>
    </button>
  );

  const roleToggle = (
    <div className="segmented view-toggle" role="group" aria-label="出演の並べ方">
      <button type="button" className={`seg${roleView === "list" ? " is-on" : ""}`} aria-pressed={roleView === "list"} onClick={() => chooseRoleView("list")}>
        キャラ順
      </button>
      <button type="button" className={`seg${roleView === "timeline" ? " is-on" : ""}`} aria-pressed={roleView === "timeline"} onClick={() => chooseRoleView("timeline")}>
        年表
      </button>
    </div>
  );

  const share = async () => {
    const data = { title: `${d.name} — CVerse`, url: location.href };
    try {
      // スマホでは共有シート、それ以外は URL をコピーする。
      if (navigator.share && matchMedia("(pointer: coarse)").matches) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(data.url);
        setShared(true);
        setTimeout(() => setShared(false), 1800);
      }
    } catch {
      setShared(false);
    }
  };

  return (
    <article className="detail" key={d.id}>
      <header className={`detail__head detail__head--${d.kind}`}>
        <Thumb kind={d.kind} src={d.image && imageUrl(d.image.url)} label={d.name} size={102} portrait eager />
        <div className="detail__title">
          <p className="detail__kind">
            <KindIcon kind={d.kind} />
            {KIND_LABEL[d.kind]}
          </p>
          <h1>{d.name}</h1>
          {d.reading && <p className="detail__reading">{d.reading}</p>}
          {d.nameEn && <p className="detail__en" lang="en">{d.nameEn}</p>}
          {facts.length > 0 && (
            <dl className="detail__facts">
              {facts.map(([term, value]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </header>

      <div className="detail__actions">
        <button type="button" className="button button--tinted" onClick={onStartPath}>
          <Icon name="route" />
          つながりを調べる
        </button>
        <button type="button" className={`button${isFavorite ? " is-on" : ""}`} aria-pressed={isFavorite} onClick={onToggleFavorite}>
          <Icon name="star" filled={isFavorite} />
          お気に入り
        </button>
        <button type="button" className="button" onClick={share}>
          <Icon name={shared ? "check" : "share"} />
          <span aria-live="polite">{shared ? "URL をコピーしました" : "共有"}</span>
        </button>
      </div>
      {filtered && (
        <p className="filter-note">
          相関図は絞り込み中です。下の一覧には、すべて載せています。
          <button type="button" className="link" onClick={onClearFilter}>
            絞り込みを外す
          </button>
        </p>
      )}

      {d.kind === "va" && (
        <>
          {roleView === "timeline" ? (
            <Timeline key={d.id} roles={d.roles ?? []} go={go} toggle={roleToggle} />
          ) : (
            <ListSection
              title="演じたキャラ"
              toggle={roleToggle}
              showCount={false}
              items={d.roles ?? []}
              text={(r) => `${r.name} ${(r.works ?? []).map((w) => w.name).join(" ")}`}
              className="cast"
              empty="出演の記録がありません。"
            >
              {(r) => {
                const work = r.works?.[0];
                const rest = (r.works?.length ?? 0) - 1;
                return (
                  <li key={r.id}>
                    {go(r, "ch", [r.kind && (KIND_NOTE[r.kind] ?? r.kind), work?.role && ROLE_LABEL[work.role]].filter(Boolean).join("・"))}
                    <span className="cast__dots" aria-hidden="true" />
                    {work && go(work, "wk", [workMeta(work), rest > 0 && `ほか${rest}作品`].filter(Boolean).join("・"), { right: true })}
                  </li>
                );
              }}
            </ListSection>
          )}
        </>
      )}

      {d.kind === "ch" && (
        <>
          <ListSection title="担当声優" items={d.voicedBy ?? []} text={(c) => c.name} empty="声優の記録がありません。">
            {(c, i) => <li key={`${c.id}-${i}`}>{go(c, "va", castNote(c))}</li>}
          </ListSection>
          <ListSection title="登場作品" items={d.works ?? []} text={(w) => w.name}>
            {(w) => <li key={w.id}>{go(w, "wk", [workMeta(w), w.role && ROLE_LABEL[w.role]].filter(Boolean).join("・"))}</li>}
          </ListSection>
          {d.relations && d.relations.length > 0 && (
            <ListSection title="関係のあるキャラ" items={d.relations} text={(r) => r.name}>
              {(r) => <li key={r.id}>{go(r, "ch", r.label)}</li>}
            </ListSection>
          )}
        </>
      )}

      {d.kind === "wk" && (
        <>
          <ListSection
            title="キャスト"
            showCount={false}
            items={d.cast ?? []}
            text={(c) => `${c.name} ${(c.vas ?? []).map((v) => v.name).join(" ")}`}
            className="cast"
            empty="キャストの記録がありません。"
          >
            {(c) => (
              <li key={c.id}>
                {go(c, "ch", ROLE_LABEL[c.role])}
                <span className="cast__dots" aria-hidden="true" />
                <span className="cast__side">
                  {c.vas?.map((v, i) => (
                    <span key={`${v.id}-${i}`}>
                      {go(v, "va", [v.kind && (KIND_NOTE[v.kind] ?? v.kind), period(v.period)].filter(Boolean).join("・"), { right: true })}
                    </span>
                  ))}
                </span>
              </li>
            )}
          </ListSection>
          {d.related && d.related.length > 0 && (
            <ListSection title="シリーズ" items={d.related} text={(w) => w.name}>
              {(w) => (
                <li key={w.id}>
                  {go(w, "wk", [w.relation && (RELATION_LABEL[w.relation] ?? w.relation), workMeta(w)].filter(Boolean).join("・"))}
                </li>
              )}
            </ListSection>
          )}
        </>
      )}

      <section className="detail__sources">
        <h2>出典と外部リンク</h2>
        <ul>
          {d.sources?.map((s) => (
            <li key={s.url}>
              {safeHref(s.url) ? (
                <a href={safeHref(s.url)} target="_blank" rel="noreferrer">
                  {SOURCE_LABEL[s.source] ?? s.source}
                  <Icon name="external" size={12} />
                </a>
              ) : (
                <span>{SOURCE_LABEL[s.source] ?? s.source}</span>
              )}
              <span className="muted">{s.fetchedAt} 取得</span>
            </li>
          ))}
          {!d.sources?.length && <li className="muted">出典の記録がありません</li>}
          {d.image && <ImageCredit image={d.image} />}
          {d.wikipediaTitle && !hasWikipedia && (
            <li>
              <a href={`https://ja.wikipedia.org/wiki/${encodeURIComponent(d.wikipediaTitle)}`} target="_blank" rel="noreferrer">
                Wikipedia の記事
                <Icon name="external" size={12} />
              </a>
            </li>
          )}
          {d.anilistId != null && !hasAnilist && (
            <li>
              <a href={`https://anilist.co/${ANILIST_PATH[d.kind]}/${d.anilistId}`} target="_blank" rel="noreferrer">
                AniList のページ
                <Icon name="external" size={12} />
              </a>
            </li>
          )}
        </ul>
        {hasWikipedia && (
          <p className="muted">
            Wikipedia 由来の情報は{" "}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.ja" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>{" "}
            で提供されています。
          </p>
        )}
        <a className="detail__report" href={issueUrl(d)} target="_blank" rel="noreferrer">
          誤りを報告する
          <Icon name="external" size={12} />
        </a>
      </section>
    </article>
  );
}
