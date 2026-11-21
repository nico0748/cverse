import { useCallback, useEffect, useMemo, useState } from "react";
import { About } from "./components/About";
import { Breadcrumbs } from "./components/Breadcrumbs";
import { Controls, Legend } from "./components/Controls";
import { DetailPanel } from "./components/DetailPanel";
import { GraphView } from "./components/GraphView";
import { Home } from "./components/Home";
import { Icon, LogoMark } from "./components/Icon";
import { MyList } from "./components/MyList";
import { PathPanel, type PathDraft } from "./components/PathPanel";
import { SearchBox } from "./components/SearchBox";
import { engine } from "./lib/engine";
import { useBriefs, useNarrow } from "./lib/hooks";
import { sceneFromPath, sceneFromView, type SceneNode } from "./lib/scene";
import { markSeen, seen, useFavorites, useHistory } from "./lib/store";
import { useTheme } from "./lib/theme";
import { DEFAULT_FILTER, type Filter, type Meta, type NodeBrief, type PathData, type ViewData } from "./lib/types";
import { parseRoute, serializeRoute, type RouteState } from "./lib/url";

const MAX_TRAIL = 40;

function initialTrail(route: RouteState): string[] {
  const saved = (history.state as { trail?: unknown } | null)?.trail;
  if (Array.isArray(saved) && saved.every((v) => typeof v === "string")) return saved;
  return route.center ? [route.center] : [];
}

/** トップ画面の相関図に出す声優。日替わりで、上位の中から 1 人。 */
function heroOf(meta: Meta | null): string | null {
  const pool = meta?.featured.slice(0, 8) ?? [];
  if (pool.length === 0) return null;
  return pool[Math.floor(Date.now() / 86_400_000) % pool.length];
}

