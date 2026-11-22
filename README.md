# CVerse（シーバース）

声優・キャラ・作品を 1 枚のネットワークで辿る閲覧サイト。CV（キャラクターボイス）＋ Universe。

ノードを押すたびに中心が移り、「声優 → キャラ → 同じ作品のキャラ → そのキャラの声優 → 別作品」と
声優と作品をまたいで派生し続けられる。どのノードが中心でも、声優と作品に 1 クリックで戻れる。

- サーバーなしの「事前生成＋静的配信」。閲覧時に外部 API は呼ばない
- グラフの中核（CSR・最短経路・近傍抽出・検索）は Rust の 1 クレートにまとめ、データ生成（ネイティブ）と
  ブラウザ（WASM / Web Worker）の両方で同じコードを使う
- 設計の考え方と計測結果: [docs/design.md](docs/design.md)
- デザインの約束（色・文字・形・動線）: [docs/design-system.md](docs/design-system.md)
- 収集データの形式: [docs/data-schema.md](docs/data-schema.md)

## 構成

```
crates/
  cverse-core/   グラフ中核。I/O なし（CSR 形式・双方向 BFS・ダイクストラ・近傍抽出・検索・正規化・Jaro-Winkler）
  cverse-cli/    検証・配信データ生成・経路探索・計測・名寄せ候補出しの CLI
  cverse-wasm/   cverse-core のブラウザ向けバインディング（wasm-bindgen）
web/             画面（TypeScript + React + Vite、描画は Sigma.js + graphology）
data/
  sample/        開発用サンプル（手書きの小さな表から scripts/gen_sample.py で生成）
  source/        実データ（AniList の人気アニメ 300 作品の配役。シーズン違いは 1 作品にまとめる。scripts/fetch-anilist.mjs で取得）
scripts/         データの取得・生成
docs/
```

## 動かす

