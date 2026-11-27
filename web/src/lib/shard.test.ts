import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDetail, peekDetail } from "./shard";
import type { Meta } from "./types";

describe("peekDetail", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("シャードを読み終える前は undefined、読み終えたら同じ詳細を同期で返す（無い id は null）", async () => {
    const detail = { id: "va:1", kind: "va", name: "テスト" };
    const fetch = vi.fn(async () => new Response(JSON.stringify({ "va:1": detail })));
    vi.stubGlobal("fetch", fetch);
    const meta = { shardCount: 1 } as Meta;
    expect(peekDetail(meta, "va:1")).toBeUndefined();
    const loaded = await loadDetail(meta, "va:1");
    expect(peekDetail(meta, "va:1")).toBe(loaded);
    expect(peekDetail(meta, "va:2")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
