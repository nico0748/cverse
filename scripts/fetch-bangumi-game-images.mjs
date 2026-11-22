#!/usr/bin/env node
/**
 * AniList で画像が見つからなかったゲームのキャラに、Bangumi（bgm.tv）のキャラ画像を付ける。
 *
 *   node scripts/fetch-bangumi-game-images.mjs [--out data/source] [--refresh]
 *
 * - Bangumi はゲームそのものを作品として登録していて、キャラ一覧に画像と声優が付いている
 *   （API: https://bangumi.github.io/api/ 。キャラ画像の権利は各作品の権利者にある。サイトは URL を直接参照するだけで保存しない）
 * - 同じ人物とみなすのは、名前（Bangumi の表示名と、詳細の「日文名」「别名」など）が正規化して一致するとき。
 *   名前の一部だけが合うときは、日本語の声優も一致したときだけ。「〔オルタ〕」などの別の姿は含むだけでは合わせない
 * - 画像のないキャラだけが対象（fetch-anilist-game-images.mjs のあとに実行する）。前回このスクリプトが付けた画像は付け直す
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
const API = "https://api.bgm.tv";
const UA = "CVerseDataCollector/0.1 (https://github.com/nico0748/cverse; portfolio project)";
const today = new Date().toISOString().slice(0, 10);

/** ゲームと、Bangumi での作品 ID（https://bgm.tv/subject/<id>）。 */
export const GAMES = [
  { id: "wk:wp-fgo", subject: 109378 },
  { id: "wk:wp-umamusume", subject: 175552 },
  { id: "wk:wp-genshin", subject: 284157 },
  { id: "wk:wp-starrail", subject: 360097 },
  { id: "wk:wp-zzz", subject: 380974 },
  { id: "wk:wp-bluearchive", subject: 300648 },
  { id: "wk:wp-pjsekai", subject: 309303 },
  { id: "wk:wp-gakumas", subject: 482314 },
  { id: "wk:wp-nikke", subject: 343054 },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastCall = 0;

/** API を GET で 1 回呼ぶ。応答はパスごとにキャッシュする。 */
async function get(path) {
  const file = join(CACHE, `bgm-${createHash("sha1").update(path).digest("hex").slice(0, 16)}.json`);
  if (!REFRESH) {
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch {
      // キャッシュに無ければ取りに行く。
    }
  }
  for (let attempt = 1; attempt <= 5; attempt++) {
    await sleep(Math.max(0, lastCall + 1200 - Date.now()));
    lastCall = Date.now();
    let response;
    try {
      response = await fetch(API + path, { headers: { "User-Agent": UA, Accept: "application/json" } });
    } catch (error) {
      console.warn(`  通信に失敗（${attempt} 回目）: ${error.message}`);
      await sleep(5000 * attempt);
      continue;
    }
    if (response.status === 429) {
      const wait = Number(response.headers.get("retry-after") ?? 30) + 1;
      console.warn(`  回数の上限に当たったので ${wait} 秒待ちます`);
      await sleep(wait * 1000);
      continue;
    }
    if (response.status === 404) return null;
    const body = await response.json().catch(() => null);
    if (!response.ok || body == null) {
      console.warn(`  応答が不正（${response.status}、${attempt} 回目）`);
      await sleep(5000 * attempt);
      continue;
    }
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, JSON.stringify(body));
    return body;
  }
  throw new Error(`Bangumi から取得できませんでした: ${path}`);
}

export const norm = (s) =>
  (typeof s === "string" ? s : "")
    .normalize("NFKC")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[\s　・=＝.·]/g, "")
    .replace(/﨑/g, "崎")
    .replace(/髙/g, "高")
    .toLowerCase();

/** 詳細の infobox から、名前として使える値（日本語名・別名など）を集める。 */
export function infoboxNames(infobox) {
  const out = [];
  for (const { key, value } of infobox ?? []) {
    if (/日文|日语|日本語|假名|简体中文名|中文名|本名/.test(key) && typeof value === "string") out.push(value);
    if (key === "别名" && Array.isArray(value)) {
      for (const { k, v } of value) if (!/称号|昵称|外号/.test(k ?? "") && typeof v === "string") out.push(v);
    }
  }
  return out.flatMap((v) => v.split(/[、,，\/／]/)).map((v) => v.trim()).filter(Boolean);
}

