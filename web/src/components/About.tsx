import { useEffect, useRef } from "react";
import { KIND_SHAPE } from "../lib/theme";
import { KINDS, KIND_LABEL, type Meta } from "../lib/types";
import { Icon } from "./Icon";
import { KindIcon } from "./KindIcon";

const REPO = "https://github.com/nico0748/cverse";

/** 使い方・データの出どころ・画像の扱いをまとめた案内。 */
export function About({ open, onClose, meta }: { open: boolean; onClose: () => void; meta: Meta | null }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="about"
      aria-labelledby="about-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div className="about__inner">
        <header className="about__head">
          <h2 id="about-title">使い方とデータについて</h2>
          <button type="button" className="icon-button" aria-label="閉じる" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>

        <section>
          <h3>図の見方</h3>
          <ul className="about__kinds">
            {KINDS.map((k) => (
              <li key={k}>
                <KindIcon kind={k} size={16} />
                <strong>{KIND_LABEL[k]}</strong>
                <span>{KIND_SHAPE[k].shapeLabel}</span>
              </li>
            ))}
          </ul>
          <p>
            種類は色と形の両方で区別しています。橙の線は「声優がキャラを演じている」、墨色の線は「キャラが作品に登場している」
            というつながりで、メインキャラは太い線、それ以外は細い線です。キャラを中心にすると、担当声優が上、登場作品が下に並びます。
          </p>
        </section>

        <section>
          <h3>操作</h3>
          <dl className="about__keys">
            <dt>ノードを押す</dt>
            <dd>そのノードを中心にして、つながりを開き直します</dd>
            <dt>ノードに重ねる・長押し</dt>
            <dd>担当声優などの補足を表示します</dd>
            <dt>ドラッグ・ホイール・ピンチ</dt>
            <dd>図を動かす、拡大・縮小する</dd>
            <dt className="keys-only">
              <kbd>/</kbd>
            </dt>
            <dd className="keys-only">検索欄へ移動します</dd>
            <dt>ブラウザの「戻る」</dt>
            <dd>ひとつ前の中心に戻ります</dd>
          </dl>
        </section>

        <section>
          <h3>データ</h3>
          <p>
            <a href="https://anilist.co" target="_blank" rel="noreferrer">AniList</a>、{" "}
            <a href="https://bgm.tv" target="_blank" rel="noreferrer">Bangumi</a>（ゲームキャラの画像）、{" "}
            <a href="https://github.com/nico0748/SchaleDB" target="_blank" rel="noreferrer">SchaleDB</a>（ブルーアーカイブの生徒アイコン）と{" "}
            <a href="https://ja.wikipedia.org" target="_blank" rel="noreferrer">Wikipedia 日本語版</a>
            （<a href="https://creativecommons.org/licenses/by-sa/4.0/deed.ja" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>
            ）の情報をもとにしています。各ページの出典は詳細の末尾にあります。
          </p>
          {meta && (
            <p className="muted">
              声優{meta.counts.voiceActors.toLocaleString()}人、キャラ{meta.counts.characters.toLocaleString()}人、作品
              {meta.counts.works.toLocaleString()}本を収録{meta.dataDate && `（${meta.dataDate} 取得）`}。
            </p>
          )}
          <p>
            誤りを見つけたら、詳細の末尾にある「誤りを報告する」か{" "}
            <a href={`${REPO}/issues`} target="_blank" rel="noreferrer">GitHub の Issue</a> でお知らせください。
          </p>
        </section>

        <section>
          <h3>画像</h3>
          <p>
            外部の画像は、このサイトに複製を置かず、出典元のものをそのまま表示しています（利用が許諾されていて
            データに同梱した画像を除きます）。著作権は各権利者にあります。出典とクレジットは、詳細の末尾の「出典と外部リンク」に
            表示します。掲載に問題がある場合は GitHub の Issue でお知らせください。
          </p>
        </section>

        <section>
          <h3>このサイト</h3>
          <p>非商用で、広告はありません。お気に入りと履歴はこの端末のブラウザにだけ保存され、外部には送られません。</p>
        </section>
      </div>
    </dialog>
  );
}
