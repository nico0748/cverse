import type { Meta, NodeBrief } from "../lib/types";
import { KindIcon } from "./KindIcon";
import { SearchBox } from "./SearchBox";

interface Props {
  meta: Meta | null;
  featured: NodeBrief[];
  favorites: NodeBrief[];
  onNavigate: (id: string) => void;
}

/** 入口の画面。検索か、代表的な声優から始める。 */
export function Home({ meta, featured, favorites, onNavigate }: Props) {
  return (
    <div className="home">
      <div className="home__inner">
        <h1>
          CVerse
          <small>シーバース</small>
        </h1>
        <p className="home__lead">
          声優・キャラ・作品を 1 枚のネットワークで辿る。
          <br />
          ノードを押すたびに中心が移り、声優と作品をまたいで派生し続けられます。
        </p>
        <SearchBox label="声優・キャラ・作品を検索" placeholder="声優・キャラ・作品の名前（ひらがなでも可）" onPick={(n) => onNavigate(n.id)} autoFocus hotkey />

        {favorites.length > 0 && (
          <section>
            <h2>お気に入り</h2>
            <ul className="home__chips">
              {favorites.map((n) => (
                <li key={n.id}>
                  <button type="button" className="chip" onClick={() => onNavigate(n.id)}>
                    <KindIcon kind={n.kind} size={10} />
                    {n.label}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {featured.length > 0 && (
          <section>
            <h2>声優から始める</h2>
            <ul className="home__chips">
              {featured.map((n) => (
                <li key={n.id}>
                  <button type="button" className="chip" onClick={() => onNavigate(n.id)}>
                    <KindIcon kind={n.kind} size={10} />
                    {n.label}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {meta && (
          <p className="home__meta">
            声優 {meta.counts.voiceActors.toLocaleString()} 人・キャラ {meta.counts.characters.toLocaleString()} 人・作品{" "}
            {meta.counts.works.toLocaleString()} 本
            {meta.dataDate && <>（データ取得日 {meta.dataDate}）</>}
          </p>
        )}
        <p className="home__meta">
          データ: <a href="https://anilist.co" target="_blank" rel="noreferrer">AniList</a>・
          <a href="https://ja.wikipedia.org" target="_blank" rel="noreferrer">Wikipedia 日本語版</a>（
          <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.ja" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>
          ）。非商用・広告なし。お気に入りはこの端末にだけ保存されます。
        </p>
      </div>
    </div>
  );
}
