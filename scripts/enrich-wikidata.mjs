#!/usr/bin/env node
/**
 * Wikidata（CC0）で data/source/ の作品・声優・キャラを補う後処理（docs/data-schema.md の形式）。
 *
 *   node scripts/enrich-wikidata.mjs [--out data/source] [--refresh] [--with-characters] [--lead-limit 200] [--va-lead-limit 200]
 *
 * - AniList の ID（作品 P8729、声優 P11227、キャラ P11736）で Wikidata の項目に引き当てる。
 *   名前の一致では引き当てないので、別人・別作品に誤って付くことはない（名寄せの「正解」として使う）
 * - 足すもの
 *   - 作品（読みが無いものだけ）: reading（P1814「かな表記」）、wikipediaTitle（日本語版の記事名）、wikidataId
 *   - 声優: reading（P1814 があれば、ローマ字から作った読みより正確なので置き換える）、agency（P108 / P1416 の日本語ラベル）、
 *     debutYear（P2031「活動開始」）、aliases（日本語の別名）、wikipediaTitle、wikidataId
 *   - キャラ: reading（無いときだけ）、wikipediaTitle、wikidataId
 * - 引き当てたノードの sources に Wikidata の項目 URL を足す。ID・画像・配役・登場には触らない
 * - fetch-anilist.mjs、fetch-wikipedia-games.mjs（とその後の画像スクリプト）のあとに実行する。
 *   何度実行しても同じ結果になる（前回足した値は Wikidata の値で上書きされるだけ）
 * - キャラは Wikidata の登録が少なく検索の回数が多い（800 回超）ので、`--with-characters` を付けたときだけ引き当てる
 * - 検索は 2 秒おき、項目は 0.3 秒おきに取り、429 のときは Retry-After 待つ。応答は scripts/.cache/ に置いて使い回す
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const OUT = option("--out", join(here, "..", "data", "source"));
const REFRESH = args.includes("--refresh");
const WITH_CHARACTERS = args.includes("--with-characters");
const CACHE = join(here, ".cache");
const UA = "CVerseDataCollector/0.1 (https://github.com/nico0748/cverse; portfolio project)";
const today = new Date().toISOString().slice(0, 10);
const INTERVAL = 2000;
const ENTITY_INTERVAL = 300;
const SUMMARY_INTERVAL = 3000;
// Wikipedia の冒頭から読みを取る件数（人気順の上位）。要約 API も共有の回線では回数制限に当たりやすいので、上位に絞る。
const LEAD_LIMIT = Number(option("--lead-limit", "200"));
const VA_LEAD_LIMIT = Number(option("--va-lead-limit", "200"));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastCall = 0;

/**
 * Wikidata から 1 つ取る。キャッシュがあればそれを使う。
 * api.php は回数制限が厳しく（共有の回線だと 1 分に 1 回ほどしか通らない）、使わない。
 * 検索は Special:Search の結果ページ、項目は Special:EntityData（キャッシュされた JSON）から取る。
 */
async function get(url, { json, interval, keep = (x) => x }) {
  const key = createHash("sha1").update(`wd:${url}`).digest("hex").slice(0, 16);
  const file = join(CACHE, `wd-${key}.json`);
  if (!REFRESH) {
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch {
      // キャッシュに無ければ取りに行く。
    }
  }
  for (let attempt = 1; attempt <= 12; attempt++) {
    await sleep(Math.max(0, lastCall + interval - Date.now()));
    lastCall = Date.now();
    let response;
    try {
      response = await fetch(url, { headers: { "User-Agent": UA } });
    } catch (error) {
      console.warn(`  通信に失敗（${attempt} 回目）: ${error.message}`);
      await sleep(10000 * attempt);
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      const wait = Math.max(Number(response.headers.get("retry-after")) || 0, 10) * 1000;
      console.warn(`  混み合っているので ${wait / 1000} 秒待ちます（${response.status}、${attempt} 回目）`);
      await sleep(wait + Math.min(5000 * attempt, 60000));
      continue;
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Wikidata: ${response.status} ${url}`);
    const body = keep(json ? await response.json() : await response.text());
    await writeFile(file, JSON.stringify(body));
    return body;
  }
  throw new Error(`Wikidata: 何度試しても取れませんでした ${url}`);
}

const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** 外部 ID（AniList）を持つ Wikidata の項目 ID を、検索（haswbstatement の OR）でまとめて探す。 */
async function findItems(property, ids) {
  const found = new Set();
  const batches = chunks(ids, 40);
  for (const [i, batch] of batches.entries()) {
    const query = new URLSearchParams({
      search: `haswbstatement:${batch.map((id) => `${property}=${id}`).join("|")}`,
      title: "Special:Search",
      ns0: "1",
      limit: "100",
      fulltext: "1",
    });
    const hits = await get(`https://www.wikidata.org/w/index.php?${query}`, {
      json: false,
      interval: INTERVAL,
      keep: (html) => [...new Set([...html.matchAll(/data-serp-pos="\d+"[^>]*>|<a href="\/wiki\/(Q\d+)"/g)].map((m) => m[1]).filter(Boolean))],
    });
    for (const qid of hits ?? []) found.add(qid);
    if ((i + 1) % 10 === 0 || i + 1 === batches.length) console.log(`  ${property}: ${i + 1}/${batches.length} 回（見つかった項目 ${found.size}）`);
  }
  return [...found];
}

