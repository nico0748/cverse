import { useCallback, useEffect, useMemo, useState } from "react";
import { Breadcrumbs } from "./components/Breadcrumbs";
import { Controls, Legend } from "./components/Controls";
import { DetailPanel } from "./components/DetailPanel";
import { GraphView } from "./components/GraphView";
import { Home } from "./components/Home";
import { PathPanel, type PathDraft } from "./components/PathPanel";
import { SearchBox } from "./components/SearchBox";
import { engine } from "./lib/engine";
import { useFavorites } from "./lib/favorites";
import { sceneFromPath, sceneFromView, type SceneNode } from "./lib/scene";
import type { Filter, Meta, NodeBrief, PathData, ViewData } from "./lib/types";
import { parseRoute, serializeRoute, type RouteState } from "./lib/url";

const MAX_TRAIL = 40;

function initialTrail(route: RouteState): string[] {
  const saved = (history.state as { trail?: unknown } | null)?.trail;
  if (Array.isArray(saved) && saved.every((v) => typeof v === "string")) return saved;
  return route.center ? [route.center] : [];
}

export function App() {
  const [route, setRoute] = useState(() => parseRoute(location.search));
  const [trail, setTrail] = useState(() => initialTrail(route));
  const [meta, setMeta] = useState<Meta | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [view, setView] = useState<ViewData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [pathData, setPathData] = useState<PathData | null>(null);
  const [briefs, setBriefs] = useState(() => new Map<string, NodeBrief>());
  const [tab, setTab] = useState<"detail" | "path">(route.path ? "path" : "detail");
  const [draft, setDraft] = useState<PathDraft>({ from: null, to: null, mode: route.path?.mode ?? "bfs" });
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { favorites, toggle: toggleFavorite } = useFavorites();

  // ---- URL と履歴（F-05）: 中心ノードを URL に持たせ、ブラウザの「戻る」で前の中心へ戻る ----
  const commit = useCallback((next: RouteState, nextTrail: string[], mode: "push" | "replace") => {
    const url = location.pathname + serializeRoute(next);
    if (mode === "push") history.pushState({ trail: nextTrail }, "", url);
    else history.replaceState({ trail: nextTrail }, "", url);
    setRoute(next);
    setTrail(nextTrail);
  }, []);

  useEffect(() => {
    const onPop = () => {
      const next = parseRoute(location.search);
      setRoute(next);
      setTrail(initialTrail(next));
      setTab(next.path ? "path" : "detail");
      setPicking(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback(
    (id: string) => {
      const nextTrail = trail[trail.length - 1] === id ? trail : [...trail, id].slice(-MAX_TRAIL);
      commit({ ...route, center: id, path: null }, nextTrail, "push");
      setTab("detail");
      setPicking(null);
    },
    [route, trail, commit],
  );

  const jump = useCallback(
    (index: number) => commit({ ...route, center: trail[index], path: null }, trail.slice(0, index + 1), "push"),
    [route, trail, commit],
  );

  const goHome = () => {
    commit({ ...route, center: null, path: null }, [], "push");
    setDraft({ from: null, to: null, mode: "bfs" });
    setTab("detail");
  };

  // ---- データ ----
  useEffect(() => {
    engine.meta().then(setMeta, (e: Error) => setBootError(e.message));
  }, []);

  useEffect(() => {
    if (!route.center) {
      setView(null);
      setNotFound(false);
      return;
    }
    let stale = false;
    engine.view(route.center, route.depth, route.filter).then(
      (v) => {
        if (stale) return;
        setNotFound(!v);
        if (v) setView(v);
      },
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [route.center, route.depth, route.filter]);

  useEffect(() => {
    setPathData(null);
    if (!route.path) return;
    let stale = false;
    engine.path(route.path.from, route.path.to, route.path.mode, route.filter).then(
      (p) => !stale && setPathData(p),
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [route.path, route.filter]);

  // パンくず・お気に入り・トップの声優・経路の端点の表示名をまとめて引く。
  const wanted = useMemo(() => {
    const ids = new Set([...trail, ...favorites, ...(meta?.featured ?? [])]);
    if (route.path) ids.add(route.path.from).add(route.path.to);
    return [...ids];
  }, [trail, favorites, meta, route.path]);

  useEffect(() => {
    const missing = wanted.filter((id) => !briefs.has(id));
    if (missing.length === 0) return;
    let stale = false;
    engine.briefs(missing).then(
      (list) => {
        if (stale) return;
        setBriefs((prev) => {
          const next = new Map(prev);
          list.forEach((b, i) => next.set(missing[i], b ?? { id: missing[i], label: "（不明）", kind: "more" }));
          return next;
        });
      },
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [wanted, briefs]);

  const known = useCallback(
    (ids: string[]) => ids.map((id) => briefs.get(id)).filter((b): b is NodeBrief => !!b && b.kind !== "more"),
    [briefs],
  );

  // URL の経路を、経路パネルの入力欄に反映する（共有 URL を開いたとき・戻るで戻ったとき）。
  useEffect(() => {
    if (!route.path) return;
    const from = briefs.get(route.path.from);
    const to = briefs.get(route.path.to);
    if (from && to) setDraft({ from, to, mode: route.path.mode });
  }, [route.path, briefs]);

  // ---- 経路 ----
  const updateDraft = (next: PathDraft) => {
    setDraft(next);
    setPicking(null);
    if (next.from && next.to) {
      commit({ ...route, path: { from: next.from.id, to: next.to.id, mode: next.mode } }, trail, route.path ? "replace" : "push");
    } else if (route.path) {
      commit({ ...route, path: null }, trail, "replace");
    }
  };

  const openPathTab = () => {
    setTab("path");
    setSheetOpen(true);
    // 始点の初期値は今の中心。
    const center = route.center ? briefs.get(route.center) : undefined;
    if (!draft.from && !draft.to && center && center.kind !== "more") setDraft({ ...draft, from: center });
  };

  const clearPath = () => {
    setDraft({ from: null, to: null, mode: draft.mode });
    setPicking(null);
    if (route.path) commit({ ...route, path: null }, trail, "push");
  };

  const onNodeClick = (node: SceneNode) => {
    if (picking && node.kind !== "more") {
      updateDraft({ ...draft, [picking]: { id: node.id, label: node.label, kind: node.kind } });
      return;
    }
    navigate(node.target);
    if (node.kind === "more") setSheetOpen(true);
  };

  // ---- 場面 ----
  const showingPath = !!route.path && !!pathData?.found;
  const scene = useMemo(() => {
    if (route.path && pathData?.found) return sceneFromPath(pathData);
    return view ? sceneFromView(view, trail) : null;
  }, [route.path, pathData, view, trail]);

  const centerBrief = route.center ? briefs.get(route.center) : undefined;
  useEffect(() => {
    document.title = centerBrief ? `${centerBrief.label} — CVerse` : "CVerse — 声優×キャラ グラフ";
  }, [centerBrief]);

  const setDepth = (depth: number) => commit({ ...route, depth }, trail, "replace");
  const setFilter = (filter: Filter) => commit({ ...route, filter }, trail, "replace");
  const atHome = !route.center && !route.path;

  if (bootError) {
    return (
      <div className="fatal" role="alert">
        <h1>CVerse</h1>
        <p>データを読み込めませんでした。通信状況を確認して、ページを再読み込みしてください。</p>
        <p className="muted">{bootError}</p>
        <button type="button" className="chip" onClick={() => location.reload()}>
          再読み込み
        </button>
      </div>
    );
  }

  return (
    <div className={`app${atHome ? " app--home" : ""}${sheetOpen ? " app--sheet-open" : ""}`}>
      <header className="topbar">
        <button type="button" className="logo" onClick={goHome} aria-label="CVerse トップへ">
          CVerse
        </button>
        {!atHome && (
          <>
            <SearchBox label="声優・キャラ・作品を検索" placeholder="検索（ひらがな・読みでも可）" onPick={(n) => navigate(n.id)} hotkey />
            <button type="button" className={`chip${tab === "path" ? " is-on" : ""}`} onClick={openPathTab}>
              最短経路
            </button>
          </>
        )}
      </header>

      {!atHome && <Breadcrumbs trail={known(trail)} onJump={jump} />}

      <main className="stage">
        <GraphView scene={atHome ? null : scene} onNodeClick={onNodeClick} picking={picking !== null} />
        {atHome ? (
          <Home meta={meta} featured={known(meta?.featured ?? [])} favorites={known(favorites)} onNavigate={navigate} />
        ) : (
          <>
            <Controls depth={route.depth} onDepth={setDepth} filter={route.filter} onFilter={setFilter} />
            <Legend />
            {showingPath && (
              <p className="stage__banner">
                最短経路を表示中
                <button type="button" className="link" onClick={clearPath}>
                  グラフに戻る
                </button>
              </p>
            )}
            {picking && <p className="stage__banner">経路の{picking === "from" ? "始点" : "終点"}にするノードを押してください</p>}
            {notFound && (
              <p className="stage__banner" role="alert">
                「{route.center}」は見つかりませんでした。
                <button type="button" className="link" onClick={goHome}>
                  トップへ戻る
                </button>
              </p>
            )}
            {view && !notFound && !showingPath && view.nodes.length === 1 && (
              <p className="stage__banner">この条件ではつながるノードがありません。絞り込みを緩めてください。</p>
            )}
          </>
        )}
      </main>

      {!atHome && (
        <aside className="panel" aria-label="詳細と経路">
          <button type="button" className="panel__handle" aria-expanded={sheetOpen} onClick={() => setSheetOpen((v) => !v)}>
            <span className="panel__grip" aria-hidden="true" />
            <span>{tab === "path" ? "最短経路" : (centerBrief?.label ?? "詳細")}</span>
          </button>
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "detail"} onClick={() => setTab("detail")}>
              詳細
            </button>
            <button type="button" role="tab" aria-selected={tab === "path"} onClick={openPathTab}>
              最短経路
            </button>
          </div>
          <div className="panel__body" role="tabpanel">
            {tab === "path" ? (
              <PathPanel
                draft={draft}
                onDraft={updateDraft}
                result={route.path ? pathData : null}
                picking={picking}
                onPicking={(which) => {
                  setPicking(which);
                  if (which) setSheetOpen(false);
                }}
                onNavigate={navigate}
                onClear={clearPath}
              />
            ) : meta && route.center && !notFound ? (
              <DetailPanel
                meta={meta}
                id={route.center}
                onNavigate={navigate}
                isFavorite={favorites.includes(route.center)}
                onToggleFavorite={() => toggleFavorite(route.center!)}
              />
            ) : (
              <p className="panel__msg">{notFound ? "ノードが見つかりません。" : "読み込み中…"}</p>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
