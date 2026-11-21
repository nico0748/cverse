import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// 書体は自分のサイトから配る（外部のフォント配信に利用者の情報を渡さない）。
// 使う文字の分だけ小分けに届くので、日本語でも最初の読み込みは軽い。
import "@fontsource/biz-udpgothic/400.css";
import "@fontsource/biz-udpgothic/700.css";
import "@fontsource/shippori-mincho-b1/700.css";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