必要なもの: Rust（stable、`wasm32-unknown-unknown` ターゲット）、[wasm-pack](https://rustwasm.github.io/wasm-pack/)、Node.js 22。

```sh
cd web
npm install
npm run wasm     # cverse-wasm を web/src/wasm/pkg にビルド
npm run data     # data/source（実データ）から配信データを web/public/data に生成
npm run dev      # http://localhost:5173
```

小さなサンプルで動かすときは `CVERSE_DATA=sample npm run data`。
実データを取り直す・広げるときは、リポジトリの直下で次の 2 つを順に実行する。

```sh
node scripts/fetch-anilist.mjs --works 300 --cast-pages 2 --va-pages 1 --refresh   # アニメ（AniList）
node scripts/fetch-wikipedia-games.mjs                                              # 主要ゲーム（日本語版 Wikipedia）
```

AniList は 2 秒おきに呼ぶので、声優ごとの出演作まで取ると 1 時間半ほどかかる（`--va-pages 0` なら 10 分ほど）。
`--works` は人気順に集めるアニメの本数（シーズン違いと劇場版は 1 本に数える）、`--va-pages` は集まった声優それぞれの出演作を
人気順に何ページ（1 ページ 25 作品）足すか。声優は増やさず、その声優のキャラだけを足す。
ゲームは `scripts/fetch-wikipedia-games.mjs` の `GAMES` に並べた作品の記事から、キャラと声優の対応を読む。
アニメのあとに実行すること（アニメ版の同じキャラにまとめ、声優も名前でアニメ側に寄せる）。
`--refresh` を付けないと、前回の応答（`scripts/.cache/`）を使い回す。途中で止まった取得の続きには付けずに実行する。
画像を載せる範囲はビルド時に選べる（`cargo run --release -p cverse-cli -- build data/source --out web/public/data --images licensed`。
`all` が既定、`licensed` は再利用できるライセンス（パブリックドメイン、CC0、クレジット付きの CC BY / CC BY-SA）の画像だけ、`none` は画像なし）。

| コマンド | 内容 |
|---|---|
| `cargo test --workspace` | Rust のテスト |
| `npm test`（web/） | レイアウト・URL・Rust との取り決め・配色のコントラストのテスト |
| `npm run build`（web/） | 型チェックして `web/dist` に静的ビルド |
| `cargo run -p cverse-cli -- validate data/source` | 収集データの検証（ID 重複・参照切れ・必須欠落） |
| `cargo run --release -p cverse-cli -- path web/public/data <id> <id> --mode weighted` | 最短経路を表示 |
| `cargo run --release -p cverse-cli -- bench web/public/data` | 片方向 BFS と双方向 BFS の比較計測 |
| `cargo run -p cverse-cli -- candidates data/source` | 名寄せの候補（自動統合 / 確認待ち）を JSON で出力 |

デプロイは `web/dist` を静的ホスティング（Cloudflare Pages など）に置くだけでよい。

## 実装済みの機能

| ID | 機能 | 状態 |
|---|---|---|
| F-01 | グラフ表示（ズーム・パン・ドラッグ） | ✓ |
| F-02 | 中心切替（位置を引き継いでアニメーション） | ✓ |
| F-03 | 声優を上・作品を下に固定 | ✓ |
| F-04 | 種類別の色と形、凡例 | ✓ |
| F-05 | パンくず、URL 連動、ブラウザの「戻る」 | ✓ |
| F-06 | 表示段数スライダー（1〜3） | ✓ |
| F-07 | 詳細パネル（出演一覧・外部リンク・出典・取得日） | ✓ |
| F-08 | 検索（ひらがな・カタカナ・読み・部分一致） | ✓ |
| F-09 | 絞り込み（媒体・形態・年代・主役のみ） | ✓ |
| F-10 | 最短経路（最短 / 主役のみ / 主役を優先）と「共演で何ステップ」 | ✓ |
| F-11 | お気に入り（ブラウザ内に保存） | ✓ |
| F-12 | 誤り報告 | GitHub Issue のみ（Google フォームは未設定） |
| F-13 | 経路・表示の URL 共有 | ✓ |

まだ無いもの: AniList / Wikipedia からの収集を行う Rust CLI と作業用 SQLite、名寄せの確認画面、週次更新の
GitHub Actions、Cloudflare Pages へのデプロイ設定。

## データとライセンス

- アニメの配役は [AniList](https://anilist.co)、ゲームなどは [Wikipedia 日本語版](https://ja.wikipedia.org)（CC BY-SA 4.0）を出典とする
- 各ノードに取得元と取得日を持たせ、詳細パネルに表示する
- キャラ・声優・作品の画像は、データに `image` があれば表示する。画像はこのサイトに保存せず、出典元の URL を直接参照し、
  出典とクレジットを詳細パネルに出す。著作権は各権利者にある。画像が無いノードは頭文字のアイコンになる
- 画像を載せたくない場合や、再利用できるライセンスのものだけにしたい場合は、ビルド時の `--images none` / `--images licensed` で切り替える。
  `licensed` で残るのは、パブリックドメイン・CC0 と、作者名か掲載元ページのある CC BY / CC BY-SA だけ（非営利限定や改変禁止は含めない）
- `data/sample/images/` は自動生成した仮の絵（CC0）。実在の人物・作品の画像ではない
- `data/sample/` は動作確認用の手書きデータで、お気に入り数・人気は仮の値
- `data/source/` は AniList から取得した実データ（声優 2,305 人、キャラ 10,194 人、作品 300 本。シーズン違いをまとめる前は 421 本）。画像は AniList の URL を
  直接参照していて、再利用のライセンスは無い（`license: null`）。`--images licensed` でビルドすると、これらの画像は載らない
- 読み（ひらがな）は AniList に無いので、ローマ字表記から機械的に起こしている。「しんいち」が「しにち」になるなど
  一部は正しくない（検索は名前そのものでも当たる）
