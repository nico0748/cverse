#!/usr/bin/env node
/**
 * Wikipedia 由来のゲーム作品と声優に、Wikidata / Wikimedia Commons から再利用できる画像を足す（docs/data-schema.md の image）。
 *
 *   node scripts/fetch-wikidata-images.mjs [--out data/source] [--refresh]
 *
 * - fetch-wikipedia-games.mjs のあとに実行する
 * - 対象は ID が `:wp-` の作品（ゲーム）と声優のうち、image がまだ無いものだけ。それ以外の行
 *   （AniList 由来の行や、すでに画像がある行）には触らない
 * - 日本語版 Wikipedia の記事から Wikidata の項目を引き、作品はロゴ（P154）、なければ画像（P18）、声優は画像（P18）を使う
 * - Commons のライセンスがパブリックドメイン・CC0・CC BY・CC BY-SA のものだけを使う（`--images licensed` で残る条件と同じ）。
 *   作者名と Commons の `File:` ページを attribution / pageUrl に残す
 * - 応答は scripts/.cache/ に置いて使い回す。取り直すときは `--refresh`
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
const CACHE = join(here, ".cache");
const UA = "CVerseDataCollector/0.1 (https://github.com/nico0748/cverse; portfolio project)";
/** 作品は 3:4 で、人物は顔が見える程度で足りる（docs/data-schema.md）。 */
const WIDTH = { work: 320, person: 240 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastCall = 0;

/** MediaWiki の API を呼ぶ。キャッシュがあればそれを使う。 */
async function api(endpoint, params) {
  const query = new URLSearchParams({ format: "json", formatversion: "2", ...params });
  const url = `${endpoint}?${query}`;
  const file = join(CACHE, `wd-${createHash("sha1").update(url).digest("hex").slice(0, 16)}.json`);
  if (!REFRESH) {
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch {
      // キャッシュに無ければ取りに行く。
    }
  }
  for (let attempt = 1; attempt <= 5; attempt++) {
    await sleep(Math.max(0, lastCall + 1500 - Date.now()));
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
      console.warn(`  HTTP ${response.status}（${attempt} 回目）。待ってから取り直す`);
      await sleep(15000 * attempt);
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    const json = await response.json();
    if (json.error) throw new Error(`${json.error.code}: ${json.error.info}`);
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, JSON.stringify(json));
    return json;
  }
  throw new Error(`取得できませんでした: ${url}`);
}

const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** 日本語版 Wikipedia の記事名 → Wikidata の項目（リダイレクトも辿る）。 */
async function entitiesByJaTitle(titles) {
  const out = new Map();
  for (const part of chunks([...new Set(titles)], 50)) {
    const json = await api("https://www.wikidata.org/w/api.php", {
      action: "wbgetentities",
      sites: "jawiki",
      titles: part.join("|"),
      props: "claims|sitelinks",
      sitefilter: "jawiki",
      redirects: "yes",
    });
    const byTitle = new Map();
    for (const entity of Object.values(json.entities ?? {})) {
      const title = entity.sitelinks?.jawiki?.title;
      if (title && !entity.missing) byTitle.set(norm(title), entity);
    }
    // 記事名がリダイレクトだったときは、そのリダイレクト先の項目になる。並びで対応させられないので、
    // まず記事名どおりの項目を探し、なければ jawiki 側でリダイレクトを解決して引き直す。
    const unresolved = part.filter((t) => !byTitle.has(norm(t)));
    const redirects = await resolveJaRedirects(unresolved);
    for (const title of part) {
      const entity = byTitle.get(norm(title)) ?? byTitle.get(norm(redirects.get(title) ?? ""));
      if (entity) out.set(title, entity);
    }
  }
  return out;
}