const KEEP_CLAIMS = ["P8729", "P11227", "P11736", "P1814", "P2031", "P108", "P1416"];

/** 項目の中身を 1 件ずつ取り、使う部分（主張の一部・日本語のラベルと別名・日本語版の記事名）だけ残す。 */
async function getEntities(qids) {
  const entities = new Map();
  for (const [i, qid] of qids.entries()) {
    const entity = await get(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, {
      json: true,
      interval: ENTITY_INTERVAL,
      keep: (body) => {
        const e = Object.values(body.entities ?? {})[0];
        if (!e) return null;
        return {
          id: e.id,
          claims: Object.fromEntries(KEEP_CLAIMS.filter((p) => e.claims?.[p]).map((p) => [p, e.claims[p]])),
          labels: e.labels?.ja ? { ja: e.labels.ja } : {},
          aliases: e.aliases?.ja ? { ja: e.aliases.ja } : {},
          sitelinks: e.sitelinks?.jawiki ? { jawiki: { title: e.sitelinks.jawiki.title } } : {},
        };
      },
    });
    // 転送（統合済みの項目）は転送先の ID で返るので、元の ID で引けるようにしておく。
    if (entity) entities.set(qid, entity);
    if ((i + 1) % 200 === 0) console.log(`  項目 ${i + 1}/${qids.length}`);
  }
  return entities;
}

/** 日本語版 Wikipedia の要約（REST API。キャッシュされていて回数制限がゆるい）の冒頭の文を取る。 */
async function summary(title) {
  const url = `https://ja.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  return get(url, { json: true, interval: SUMMARY_INTERVAL, keep: (b) => ({ title: b.title, type: b.type, extract: (b.extract ?? "").slice(0, 300) }) });
}

const squash = (s) => String(s ?? "").normalize("NFKC").replace(/[\s・=＝]/g, "").toLowerCase();

/**
 * 冒頭の「『進撃の巨人』（しんげきのきょじん）は」「花澤 香菜（はなざわ かな、1989年…）は」から、見出しの語と読みを取り出す。
 * 読みはかなだけのものを使う（漢字が混じるものや、別の注記は使わない）。
 */
export function leadReading(extract) {
  const m = /^[『「]?([^』」（(]{1,80})[』」]?\s*[（(]([^、，,）)]{1,80})[、，,）)]/.exec(extract ?? "");
  if (!m) return undefined;
  const reading = kanaReading(m[2]);
  return reading ? { head: m[1].trim(), reading } : undefined;
}

const values = (entity, property) =>
  (entity.claims?.[property] ?? [])
    .filter((claim) => claim.rank !== "deprecated" && claim.mainsnak?.snaktype === "value")
    .sort((a, b) => (b.rank === "preferred") - (a.rank === "preferred"))
    .map((claim) => claim.mainsnak.datavalue.value);

/** かな表記を、検索で使うひらがなにそろえる（空白・中黒は残さない）。かな以外が混じるものは使わない。 */
function kanaReading(text) {
  const s = String(text ?? "")
    .normalize("NFKC")
    .replace(/[\s・=＝]/g, "")
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  return /^[ぁ-ゖー゙゚ゝゞ]+$/.test(s) ? s : undefined;
}

const year = (time) => {
  const m = /^[+-](\d{4})-/.exec(time?.time ?? "");
  return m ? Number(m[1]) : undefined;
};

function addSource(node, qid) {
  const url = `https://www.wikidata.org/wiki/${qid}`;
  node.sources = (node.sources ?? []).filter((s) => s.source !== "wikidata");
  node.sources.push({ source: "wikidata", url, fetchedAt: today });
}

