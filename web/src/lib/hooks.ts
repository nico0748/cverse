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
    // Tab で外へ出たら閉じる（開いたままページの裏へフォーカスが行かないように）。
    const onFocusOut = (e: FocusEvent) => {
      const to = e.relatedTarget as Node | null;
      if (to && ref.current && !ref.current.contains(to)) setOpen(false);
    };
    const el = ref.current;
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    el?.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      el?.removeEventListener("focusout", onFocusOut);
    };
  }, [open]);
  return [open, setOpen, ref];
}

const SCOPES = ".endpoint, .mylist, .filters, .path, .panel";
const FOCUSABLE = "button:not(:disabled), input:not(:disabled), a[href], [tabindex]";

/**
 * 押したボタンが消えたり無効になったりして、フォーカスの行き場が無くなったときの受け皿。
 * 押した場所を含むまとまり（端点の欄、マイリスト、絞り込み、パネル）の先頭へ移して、キーボードで続けられるようにする。
 */
export function useFocusRescue() {
  useEffect(() => {
    const rescue = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Enter") return;
      const from = e.target as Element | null;
      const scopes: Element[] = [];
      for (let el = from?.closest?.(SCOPES) ?? null; el; el = el.parentElement?.closest(SCOPES) ?? null) scopes.push(el);
      if (!scopes.length) return;
      // 画面の更新が済んでから確かめる。
      setTimeout(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        for (const scope of scopes) {
          if (!scope.isConnected) continue;
          const target = scope.matches("[tabindex]") ? (scope as HTMLElement) : scope.querySelector<HTMLElement>(FOCUSABLE);
          if (target) return target.focus({ preventScroll: true });
        }
      }, 60);
    };
    document.addEventListener("click", rescue, true);
    document.addEventListener("keydown", rescue, true);
    return () => {
      document.removeEventListener("click", rescue, true);
      document.removeEventListener("keydown", rescue, true);
    };
  }, []);
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

/** 縦長の狭い画面（スマホ）かどうか。styles.css の区切りと同じ条件。横向きのスマホは含めない。 */
export function useNarrow(): boolean {
  const query = "(max-width: 860px) and (orientation: portrait), (max-width: 560px)";
  const [narrow, setNarrow] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}