export function App() {
  const [route, setRoute] = useState(() => parseRoute(location.search));
  const [trail, setTrail] = useState(() => initialTrail(route));
  const [meta, setMeta] = useState<Meta | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [view, setView] = useState<ViewData | null>(null);
  const [heroView, setHeroView] = useState<ViewData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [pathData, setPathData] = useState<PathData | null>(null);
  const [tab, setTab] = useState<"detail" | "path">(route.path ? "path" : "detail");
  const [draft, setDraft] = useState<PathDraft>({ from: null, to: null, mode: route.path?.mode ?? "bfs" });
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [hint, setHint] = useState(() => !seen("graph-hint"));
  const { favorites, toggle: toggleFavorite } = useFavorites();
  const { history: visited, visit, clear: clearHistory } = useHistory();
  const { theme, toggle: toggleTheme } = useTheme();
  const narrow = useNarrow();

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
    commit({ center: null, depth: 1, filter: DEFAULT_FILTER, path: null }, [], "push");
    setDraft({ from: null, to: null, mode: "bfs" });
    setTab("detail");
    setPicking(null);
    setSheetOpen(false);
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
        if (v) {
          setView(v);
          visit(v.center);
        }
      },
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [route.center, route.depth, route.filter, visit]);

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

  const atHome = !route.center && !route.path && tab !== "path";
  const heroId = heroOf(meta);
  useEffect(() => {
    // トップ画面の相関図（スマホでは出さない）。
    if (!atHome || narrow || !heroId) return;
    let stale = false;
    engine.view(heroId, 1, DEFAULT_FILTER).then(
      (v) => !stale && setHeroView(v),
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [atHome, narrow, heroId]);

  // パンくず・お気に入り・履歴・トップの入口・経路の端点の表示名と画像をまとめて引く。
  const wanted = useMemo(() => {
    const ids = new Set([...trail, ...favorites, ...visited, ...(meta?.featured ?? []), ...(meta?.featuredWorks ?? [])]);
    if (route.path) ids.add(route.path.from).add(route.path.to);
    return [...ids];
  }, [trail, favorites, visited, meta, route.path]);
  const briefs = useBriefs(wanted);
  const known = (ids: string[]) => ids.map((id) => briefs.get(id)).filter((b): b is NodeBrief => !!b);

  // URL の経路を、経路パネルの入力欄に反映する（共有 URL を開いたとき・戻るで戻ったとき）。
  const pathFrom = route.path ? briefs.get(route.path.from) : undefined;
  const pathTo = route.path ? briefs.get(route.path.to) : undefined;
  const pathMode = route.path?.mode;
  useEffect(() => {
    if (pathFrom && pathTo && pathMode) setDraft({ from: pathFrom, to: pathTo, mode: pathMode });
  }, [pathFrom, pathTo, pathMode]);

  // ---- 経路 ----
  const updateDraft = (next: PathDraft) => {
    setDraft(next);
    setPicking(null);
    if (next.from && next.to && next.from.id !== next.to.id) {
      commit({ ...route, path: { from: next.from.id, to: next.to.id, mode: next.mode } }, trail, route.path ? "replace" : "push");
      // スマホでは結果の図が見えるよう、シートは開いたままにして要約を読めるようにする。
      setSheetOpen(true);
    } else if (route.path) {
      commit({ ...route, path: null }, trail, "replace");
    }
  };

  /** 経路の画面を開く。始点を指定しなければ、今の中心を始点にする。 */
  const openPath = (from?: NodeBrief | null, to?: NodeBrief | null) => {
    setTab("path");
    setSheetOpen(true);
    if (from && to) {
      updateDraft({ from, to, mode: draft.mode });
      return;
    }
    const center = route.center ? briefs.get(route.center) : undefined;
    const start = from ?? (!draft.from && !draft.to ? center : undefined);
    if (start) setDraft({ ...draft, from: start });
  };

  const clearPath = () => {
    setDraft({ from: null, to: null, mode: draft.mode });
    setPicking(null);
    if (route.path) commit({ ...route, path: null }, trail, "push");
  };

  const closePath = () => {
    clearPath();
    setTab("detail");
  };

  const dismissHint = () => {
    if (!hint) return;
    setHint(false);
    markSeen("graph-hint");
  };

  const onNodeClick = (node: SceneNode) => {
    dismissHint();
    if (picking && node.kind !== "more") {
      updateDraft({ ...draft, [picking]: { id: node.id, label: node.label, kind: node.kind, image: node.image } });
      setSheetOpen(true);
      return;
    }
    navigate(node.target);
    if (node.kind === "more") setSheetOpen(true);
  };

  const random = () => {
    void engine.randomVoiceActor().then((id) => id && navigate(id));
  };

  // ---- 場面 ----
  const showingPath = !!route.path && !!pathData?.found;
  const scene = useMemo(() => {
    const layout = { portrait: narrow };
    if (route.path && pathData?.found) return sceneFromPath(pathData, layout);
    if (route.center) return view ? sceneFromView(view, trail, layout) : null;
    // トップ画面（と、中心が無いままの経路画面）では日替わりの相関図を見せる。
    return heroView && !narrow ? sceneFromView(heroView, []) : null;
  }, [route.path, route.center, pathData, view, heroView, trail, narrow]);

  const centerBrief = route.center ? briefs.get(route.center) : undefined;
  useEffect(() => {
    document.title = route.path && pathFrom && pathTo
      ? `${pathFrom.label} と ${pathTo.label} のつながり | CVerse`
      : centerBrief
        ? `${centerBrief.label} の相関図 | CVerse`
        : "CVerse | 声優・キャラ・作品の相関図";
  }, [centerBrief, route.path, pathFrom, pathTo]);

  const setDepth = (depth: number) => commit({ ...route, depth }, trail, "replace");
  const setFilter = (filter: Filter) => commit({ ...route, filter }, trail, "replace");
  const suggestions = useMemo(() => {
    const ids = [...new Set([...visited, ...favorites])].slice(0, 8);
    return ids.map((id) => briefs.get(id)).filter((b): b is NodeBrief => !!b);
    // briefs は同じ Map を使い回すので、中身が届いたことは wanted の変化で拾う。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visited, favorites, briefs, briefs.size]);

  if (bootError) {
    return (
      <div className="fatal" role="alert">
        <LogoMark size={40} />
        <h1>データを読み込めませんでした</h1>
        <p>通信状況を確認して、もう一度読み込んでください。</p>
        <p className="muted">{bootError}</p>
        <button type="button" className="button button--primary" onClick={() => location.reload()}>
          もう一度読み込む
        </button>
      </div>
    );
  }

  const hero = heroId ? (briefs.get(heroId) ?? null) : null;
  const sheetTitle = tab === "path" ? "つながりを調べる" : (centerBrief?.label ?? "詳細");
  return (
    <div className={`app${atHome ? " app--home" : ""}${sheetOpen ? " app--sheet-open" : ""}`}>
      <a className="skip-link" href="#panel">
        本文へ移動
      </a>
      <header className="topbar">
        <a
          className="brand"
          href={location.pathname}
          aria-label="CVerse トップへ"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey) return;
            e.preventDefault();
            goHome();
          }}
        >
          <LogoMark />
          <span className="brand__name">CVerse</span>
        </a>
        {!atHome && (
          <SearchBox
            label="声優・キャラ・作品を検索"
            placeholder="声優・キャラ・作品を検索"
            onPick={(n) => navigate(n.id)}
            suggestions={suggestions}
            suggestionsLabel="最近見た・お気に入り"
            hotkey
          />
        )}
        <nav className="topbar__nav" aria-label="メニュー">
          {!atHome && (
            <button type="button" className={`nav-button${tab === "path" ? " is-on" : ""}`} aria-pressed={tab === "path"} onClick={() => (tab === "path" ? closePath() : openPath())}>
              <Icon name="route" />
              <span className="nav-button__label">つながりを調べる</span>
            </button>
          )}
          <MyList
            favorites={known(favorites)}
            history={known(visited)}
            onPick={navigate}
            onClearHistory={clearHistory}
            theme={theme}
            onToggleTheme={toggleTheme}
            onAbout={() => setAboutOpen(true)}
          />
          <button type="button" className="nav-button nav-button--wide-only" aria-label={theme === "dark" ? "明るい配色にする" : "暗い配色にする"} title={theme === "dark" ? "明るい配色にする" : "暗い配色にする"} onClick={toggleTheme}>
            <Icon name={theme === "dark" ? "sun" : "moon"} />
          </button>
          <button type="button" className="nav-button nav-button--wide-only" aria-label="使い方とデータについて" title="使い方とデータについて" onClick={() => setAboutOpen(true)}>
            <Icon name="help" />
          </button>
        </nav>
      </header>

      <main className="stage">
        <GraphView
          scene={scene}
          onNodeClick={onNodeClick}
          picking={picking !== null}
          theme={theme}
          zoomControls={!atHome}
          label={
            showingPath
              ? "2 つのノードをつなぐ経路の図。内容は「つながりを調べる」の一覧にもあります。"
              : `${(atHome ? hero?.label : centerBrief?.label) ?? ""}の相関図。内容は詳細の一覧にもあります。`
          }
        />
        {atHome ? (
          <Home
            meta={meta}
            featured={known(meta?.featured ?? [])}
            featuredWorks={known(meta?.featuredWorks ?? [])}
            favorites={known(favorites)}
            history={known(visited)}
            hero={narrow ? null : hero}
            onNavigate={navigate}
            onRandom={random}
            onPath={openPath}
            onAbout={() => setAboutOpen(true)}
          />
        ) : (
          <>
            <div className="stage__top">
              {!showingPath && route.center && <Breadcrumbs trail={known(trail)} onJump={jump} />}
              {!showingPath && route.center && <Controls depth={route.depth} onDepth={setDepth} filter={route.filter} onFilter={setFilter} />}
            </div>
            <Legend />
            <div className="stage__notes" aria-live="polite">
              {showingPath && (
                <p className="note">
                  経路を表示しています
                  <button type="button" className="link" onClick={closePath}>
                    {route.center ? "相関図に戻る" : "閉じる"}
                  </button>
                </p>
              )}
              {picking && (
                <p className="note note--accent">
                  {picking === "from" ? "始点" : "終点"}にするノードを押してください
                  <button type="button" className="link" onClick={() => setPicking(null)}>
                    やめる
                  </button>
                </p>
              )}
              {notFound && (
                <p className="note" role="alert">
                  「{route.center}」は見つかりませんでした。
                  <button type="button" className="link" onClick={goHome}>
                    トップへ戻る
                  </button>
                </p>
              )}
              {view && route.center && !notFound && !showingPath && view.nodes.length === 1 && (
                <p className="note">
                  この条件ではつながるノードがありません。
                  <button type="button" className="link" onClick={() => setFilter(DEFAULT_FILTER)}>
                    絞り込みを外す
                  </button>
                </p>
              )}
              {hint && route.center && !showingPath && !picking && !notFound && (
                <p className="note">
                  ノードを押すと、そこが中心になります
                  <button type="button" className="link" onClick={dismissHint}>
                    わかった
                  </button>
                </p>
              )}
            </div>
          </>
        )}
      </main>

      {!atHome && (
        <aside className="panel" id="panel" aria-label={sheetTitle} tabIndex={-1}>
          <button type="button" className="panel__handle" aria-expanded={sheetOpen} onClick={() => setSheetOpen((v) => !v)}>
            <span className="panel__grip" aria-hidden="true" />
            <span className="panel__peek">
              {sheetTitle}
              <span className="sr-only">{sheetOpen ? "（閉じる）" : "（開く）"}</span>
            </span>
          </button>
          <div className="panel__body">
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
                suggestions={suggestions}
                canPick={!!scene && !showingPath}
              />
            ) : meta && route.center && !notFound ? (
              <DetailPanel
                meta={meta}
                id={route.center}
                onNavigate={navigate}
                isFavorite={favorites.includes(route.center)}
                onToggleFavorite={() => toggleFavorite(route.center!)}
                onStartPath={() => openPath(centerBrief ?? null)}
              />
            ) : (
              <p className="panel__msg">{notFound ? "ノードが見つかりません。" : "読み込み中…"}</p>
            )}
          </div>
        </aside>
      )}
      <About open={aboutOpen} onClose={() => setAboutOpen(false)} meta={meta} />
    </div>
  );
}
