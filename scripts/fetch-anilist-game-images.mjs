#!/usr/bin/env node
/**
 * 主要ゲームのキャラに、AniList のキャラ画像を付ける（docs/data-schema.md の形式）。
 *
 *   node scripts/fetch-anilist-game-images.mjs [--out data/source] [--refresh]
 *
 * - ゲームのキャラは日本語版 Wikipedia から取っているので画像がない。AniList にはゲームそのものは載らないが、
 *   アンソロジーコミック・PV・短編アニメ・楽曲 MV など、関連作品のキャラとして多くのゲームキャラが登録されている
 * - ゲームごとに関連作品を探し（作品名がゲームの名前に合うものだけ）、その作品のキャラから同じ人物を探す
 * - 同じ人物とみなすのは、名前（日本語名・別名）が正規化して一致するとき。片方がもう片方を含むだけのとき
 *   （「ホシノ」と「小鳥遊ホシノ」）は、日本語の声優も一致したときだけ。「〔オルタ〕」「丹恒・飲月」などの別の姿は、
 *   名前の一部だけでは元の姿と合わせない
 * - 画像のほか、AniList のページを出典に足す。キャラの ID は変えない（ch:wp- のまま。アニメ側に同じ人物がいてもまとめない）
 * - fetch-wikipedia-games.mjs のあとに実行する。何度実行しても同じ結果になる
 * - AniList の応答は scripts/.cache/ に置いて使い回す。取り直すときは `--refresh`
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  const value = args[at + 1];
  if (value === undefined || value === "" || value.startsWith("--")) {
    console.error(`${name} には値を指定してください`);
    process.exit(1);
  }
  return value;
};
const OUT = option("--out", join(here, "..", "data", "source"));
const REFRESH = args.includes("--refresh");
const CACHE = join(here, ".cache");
const API = "https://graphql.anilist.co";
const today = new Date().toISOString().slice(0, 10);

/**
 * ゲームごとの、関連作品を探す語と、作品名がそのゲームのものかを見分ける式。
 * 検索は英語名でもかかるようにする。式は日本語名・英語名・ローマ字・中国語名のどれかに合えばよい。
 */
export const GAMES = [
  { id: "wk:wp-fgo", search: ["Fate/Grand Order"], title: /Fate\/Grand (Order|Carnival)|FGO/i },
  { id: "wk:wp-umamusume", search: ["Uma Musume", "ウマ娘"], title: /ウマ娘|Uma Musume/i },
  { id: "wk:wp-genshin", search: ["Genshin", "原神"], title: /原神|Genshin/i },
  { id: "wk:wp-starrail", search: ["Star Rail", "星穹铁道"], title: /スターレイル|Star Rail|星穹[铁鐵]道/i },
  { id: "wk:wp-zzz", search: ["Zenless Zone Zero", "绝区零"], title: /ゼンレスゾーンゼロ|Zenless|[绝絕]区零/i },
  { id: "wk:wp-bluearchive", search: ["Blue Archive", "ブルーアーカイブ"], title: /ブルーアーカイブ|ブルアカ|Blue Archive/i },
  { id: "wk:wp-pjsekai", search: ["Project Sekai", "プロジェクトセカイ"], title: /プロジェクトセカイ|プロセカ|Project ?Sekai|Colorful Stage/i },
  { id: "wk:wp-gakumas", search: ["Gakuen Idolmaster", "学園アイドルマスター"], title: /学園アイドルマスター|Gakuen ?Idolm@?aster|学マス/i },
  { id: "wk:wp-nikke", search: ["NIKKE"], title: /NIKKE/i },
];

const MEDIA_QUERY = `query ($search: String, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(search: $search) { id type format title { romaji english native } synonyms }
  }
}`;

