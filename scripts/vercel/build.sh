#!/usr/bin/env bash
# Vercel のビルド手順（web/vercel.json から web/ で実行される）。
# WASM と配信データ（data/source から）を作ってから、画面をビルドする。
set -euo pipefail
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
export RUSTUP_TOOLCHAIN=stable
# OGP 画像の絶対 URL。設定が無ければ、Vercel が渡す本番のドメインを使う。
if [ -z "${VITE_SITE_URL:-}" ] && [ -n "${VERCEL_PROJECT_PRODUCTION_URL:-}" ]; then
  export VITE_SITE_URL="https://${VERCEL_PROJECT_PRODUCTION_URL}"
fi
echo "VITE_SITE_URL=${VITE_SITE_URL:-（未設定）}"
npm run wasm
npm run data
npm run build
