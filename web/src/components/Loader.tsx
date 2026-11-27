/**
 * 読み込み中の印。ロゴの 3 つの形（声優の丸・キャラの角丸・作品の四角）が、線でつながりながら順に現れる。
 * 少し待ってから出す（すぐ読み終わるときは一瞬も見せない）。index.html の起動時の表示と同じ形。
 */
export function Loader({ label = "相関図を用意しています" }: { label?: string }) {
  return (
    <div className="loader" role="status" aria-live="polite">
      <svg className="loader__mark" viewBox="0 0 32 32" width="56" height="56" aria-hidden="true">
        <path className="loader__link loader__link--1" d="M10 9.5L21 16" pathLength="1" />
        <path className="loader__link loader__link--2" d="M21 16L11 23.5" pathLength="1" />
        <circle className="loader__node loader__node--1" cx="8.5" cy="8.5" r="6" />
        <rect className="loader__node loader__node--2" x="16" y="11" width="11" height="11" rx="3.6" />
        <rect className="loader__node loader__node--3" x="4" y="19.5" width="9.5" height="9.5" rx="1" />
      </svg>
      <p className="loader__text">{label}</p>
    </div>
  );
}