/** jawiki の記事名のリダイレクトを解決する。 */
async function resolveJaRedirects(titles) {
  const out = new Map();
  for (const part of chunks(titles, 50)) {
    if (!part.length) continue;
    const json = await api("https://ja.wikipedia.org/w/api.php", { action: "query", titles: part.join("|"), redirects: "1" });
    const normalized = new Map((json.query?.normalized ?? []).map((n) => [n.from, n.to]));
    const redirected = new Map((json.query?.redirects ?? []).map((r) => [r.from, r.to]));
    for (const title of part) {
      const n = normalized.get(title) ?? title;
      out.set(title, redirected.get(n) ?? n);
    }
  }
  return out;
}

const norm = (s) => s.replace(/_/g, " ").trim();

/** 項目のファイル名の主張（P154 ロゴ、P18 画像など）。 */
function fileClaim(entity, property) {
  for (const claim of entity.claims?.[property] ?? []) {
    if (claim.rank === "deprecated") continue;
    const value = claim.mainsnak?.datavalue?.value;
    if (typeof value === "string" && value) return value;
  }
  return null;
}

/** Commons のファイル → 表示用の縮小画像 URL・ライセンス・作者。 */
async function commonsInfo(files, width) {
  const out = new Map();
  for (const part of chunks([...new Set(files)], 50)) {
    const json = await api("https://commons.wikimedia.org/w/api.php", {
      action: "query",
      titles: part.map((f) => `File:${f}`).join("|"),
      prop: "imageinfo",
      iiprop: "url|extmetadata|size",
      iiurlwidth: String(width),
      iiextmetadatafilter: "LicenseShortName|Artist|Credit|AttributionRequired",
    });
    const normalized = new Map((json.query?.normalized ?? []).map((n) => [n.to, n.from]));
    for (const page of json.query?.pages ?? []) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      const requested = (normalized.get(page.title) ?? page.title).replace(/^File:/, "");
      const meta = info.extmetadata ?? {};
      out.set(norm(requested), {
        url: withoutTracking(info.thumburl ?? info.url),
        pageUrl: info.descriptionurl,
        license: plain(meta.LicenseShortName?.value),
        artist: plain(meta.Artist?.value) || plain(meta.Credit?.value),
        width: info.thumbwidth ?? info.width,
        height: info.thumbheight ?? info.height,
      });
    }
  }
  return out;
}

/** Commons が縮小画像の URL に付ける計測用のクエリ（utm_*）を外す。 */
function withoutTracking(url) {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) if (key.startsWith("utm_")) u.searchParams.delete(key);
    return u.toString();
  } catch {
    return url;
  }
}