/** 種類ごとに、AniList ID → Wikidata の項目 を作る。 */
async function index(nodes, property, label) {
  const ids = [...new Set(nodes.map((n) => n.anilistId).filter(Number.isInteger))];
  console.log(`${label}: AniList ID ${ids.length} 件を Wikidata で探します`);
  const qids = await findItems(property, ids);
  const entities = await getEntities(qids);
  const byAnilist = new Map();
  for (const [qid, entity] of entities) {
    for (const value of values(entity, property)) {
      const id = Number(value);
      // 1 つの AniList ID に項目が複数ある（重複項目）ときは、どちらとも決められないので使わない。
      if (byAnilist.has(id)) byAnilist.set(id, null);
      else byAnilist.set(id, { qid, entity });
    }
  }
  console.log(`  ${label}: Wikidata の項目に引き当てられたもの ${[...byAnilist.values()].filter(Boolean).length} 件`);
  return byAnilist;
}

const jaTitle = (entity) => entity.sitelinks?.jawiki?.title;
const pageUrl = (title) => `https://ja.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;

async function main() {
  await mkdir(CACHE, { recursive: true });
  const load = async (name) => JSON.parse(await readFile(join(OUT, `${name}.json`), "utf8"));
  const works = await load("works");
  const voiceActors = await load("voice_actors");
  const characters = await load("characters");
  const stats = {};
  const count = (key) => (stats[key] = (stats[key] ?? 0) + 1);

  // 作品
  // 作品は読みが無いものだけ引く（読みがあるものは AniList のローマ字から作れているので、回数を節約する）。
  const workIndex = await index(works.filter((w) => !w.reading), "P8729", "作品（読みなし）");
  for (const work of works) {
    const hit = workIndex.get(work.anilistId);
    if (!hit) continue;
    const { qid, entity } = hit;
    work.wikidataId = qid;
    const title = jaTitle(entity);
    if (title && !work.wikipediaTitle) (work.wikipediaTitle = title), count("作品: Wikipedia 記事名");
    const reading = values(entity, "P1814").map(kanaReading).find(Boolean);
    if (reading && !work.reading) (work.reading = reading), count("作品: 読みを追加");
    addSource(work, qid);
    count("作品: 引き当て");
  }

  // 声優。所属は項目 ID なので、あとでラベルをまとめて引く。
  const vaIndex = await index(voiceActors, "P11227", "声優");
  const agencyOf = new Map();
  const wikidataReading = new Set();
  for (const va of voiceActors) {
    const hit = vaIndex.get(va.anilistId);
    if (!hit) continue;
    const { qid, entity } = hit;
    va.wikidataId = qid;
    const title = jaTitle(entity);
    if (title) va.wikipediaTitle = title;
    const reading = values(entity, "P1814").map(kanaReading).find(Boolean);
    if (reading) {
      wikidataReading.add(va.id);
      if (va.reading && kanaReading(va.reading) !== reading) count("声優: 読みを訂正");
      else if (!va.reading) count("声優: 読みを追加");
      va.reading = reading;
    }
    const debut = values(entity, "P2031").map((t) => year(t)).find(Boolean);
    if (debut) (va.debutYear = debut), count("声優: 活動開始年");
    const agencies = [...values(entity, "P108"), ...values(entity, "P1416")].map((v) => v.id).filter(Boolean);
    if (agencies.length) agencyOf.set(va, agencies);
    const aliases = (entity.aliases?.ja ?? [])
      .map((a) => a.value.trim())
      .filter((a) => a && a !== va.name && a.length <= 40 && !/^[\p{Script=Latin}\s.\-']+$/u.test(a));
    if (aliases.length) va.aliases = [...new Set([...(va.aliases ?? []), ...aliases])].slice(0, 8);
    addSource(va, qid);
    count("声優: 引き当て");
  }
  const agencyIds = [...new Set([...agencyOf.values()].flat())];
  const agencyEntities = await getEntities(agencyIds);
  for (const [va, ids] of agencyOf) {
    const names = ids.map((id) => agencyEntities.get(id)?.labels?.ja?.value).filter(Boolean);
    if (names.length) (va.agency = names[0]), count("声優: 所属");
  }

  // キャラ。Wikidata に登録されている日本のキャラは少ないので、手がかり程度（--with-characters のときだけ）。
  if (WITH_CHARACTERS) {
    const characterIndex = await index(characters, "P11736", "キャラ");
    for (const character of characters) {
      const hit = characterIndex.get(character.anilistId);
      if (!hit) continue;
      const { qid, entity } = hit;
      character.wikidataId = qid;
      const title = jaTitle(entity);
      if (title && !character.wikipediaTitle) character.wikipediaTitle = title;
      const reading = values(entity, "P1814").map(kanaReading).find(Boolean);
      if (reading && !character.reading) (character.reading = reading), count("キャラ: 読みを追加");
      addSource(character, qid);
      count("キャラ: 引き当て");
    }
  }

  // 読みの補い（日本語版 Wikipedia の冒頭の文）。Wikidata にかな表記の無い作品と声優が多いので、記事の冒頭の読みを使う。
  // 記事名が分かっているものはそれを、作品で記事名が分からないものは作品名そのものを引き、見出しが作品名と一致したときだけ使う。
  const fromLead = async (node, name, title, strict) => {
    const page = await summary(title);
    if (!page || page.type === "disambiguation") return undefined;
    const lead = leadReading(page.extract);
    if (!lead) return undefined;
    if (strict && squash(lead.head) !== squash(name)) return undefined;
    // 見出しが名前と大きく違う（記事が別のもの）ときは使わない。
    if (!strict && squash(lead.head) !== squash(name) && squash(lead.head) !== squash(title.replace(/\s*\(.*\)$/, ""))) return undefined;
    return lead.reading;
  };
  const isKanaName = (name) => Boolean(kanaReading(name));
  const workTargets = works
    .filter((w) => !w.reading && !isKanaName(w.title) && w.format !== "GAME")
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
    .slice(0, LEAD_LIMIT);
  console.log(`作品: 読みの無いもののうち人気上位 ${workTargets.length} 件を Wikipedia の冒頭で補います`);
  for (const [i, work] of workTargets.entries()) {
    const reading = work.wikipediaTitle ? await fromLead(work, work.title, work.wikipediaTitle, false) : await fromLead(work, work.title, work.title, true);
    if (reading) {
      work.reading = reading;
      work.sources = (work.sources ?? []).filter((x) => !(x.source === "wikipedia" && x.url === pageUrl(work.wikipediaTitle ?? work.title)));
      work.sources.push({ source: "wikipedia", url: pageUrl(work.wikipediaTitle ?? work.title), fetchedAt: today });
      count("作品: 読みを追加（Wikipedia）");
    }
    if ((i + 1) % 300 === 0) console.log(`  ${i + 1}/${workTargets.length}`);
  }
  // 声優は、Wikidata のかな表記で読みが決まらなかった人（ローマ字から作った読み）を、記事の冒頭の読みで確かめる。
  const vaTargets = voiceActors
    .filter((v) => v.wikipediaTitle && !isKanaName(v.name) && !wikidataReading.has(v.id))
    .sort((a, b) => (b.favourites ?? 0) - (a.favourites ?? 0))
    .slice(0, VA_LEAD_LIMIT);
  console.log(`声優: ${vaTargets.length} 人の読みを Wikipedia の冒頭で確かめます`);
  for (const [i, va] of vaTargets.entries()) {
    const reading = await fromLead(va, va.name, va.wikipediaTitle, false);
    if (reading) {
      if (va.reading && kanaReading(va.reading) !== reading) count("声優: 読みを訂正（Wikipedia）");
      else if (!va.reading) count("声優: 読みを追加（Wikipedia）");
      va.reading = reading;
      va.sources = (va.sources ?? []).filter((x) => !(x.source === "wikipedia" && x.url === pageUrl(va.wikipediaTitle)));
      va.sources.push({ source: "wikipedia", url: pageUrl(va.wikipediaTitle), fetchedAt: today });
    }
    if ((i + 1) % 300 === 0) console.log(`  ${i + 1}/${vaTargets.length}`);
  }

  const save = (name, rows) => writeFile(join(OUT, `${name}.json`), `[\n${rows.map((row) => JSON.stringify(row)).join(",\n")}\n]\n`);
  await save("works", works);
  await save("voice_actors", voiceActors);
  await save("characters", characters);
  console.log("結果:");
  for (const [key, value] of Object.entries(stats)) console.log(`  ${key}: ${value}`);
  console.log(`  作品の読みの充足: ${works.filter((w) => w.reading).length}/${works.length}`);
  console.log(`  声優の読みの充足: ${voiceActors.filter((v) => v.reading).length}/${voiceActors.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
