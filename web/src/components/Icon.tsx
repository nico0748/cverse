/** 線画の小さなアイコン。色は文字色に従う。装飾なので読み上げからは隠す（ラベルはボタン側に付ける）。 */
const PATHS = {
  search: "M7 12.5A5.5 5.5 0 1 0 7 1.5a5.5 5.5 0 0 0 0 11zM11 11l3.5 3.5",
  star: "M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z",
  route: "M3.5 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12.5 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM3.5 6v2.5a2 2 0 0 0 2 2h5",
  share: "M8 10V2M5 4.5L8 1.5l3 3M3 8.5v4.5h10V8.5",
  sun: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1",
  moon: "M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z",
  help: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM6.2 6.3a1.9 1.9 0 1 1 2.7 1.7c-.6.3-.9.7-.9 1.3M8 11.6v.1",
  close: "M3.5 3.5l9 9M12.5 3.5l-9 9",
  swap: "M5 2v11M2.5 10.5L5 13l2.5-2.5M11 14V3M8.5 5.5L11 3l2.5 2.5",
  external: "M6 3H3v10h10v-3M9 2.5h4.5V7M13 3L7.5 8.5",
  shuffle: "M1.5 4.5h2.5c3 0 4 7 7 7h3M12 9.5l2 2-2 2M1.5 11.5h2.5c1 0 1.8-.8 2.5-1.9M9 6.2c.6-1 1.3-1.7 2-1.7h3M12 2.5l2 2-2 2",
  clock: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 4.5V8l2.5 1.5",
  filter: "M2 4.5h12M4.5 8h7M6.5 11.5h3",
  chevron: "M6 3.5L10.5 8 6 12.5",
  menu: "M2.5 4.5h11M2.5 8h11M2.5 11.5h11",
  check: "M3 8.5l3.2 3L13 4.5",
  target: "M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** ロゴの印。丸（声優）・角丸（キャラ）・四角（作品）が線でつながっている。 */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg className="logo-mark" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path d="M10 9.5L21 16M21 16L11 23.5" stroke="var(--ink-3)" strokeWidth="1.5" fill="none" />
      <circle cx="8.5" cy="8.5" r="6" fill="var(--va)" />
      <rect x="16" y="11" width="11" height="11" rx="3.6" fill="var(--ch)" />
      <rect x="4" y="19.5" width="9.5" height="9.5" rx="1" fill="var(--wk)" />
    </svg>
  );
}
