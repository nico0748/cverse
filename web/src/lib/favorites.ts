import { useCallback, useSyncExternalStore } from "react";

/** お気に入り（F-11）。ログインなしで、この端末のブラウザ内だけに保存する。 */
const KEY = "cverse:favorites:v1";
const listeners = new Set<() => void>();
let cache: string[] | null = null;

function read(): string[] {
  if (cache) return cache;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    cache = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: string[]) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 保存できない環境（プライベートモードなど）でも、このセッション中は使える。
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFavorites() {
  const favorites = useSyncExternalStore(subscribe, read, read);
  const toggle = useCallback((id: string) => {
    const cur = read();
    write(cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur].slice(0, 200));
  }, []);
  return { favorites, toggle };
}
