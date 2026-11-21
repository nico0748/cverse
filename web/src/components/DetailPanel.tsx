import { useEffect, useState, type ReactNode } from "react";
import { loadDetail } from "../lib/shard";
import {
  FORMAT_LABEL,
  KIND_LABEL,
  ROLE_LABEL,
  type CastRef,
  type Detail,
  type Kind,
  type Meta,
  type WorkRef,
} from "../lib/types";
import { KindIcon } from "./KindIcon";

const REPO = "https://github.com/nico0748/cverse";
const SOURCE_LABEL: Record<string, string> = {
  anilist: "AniList",
  wikipedia: "Wikipedia",
  wikidata: "Wikidata",
  manual: "手入力",
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

interface Props {
  meta: Meta;
  id: string;
  onNavigate: (id: string) => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}

/** 一覧の項目。押すとそのノードが中心になる。 */
function Go({ id, kind, onNavigate, children }: { id: string; kind: Kind; onNavigate: (id: string) => void; children: ReactNode }) {
  return (
    <button type="button" className="go" onClick={() => onNavigate(id)}>
      <KindIcon kind={kind} size={10} />
      <span>{children}</span>
    </button>
  );
}

const workMeta = (w: WorkRef) => [w.year, w.format && (FORMAT_LABEL[w.format] ?? w.format)].filter(Boolean).join("・");

function period(p: CastRef["period"]) {
  if (!p || (p.from == null && p.to == null)) return "";
  return `${p.from ?? ""}〜${p.to ?? ""}`;
}

function castNote(c: CastRef) {
  return [c.medium && MEDIUM_LABEL[c.medium], c.kind && (KIND_NOTE[c.kind] ?? c.kind), period(c.period)]
    .filter(Boolean)
    .join("・");
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

/** 詳細パネル（F-07）。出演一覧・外部リンク・出典・取得日。一覧から中心を切り替えられる。 */
export function DetailPanel({ meta, id, onNavigate, isFavorite, onToggleFavorite }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");

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
  }, [meta, id]);

  if (state === "error") return <p className="panel__msg">詳細を読み込めませんでした。通信状況を確認して、もう一度お試しください。</p>;
  if (state === "missing") return <p className="panel__msg">このノードの詳細データがありません。</p>;
  if (!detail || detail.id !== id) return <p className="panel__msg">読み込み中…</p>;

  const d = detail;
  const facts: string[] = [];
  if (d.kind === "va") {
    if (d.agency) facts.push(d.agency);
    if (d.debutYear) facts.push(`${d.debutYear} 年〜`);
  } else if (d.kind === "wk") {
    if (d.format) facts.push(FORMAT_LABEL[d.format] ?? d.format);
    if (d.year) facts.push(`${d.year} 年`);
    if (d.series && d.series !== d.name) facts.push(`${d.series} シリーズ`);
  }
  const hasWikipedia = d.sources?.some((s) => s.source === "wikipedia");

  return (
    <article className="detail">
      <header className="detail__head">
        <p className="detail__kind">
          <KindIcon kind={d.kind} />
          {KIND_LABEL[d.kind]}
        </p>
        <h2>{d.name}</h2>
        {(d.reading || d.nameEn) && <p className="detail__reading">{[d.reading, d.nameEn].filter(Boolean).join(" / ")}</p>}
        {facts.length > 0 && <p className="detail__facts">{facts.join("・")}</p>}
        {d.aliases && d.aliases.length > 0 && <p className="detail__facts">別名: {d.aliases.join("、")}</p>}
        <div className="detail__actions">
          <button type="button" className={`chip${isFavorite ? " is-on" : ""}`} aria-pressed={isFavorite} onClick={onToggleFavorite}>
            {isFavorite ? "★ お気に入り" : "☆ お気に入り"}
          </button>
          {d.wikipediaTitle && (
            <a className="chip" href={`https://ja.wikipedia.org/wiki/${encodeURIComponent(d.wikipediaTitle)}`} target="_blank" rel="noreferrer">
              Wikipedia ↗
            </a>
          )}
          {d.anilistId != null && (
            <a className="chip" href={`https://anilist.co/${ANILIST_PATH[d.kind]}/${d.anilistId}`} target="_blank" rel="noreferrer">
              AniList ↗
            </a>
          )}
        </div>
      </header>

      {d.kind === "va" && (
        <section>
          <h3>出演 <span className="count">{d.roles?.length ?? 0}</span></h3>
          <ul className="rows">
            {d.roles?.map((r) => (
              <li key={r.id}>
                <Go id={r.id} kind="ch" onNavigate={onNavigate}>{r.name}</Go>
                <div className="rows__sub">
                  {r.works?.slice(0, 3).map((w) => (
                    <Go key={w.id} id={w.id} kind="wk" onNavigate={onNavigate}>
                      {w.name}
                      <small>{[workMeta(w), w.role && ROLE_LABEL[w.role]].filter(Boolean).join("・")}</small>
                    </Go>
                  ))}
                  {(r.works?.length ?? 0) > 3 && <small className="muted">ほか {r.works!.length - 3} 作品</small>}
                  {r.kind && <small className="muted">{KIND_NOTE[r.kind] ?? r.kind}</small>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.kind === "ch" && (
        <>
          <section>
            <h3>担当声優</h3>
            <ul className="rows">
              {d.voicedBy?.map((c, i) => (
                <li key={`${c.id}-${i}`}>
                  <Go id={c.id} kind="va" onNavigate={onNavigate}>
                    {c.name}
                    <small>{castNote(c)}</small>
                  </Go>
                </li>
              ))}
              {!d.voicedBy?.length && <li className="muted">データなし</li>}
            </ul>
          </section>
          <section>
            <h3>登場作品 <span className="count">{d.works?.length ?? 0}</span></h3>
            <ul className="rows">
              {d.works?.map((w) => (
                <li key={w.id}>
                  <Go id={w.id} kind="wk" onNavigate={onNavigate}>
                    {w.name}
                    <small>{[workMeta(w), w.role && ROLE_LABEL[w.role]].filter(Boolean).join("・")}</small>
                  </Go>
                </li>
              ))}
            </ul>
          </section>
          {d.relations && d.relations.length > 0 && (
            <section>
              <h3>関係</h3>
              <ul className="rows">
                {d.relations.map((r) => (
                  <li key={r.id}>
                    <Go id={r.id} kind="ch" onNavigate={onNavigate}>
                      {r.name}
                      <small>{r.label}</small>
                    </Go>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {d.kind === "wk" && (
        <>
          {d.related && d.related.length > 0 && (
            <section>
              <h3>シリーズ</h3>
              <ul className="rows">
                {d.related.map((w) => (
                  <li key={w.id}>
                    <Go id={w.id} kind="wk" onNavigate={onNavigate}>
                      {w.name}
                      <small>{[w.relation && (RELATION_LABEL[w.relation] ?? w.relation), workMeta(w)].filter(Boolean).join("・")}</small>
                    </Go>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h3>キャスト <span className="count">{d.cast?.length ?? 0}</span></h3>
            <ul className="rows">
              {d.cast?.map((c) => (
                <li key={c.id}>
                  <Go id={c.id} kind="ch" onNavigate={onNavigate}>
                    {c.name}
                    <small>{ROLE_LABEL[c.role]}</small>
                  </Go>
                  <div className="rows__sub">
                    {c.vas?.map((v, i) => (
                      <Go key={`${v.id}-${i}`} id={v.id} kind="va" onNavigate={onNavigate}>
                        {v.name}
                        <small>{[v.kind && (KIND_NOTE[v.kind] ?? v.kind), period(v.period)].filter(Boolean).join("・")}</small>
                      </Go>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <section className="detail__sources">
        <h3>出典</h3>
        <ul>
          {d.sources?.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {SOURCE_LABEL[s.source] ?? s.source} ↗
              </a>
              <span className="muted">取得日 {s.fetchedAt}</span>
            </li>
          ))}
          {!d.sources?.length && <li className="muted">出典の記録がありません</li>}
        </ul>
        {hasWikipedia && (
          <p className="muted">
            Wikipedia 由来の情報は{" "}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.ja" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>{" "}
            で提供されています。
          </p>
        )}
        <a className="link" href={issueUrl(d)} target="_blank" rel="noreferrer">
          誤りを報告する（GitHub）↗
        </a>
      </section>
    </article>
  );
}
