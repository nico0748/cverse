# CVerse（シーバース）

声優・キャラ・作品を 1 枚のネットワークで辿る閲覧サイト。CV（キャラクターボイス）＋ Universe。

ノードを押すたびに中心が移り、「声優 → キャラ → 同じ作品のキャラ → そのキャラの声優 → 別作品」と
声優と作品をまたいで派生し続けられる。どのノードが中心でも、声優と作品に 1 クリックで戻れる。

- サーバーなしの「事前生成＋静的配信」。閲覧時に外部 API は呼ばない
- グラフの中核（CSR・最短経路・近傍抽出・検索）は Rust の 1 クレートにまとめ、データ生成（ネイティブ）と
  ブラウザ（WASM / Web Worker）の両方で同じコードを使う
- 設計の考え方と計測結果: [docs/design.md](docs/design.md)
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
  source/        収集・名寄せ済みの実データ（収集側が置く）
docs/
```

## 動かす

必要なもの: Rust（stable、`wasm32-unknown-unknown` ターゲット）、[wasm-pack](https://rustwasm.github.io/wasm-pack/)、Node.js 22。

```sh
cd web
npm install
npm run wasm     # cverse-wasm を web/src/wasm/pkg にビルド
npm run data     # data/sample から配信データを web/public/data に生成
npm run dev      # http://localhost:5173
```

実データで動かすときは `CVERSE_DATA=source npm run data`。

| コマンド | 内容 |
|---|---|
| `cargo test --workspace` | Rust のテスト |
| `npm test`（web/） | レイアウト・URL・Rust との取り決めのテスト |
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
- キャラ画像・声優写真は載せない（頭文字＋色と形のアイコン）
- `data/sample/` は動作確認用の手書きデータで、お気に入り数・人気は仮の値
