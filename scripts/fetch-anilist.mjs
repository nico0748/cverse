#!/usr/bin/env node
/**
 * AniList から人気アニメの配役を取得して、data/source/ に収集データ（docs/data-schema.md の形式）を書き出す。
 *
 *   node scripts/fetch-anilist.mjs [--works 300] [--cast-pages 2] [--out data/source]
 *
 * - 人気順に上位 `--works` 本のアニメを取り、作品ごとにキャラと日本語版の声優を集める
 * - キャラは 1 作品あたり 25 人 × `--cast-pages` ページまで（主役が先、次に人気順）
 * - AniList の API は 1 分あたりの回数に上限があるので、間隔を空け、上限に当たったら待ってやり直す
 * - 取得した応答は scripts/.cache/ に置き、途中で止まってもやり直せる。新しい内容に取り直すときは `--refresh`
 * - 画像は URL だけを記録する（サイトは保存せず直接参照する）。AniList の画像は各権利者のもので、
 *   再利用のライセンスは無いので `license` は null にする
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toHiragana } from "./romaji.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const WORKS = Number(option("--works", 300));
const CAST_PAGES = Number(option("--cast-pages", 2));
const OUT = option("--out", join(here, "..", "data", "source"));
// 数でない値を渡されたまま進むと、何も取得せずに空のデータで上書きしてしまう。
for (const [name, value] of [["--works", WORKS], ["--cast-pages", CAST_PAGES]]) {
  if (!Number.isSafeInteger(value) || value < 1) {
    console.error(`${name} には 1 以上の整数を指定してください`);
    process.exit(1);
  }
}
const REFRESH = args.includes("--refresh");
const CACHE = join(here, ".cache");
const API = "https://graphql.anilist.co";
const today = new Date().toISOString().slice(0, 10);

const CHARACTERS = `
  pageInfo { hasNextPage }
  edges {
    role
    node { id name { native full first last alternative } image { large } favourites siteUrl }
    voiceActors(language: JAPANESE) { id name { native full first last } image { large } favourites siteUrl }
  }`;

const LIST_QUERY = `query ($page: Int) {
  Page(page: $page, perPage: 10) {
    pageInfo { hasNextPage }
    media(type: ANIME, sort: POPULARITY_DESC, countryOfOrigin: "JP", isAdult: false) {
      id format popularity siteUrl
      title { native romaji english }
      startDate { year }
      coverImage { large }
      relations { edges { relationType node { id type } } }
      characters(page: 1, perPage: 25, sort: [ROLE, FAVOURITES_DESC]) {${CHARACTERS}
      }
    }
  }
}`;

const CAST_QUERY = `query ($id: Int, $page: Int) {
  Media(id: $id) {
    characters(page: $page, perPage: 25, sort: [ROLE, FAVOURITES_DESC]) {${CHARACTERS}
    }
  }
}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastCall = 0;

/** API を 1 回呼ぶ。応答は問い合わせの内容ごとにキャッシュする。 */
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
    // 1 分 30 回の上限に収まるよう、2.2 秒は空ける。
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
    // GraphQL は、エラーがあっても一部のデータを返すことがある。欠けた応答をキャッシュして使い回さない。
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