const CHARACTERS_QUERY = `query ($id: Int, $page: Int) {
  Media(id: $id) {
    characters(page: $page, perPage: 25) {
      pageInfo { hasNextPage }
      edges {
        node { id name { full native alternative } image { large } }
        voiceActors(language: JAPANESE) { id }
      }
    }
  }
}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastCall = 0;

/** API を 1 回呼ぶ。応答は問い合わせの内容ごとにキャッシュする（fetch-anilist.mjs と同じ作り）。 */
async function call(query, variables) {
  const key = createHash("sha1").update(query + JSON.stringify(variables)).digest("hex").slice(0, 16);
  const file = join(CACHE, `${key}.json`);
  if (!REFRESH) {
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch {
      // キャッシュに無ければ取りに行く。
    }
  }
  for (let attempt = 1; attempt <= 6; attempt++) {
    await sleep(Math.max(0, lastCall + 2200 - Date.now()));
    lastCall = Date.now();
    let response;
    try {
      response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables }),
      });
    } catch (error) {
      console.warn(`  通信に失敗（${attempt} 回目）: ${error.message}`);
      await sleep(5000 * attempt);
      continue;
    }
    if (response.status === 429) {
      const wait = Number(response.headers.get("retry-after") ?? 60) + 1;
      console.warn(`  回数の上限に当たったので ${wait} 秒待ちます`);
      await sleep(wait * 1000);
      continue;
    }
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.data || body.errors?.length) {
      console.warn(`  応答が不正（${response.status}、${attempt} 回目）`);
      await sleep(5000 * attempt);
      continue;
    }
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, JSON.stringify(body.data));
    return body.data;
  }
  throw new Error("AniList から取得できませんでした");
}

export const norm = (s) =>
  (s ?? "")
    .normalize("NFKC")
    .replace(/[\s　・=＝.·]/g, "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/﨑/g, "崎")
    .replace(/髙/g, "高")
    .toLowerCase();

/** ゲームの関連作品（作品名がゲームのものと合う作品）を探す。 */
async function relatedMedia(game) {
  const found = new Map();
  for (const search of game.search) {
    for (let page = 1; page <= 4; page++) {
      const data = await call(MEDIA_QUERY, { search, page });
      for (const m of data.Page.media) {
        const titles = [m.title.romaji, m.title.english, m.title.native, ...(m.synonyms ?? [])].filter(Boolean);
        if (titles.some((t) => game.title.test(t))) found.set(m.id, m);
      }
      if (!data.Page.pageInfo.hasNextPage) break;
    }
  }
  return [...found.values()];
}

/** 作品のキャラを全部取る。 */
async function mediaCharacters(id) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const data = await call(CHARACTERS_QUERY, { id, page });
    const chars = data.Media?.characters;
    if (!chars) break;
    out.push(...chars.edges);
    if (!chars.pageInfo.hasNextPage) break;
  }
  return out;
}

/** 「沖田総司〔オルタ〕」のような別の姿の名前か。別の姿は見た目が違うので、名前の一部だけでは合わせない。 */
export const isForm = (name) => /[〔［\[]/.test(name ?? "");
/**
 * `name` が `base` の別の姿か（「丹恒・飲月」と「丹恒」、「スカサハ＝スカディ」と「スカサハ」）。
 * 区切りの後ろに名前が続く形だけを見るので、「キャプテン・ネモ」と「ネモ」のような普通の名前は別の姿とみなさない。
 */
export const isFormOf = (name, base) =>
  Boolean(base) && name.length > base.length && name.startsWith(base) && /^[・＝=]/.test(name.slice(base.length));

/**
 * ゲームのキャラ 1 人に合う AniList のキャラを選ぶ。
 * 名前が一致すればそれ。含むだけなら、声優も一致して、候補が 1 人に絞れるときだけ。
 */
export function pick(name, vaAnilistIds, candidates) {
  const n = norm(name);
  if (!n) return null;
  const exact = candidates.filter((c) => c.names.includes(n));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    const byVa = exact.filter((c) => c.vas.some((v) => vaAnilistIds.has(v)));
    return byVa.length === 1 ? byVa[0] : null;
  }
  if (Array.from(n).length < 2 || isForm(name)) return null;
  const partial = candidates.filter(
    (c) =>
      c.vas.some((v) => vaAnilistIds.has(v)) &&
      !c.raw.some((r) => isForm(r) || isFormOf(name, r)) &&
      c.names.some((m) => Array.from(m).length >= 2 && (m.includes(n) || n.includes(m))),
  );
  return partial.length === 1 ? partial[0] : null;
}

async function main() {
  const readJson = async (name) => JSON.parse(await readFile(join(OUT, name), "utf8"));
  const [characters, casts, voiceActors] = await Promise.all(["characters.json", "casts.json", "voice_actors.json"].map(readJson));
  const byId = new Map(characters.map((c) => [c.id, c]));
  const vaAnilist = new Map(voiceActors.filter((v) => v.anilistId).map((v) => [v.id, v.anilistId]));

  const loose = [];
  let total = 0;
  let added = 0;
  console.log("ゲームごとの画像:");
  for (const game of GAMES) {
    // このゲームに配役があり、まだ画像のないキャラ（Wikipedia 由来のもの）。
    const targets = new Map();
    for (const cast of casts) {
      if (cast.medium !== "game" || cast.work !== game.id) continue;
      const ch = byId.get(cast.character);
      if (!ch || !ch.id.startsWith("ch:wp-")) continue;
      const entry = targets.get(ch.id) ?? { ch, vas: new Set() };
      const al = vaAnilist.get(cast.voiceActor);
      if (al) entry.vas.add(al);
      targets.set(ch.id, entry);
    }
    total += targets.size;

    const media = await relatedMedia(game);
    const candidates = new Map();
    for (const m of media) {
      for (const edge of await mediaCharacters(m.id)) {
        const node = edge.node;
        if (!node.image?.large || /\/default\.(jpg|png)$/.test(node.image.large)) continue;
        const c = candidates.get(node.id) ?? {
          id: node.id,
          image: node.image.large,
          label: node.name.native ?? node.name.full,
          raw: [node.name.native, node.name.full, ...(node.name.alternative ?? [])].filter(Boolean),
          names: [...new Set([node.name.native, node.name.full, ...(node.name.alternative ?? [])].map(norm).filter(Boolean))],
          vas: [],
        };
        for (const va of edge.voiceActors ?? []) if (!c.vas.includes(va.id)) c.vas.push(va.id);
        candidates.set(node.id, c);
      }
    }

    let hit = 0;
    for (const { ch, vas } of targets.values()) {
      const found = pick(ch.name, vas, [...candidates.values()]);
      // 前回付けた AniList の画像と出典は、付け直す前に外す。
      ch.sources = (ch.sources ?? []).filter((s) => s.source !== "anilist");
      if (ch.image?.source === "anilist") delete ch.image;
      delete ch.anilistId;
      if (!found) continue;
      hit++;
      if (!found.names.includes(norm(ch.name))) loose.push(`${ch.name} → ${found.label}`);
      // アニメ側にも同じ人物（「Fate/Zero」のイスカンダルなど）がいることがあるが、まとめない。
      // 公開済みの ch:wp- の ID は URL とお気に入りに使われているので、消さずに残す。
      const pageUrl = `https://anilist.co/character/${found.id}`;
      ch.anilistId = found.id;
      ch.image = { url: found.image, source: "anilist", pageUrl, license: null, attribution: null };
      ch.sources.push({ source: "anilist", url: pageUrl, fetchedAt: today });
    }
    added += hit;
    console.log(`  ${game.id}: 関連作品 ${media.length}、候補 ${candidates.size} 人、画像を付けた ${hit} / ${targets.size}`);
  }

  await writeFile(join(OUT, "characters.json"), `[\n${characters.map((item) => JSON.stringify(item)).join(",\n")}\n]\n`);
  if (loose.length) console.log(`名前の一部と声優で合わせたもの ${loose.length} 件:\n  ${loose.join("\n  ")}`);
  console.log(`画像を付けた: ${added} / ${total}（Wikipedia 由来のゲームキャラ）→ ${OUT}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
