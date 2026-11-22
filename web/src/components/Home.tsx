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
  /** 狭い画面（スマホ）か。 */
  compact: boolean;
  onNavigate: (id: string) => void;
  onRandom: () => void;
  onPath: (from: NodeBrief | null, to: NodeBrief | null) => void;
  onTimeAttack: () => void;
  onAbout: () => void;
}

/** 入口の画面。検索・続きから・声優から・作品から・2 人のつながり、のどこからでも入れる。 */
export function Home({ meta, featured, featuredWorks, favorites, history, hero, compact, onNavigate, onRandom, onPath, onTimeAttack, onAbout }: Props) {
  // つながりの例: 人気の声優から離れた 2 人を組にする。
  const pairs: [NodeBrief, NodeBrief][] = [];
  for (const [a, b] of [[0, 7], [2, 11], [4, 15]]) {
    if (featured[a] && featured[b]) pairs.push([featured[a], featured[b]]);
  }
  const resume = history.slice(0, 6);
  return (
    <div className="home">
      <div className="home__col" id="home" tabIndex={-1}>
        <section className="home__hero" aria-labelledby="home-title">
          <h1 id="home-title" className="home__title">
            この声、
            <br />
            あのキャラも。
          </h1>
          <p className="home__lead">
            声優・キャラ・作品のつながりを、1枚の相関図でたどれます。気になる名前を入れて、押したノードから次へ次へと渡り歩いてください。
          </p>
          <SearchBox
            label="声優・キャラ・作品を検索"
            placeholder={compact ? "名前で検索" : "声優・キャラ・作品の名前（ひらがなでも）"}
            onPick={(n) => onNavigate(n.id)}
            suggestions={resume}
            suggestionsLabel="最近見た"
            autoFocus={matchMedia("(pointer: fine)").matches}
            hotkey
            large
          />
          {compact && <p className="home__note home__note--search">声優・キャラ・作品を、ひらがなの読みでも探せます。</p>}
          <div className="home__quick">
            <button type="button" className="button" onClick={onRandom}>
              <Icon name="shuffle" />
              おまかせで声優を選ぶ
            </button>
            <button type="button" className="button" onClick={() => onPath(null, null)}>
              <Icon name="route" />
              2人のつながりを調べる
            </button>
            <button type="button" className="button" onClick={onTimeAttack}>
              <Icon name="timer" />
              つながりタイムアタック
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
            <h2 id="home-path">2人のつながりを調べる</h2>
            <p className="home__note">共演した作品をたどって、2人が何ステップでつながるかを探します。</p>
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

        <section aria-labelledby="home-ta" className="home__ta">
          <h2 id="home-ta">つながりタイムアタック</h2>
          <p className="home__note">出題された声優やキャラから、相関図をたどってゴールまで。何秒で着けるかを競って、結果を X で共有できます。</p>
          <button type="button" className="button button--primary" onClick={onTimeAttack}>
            <Icon name="timer" />
            挑戦する
          </button>
        </section>

        <footer className="home__foot">
          {meta && (
            <p>
              声優{meta.counts.voiceActors.toLocaleString()}人、キャラ{meta.counts.characters.toLocaleString()}人、作品
              {meta.counts.works.toLocaleString()}本を収録
              {meta.dataDate && <>（{meta.dataDate} 取得）</>}
            </p>
          )}
          <p>
            データは <a href="https://anilist.co" target="_blank" rel="noreferrer">AniList</a>、{" "}
            <a href="https://bgm.tv" target="_blank" rel="noreferrer">Bangumi</a>（ゲームキャラの画像）、{" "}
            <a href="https://github.com/nico0748/SchaleDB" target="_blank" rel="noreferrer">SchaleDB</a>（ブルーアーカイブの生徒アイコン）と{" "}
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
            今日の相関図: <strong>{hero.label}</strong>
          </span>
          <button type="button" className="button" onClick={() => onNavigate(hero.id)}>
            この図を開く
          </button>
        </p>
      )}
    </div>
  );
}
