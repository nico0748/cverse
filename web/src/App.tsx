import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { About } from "./components/About";
import { Breadcrumbs, type Crumb } from "./components/Breadcrumbs";
import { Controls, Legend } from "./components/Controls";
import { DetailPanel } from "./components/DetailPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { GraphView } from "./components/GraphView";
import { Home } from "./components/Home";
import { Icon, LogoMark } from "./components/Icon";
import { Loader } from "./components/Loader";
import { MyList } from "./components/MyList";
import { PathPanel, type PathDraft } from "./components/PathPanel";
import { SearchBox } from "./components/SearchBox";
import { Thumb } from "./components/Thumb";
import { TimeAttackIntro, TimeAttackPanel, Timer } from "./components/TimeAttack";
import { engine } from "./lib/engine";
import { useBriefs, useFocusRescue, useNarrow } from "./lib/hooks";
import { sceneFromPath, sceneFromView, type SceneNode } from "./lib/scene";
import { markSeen, seen, useFavorites, useHistory } from "./lib/store";
import { useTheme } from "./lib/theme";
import { DEFAULT_FILTER, KIND_LABEL, isDefaultFilter, type Filter, type Meta, type NodeBrief, type PathData, type ViewData } from "./lib/types";
import { useTimeAttack } from "./lib/useTimeAttack";
import { EMPTY_ROUTE, parseRoute, serializeRoute, type RouteState } from "./lib/url";

const MAX_TRAIL = 40;

/** 履歴の 1 件ごとに覚えておくもの。 */
interface HistoryState {
  trail?: unknown;
  /** 「つながりを調べる」を開いたときに積んだ履歴か（閉じるときに 1 つ戻ればよい）。 */
  opened?: boolean;
}

/** つながりの結果を一言で（詳細の見出しと、畳んだシートの両方で同じ言い方をする）。 */
function pathSummary(path: PathData, from: NodeBrief | null | undefined, to: NodeBrief | null | undefined): string {
  if (path.hops <= 1) return "直接つながっています";
  if (from?.kind === "va" && to?.kind === "va" && path.costar > 0) return `共演${path.costar}回でつながる`;
  return `${path.hops}回たどるとつながります`;
}

function initialTrail(route: RouteState): string[] {
  const saved = (history.state as HistoryState | null)?.trail;
  if (Array.isArray(saved) && saved.every((v) => typeof v === "string")) return saved;
  return route.center ? [route.center] : [];
}

/** トップ画面の相関図に出す声優。日替わりで、上位の中から 1 人。 */
function heroOf(meta: Meta | null): string | null {
  const pool = meta?.featured.slice(0, 8) ?? [];
  if (pool.length === 0) return null;
  return pool[Math.floor(Date.now() / 86_400_000) % pool.length];
}

/** スマホの下のシートの開き具合。 */
type Sheet = "peek" | "half" | "full";

