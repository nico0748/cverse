import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// 本文の書体は端末のもの（BIZ UDP ゴシック・ヒラギノ・游ゴシックなど）を使い、日本語の Web フォントは
// 見出し用の Zen Maru Gothic だけにする（900 は見出しとロゴ、700 は名前と頭文字）。その定義（使う文字の分だけ
// 小分けに届く）も最初の描画を待たせないよう、画面が出てから読み込む。配るのは自分のサイトからで、
// 外部のフォント配信に利用者の情報は渡さない。
void import("@fontsource/zen-maru-gothic/900.css");
void import("@fontsource/zen-maru-gothic/700.css");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
