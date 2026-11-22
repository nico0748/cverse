#!/usr/bin/env node
/**
 * 主役（ヒロインなど）が抜けている作品が無いかを確かめる。
 *
 *   node scripts/check-main-cast.mjs [--data data/source] [--offline] [--show 30] [--refresh]
 *
 * AniList の各作品（まとめたシーズンそれぞれ）の配役 1 ページ目で、日本語の声が付いた主役（MAIN）を、収集データの
 * その作品の主役と照らし合わせる。AniList で主役なのに、収集データでその作品に主役として登場していないキャラがいれば、
 * 作品ごとに並べて終了コード 1 で終わる。配役の取得は fix-anilist-home-works.mjs と同じ問い合わせなので、
 * そのあとに実行すれば scripts/.cache/ の応答を使い回し、通信はほとんど起きない。
 *
 * `--offline` は AniList に問い合わせず、収集データだけで「主役が 1 人もいない作品」の数を出す（目安。AniList に主役の
 * 登録が無い作品も数に入る）。
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clean, fetchFirstCastPages, GENERIC, mainVoices, workOfMediaMap } from "./anilist-cast.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at < 0 ? fallback : args[at + 1];
};
const DATA = option("--data", join(here, "..", "data", "source"));
const SHOW = Number(option("--show", 30));
const OFFLINE = args.includes("--offline");
const REFRESH = args.includes("--refresh");

const load = async (name) => JSON.parse(await readFile(join(DATA, name), "utf8"));
const works = await load("works.json");
const appearances = await load("appearances.json");
const characters = await load("characters.json");
const charName = new Map(characters.map((c) => [c.id, c.name]));
const workById = new Map(works.map((w) => [w.id, w]));

/** 作品 → その作品に主役として登場するキャラ */
const mains = new Map();
for (const a of appearances) {
  if (a.role !== "MAIN") continue;
  if (!mains.has(a.work)) mains.set(a.work, new Set());
  mains.get(a.work).add(a.character);
}
const anime = works.filter((w) => w.id.startsWith("wk:al-"));
const noMain = anime.filter((w) => !mains.has(w.id));
console.log(`アニメ ${anime.length} 作品のうち、主役が 1 人もいない作品: ${noMain.length}`);
if (OFFLINE) {
  noMain.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
  for (const w of noMain.slice(0, SHOW)) console.log(`  ${w.title}（人気 ${w.popularity ?? 0}）`);
  process.exit(0);
}

const workOfMedia = workOfMediaMap(works);
const castPages = await fetchFirstCastPages([...workOfMedia.keys()], { refresh: REFRESH });
/** 作品 → 抜けている主役の名前 */
const missing = new Map();
let expected = 0;
for (const [id, edges] of castPages) {
  const work = workOfMedia.get(id);
  for (const e of edges) {
    if (e.role !== "MAIN" || !e.node?.id) continue;
    if (GENERIC.test(clean(e.node.name.native)) || GENERIC.test(clean(e.node.name.full))) continue;
    // 声の無い主役は相関図につながらないので、数えない。
    if (mainVoices(e).length === 0) continue;
    expected++;
    const chId = `ch:al-${e.node.id}`;
    if (mains.get(work)?.has(chId)) continue;
    if (!missing.has(work)) missing.set(work, new Set());
    missing.get(work).add(charName.get(chId) ?? (clean(e.node.name.native) || clean(e.node.name.full)));
  }
}
const list = [...missing].sort((a, b) => (workById.get(b[0])?.popularity ?? 0) - (workById.get(a[0])?.popularity ?? 0));
const count = list.reduce((n, [, s]) => n + s.size, 0);
console.log(`AniList で声の付いた主役 ${expected} 件のうち、収集データで主役として登場していないもの: ${count} 件（${list.length} 作品）`);
for (const [work, names] of list.slice(0, SHOW)) console.log(`  ${workById.get(work)?.title ?? work}: ${[...names].join("、")}`);
process.exit(list.length ? 1 : 0);
