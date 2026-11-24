# 公開（デプロイ）のまとめ

CVerse はサーバーを持たない静的サイトなので、`web/dist` をそのまま静的ホスティングに置けば動く。
ここでは Cloudflare Pages を前提に、公開に必要な設定と、`VITE_SITE_URL`（サイトの URL）の扱いをまとめる。

## VITE_SITE_URL（サイトの URL）

| 項目 | 内容 |
|---|---|
| 何のためか | X などで共有したときに OGP 画像（`web/public/og.png`）が出るよう、`index.html` の `og:image` と `twitter:image` を絶対 URL にする |
| 書き方 | 公開先の URL を末尾の `/` なしで。例: `https://cverse.pages.dev`、独自ドメインなら `https://cverse.example.com` |
| いつ効くか | **ビルド時**（Vite が `%VITE_SITE_URL%` を置き換える）。公開後に変えたら、もう一度ビルドしないと反映されない |
| どこで設定するか | Cloudflare Pages の「Settings → Environment variables」（本番とプレビューで別々に設定できる）。手元では `web/.env.local` |
| 空のとき | `og:image` が `/og.png` という相対パスになり、X やほかの SNS では画像が出ない。サイト自体は動く |

ほかの URL（タイムアタックの共有リンク、詳細の「共有」）は、開いているページの `location` から作るので設定は要らない。
独自ドメインを付けたら、`VITE_SITE_URL` もそのドメインに変えてビルドし直す。

## Cloudflare Pages の設定

### おすすめ: GitHub Actions でビルドして Pages に上げる（Direct Upload）

配信データ（`web/public/data`）は Rust の `cverse-cli` で、画面は WASM（wasm-pack）でビルドする。
Cloudflare Pages のビルド環境には Rust と wasm-pack が入っていないので、すでに同じ手順が通っている
GitHub Actions（`.github/workflows/ci.yml` の `web` ジョブ）でビルドし、`wrangler pages deploy` で上げるのが確実。

1. Cloudflare でプロジェクトを作る（Workers & Pages → Create → Pages → 「Direct Upload」）。名前を `cverse` にすると URL は `https://cverse.pages.dev`
2. Cloudflare の API トークン（権限: Account → Cloudflare Pages → Edit）とアカウント ID を、GitHub リポジトリの Secrets に入れる
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
3. GitHub リポジトリの Variables に `VITE_SITE_URL`（例: `https://cverse.pages.dev`）を入れる
4. main へのマージで動くデプロイ用ワークフローを足す（`npm run wasm` → `npm run data` → `npm run build` → `npx wrangler pages deploy web/dist --project-name cverse`。ビルドの環境変数に `VITE_SITE_URL: ${{ vars.VITE_SITE_URL }}`）

### Cloudflare 側でビルドする場合（Git 連携）

| 項目 | 値 |
|---|---|
| Framework preset | None |
| Root directory | `web` |
| Build command | `curl https://sh.rustup.rs -sSf \| sh -s -- -y --target wasm32-unknown-unknown && . $HOME/.cargo/env && cargo install wasm-pack && npm run wasm && npm run data && npm run build` |
| Build output directory | `dist` |
| Environment variables | `VITE_SITE_URL`（上の表）、`NODE_VERSION=22` |

Rust の導入と Rust のビルドを毎回するので 10 分以上かかり、無料枠のビルド時間（月 500 回、1 回 20 分まで）にも響く。上の Direct Upload をすすめる理由。

### 確かめておくこと

| 項目 | 内容 |
|---|---|
| ファイルの数 | Pages は 1 回のデプロイで 20,000 ファイルまで、1 ファイル 25 MiB まで。配信データは詳細を「シャード」にまとめてあり、実データのビルドで約 520 ファイル（いちばん大きい search.txt でも 2.4 MB、2026-11-24 時点）なので十分収まる |
| URL の形 | 画面の状態はすべてクエリ（`?c=…`、`?ta=…`）で持つので、SPA 用のリダイレクト設定（`_redirects`）は要らない |
| 画像 | キャラ・作品の画像は AniList・Bangumi・Wikimedia などの URL を直接参照するだけで、サイトには置かない。Pages 側の設定は要らない |
| OGP 画像 | いまは全ページ共通の `og.png`。タイムアタックの結果ごとに画像を変えるには Pages Functions が要る（未対応） |

## 公開前に決めること

- **データの利用条件.** AniList の利用規約（商用・再配布の扱い）と、Bangumi・SchaleDB の画像の扱い。サイトは画像を保存せず URL を直接参照して出典を出しているが、公開してよいかは最終的に判断が要る
- **ライセンス.** リポジトリのライセンスは未決（`Cargo.toml` に `license` が無い）
- **誤り報告の窓口.** いまは詳細の「誤りを報告する」が GitHub の Issue を開く。GitHub アカウントの無い人向けに Google フォームを用意するかどうか
