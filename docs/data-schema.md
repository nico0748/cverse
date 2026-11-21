# CVerse データスキーマ（収集データ → ビルド入力）

収集・名寄せ済みの「正規化データ」を `data/source/` に JSON で置く。
`cverse-cli build` がこれを読み、配信用データ（CSRバイナリ・検索索引・詳細シャード）を生成する。
サンプルは `data/sample/` にある（同じ形式）。

## ファイル構成

```
data/source/
  voice_actors.json   # VoiceActor[]
  characters.json     # Character[]
  works.json          # Work[]
  casts.json          # Cast[]        声優–キャラ「演じる」
  appearances.json    # Appearance[]  キャラ–作品「登場する」
  series.json         # Series[]      作品–作品（任意・無ければファイルごと省略可）
  relations.json      # Relation[]    キャラ–キャラ（任意・将来用）
```

すべて UTF-8 の JSON 配列。未知のフィールドは無視される。任意項目は省略か `null`。

## ID

- 文字列で、全ファイルを通して一意。種別プレフィックスを必ず付ける: `va:` / `ch:` / `wk:`
- 推奨: AniList 由来は `va:al-95185` `ch:al-40882` `wk:al-16498`、Wikipedia 由来は `wk:wp-<記事名>` など
- 名寄せで統合した場合は AniList 側の ID を優先して残す
- ID は更新をまたいで安定させる（URL・お気に入りに使う）

## 共通: sources

```json
"sources": [{ "source": "anilist", "url": "https://anilist.co/staff/95185", "fetchedAt": "2026-11-22" }]
```

`source` は `anilist` | `wikipedia` | `wikidata` | `manual`。`url` と `fetchedAt`(YYYY-MM-DD) は必須。
ノード 3 種は `sources` 必須（1 件以上）。エッジは任意。

## 共通: image（任意）

VoiceActor / Character / Work は、画像を 1 枚持てる（Work はキービジュアルやカバー）。

```json
"image": {
  "url": "https://s4.anilist.co/file/anilistcdn/character/large/b36765-xxxx.png",
  "source": "anilist",
  "pageUrl": "https://anilist.co/character/36765",
  "license": null,
  "attribution": null
}
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| url | string | ✓ | そのまま表示できる画像の URL。`https://` のみ。データのディレクトリからの相対パス（同梱画像）も可 |
| source | string | 推奨 | `anilist` \| `wikimedia-commons` \| `wikidata` \| `official` など |
| pageUrl | string | 推奨 | 画像の掲載元ページ（AniList の該当ページ、Commons の `File:` ページなど）。`https://` のみ |
| license | string \| null | | ライセンス表記（`CC BY-SA 4.0` など）。権利者の著作物で許諾が無いものは `null` |
| attribution | string \| null | | 作者名やクレジット。不明なら `null` |
| width / height | number | | 元画像の大きさ（分かれば） |

- サイトは画像を**再配布しない**。`url` を直接参照して表示するだけで、出典とクレジットを詳細パネルに出す
- 小さめの画像で足りる（AniList なら `large` か `medium`）。グラフ上では 30〜100px 程度、詳細でも 100px 程度で使う
- 人物の画像は縦長で顔が上寄りにある前提で、上から少し下を正方形に切り抜く。作品の画像は縦長（3:4）のまま見せる
- `image` は URL の文字列だけでも受け付ける（`"image": "https://…"`）
- 表示できない URL（`http://`、`data:`、実在しない相対パスなど）は検証時に警告して、その画像だけ外す
- 同梱画像（相対パス）は、データのディレクトリの中にある普通の画像ファイルに限る。拡張子は
  `png` `jpg` `jpeg` `webp` `avif` `gif` `svg` のいずれか。`..` や `.` で始まる名前を含むパス、シンボリックリンク、
  絵を描く要素（`svg` `g` `path` `rect` `circle` `text` など）と引用符で囲んだ属性だけでできた SVG 以外は受け付けない
  （宣言・コメント・文字参照 `&`・`style`・`on…` 属性・文書の外を指す `href` があると外す。公開先でスクリプトが動かないように）
- 画像が無いノードは、頭文字のアイコンで表示する
- ビルド時に `--images all|licensed|none` で載せる範囲を選べる。`none` は画像なし。`licensed` は再利用できるものだけを残す
  - `license` がパブリックドメイン（`Public domain` `PD` `PDM`）か `CC0` のもの
  - `license` が `CC BY` / `CC BY-SA`（版の番号と国・地域の版は可。例: `CC BY-SA 3.0 France`）で、
    `attribution` か `pageUrl` があるもの（クレジットを出せるもの）
  - 非営利限定（NC）・改変禁止（ND）と、それ以外の語が混じる表記（`All rights reserved`、`CC0 except …` など）は外す