export function App() {
  const [route, setRoute] = useState(() => parseRoute(location.search));
  const [trail, setTrail] = useState(() => initialTrail(route));
  const [meta, setMeta] = useState<Meta | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  // 図に出している近傍と、そのときの足跡。足跡だけ先に変わっても、新しい近傍が届くまで図は組み直さない。
  const [shown, setShown] = useState<{ view: ViewData; trail: string[] } | null>(null);
  const [heroView, setHeroView] = useState<ViewData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [viewError, setViewError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [pathData, setPathData] = useState<PathData | null>(null);
  const [pathError, setPathError] = useState(false);
  const [draft, setDraft] = useState<PathDraft>({ from: null, to: null, mode: route.path?.mode ?? "bfs" });
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  // 相手を選ぶ前の「つながりを調べる」は入力欄が本体なので、スマホでも開いた状態から始める。
  const [sheet, setSheet] = useState<Sheet>(route.pathOpen && !route.path ? "full" : "peek");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [hint, setHint] = useState(() => !seen("graph-hint"));
  const [announcement, setAnnouncement] = useState("");
  const { favorites, toggle: toggleFavorite } = useFavorites();
  const { history: visited, visit, clear: clearHistory, restore: restoreHistory } = useHistory();
  const { theme, toggle: toggleTheme } = useTheme();
  const narrow = useNarrow();
  useFocusRescue();
  const panelRef = useRef<HTMLElement>(null);
  const dragRef = useRef({ y: 0, moved: false });
  const bodyRef = useRef<HTMLDivElement>(null);
  // あとから呼ばれる処理（検索の結果、おまかせ など）が古い状態で動かないよう、最新の状態を持っておく。
  const live = useRef({ route, trail });
  live.current = { route, trail };
  const tab = route.game ? "game" : route.pathOpen ? "path" : "detail";

  // ---- URL と履歴（F-05）: 中心ノードを URL に持たせ、ブラウザの「戻る」で前の中心へ戻る ----
  const commit = useCallback((next: RouteState, nextTrail: string[], mode: "push" | "replace", opened = false) => {
    const url = location.pathname + serializeRoute(next);
    if (mode === "push") history.pushState({ trail: nextTrail, opened } satisfies HistoryState, "", url);
    else history.replaceState({ trail: nextTrail, opened: !!(history.state as HistoryState | null)?.opened } satisfies HistoryState, "", url);
    live.current = { route: next, trail: nextTrail };
    setRoute(next);
    setTrail(nextTrail);
  }, []);

  // ---- つながりタイムアタック ----
  const onPair = useCallback(
    (from: string, to: string) => commit({ ...EMPTY_ROUTE, game: { kind: "pair", from, to } }, [], "replace"),
    [commit],
  );
  const ta = useTimeAttack(route.game, onPair);
  const [taShowing, setTaShowing] = useState<"mine" | "shortest">("mine");
  const [taNote, setTaNote] = useState("");
  const taPhase = ta.state.phase;
  const inGame = !!route.game;
  const gameIntro = inGame && (taPhase === "lobby" || taPhase === "loading" || taPhase === "ready" || taPhase === "error");
  const openLobby = useCallback(() => {
    commit({ ...EMPTY_ROUTE, game: { kind: "lobby" } }, [], live.current.route.game ? "replace" : "push");
    setPicking(null);
  }, [commit]);
  useEffect(() => {
    setTaNote("");
    if (taPhase === "cleared" || taPhase === "gaveup") {
      setTaShowing(taPhase === "cleared" ? "mine" : "shortest");
      setSheet("half");
      setAnnouncement(taPhase === "cleared" ? "ゴールしました" : "ギブアップしました。最短の道を表示しています");
    } else if (taPhase === "playing") {
      setSheet("peek");
    }
  }, [taPhase]);

  const clearDraft = useCallback(() => setDraft((d) => ({ from: null, to: null, mode: d.mode })), []);

  useEffect(() => {
    const onPop = () => {
      const parsed = parseRoute(location.search);
      // 「戻る」で変わるのは中心だけ。段数と絞り込みは、いま選んでいるものを保つ（外した条件が勝手に戻らないように）。
      const before = live.current.route;
      const next = parsed.center || parsed.pathOpen ? { ...parsed, depth: before.depth, filter: before.filter } : parsed;
      if (next !== parsed) history.replaceState(history.state, "", location.pathname + serializeRoute(next));
      const nextTrail = initialTrail(next);
      live.current = { route: next, trail: nextTrail };
      setRoute(next);
      setTrail(nextTrail);
      setPicking(null);
      // 経路の無い画面へ戻ったら、入力欄も空にする（URL に経路があれば、下の処理が入れ直す）。
      if (!next.path) clearDraft();
      if (next.pathOpen && !next.path) setSheet("full");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [clearDraft]);

  /** ノードを中心にする。同じ中心なら履歴は積まない。前に通った地点なら、足跡をそこまで巻き戻す。 */
  const navigate = useCallback(
    (id: string) => {
      const { route, trail } = live.current;
      setPicking(null);
      if (id === route.center && !route.pathOpen) return;
      const at = trail.lastIndexOf(id);
      const nextTrail = at >= 0 ? trail.slice(0, at + 1) : [...trail, id].slice(-MAX_TRAIL);
      commit({ ...route, center: id, path: null, pathOpen: false }, nextTrail, "push");
      clearDraft();
    },
    [commit, clearDraft],
  );

  const jump = useCallback(
    (index: number) => {
      const { route, trail } = live.current;
      if (!trail[index]) return;
      commit({ ...route, center: trail[index], path: null, pathOpen: false }, trail.slice(0, index + 1), "push");
      clearDraft();
    },
    [commit, clearDraft],
  );

  const goHome = () => {
    commit(EMPTY_ROUTE, [], "push");
    setDraft({ from: null, to: null, mode: "bfs" });
    setPicking(null);
    setSheet("peek");
  };

  // ---- データ ----
  useEffect(() => {
    engine.meta().then(setMeta, (e: Error) => setBootError(e.message));
  }, []);

  useEffect(() => {
    setViewError(false);
    if (!route.center) {
      setShown(null);
      setNotFound(false);
      return;
    }
    let stale = false;
    engine.view(route.center, route.depth, route.filter).then(
      (v) => {
        if (stale) return;
        setNotFound(!v);
        setShown(v ? { view: v, trail: live.current.trail } : null);
        if (v) visit(v.center);
      },
      () => !stale && setViewError(true),
    );
    return () => {
      stale = true;
    };
  }, [route.center, route.depth, route.filter, trail, visit, attempt]);

  useEffect(() => {
    setPathData(null);
    setPathError(false);
    if (!route.path) return;
    let stale = false;
    engine.path(route.path.from, route.path.to, route.path.mode, route.filter).then(
      (p) => !stale && setPathData(p),
      () => !stale && setPathError(true),
    );
    return () => {
      stale = true;
    };
  }, [route.path, route.filter]);

  const atHome = !route.center && !route.pathOpen && !inGame;
  const heroId = heroOf(meta);
  const wantHero = !route.center && !inGame && !narrow && !!heroId;
  useEffect(() => {
    // トップ画面（と、中心が無いままの「つながりを調べる」）の相関図。スマホでは出さない。
    if (!wantHero || !heroId) return;
    let stale = false;
    engine.view(heroId, 1, DEFAULT_FILTER).then(
      (v) => !stale && setHeroView(v),
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [wantHero, heroId]);

  // パンくず・お気に入り・履歴・トップの入口・経路の端点の表示名と画像をまとめて引く。
  const wanted = useMemo(() => {
    const ids = new Set([...trail, ...favorites, ...visited, ...(meta?.featured ?? []), ...(meta?.featuredWorks ?? [])]);
    if (route.path) ids.add(route.path.from).add(route.path.to);
    return [...ids];
  }, [trail, favorites, visited, meta, route.path]);
  const briefs = useBriefs(wanted);
  const known = (ids: string[]) => ids.map((id) => briefs.get(id)).filter((b): b is NodeBrief => !!b);

  // URL の経路を、経路パネルの入力欄に反映する（共有 URL を開いたとき・戻るで戻ったとき）。
  // undefined はまだ引いている途中、null はデータに無い ID。
  const pathFrom = route.path ? briefs.get(route.path.from) : undefined;
  const pathTo = route.path ? briefs.get(route.path.to) : undefined;
  const pathMode = route.path?.mode;
  const pathMissing = !!route.path && (pathFrom === null || pathTo === null);
  useEffect(() => {
    if (pathMode && pathFrom !== undefined && pathTo !== undefined) setDraft({ from: pathFrom, to: pathTo, mode: pathMode });
  }, [pathFrom, pathTo, pathMode]);

  // ---- 経路 ----
  const updateDraft = (next: PathDraft) => {
    const { route, trail } = live.current;
    setDraft(next);
    setPicking(null);
    if (next.from && next.to && next.from.id !== next.to.id) {
      const path = { from: next.from.id, to: next.to.id, mode: next.mode };
      // 「つながりを調べる」を開いたときに履歴を積んであるので、端点や探し方の変更は置き換えにする。
      commit({ ...route, path, pathOpen: true }, trail, route.pathOpen ? "replace" : "push", true);
      // スマホでは、結果の図と要約の両方が見える高さにする。
      setSheet("half");
    } else if (route.path) {
      commit({ ...route, path: null, pathOpen: true }, trail, "replace");
    }
  };

  /** 「つながりを調べる」を開く。始点を指定しなければ、今の中心を始点にする。 */
  const openPath = (from?: NodeBrief | null, to?: NodeBrief | null) => {
    const { route, trail } = live.current;
    if (from && to) {
      setDraft({ from, to, mode: draft.mode });
      commit({ ...route, path: { from: from.id, to: to.id, mode: draft.mode }, pathOpen: true }, trail, "push", true);
      setSheet("half");
      return;
    }
    const center = route.center ? briefs.get(route.center) : undefined;
    const start = from ?? (!draft.from && !draft.to ? center : undefined);
    if (start) setDraft({ ...draft, from: start });
    if (!route.pathOpen) commit({ ...route, pathOpen: true }, trail, "push", true);
    setSheet("full");
    setAnnouncement("「つながりを調べる」を開きました");
    requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
  };

  const clearPath = () => {
    const { route, trail } = live.current;
    clearDraft();
    setPicking(null);
    if (route.path) commit({ ...route, path: null, pathOpen: true }, trail, "replace");
  };

  /** 「つながりを調べる」を閉じる。開いたときに積んだ履歴なら 1 つ戻り、そうでなければその場で閉じる。 */
  const closePath = () => {
    const { route, trail } = live.current;
    setPicking(null);
    clearDraft();
    setSheet("peek");
    if ((history.state as HistoryState | null)?.opened) history.back();
    else commit({ ...route, path: null, pathOpen: false }, trail, "replace");
  };

  const dismissHint = () => {
    if (!hint) return;
    setHint(false);
    markSeen("graph-hint");
  };

  const onNodeClick = (node: SceneNode) => {
    if (inGame) {
      if (taPhase !== "playing") return;
      if (node.kind === "more") {
        // 図に描ききれない隣は、一覧から選ぶ。
        setSheet("full");
        requestAnimationFrame(() => document.getElementById("ta-filter")?.focus());
        return;
      }
      setTaNote(ta.moveTo(node.id) ? "" : "ここへは、今いるところから直接は進めません");
      return;
    }
    dismissHint();
    if (picking) {
      // 「他 N 件」は端点にできない。押しても、選んでいる途中の状態を崩さない。
      if (node.kind === "more") return;
      // もう片方の端と同じノードは選べない（選ぶ状態のまま、別のノードを待つ）。
      const other = picking === "from" ? draft.to : draft.from;
      if (other?.id === node.id) return;
      updateDraft({ ...draft, [picking]: { id: node.id, label: node.label, kind: node.kind, image: node.image } });
      return;
    }
    navigate(node.target);
    if (node.kind === "more") setSheet("full");
  };

  const random = () => {
    void engine.randomVoiceActor().then((id) => id && navigate(id));
  };

  // Esc: 図から選ぶのをやめる。スマホでは、開いているシートを畳む。
  useEffect(() => {
    if (!picking && !(narrow && sheet !== "peek")) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("dialog[open], .popover")) return;
      if (picking) setPicking(null);
      else setSheet("peek");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking, narrow, sheet]);

  // ---- 場面 ----
  const showingPath = !!route.path && !!pathData?.found;
  const scene = useMemo(() => {
    // シートを半分まで開いたスマホでは図の枠が横長になるので、縦長向けの配置にしない。
    const layout = { portrait: narrow && sheet !== "half" };
    if (inGame) {
      const { puzzle, view, route: walked } = ta.state;
      if (!puzzle) return null;
      if (taPhase === "cleared" || taPhase === "gaveup") {
        const nodes = taShowing === "mine" ? walked.map(ta.briefOf) : puzzle.shortest;
        return sceneFromPath({ found: true, nodes, hops: nodes.length - 1, costar: 0, visited: 0, ms: 0 }, layout);
      }
      if (taPhase !== "playing" || !view) return null;
      const base = sceneFromView(view, walked, layout);
      // ゴールが図に入っていたら、ひと目でわかるよう目立たせる。
      return { ...base, nodes: base.nodes.map((n) => (n.id === puzzle.to.id ? { ...n, emphasis: "end" as const, forceLabel: true } : n)) };
    }
    if (route.path && pathData?.found) return sceneFromPath(pathData, layout);
    if (route.center) return shown ? sceneFromView(shown.view, shown.trail, layout) : null;
    // トップ画面（と、中心が無いままの経路画面）では日替わりの相関図を見せる。
    return heroView && !narrow ? sceneFromView(heroView, []) : null;
  }, [route.path, route.center, pathData, shown, heroView, narrow, sheet, inGame, ta.state, ta.briefOf, taPhase, taShowing]);

  const centerBrief = route.center ? briefs.get(route.center) : undefined;
  const sameEnds = !!route.path && route.path.from === route.path.to;
  useEffect(() => {
    document.title = inGame
      ? "つながりタイムアタック | CVerse"
      : route.path && pathFrom && pathTo && !sameEnds
      ? `${pathFrom.label} と ${pathTo.label} のつながり | CVerse`
      : route.pathOpen && !centerBrief
        ? "つながりを調べる | CVerse"
        : centerBrief
          ? `${centerBrief.label} の相関図 | CVerse`
          : "CVerse | 声優・キャラ・作品の相関図";
  }, [centerBrief, route.path, route.pathOpen, pathFrom, pathTo, sameEnds, inGame]);

  // 中心が変わったら、読み上げで知らせ、詳細を先頭から見せる。押した項目が消えてフォーカスの行き場が
  // 無くなったときは、詳細パネルへ移す（キーボードで続けて辿れるように）。
  const announced = useRef(route.center);
  useEffect(() => {
    if (!centerBrief || announced.current === centerBrief.id) return;
    announced.current = centerBrief.id;
    setAnnouncement(`${centerBrief.label}を中心に表示しました`);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    const frame = requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body) panelRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [centerBrief]);

  const setDepth = (depth: number) => commit({ ...live.current.route, depth }, live.current.trail, "replace");
  const setFilter = (filter: Filter) => commit({ ...live.current.route, filter }, live.current.trail, "replace");
  const filtered = !isDefaultFilter(route.filter);
  const suggestionKey = [...new Set([...visited, ...favorites])].slice(0, 8).join("\n");
  const suggestions = useMemo(
    () => (suggestionKey ? suggestionKey.split("\n") : []).map((id) => briefs.get(id)).filter((b): b is NodeBrief => !!b),
    // briefs は同じ Map を使い回すので、中身が届いたことは件数の変化で拾う。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [suggestionKey, briefs, briefs.size],
  );
  const crumbs: Crumb[] = trail.flatMap((id, index) => {
    const node = briefs.get(id);
    return node ? [{ node, index }] : [];
  });

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
  const sheetTitle = tab === "game" ? "つながりタイムアタック" : tab === "path" ? "つながりを調べる" : (centerBrief?.label ?? "詳細");
  const sheetOpen = sheet !== "peek";
  // シートのつまみ: 押すと開閉、上下に引くと 1 段ずつ動く。
  const drag = dragRef.current;
  const order: Sheet[] = ["peek", "half", "full"];
  const stepSheet = (by: number) => setSheet(order[Math.max(0, Math.min(order.length - 1, order.indexOf(sheet) + by))]);
  const pathHeadline = showingPath && pathData ? pathSummary(pathData, pathFrom, pathTo) : "";
  return (
    <div className={`app${atHome || gameIntro ? " app--home" : ""}${inGame ? " app--game" : ""} app--sheet-${sheet}`}>
      <a
        className="skip-link"
        href={atHome || gameIntro ? "#home" : "#panel"}
        onClick={(e) => {
          // URL に #panel を足すと「戻る」が 1 回ぶん空振りするので、フォーカスだけ移す。
          e.preventDefault();
          (atHome || gameIntro ? document.getElementById("home") : panelRef.current)?.focus();
        }}
      >
        本文へ移動
      </a>
      <p className="sr-only" role="status">
        {announcement}
      </p>
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
        {!atHome && !inGame && (
          <SearchBox
            label="声優・キャラ・作品を検索"
            placeholder={narrow ? "名前で検索" : "声優・キャラ・作品を検索"}
            onPick={(n) => navigate(n.id)}
            suggestions={suggestions}
            suggestionsLabel="最近見た・お気に入り"
            hotkey
          />
        )}
        <nav className="topbar__nav" aria-label="メニュー">
          {inGame && <span className="topbar__title">つながりタイムアタック</span>}
          {!atHome && !inGame && (
            <button
              type="button"
              className={`nav-button${tab === "path" ? " is-on" : ""}`}
              aria-pressed={tab === "path"}
              aria-label="つながりを調べる"
              title="つながりを調べる"
              onClick={() => (tab === "path" ? closePath() : openPath())}
            >
              <Icon name="route" />
              <span className="nav-button__label" aria-hidden="true">
                つながりを調べる
              </span>
            </button>
          )}
          <MyList
            favorites={known(favorites)}
            history={known(visited)}
            onPick={navigate}
            onRemoveFavorite={toggleFavorite}
            onClearHistory={clearHistory}
            onRestoreHistory={restoreHistory}
            historyIds={visited}
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

      <main
        className="stage"
        // スマホ: シートをいっぱいに開いているとき、上に見えている図を押したら畳む。
        onPointerDown={narrow && sheet === "full" && !atHome ? () => setSheet("peek") : undefined}
      >
        {atHome ? (
          <Home
            meta={meta}
            featured={known(meta?.featured ?? [])}
            featuredWorks={known(meta?.featuredWorks ?? [])}
            favorites={known(favorites)}
            history={known(visited)}
            hero={narrow ? null : hero}
            compact={narrow}
            onNavigate={navigate}
            onRandom={random}
            onPath={openPath}
            onTimeAttack={openLobby}
            onAbout={() => setAboutOpen(true)}
          />
        ) : gameIntro ? (
          <TimeAttackIntro state={ta.state} onGenerate={ta.generate} onStart={ta.start} onLobby={openLobby} />
        ) : inGame ? (
          <>
            {scene && <Legend />}
            <div className="stage__notes" aria-live="polite">
              {taPhase === "playing" && !ta.state.view && <p className="note">読み込み中…</p>}
              {taNote && (
                <p className="note note--accent">
                  {taNote}
                  <button type="button" className="link" onClick={() => setTaNote("")}>
                    閉じる
                  </button>
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="stage__top">
              {!showingPath && route.center && !notFound && <Breadcrumbs crumbs={crumbs} current={trail.length - 1} onJump={jump} />}
              {!showingPath && route.center && !notFound && <Controls depth={route.depth} onDepth={setDepth} filter={route.filter} onFilter={setFilter} />}
              {!route.center && !showingPath && hero && scene && (
                <p className="stage__caption">
                  今日の相関図: <strong>{hero.label}</strong>
                </p>
              )}
            </div>
            {scene && <Legend />}
            {!scene && !notFound && !viewError && !route.path && (route.center || !narrow) && <Loader />}
            {notFound && !route.pathOpen && (
              <div className="stage__empty" role="alert">
                <h1>このページは見つかりませんでした</h1>
                <p>データの更新で、名前や ID が変わった可能性があります。上の検索欄から探し直してください。</p>
                <button type="button" className="button button--primary" onClick={goHome}>
                  トップへ戻る
                </button>
              </div>
            )}
            <div className="stage__notes" aria-live="polite">
              {picking && (
                <p className="note note--accent">
                  {picking === "from" ? "始点" : "終点"}にするアイコンを押してください
                  <button type="button" className="link" onClick={() => setPicking(null)}>
                    やめる
                  </button>
                </p>
              )}
              {viewError && (
                <p className="note" role="alert">
                  相関図を読み込めませんでした。
                  <button type="button" className="link" onClick={() => setAttempt((n) => n + 1)}>
                    もう一度読み込む
                  </button>
                </p>
              )}
              {shown && route.center && !notFound && !showingPath && shown.view.center === route.center && shown.view.nodes.length === 1 && (
                <p className="note">
                  {filtered ? "この条件ではつながる相手がいません。" : "つながる相手が、まだデータにありません。"}
                  {filtered && (
                    <button type="button" className="link" onClick={() => setFilter(DEFAULT_FILTER)}>
                      絞り込みを外す
                    </button>
                  )}
                </p>
              )}
              {hint && scene && route.center && !showingPath && !picking && !notFound && (
                <p className="note">
                  顔や作品を押すと、そこを中心に図が広がります
                  <button type="button" className="link" onClick={dismissHint}>
                    わかった
                  </button>
                </p>
              )}
            </div>
          </>
        )}
        {/* 図は最後に置く（Tab の順番を、左上の操作 → 図の拡大・縮小 の順にするため）。 */}
        <ErrorBoundary name="相関図">
          <GraphView
            scene={scene}
            onNodeClick={onNodeClick}
            picking={picking !== null}
            theme={theme}
            zoomControls={!atHome && !gameIntro && !!scene && !(narrow && sheet === "full")}
            label={
              inGame
                ? "つながりタイムアタックの相関図。押したアイコンへ進みます。進める先は一覧にもあります。"
                : showingPath
                ? "2 つをつなぐ道の図。内容は「つながりを調べる」の一覧にもあります。"
                : `${(route.center ? centerBrief?.label : hero?.label) ?? ""}の相関図。${
                    route.depth > 1 ? "直接つながる相手は詳細の一覧にもあります。" : "内容は詳細の一覧にもあります。"
                  }`
            }
          />
        </ErrorBoundary>
      </main>

      {!atHome && !gameIntro && (
        <aside className="panel" id="panel" aria-label={sheetTitle} tabIndex={-1} ref={panelRef}>
          <button
            type="button"
            className="panel__handle"
            aria-expanded={sheetOpen}
            aria-label={`${sheetTitle}（${sheetOpen ? "閉じる" : "開く"}）`}
            onPointerDown={(e) => {
              drag.y = e.clientY;
              drag.moved = false;
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerUp={(e) => {
              const dy = e.clientY - drag.y;
              if (Math.abs(dy) < 24) return;
              drag.moved = true;
              // 大きく引いたら 2 段ぶん動かす。
              stepSheet((dy < 0 ? 1 : -1) * (Math.abs(dy) > window.innerHeight * 0.45 ? 2 : 1));
            }}
            onKeyDown={(e) => {
              if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
              e.preventDefault();
              stepSheet(e.key === "ArrowUp" ? 1 : -1);
            }}
            onClick={() => {
              if (drag.moved) {
                drag.moved = false;
                return;
              }
              setSheet(sheet === "full" ? "peek" : "full");
            }}
          >
            <span className="panel__grip" aria-hidden="true" />
            <span className="panel__peek">
              {tab === "game" && ta.state.puzzle ? (
                <span className="panel__peek-text">
                  <strong>
                    {taPhase === "playing" ? <Timer startedAt={ta.state.startedAt} endedAt={0} /> : taPhase === "cleared" ? "ゴール！" : "ギブアップ"}
                  </strong>
                  <small>ゴール: {ta.state.puzzle.to.label}</small>
                </span>
              ) : tab === "detail" && centerBrief ? (
                <>
                  <Thumb kind={centerBrief.kind} src={centerBrief.image} label={centerBrief.label} size={28} />
                  <span className="panel__peek-text">
                    <strong>{centerBrief.label}</strong>
                    <small>{centerBrief.kind === "more" ? "" : KIND_LABEL[centerBrief.kind]}の詳細</small>
                  </span>
                </>
              ) : (
                <span className="panel__peek-text">
                  <strong>{sheetTitle}</strong>
                  {pathHeadline && <small>{pathHeadline}</small>}
                </span>
              )}
              <Icon name="chevron" size={16} />
            </span>
          </button>
          <div className="panel__body" ref={bodyRef} inert={narrow && !sheetOpen}>
            <ErrorBoundary name={tab === "path" ? "つながり" : "詳細"} resetKey={`${tab}:${route.center}`}>
              {tab === "game" ? (
                <TimeAttackPanel
                  state={ta.state}
                  briefOf={ta.briefOf}
                  onStep={ta.step}
                  onBack={ta.back}
                  onGiveUp={ta.giveUp}
                  onRetry={ta.retry}
                  onLobby={openLobby}
                  showing={taShowing}
                  onShowing={setTaShowing}
                  shareUrl={ta.state.puzzle ? `${location.origin}${location.pathname}?ta=${ta.state.puzzle.from.id}~${ta.state.puzzle.to.id}` : location.href}
                />
              ) : tab === "path" ? (
                <PathPanel
                  draft={draft}
                  onDraft={updateDraft}
                  result={route.path ? pathData : null}
                  searching={!!route.path && !pathData && !pathError && !pathMissing}
                  failed={pathError}
                  missing={pathMissing}
                  filtered={filtered}
                  onClearFilter={() => setFilter(DEFAULT_FILTER)}
                  onClose={closePath}
                  picking={picking}
                  onPicking={(which) => {
                    setPicking(which);
                    if (which) setSheet("peek");
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
                  filtered={filtered}
                  onClearFilter={() => setFilter(DEFAULT_FILTER)}
                />
              ) : (
                <p className="panel__msg">{notFound ? "上の検索欄から、声優・キャラ・作品を探せます。" : ""}</p>
              )}
            </ErrorBoundary>
          </div>
        </aside>
      )}
      <About open={aboutOpen} onClose={() => setAboutOpen(false)} meta={meta} />
    </div>
  );
}