const FORMATS = new Set(["TV", "TV_SHORT", "MOVIE", "OVA", "ONA", "SPECIAL"]);
const RELATIONS = new Set(["SEQUEL", "PREQUEL", "SIDE_STORY", "SPIN_OFF", "ALTERNATIVE"]);
const isKana = (s) => /^[぀-ヿ・ー\s・＝=]+$/.test(s);
const clean = (s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
const image = (url, pageUrl) => (url && !/\/default\.(jpg|png)$/.test(url) ? { url, source: "anilist", pageUrl, license: null, attribution: null } : undefined);
const source = (url) => [{ source: "anilist", url, fetchedAt: today }];

/** 人名の読み。かなの名前はそのまま、漢字の名前はローマ字（姓・名）から起こす。 */
function personReading(name) {
  const native = clean(name.native);
  if (native && isKana(native)) return native;
  // 姓と名は別々にかなへ直す（つなげてから直すと「Shin」+「Yuuki」が「しにゅうき」になる）。
  const parts = [name.last, name.first].map(clean).filter(Boolean);
  const kana = (parts.length ? parts : [clean(name.full)]).map(toHiragana);
  return kana.every(Boolean) ? kana.join("") : undefined;
}

const works = new Map();
const characters = new Map();
const voiceActors = new Map();
/** キャラ → 作品 → その作品での声優。 */
const voicedIn = new Map();
/** 「ナレーター」のように、作品をまたいで同じ人物ではない役。入れると無関係な声優どうしがつながってしまう。 */
const GENERIC = /^(ナレーター|ナレーション|語り|語り手|Narrator|Narration)$/i;
const appearances = new Map();
const relations = [];

function addCast(work, edges) {
  for (const edge of edges ?? []) {
    const c = edge.node;
    if (!c?.id) continue;
    const chId = `ch:al-${c.id}`;
    if (GENERIC.test(clean(c.name.native)) || GENERIC.test(clean(c.name.full))) continue;
    if (!characters.has(chId)) {
      const name = clean(c.name.native) || clean(c.name.full);
      if (!name) continue;
      characters.set(chId, {
        id: chId,
        name,
        reading: personReading(c.name),
        nameEn: clean(c.name.full) || undefined,
        aliases: (c.name.alternative ?? []).map(clean).filter((a) => a && a.length <= 40).slice(0, 6),
        anilistId: c.id,
        favourites: c.favourites ?? 0,
        image: image(c.image?.large, c.siteUrl),
        sources: source(c.siteUrl),
      });
    }
    const role = ["MAIN", "SUPPORTING", "BACKGROUND"].includes(edge.role) ? edge.role : "BACKGROUND";
    const key = `${chId}|${work.id}`;
    if (!appearances.has(key)) appearances.set(key, { character: chId, work: work.id, role });
    for (const v of edge.voiceActors ?? []) {
      if (!v?.id) continue;
      const vaId = `va:al-${v.id}`;
      if (!voiceActors.has(vaId)) {
        const name = clean(v.name.native) || clean(v.name.full);
        if (!name) continue;
        voiceActors.set(vaId, {
          id: vaId,
          name,
          reading: personReading(v.name),
          nameEn: clean(v.name.full) || undefined,
          anilistId: v.id,
          favourites: v.favourites ?? 0,
          image: image(v.image?.large, v.siteUrl),
          sources: source(v.siteUrl),
        });
      }
      if (!voicedIn.has(chId)) voicedIn.set(chId, new Map());
      const byWork = voicedIn.get(chId);
      if (!byWork.has(work.id)) byWork.set(work.id, new Set());
      byWork.get(work.id).add(vaId);
    }
  }
}

console.log(`人気順に ${WORKS} 本の作品を取得します`);
const pending = [];
for (let page = 1; works.size < WORKS; page++) {
  const data = await call(LIST_QUERY, { page });
  for (const m of data.Page.media) {
    if (works.size >= WORKS) break;
    if (!FORMATS.has(m.format)) continue;
    const title = clean(m.title.native) || clean(m.title.romaji);
    if (!title) continue;
    const work = {
      id: `wk:al-${m.id}`,
      title,
      reading: toHiragana(clean(m.title.romaji)) || undefined,
      titleEn: clean(m.title.english) || clean(m.title.romaji) || undefined,
      format: m.format,
      year: m.startDate?.year ?? undefined,
      anilistId: m.id,
      popularity: m.popularity ?? 0,
      image: image(m.coverImage?.large, m.siteUrl),
      sources: source(m.siteUrl),
    };
    works.set(work.id, work);
    addCast(work, m.characters?.edges);
    if (m.characters?.pageInfo?.hasNextPage) pending.push({ work, id: m.id });
    for (const r of m.relations?.edges ?? []) {
      if (r.node?.type === "ANIME" && RELATIONS.has(r.relationType)) relations.push({ from: work.id, to: `wk:al-${r.node.id}`, relation: r.relationType });
    }
  }
  console.log(`  作品 ${works.size} / ${WORKS}`);
  if (!data.Page.pageInfo.hasNextPage) break;
}

console.log(`配役の続きを取得します（${pending.length} 作品、最大 ${CAST_PAGES} ページ）`);
let done = 0;
for (const { work, id } of pending) {
  for (let page = 2; page <= CAST_PAGES; page++) {
    const data = await call(CAST_QUERY, { id, page });
    addCast(work, data.Media?.characters?.edges);
    if (!data.Media?.characters?.pageInfo?.hasNextPage) break;
  }
  if (++done % 25 === 0) console.log(`  ${done} / ${pending.length}`);
}

// 配役の行を作る。どの作品でも同じ声優なら、作品を添えずに 1 行にまとめる。
// 作品によって声優が違うキャラ（交代など）は、作品ごとに行を分ける。
const casts = [];
for (const [chId, byWork] of voicedIn) {
  const sets = [...byWork.values()].map((set) => [...set].sort().join(","));
  if (sets.every((s) => s === sets[0])) {
    for (const vaId of [...byWork.values()][0]) casts.push({ voiceActor: vaId, character: chId, medium: "anime" });
  } else {
    for (const [workId, set] of byWork) for (const vaId of set) casts.push({ voiceActor: vaId, character: chId, medium: "anime", work: workId });
  }
}
// 声優のいないキャラは相関図でつながらないので外す。
const voiced = new Set(casts.map((c) => c.character));
for (const id of [...characters.keys()]) if (!voiced.has(id)) characters.delete(id);
const keptAppearances = [...appearances.values()].filter((a) => characters.has(a.character));
// シリーズの線は、両方の作品が入っているものだけ。向きが逆の重複は 1 本にする。
const seen = new Set();
const series = relations.filter((r) => {
  if (!works.has(r.to)) return false;
  const key = [r.from, r.to].sort().join("|");
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

const strip = (list) => list.map((item) => Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))));
const byId = (a, b) => (a.id < b.id ? -1 : 1);
await mkdir(OUT, { recursive: true });
const write = (name, list) => writeFile(join(OUT, name), `[\n${list.map((item) => JSON.stringify(item)).join(",\n")}\n]\n`);
await write("voice_actors.json", strip([...voiceActors.values()].sort(byId)));
await write("characters.json", strip([...characters.values()].sort(byId)));
await write("works.json", strip([...works.values()].sort(byId)));
await write("casts.json", casts.filter((c) => characters.has(c.character)));
await write("appearances.json", keptAppearances);
await write("series.json", series);
console.log(`書き出し: 声優 ${voiceActors.size} / キャラ ${characters.size} / 作品 ${works.size} / 配役 ${casts.length} / 登場 ${keptAppearances.length} / シリーズ ${series.length} → ${OUT}`);