- オプションは `--images none` と `--images=none` のどちらでも書ける。知らないオプションや値の無いオプションはエラーにする
- 配信データの `images.json` は、画像が 1 枚も無くても必ず書き出す（古い画像の表が残らないように）

## VoiceActor

| フィールド | 型 | 必須 | 内容 |
|---|---|---|---|
| id | string | ✓ | `va:` で始まる |
| name | string | ✓ | 日本語表記（例: 花澤香菜） |
| reading | string | 推奨 | 読み（ひらがな。カタカナでも可、ビルド時に正規化） |
| nameEn | string | | ローマ字/英語表記 |
| aliases | string[] | | 別名・旧芸名 |
| agency | string | | 所属 |
| debutYear | number | | 活動開始年 |
| anilistId | number | | |
| wikipediaTitle | string | | 日本語版 Wikipedia の記事名 |
| wikidataId | string | | 例 `Q49582` |
| favourites | number | | AniList お気に入り数。並び順と「上位だけ描く」ときの優先度に使う |
| image | Image | | 人物の写真。上の「共通: image」を参照 |
| sources | Source[] | ✓ | |

## Character

| フィールド | 型 | 必須 | 内容 |
|---|---|---|---|
| id | string | ✓ | `ch:` で始まる |
| name | string | ✓ | 日本語表記。無ければローマ字 |
| reading | string | 推奨 | |
| nameEn | string | | |
| aliases | string[] | | |
| anilistId | number | | |
| wikipediaTitle | string | | 単独記事がある場合のみ |
| favourites | number | | AniList お気に入り数。無ければ登場作品の人気から算出する |
| image | Image | | キャラの絵 |
| sources | Source[] | ✓ | |

同じキャラを複数の声優が演じた場合もキャラは 1 件にまとめ、Cast を複数張る。

## Work

| フィールド | 型 | 必須 | 内容 |
|---|---|---|---|
| id | string | ✓ | `wk:` で始まる |
| title | string | ✓ | 日本語タイトル |
| reading | string | 推奨 | 読み。ひらがな検索に使う |
| titleEn | string | | ローマ字/英語 |
| format | string | ✓ | `TV` `TV_SHORT` `MOVIE` `OVA` `ONA` `SPECIAL` `GAME` |
| year | number | 推奨 | 開始年 |
| series | string | | シリーズ名（例: 「Fate」） |
| parts | string[] | | 1 つにまとめたシーズンのタイトル（例: 「僕のヒーローアカデミア 6」）。検索にも使う |
| anilistId | number | | |
| wikipediaTitle | string | | |
| popularity | number | | AniList popularity など。大量ノード時の優先度に使う |
| image | Image | | キービジュアル・カバー |
| sources | Source[] | ✓ | |

同じ作品のシーズン違い（続編・前作でつながるテレビ・配信シリーズと、その間の OVA・特別編）は 1 件の Work にまとめ、
各シーズンのタイトルを `parts` に入れる。劇場版は別の Work のまま残し、Series でつなぐ。

## Cast（声優–キャラ）

| フィールド | 型 | 必須 | 内容 |
|---|---|---|---|
| voiceActor | string | ✓ | VoiceActor.id |
| character | string | ✓ | Character.id |
| medium | string | ✓ | `anime` \| `game` |
| work | string | | この配役が当てはまる Work.id（作品ごとに声優が違う場合に指定） |
| period | {from?: number, to?: number} | | 担当期間（年） |
| kind | string | | `regular`(既定) \| `replacement`(交代後) \| `substitute`(代役) |
| sources | Source[] | | |

同じ (voiceActor, character) で medium が違う場合は 2 行に分ける。

## Appearance（キャラ–作品）

| フィールド | 型 | 必須 | 内容 |
|---|---|---|---|
| character | string | ✓ | |
| work | string | ✓ | |
| role | string | ✓ | `MAIN` \| `SUPPORTING` \| `BACKGROUND` |
| sources | Source[] | | |

## Series（作品–作品・任意）

`{ "from": "wk:…", "to": "wk:…", "relation": "SEQUEL" }`
relation: `SEQUEL` `PREQUEL` `SIDE_STORY` `SPIN_OFF` `ADAPTATION` `ALTERNATIVE` `OTHER`。
`from` から見て `to` が何か、を表す（A の続編が B なら from=A, to=B, relation=SEQUEL）。片方向 1 行でよい。

## Relation（キャラ–キャラ・任意）

`{ "a": "ch:…", "b": "ch:…", "label": "兄弟", "sources": [...] }`

## 検証

`cargo run -p cverse-cli -- validate data/source` で参照切れ・必須欠落・ID 重複を検査できる。
参照切れのエッジはビルド時に警告して捨てる。