/**
 * ゲームのキャラ 1 人に合う Bangumi のキャラを選ぶ（fetch-anilist-game-images.mjs の pick と同じ考え方）。
 * `vas` はこちらの声優名（正規化済み）、候補の `vas` も声優名（正規化済み）。
 */
export function pick(name, vas, candidates) {
  const n = norm(name);
  if (!n) return null;
  const voicedBy = (c) => c.vas.some((v) => vas.has(v));
  const exact = candidates.filter((c) => c.names.includes(n));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    const byVa = exact.filter(voicedBy);
    return byVa.length === 1 ? byVa[0] : null;
  }
  if (Array.from(n).length < 2 || /[〔［\[]/.test(name)) return null;
  const partial = candidates.filter(
    (c) => voicedBy(c) && c.names.some((m) => Array.from(m).length >= 2 && (m.includes(n) || n.includes(m))),
  );
  return partial.length === 1 ? partial[0] : null;
}

async function main() {
  const readJson = async (name) => JSON.parse(await readFile(join(OUT, name), "utf8"));
  const [characters, casts, voiceActors] = await Promise.all(["characters.json", "casts.json", "voice_actors.json"].map(readJson));
  const byId = new Map(characters.map((c) => [c.id, c]));
  const vaName = new Map(voiceActors.map((v) => [v.id, norm(v.name)]));

  let total = 0;
  let added = 0;
  const loose = [];
  console.log("ゲームごとの画像（Bangumi）:");
  for (const game of GAMES) {
    // このゲームに配役があり、画像がないか、前回 Bangumi の画像を付けたキャラ。
    const targets = new Map();
    for (const cast of casts) {
      if (cast.medium !== "game" || cast.work !== game.id) continue;
      const ch = byId.get(cast.character);
      if (!ch || (ch.image && ch.image.source !== "bangumi")) continue;
      const entry = targets.get(ch.id) ?? { ch, vas: new Set() };
      if (vaName.get(cast.voiceActor)) entry.vas.add(vaName.get(cast.voiceActor));
      targets.set(ch.id, entry);
    }
    total += targets.size;
    if (!targets.size) continue;

    const list = (await get(`/v0/subjects/${game.subject}/characters`)) ?? [];
    const ourNames = new Set([...targets.values()].map(({ ch }) => norm(ch.name)));
    const ourVas = new Set([...targets.values()].flatMap(({ vas }) => [...vas]));
    const candidates = [];
    for (const c of list) {
      const image = c.images?.medium || c.images?.large;
      if (!image) continue;
      const cand = { id: c.id, label: c.name, image, names: [norm(c.name)].filter(Boolean), vas: (c.actors ?? []).map((a) => norm(a.name)) };
      // 表示名だけで合わないとき、声優が重なる人物は詳細の別名も見る（中国語名で登録されたキャラなど）。
      if (!ourNames.has(cand.names[0]) && cand.vas.some((v) => ourVas.has(v))) {
        const detail = await get(`/v0/characters/${c.id}`);
        cand.names.push(...infoboxNames(detail?.infobox).map(norm).filter(Boolean));
      }
      candidates.push(cand);
    }

    let hit = 0;
    for (const { ch, vas } of targets.values()) {
      ch.sources = (ch.sources ?? []).filter((s) => s.source !== "bangumi");
      if (ch.image?.source === "bangumi") delete ch.image;
      const found = pick(ch.name, vas, candidates);
      if (!found) continue;
      const pageUrl = `https://bgm.tv/character/${found.id}`;
      ch.image = { url: found.image, source: "bangumi", pageUrl, license: null, attribution: null };
      ch.sources.push({ source: "bangumi", url: pageUrl, fetchedAt: today });
      hit++;
      if (!found.names.includes(norm(ch.name))) loose.push(`${ch.name} → ${found.label}`);
    }
    added += hit;
    console.log(`  ${game.id}: 候補 ${candidates.length} 人、画像を付けた ${hit} / ${targets.size}`);
  }

  await writeFile(join(OUT, "characters.json"), `[\n${characters.map((item) => JSON.stringify(item)).join(",\n")}\n]\n`);
  if (loose.length) console.log(`名前の一部と声優で合わせたもの ${loose.length} 件:\n  ${loose.join("\n  ")}`);
  console.log(`画像を付けた: ${added} / ${total}（画像のなかったゲームキャラ）→ ${OUT}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
