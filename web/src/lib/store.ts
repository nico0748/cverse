import { useCallback, useSyncExternalStore } from "react";

/**
 * この端末のブラウザ内だけに保存する ID の一覧（お気に入り・最近見たもの）。
 * ログインは無いので、サーバーには何も送らない。
 */
export function createIdList(key: string, limit: number) {
  const listeners = new Set<() => void>();
  let cache: string[] | null = null;

  const read = (): string[] => {
    if (cache) return cache;
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      cache = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
    } catch {
      cache = [];
    }
    return cache;
  };

  const write = (next: string[]) => {
    cache = next.slice(0, limit);
    try {
      localStorage.setItem(key, JSON.stringify(cache));
    } catch {
      // 保存できない環境（プライベートモードなど）でも、このセッション中は使える。
    }
    listeners.forEach((l) => l());
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  // 別のタブで変わったら読み直す（古い控えで上書きしてしまわないように）。
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => {
      if (e.key !== key && e.key !== null) return;
      cache = null;
      listeners.forEach((l) => l());
    });
  }

  return { read, write, subscribe };
}

const favoritesStore = createIdList("cverse:favorites:v1", 200);
const historyStore = createIdList("cverse:history:v1", 30);

/** お気に入り（F-11）。 */
export function useFavorites() {
  const favorites = useSyncExternalStore(favoritesStore.subscribe, favoritesStore.read, favoritesStore.read);
  const toggle = useCallback((id: string) => {
    const cur = favoritesStore.read();
    favoritesStore.write(cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur]);
  }, []);
  return { favorites, toggle };
}

/** 最近見たノード（新しい順）。 */
export function useHistory() {
  const history = useSyncExternalStore(historyStore.subscribe, historyStore.read, historyStore.read);
  const visit = useCallback((id: string) => {
    const cur = historyStore.read();
    if (cur[0] !== id) historyStore.write([id, ...cur.filter((x) => x !== id)]);
  }, []);
  const clear = useCallback(() => historyStore.write([]), []);
  /** 消した履歴を元に戻す。 */
  const restore = useCallback((list: string[]) => historyStore.write(list), []);
  return { history, visit, clear, restore };
}

/** 一度だけ見せる案内を、もう見たかどうか。 */
export function seen(flag: string): boolean {
  try {
    return localStorage.getItem(`cverse:seen:${flag}`) === "1";
  } catch {
    return true;
  }
}

export function markSeen(flag: string) {
  try {
    localStorage.setItem(`cverse:seen:${flag}`, "1");
  } catch {
    // 保存できなければ、次も案内が出るだけ。
  }
}
