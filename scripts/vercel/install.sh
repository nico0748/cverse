#!/usr/bin/env bash
# Vercel のインストール手順（web/vercel.json から web/ で実行される）。
# WASM ターゲットと wasm-pack を用意して、画面の依存を入れる。
# Vercel のビルド環境には rustup が /rust（CARGO_HOME）に入っていることがあるので、あればそれを使う。
set -euo pipefail
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal
fi
rustup toolchain install stable --profile minimal
rustup target add wasm32-unknown-unknown --toolchain stable
npm ci
command -v wasm-pack >/dev/null 2>&1 || npm install -g wasm-pack@0.13.1
