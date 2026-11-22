import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useBriefs } from "../lib/hooks";
import { imageUrl, loadDetail, safeHref } from "../lib/shard";
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
import { Icon } from "./Icon";
import { KindIcon } from "./KindIcon";
import { Thumb } from "./Thumb";

const REPO = "https://github.com/nico0748/cverse";
const SOURCE_LABEL: Record<string, string> = {
  anilist: "AniList",
  bangumi: "Bangumi",
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
}: {
  title: string;
  items: T[];
  /** 絞り込みの対象にする文字列。 */
  text: (item: T) => string;
  children: (item: T, index: number) => ReactNode;
  empty?: string;
  className?: string;
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
          {items.length > 0 && (
            <span className="count" aria-label={`${items.length} 件`}>
              {items.length}
            </span>
          )}
        </h2>
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

  useEffect(() => {
    let stale = false;
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

  const ids = useMemo(() => (detail && detail.id === id ? refIds(detail) : []), [detail, id]);
  const briefs = useBriefs(ids);
  const image = (ref: string) => briefs.get(ref)?.image;

  if (state === "error") {
    return (
      <div className="panel__msg" role="alert">
        <p>詳細を読み込めませんでした。通信状況を確認してください。</p>
        <button type="button" className="button" onClick={() => setAttempt((n) => n + 1)}>
          もう一度読み込む
        </button>
      </div>
    );
  }
  if (state === "missing") return <p className="panel__msg">このノードの詳細データがありません。</p>;
  if (!detail || detail.id !== id) {
    return (
      <div className="skeleton" role="status" aria-label="読み込み中">
        <div className="skeleton__head" />
        <div className="skeleton__line" />
        <div className="skeleton__line" />
        <div className="skeleton__line" />
      </div>
    );
  }

  const d = detail;
  // 名鑑の項目のように、見出しの下へ「項目名: 値」で並べる。
  const facts: [string, string][] = [];
  if (d.kind === "va") {
    if (d.agency) facts.push(["所属", d.agency]);
    if (d.debutYear) facts.push(["活動開始", `${d.debutYear}年`]);
    if (d.roles?.length) facts.push(["収録", `${d.roles.length}役`]);
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
    if (d.cast?.length) facts.push(["収録", `キャスト${d.cast.length}人`]);
  }
  if (d.aliases?.length) facts.push(["別名", d.aliases.join("、")]);
  const hasWikipedia = d.sources?.some((s) => s.source === "wikipedia");
  const hasAnilist = d.sources?.some((s) => s.source === "anilist");

  const go = (ref: { id: string; name: string }, kind: Kind, note?: string, opts: { right?: boolean } = {}) => (
    <button type="button" className={`go${opts.right ? " go--right" : ""}`} onClick={() => onNavigate(ref.id)}>
      <Thumb kind={kind} src={image(ref.id)} label={ref.name} size={kind === "wk" ? 30 : 32} />
      <span className="go__text">
        <span className="go__name">{ref.name}</span>
        {note && <small>{note}</small>}
      </span>
    </button>
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
    <article className="detail">
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
        <ListSection
          title="演じたキャラ"
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
