#!/usr/bin/env bash
# Vercel のインストール手順（web/vercel.json から web/ で実行される）。
# Vercel のビルド環境には Rust が無いので、rustup で WASM ターゲットごと入れ、wasm-pack も入れる。
set -euo pipefail
# ビルド環境に別の cargo があっても、WASM ターゲットを足せる rustup のものを使う。
if [ ! -f "$HOME/.cargo/env" ]; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs |
    RUSTUP_INIT_SKIP_PATH_CHECK=yes sh -s -- -y --no-modify-path --profile minimal --default-toolchain stable --target wasm32-unknown-unknown
fi
. "$HOME/.cargo/env"
rustup target add wasm32-unknown-unknown
npm ci
command -v wasm-pack >/dev/null 2>&1 || npm install -g wasm-pack@0.13.1
