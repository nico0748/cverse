import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// 本文の書体は端末のもの（BIZ UDP ゴシック・ヒラギノ・游ゴシックなど）を使い、日本語の Web フォントは
// 見出し用の明朝 1 書体だけにする。その定義（使う文字の分だけ小分けに届く）も最初の描画を待たせないよう、
// 画面が出てから読み込む。配るのは自分のサイトからで、外部のフォント配信に利用者の情報は渡さない。
void import("@fontsource/shippori-mincho-b1/700.css");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
