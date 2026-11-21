import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * 同梱フォントの CSS から woff の予備を外す。woff2 は対象ブラウザのすべてが読めるので、
 * 予備を残すと配信ファイルの数と大きさがほぼ倍になるだけになる。
 */
function woff2Only(): Plugin {
  return {
    name: "cverse:woff2-only",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("@fontsource") || !id.split("?")[0].endsWith(".css")) return null;
      return { code: code.replace(/,\s*url\([^)]+\.woff\)\s*format\(['"]woff['"]\)/g, ""), map: null };
    },
  };
}

export default defineConfig({
  plugins: [woff2Only(), react()],
  worker: { format: "es" },
  build: { target: "es2022" },
  test: { environment: "node", include: ["src/**/*.test.ts"], css: true },
});
