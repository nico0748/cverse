import type { Handlers } from "../worker/engine.worker";
import type { Difficulty } from "./timeattack";
import { filterArgs, type Filter, type Meta, type NodeBrief, type PathData, type PathMode, type ViewData } from "./types";

/** Web Worker 上のグラフエンジンを Promise で呼ぶ薄いクライアント。 */
class EngineClient {
  private worker = new Worker(new URL("../worker/engine.worker.ts", import.meta.url), { type: "module" });
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private seq = 0;
  private ready: Promise<Meta>;

  constructor() {
    this.worker.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.error !== undefined) p.reject(new Error(e.data.error));
      else p.resolve(e.data.result);
    };
    // Worker 自体が読み込めなかった・落ちたときは、待っている呼び出しをすべて失敗にする
    // （そのままだと、画面が「読み込み中」のまま止まる）。
    const fail = (message: string) => {
      const error = new Error(message);
      for (const p of this.pending.values()) p.reject(error);
      this.pending.clear();
    };
    this.worker.onerror = (e) => fail(e.message || "グラフエンジンを読み込めませんでした");
    this.worker.onmessageerror = () => fail("グラフエンジンとの通信に失敗しました");
    this.ready = this.call("boot", import.meta.env.BASE_URL);
    this.ready.catch(() => {});
  }

  private call<M extends keyof Handlers>(method: M, ...args: Parameters<Handlers[M]>) {
    return new Promise<Awaited<ReturnType<Handlers[M]>>>((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ id, method, args });
    });
  }

  meta(): Promise<Meta> {
    return this.ready;
  }

  async view(center: string, depth: number, filter: Filter): Promise<ViewData | null> {
    await this.ready;
    return this.call("view", center, depth, filterArgs(filter));
  }

  async path(from: string, to: string, mode: PathMode, filter: Filter): Promise<PathData> {
    await this.ready;
    return this.call("path", from, to, mode, filterArgs(filter));
  }

  /** `kindMask` は絞り込む種類のビット（声優 1・キャラ 2・作品 4。0 は全種類）。 */
  async search(query: string, limit = 12, kindMask = 0): Promise<NodeBrief[]> {
    await this.ready;
    return this.call("search", query, kindMask, limit);
  }

  async briefs(ids: string[]): Promise<(NodeBrief | null)[]> {
    await this.ready;
    return this.call("briefs", ids);
  }

  /** 隣のノード（種類と人気の順）。 */
  async neighbors(id: string): Promise<NodeBrief[]> {
    await this.ready;
    return this.call("neighborList", id);
  }

  /** 2 つのノードで 1 問作る（最短経路で解けなければ null）。 */
  async puzzleOf(from: string, to: string) {
    await this.ready;
    return this.call("puzzleOf", from, to);
  }

  /** 難易度に合う 1 問を作る。`seed` を渡すと同じ問題になる（今日の 1 問）。 */
  async makePuzzle(difficulty: Difficulty, seed: string | null = null) {
    await this.ready;
    return this.call("makePuzzle", difficulty, seed);
  }

  async randomVoiceActor(): Promise<string | null> {
    await this.ready;
    return this.call("randomVoiceActor");
  }
}

export const engine = new EngineClient();
