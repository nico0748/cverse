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
| favourites | number | | AniList お気に入り数 |
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
| sources | Source[] | ✓ | |

同じキャラを複数の声優が演じた場合もキャラは 1 件にまとめ、Cast を複数張る。

## Work

| フィールド | 型 | 必須 | 内容 |
|---|---|---|---|
| id | string | ✓ | `wk:` で始まる |
| title | string | ✓ | 日本語タイトル |
| reading | string | | |
| titleEn | string | | ローマ字/英語 |
| format | string | ✓ | `TV` `TV_SHORT` `MOVIE` `OVA` `ONA` `SPECIAL` `GAME` |
| year | number | 推奨 | 開始年 |
| series | string | | シリーズ名（例: 「Fate」） |
| anilistId | number | | |
| wikipediaTitle | string | | |
| popularity | number | | AniList popularity など。大量ノード時の優先度に使う |
| sources | Source[] | ✓ | |

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
