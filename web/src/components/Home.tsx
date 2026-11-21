import type { Meta, NodeBrief } from "../lib/types";
import { Icon } from "./Icon";
import { NodeCard } from "./NodeChip";
import { SearchBox } from "./SearchBox";
import { Thumb } from "./Thumb";

interface Props {
  meta: Meta | null;
  featured: NodeBrief[];
  featuredWorks: NodeBrief[];
  favorites: NodeBrief[];
  history: NodeBrief[];
  /** 右側の相関図で中心にしているノード。 */
  hero: NodeBrief | null;
  onNavigate: (id: string) => void;
  onRandom: () => void;
  onPath: (from: NodeBrief | null, to: NodeBrief | null) => void;
  onAbout: () => void;
}

/** 入口の画面。検索・続きから・声優から・作品から・2 人のつながり、のどこからでも入れる。 */
export function Home({ meta, featured, featuredWorks, favorites, history, hero, onNavigate, onRandom, onPath, onAbout }: Props) {
  // つながりの例: 人気の声優から離れた 2 人を組にする。
  const pairs: [NodeBrief, NodeBrief][] = [];
  for (const [a, b] of [[0, 7], [2, 11], [4, 15]]) {
    if (featured[a] && featured[b]) pairs.push([featured[a], featured[b]]);
  }
  const resume = history.slice(0, 6);
  return (
    <div className="home">
      <div className="home__col">
        <section className="home__hero" aria-labelledby="home-title">
          <h1 id="home-title" className="home__title">
            この声、
            <br />
            あのキャラも。
          </h1>
          <p className="home__lead">
            声優・キャラ・作品のつながりを、1 枚の相関図でたどれます。気になる名前を入れて、押したノードから次へ次へと渡り歩いてください。
          </p>
          <SearchBox
            label="声優・キャラ・作品を検索"
            placeholder="声優・キャラ・作品の名前（ひらがなでも）"
            onPick={(n) => onNavigate(n.id)}
            suggestions={resume}
            suggestionsLabel="最近見た"
            autoFocus={matchMedia("(pointer: fine)").matches}
            hotkey
            large
          />
          <div className="home__quick">
            <button type="button" className="button" onClick={onRandom}>
              <Icon name="shuffle" />
              おまかせで声優を選ぶ
            </button>
            <button type="button" className="button" onClick={() => onPath(null, null)}>
              <Icon name="route" />
              2 人のつながりを調べる
            </button>
          </div>
        </section>

        {resume.length > 0 && (
          <section aria-labelledby="home-resume">
            <h2 id="home-resume">続きから</h2>
            <ul className="cards cards--row">
              {resume.map((n) => (
                <li key={n.id}>
                  <NodeCard node={n} onPick={onNavigate} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {favorites.length > 0 && (
          <section aria-labelledby="home-favorites">
            <h2 id="home-favorites">お気に入り</h2>
            <ul className="cards cards--row">
              {favorites.slice(0, 12).map((n) => (
                <li key={n.id}>
                  <NodeCard node={n} onPick={onNavigate} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {featured.length > 0 && (
          <section aria-labelledby="home-va">
            <h2 id="home-va">声優から始める</h2>
            <ul className="cards">
              {featured.slice(0, 12).map((n) => (
                <li key={n.id}>
                  <NodeCard node={n} onPick={onNavigate} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {featuredWorks.length > 0 && (
          <section aria-labelledby="home-wk">
            <h2 id="home-wk">作品から始める</h2>
            <ul className="cards cards--poster">
              {featuredWorks.slice(0, 8).map((n) => (
                <li key={n.id}>
                  <NodeCard node={n} onPick={onNavigate} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {pairs.length > 0 && (
          <section aria-labelledby="home-path">
            <h2 id="home-path">2 人のつながりを調べる</h2>
            <p className="home__note">共演した作品をたどって、2 人が何ステップでつながるかを探します。</p>
            <ul className="pairs">
              {pairs.map(([a, b]) => (
                <li key={`${a.id}-${b.id}`}>
                  <button type="button" className="pair" onClick={() => onPath(a, b)}>
                    <Thumb kind={a.kind} src={a.image} label={a.label} size={32} />
                    <span>{a.label}</span>
                    <span className="pair__link" aria-hidden="true" />
                    <span className="sr-only">と</span>
                    <span>{b.label}</span>
                    <Thumb kind={b.kind} src={b.image} label={b.label} size={32} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="home__foot">
          {meta && (
            <p>
              声優 {meta.counts.voiceActors.toLocaleString()} 人、キャラ {meta.counts.characters.toLocaleString()} 人、作品{" "}
              {meta.counts.works.toLocaleString()} 本を収録
              {meta.dataDate && <>（{meta.dataDate} 取得）</>}
            </p>
          )}
          <p>
            データは <a href="https://anilist.co" target="_blank" rel="noreferrer">AniList</a> と{" "}
            <a href="https://ja.wikipedia.org" target="_blank" rel="noreferrer">Wikipedia 日本語版</a>
            （<a href="https://creativecommons.org/licenses/by-sa/4.0/deed.ja" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>
            ）をもとにしています。非商用で、広告はありません。{" "}
            <button type="button" className="link" onClick={onAbout}>
              使い方とデータについて
            </button>
          </p>
        </footer>
      </div>

      {hero && (
        <p className="home__caption">
          <span>
            <strong>{hero.label}</strong> の相関図
          </span>
          <button type="button" className="button button--primary" onClick={() => onNavigate(hero.id)}>
            この図を開く
          </button>
        </p>
      )}
    </div>
  );
}
