import { useEffect, useRef, useState, type RefObject } from "react";
import { engine } from "./engine";
import type { NodeBrief } from "./types";

/** 外側を押すか Esc で閉じるポップオーバー。 */
export function usePopover<T extends HTMLElement>(): [boolean, (open: boolean) => void, RefObject<T | null>] {
  const [open, setOpen] = useState(false);
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      // 閉じたら、開いたボタンにフォーカスを戻す。
      ref.current?.querySelector<HTMLElement>("[aria-expanded]")?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return [open, setOpen, ref];
}

const briefCache = new Map<string, NodeBrief | null>();

/**
 * ID から表示名・種類・画像を引く（一覧に小さな画像を添えるため）。
 * 索引は Web Worker 側にあるので非同期に届く。届くまでは頭文字のアイコンで表示する。
 */
export function useBriefs(ids: string[]): Map<string, NodeBrief | null> {
  const [, bump] = useState(0);
  const key = ids.join("\n");
  useEffect(() => {
    const missing = [...new Set(ids)].filter((id) => !briefCache.has(id));
    if (missing.length === 0) return;
    let stale = false;
    engine.briefs(missing).then(
      (list) => {
        list.forEach((b, i) => briefCache.set(missing[i], b));
        if (!stale) bump((n) => n + 1);
      },
      () => {},
    );
    return () => {
      stale = true;
    };
    // ids の中身（key）が変わったときだけ引き直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return briefCache;
}

/** 画面幅が狭い（スマホ）かどうか。styles.css の区切りと同じ値。 */
export function useNarrow(): boolean {
  const query = "(max-width: 860px)";
  const [narrow, setNarrow] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}