/** HTML を素の文字列にする（Commons の作者欄はリンクなどの HTML で来る）。 */
function plain(html) {
  if (typeof html !== "string") return "";
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/**
 * 再利用できるライセンスか。crates/cverse-cli/src/model.rs の is_freely_licensed と同じ条件
 * （パブリックドメイン・CC0・CC BY・CC BY-SA。NC / ND とそれ以外の語が混じる表記は外す）。
 */
const JURISDICTIONS = new Set(["unported", "international", "generic", "igo", "japan", "jp", "france", "fr", "germany", "de", "netherlands", "nl", "spain", "es", "italy", "it", "us", "usa", "united", "states", "uk", "england", "wales", "scotland", "and", "australia", "au", "austria", "at", "canada", "ca", "korea", "taiwan", "china"]);
function isFreeLicense(license) {
  const tokens = license.toLowerCase().split(/[^\p{L}\p{N}.]+/u).filter(Boolean);
  const joined = tokens.join(" ");
  if (["cc0", "cc0 1.0", "pd", "pdm", "public domain", "public domain mark", "public domain mark 1.0"].includes(joined)) return true;
  let rest;
  if (tokens[0] === "cc" && tokens[1] === "by" && tokens[2] === "sa") rest = tokens.slice(3);
  else if (tokens[0] === "cc" && tokens[1] === "by") rest = tokens.slice(2);
  else return false;
  if (rest.length && !/^[\d.]+$/.test(rest[0])) return false;
  return rest.slice(1).every((t) => JURISDICTIONS.has(t));
}

// ---- ここから本体 ----

const readJson = async (name) => JSON.parse(await readFile(join(OUT, name), "utf8"));
const works = await readJson("works.json");
const voiceActors = await readJson("voice_actors.json");

const isWp = (id) => typeof id === "string" && id.includes(":wp-");
const titleOf = (url) => {
  const m = /^https:\/\/ja\.wikipedia\.org\/wiki\/(.+)$/.exec(url ?? "");
  return m ? norm(decodeURIComponent(m[1])) : null;
};

// 作品: 作品名の記事を先に、なければ出典の記事（登場キャラクターの記事など）を候補にする。
const workTargets = works
  .filter((w) => isWp(w.id) && !w.image)
  .map((w) => ({ row: w, kind: "work", titles: [...new Set([w.wikipediaTitle, w.title, ...(w.sources ?? []).map((s) => titleOf(s.url))].filter(Boolean))] }));
const personTargets = voiceActors
  .filter((v) => isWp(v.id) && !v.image)
  .map((v) => ({ row: v, kind: "person", titles: [v.wikipediaTitle ?? v.name] }));

const entities = await entitiesByJaTitle([...workTargets, ...personTargets].flatMap((t) => t.titles));

/** 対象ごとに使う Commons のファイル名を決める。 */
for (const target of [...workTargets, ...personTargets]) {
  const properties = target.kind === "work" ? ["P154", "P18"] : ["P18"];
  outer: for (const property of properties) {
    for (const title of target.titles) {
      const entity = entities.get(title);
      const file = entity && fileClaim(entity, property);
      if (file) {
        target.file = file;
        target.qid = entity.id;
        break outer;
      }
    }
  }
}

const infos = new Map();
for (const kind of ["work", "person"]) {
  const files = [...workTargets, ...personTargets].filter((t) => t.kind === kind && t.file).map((t) => t.file);
  for (const [k, v] of await commonsInfo(files, WIDTH[kind])) infos.set(`${kind}|${k}`, v);
}

const report = { added: [], noFile: [], notFree: [] };
for (const target of [...workTargets, ...personTargets]) {
  const label = target.row.title ?? target.row.name;
  if (!target.file) {
    report.noFile.push(label);
    continue;
  }
  const info = infos.get(`${target.kind}|${norm(target.file)}`);
  if (!info || !info.url?.startsWith("https://") || !info.pageUrl?.startsWith("https://")) {
    report.noFile.push(label);
    continue;
  }
  if (!info.license || !isFreeLicense(info.license)) {
    report.notFree.push(`${label}（${info.license || "ライセンス不明"}）`);
    continue;
  }
  const image = {
    url: info.url,
    source: "wikimedia-commons",
    pageUrl: info.pageUrl,
    license: info.license,
    attribution: info.artist || null,
    ...(info.width && info.height ? { width: info.width, height: info.height } : {}),
  };
  // image は sources の前に置く（AniList 由来の行と同じ並び）。ほかのフィールドはそのまま。
  const entries = Object.entries(target.row).filter(([k]) => k !== "image");
  const at = entries.findIndex(([k]) => k === "sources");
  entries.splice(at < 0 ? entries.length : at, 0, ["image", image]);
  for (const k of Object.keys(target.row)) delete target.row[k];
  Object.assign(target.row, Object.fromEntries(entries));
  report.added.push(`${label}（${info.license}）`);
}

// 書き出しは fetch-wikipedia-games.mjs と同じ形（1 行 1 件）。並びも変えない。
const write = (name, list) => writeFile(join(OUT, name), `[\n${list.map((item) => JSON.stringify(item)).join(",\n")}\n]\n`);
await write("works.json", works);
await write("voice_actors.json", voiceActors);

console.log(`対象: 作品 ${workTargets.length} / 声優 ${personTargets.length}（Wikipedia 由来で画像なし）`);
console.log(`画像を足した: ${report.added.length}`);
for (const s of report.added) console.log(`  + ${s}`);
console.log(`Wikidata に画像が無い: ${report.noFile.length}`);
if (report.noFile.length) console.log(`  ${report.noFile.join("、")}`);
console.log(`ライセンスが合わず使わない: ${report.notFree.length}`);
for (const s of report.notFree) console.log(`  - ${s}`);
