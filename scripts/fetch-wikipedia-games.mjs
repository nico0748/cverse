#!/usr/bin/env node
/**
 * 日本語版 Wikipedia から主要ゲームのキャラと声優を取り、data/source/ に足す（docs/data-schema.md の形式）。
 *
 *   node scripts/fetch-wikipedia-games.mjs [--out data/source] [--refresh]
 *
 * - 対象は要件定義書の「主要ゲーム」（`GAMES`）。各作品の記事か「登場キャラクター」記事の、
 *   定義リスト（「; 名前」「: 声 - [[声優]]」）と表（名前と声の列）からキャラと日本語の声優を読む
 * - 声優は、名前が同じなら AniList 由来の声優に寄せる。いなければ Wikipedia 由来の声優を作る
 * - アニメ版にいる同じ名前のキャラ（作品名にゲームの名前を含む作品に登場するキャラ）は、同じキャラとしてまとめる
 * - fetch-anilist.mjs のあとに実行する。前回このスクリプトが足した行（ID が `:wp-` のもの、medium が game の配役）は
 *   消してから足し直すので、何度実行しても同じ結果になる
 * - Wikipedia は回数制限が厳しいので、記事は 8 秒おきに取り、scripts/.cache/ に置いて使い回す。取り直すときは `--refresh`
 * - 記事の本文は CC BY-SA 4.0。使うのは事実（キャラ名と声優の対応）だけで、出典として記事の URL を残す
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
const today = new Date().toISOString().slice(0, 10);

/**
 * 主要ゲーム。`match` はアニメ版の作品名に含まれていれば同じシリーズとみなす語（キャラの名寄せに使う）。
 */
export const GAMES = [
  { id: "wk:wp-fgo", title: "Fate/Grand Order", reading: "ふぇいとぐらんどおーだー", year: 2015, pages: ["Fate/Grand Orderの登場キャラクター"], match: ["Fate/Grand Order", "Fate/Grand Carnival"] },
  { id: "wk:wp-umamusume", title: "ウマ娘 プリティーダービー", reading: "うまむすめぷりてぃーだーびー", year: 2021, pages: ["ウマ娘 プリティーダービーの登場キャラクター"], match: ["ウマ娘"] },
  { id: "wk:wp-genshin", title: "原神", reading: "げんしん", year: 2020, pages: ["原神"], match: ["原神"] },
  { id: "wk:wp-starrail", title: "崩壊：スターレイル", reading: "ほうかいすたーれいる", year: 2023, pages: ["崩壊:スターレイル"], match: ["スターレイル"] },
  { id: "wk:wp-zzz", title: "ゼンレスゾーンゼロ", reading: "ぜんれすぞーんぜろ", year: 2024, pages: ["ゼンレスゾーンゼロ"], match: ["ゼンレスゾーンゼロ"] },
  { id: "wk:wp-bluearchive", title: "ブルーアーカイブ", reading: "ぶるーあーかいぶ", year: 2021, pages: ["ブルーアーカイブ -Blue Archive-の登場キャラクター"], match: ["ブルーアーカイブ"] },
  { id: "wk:wp-pjsekai", title: "プロジェクトセカイ カラフルステージ! feat. 初音ミク", reading: "ぷろじぇくとせかいからふるすてーじ", year: 2020, pages: ["プロジェクトセカイの登場人物"], match: ["プロジェクトセカイ"] },
  { id: "wk:wp-gakumas", title: "学園アイドルマスター", reading: "がくえんあいどるますたー", year: 2024, pages: ["学園アイドルマスター"], match: ["学園アイドルマスター"] },
  { id: "wk:wp-nikke", title: "勝利の女神：NIKKE", reading: "しょうりのめがみにけ", year: 2022, pages: ["勝利の女神:NIKKE"], match: ["NIKKE"] },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastCall = 0;
const pageUrl = (title) => `https://ja.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;

/** 記事の wikitext を取る。キャッシュがあればそれを使う。 */
async function wikitext(title) {
  const key = createHash("sha1").update(`wp:${title}`).digest("hex").slice(0, 16);
  const file = join(CACHE, `wp-${key}.wiki`);
  if (!REFRESH) {
    try {
      return await readFile(file, "utf8");
    } catch {
      // キャッシュに無ければ取りに行く。
    }
  }
  for (let attempt = 1; attempt <= 6; attempt++) {
    await sleep(Math.max(0, lastCall + 8000 - Date.now()));
    lastCall = Date.now();
    const url = `https://ja.wikipedia.org/w/index.php?${new URLSearchParams({ title, action: "raw" })}`;
    let response;
    try {
      response = await fetch(url, { headers: { "User-Agent": UA } });
    } catch (error) {
      console.warn(`  通信に失敗（${attempt} 回目）: ${error.message}`);
      await sleep(15000 * attempt);
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      console.warn(`  混み合っているので待ちます（${response.status}、${attempt} 回目）`);
      await sleep(30000 * attempt);
      continue;
    }
    if (!response.ok) throw new Error(`${title}: ${response.status}`);
    const text = await response.text();
    if (/^#(REDIRECT|転送)/i.test(text)) throw new Error(`${title} は転送ページです。転送先の記事名を GAMES に書いてください`);
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, text);
    return text;
  }
  throw new Error(`${title} を取得できませんでした`);
}

// ---- wikitext の読み取り ----

/** 入れ子の {{…}} を外す。ruby は親文字だけ残す。 */
function stripTemplates(s) {
  let out = s;
  for (let i = 0; i < 6; i++) {
    const next = out
      .replace(/\{\{\s*(?:ruby|読み仮名|読み仮名_ruby不使用)\s*\|([^{}|]*)\|[^{}]*\}\}/gi, "$1")
      .replace(/\{\{\s*(?:仮リンク|ill)\s*\|([^{}|]*)(?:\|[^{}]*)?\}\}/gi, "$1")
      .replace(/\{\{\s*(?:Nowrap|nowrap|lang\|[a-z-]+)\s*\|([^{}]*)\}\}/g, "$1")
      .replace(/\{\{[^{}]*\}\}/g, "");
    if (next === out) break;
    out = next;
  }
  return out;
}

/** 表示される文字だけにする（参照、テンプレート、リンク、強調、HTML を外す）。 */
/** リンクを表示名にする（テンプレートの中のリンクも先に外す。例: {{ruby|[[胡桃 (原神)|胡桃]]|フータオ}}）。 */
const delink = (s) => s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1");

export function plain(s) {
  return stripTemplates(
    delink(s)
      .replace(/<ref[^>]*\/>/g, "")
      .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "")
      .replace(/<!--[\s\S]*?-->/g, ""),
  )
    .replace(/\[https?:\S+\s([^\]]*)\]/g, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/'{2,}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const KANA = /^[ぁ-ゖー・\s　]+$/;
const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** 見出しの名前から、名前と読みを取り出す。「七神 リン（なながみ リン）」→ 七神 リン / なながみりん */
export function splitName(raw) {
  const rubyReading = delink(raw).match(/\{\{\s*(?:ruby|読み仮名|読み仮名_ruby不使用)\s*\|[^{}|]*\|([^{}|]*)\}\}/i)?.[1];
  let text = plain(raw);
  let reading;
  const paren = text.match(/^(.*?)\s*[（(]([^）)]*)[）)]\s*$/);
  if (paren) {
    text = paren[1].trim();
    const inside = paren[2].trim();
    if (KANA.test(toHira(inside))) reading = toHira(inside).replace(/[\s　・]/g, "");
  }
  // 「名前 / 別名」「名前 - 説明」の後ろは名前ではない。
  text = text.split(/\s[\/／]\s|\s[-‐－–]\s/)[0].trim();
  if (!reading && rubyReading && KANA.test(toHira(rubyReading))) reading = toHira(rubyReading).replace(/[\s　・]/g, "");
  if (!reading && KANA.test(toHira(text))) reading = toHira(text).replace(/[\s　・]/g, "");
  return { name: text, reading };
}

const NOT_A_NAME = /^(なし|不明|未定|非公開|\?+|？+|-|—|―|ー|N\/A|無し)$/;

/**
 * 「声 - 」の後ろから声優の名前を取り出す。交代（→）や複数（、）はすべて返す。
 * 返すのは表示名と、リンク先の記事名（あれば）。
 */
export function parseVoices(credit) {
  const head = credit
    .replace(/<ref[^>]*\/>/g, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "")
    .split(/\s[\/／]\s/)[0];
  const voices = [];
  const seen = new Set();
  const push = (name, article, linked, afterArrow) => {
    const n = name.replace(/[（(][^）)]*[）)]/g, "").replace(/\s+/g, " ").trim();
    if (!n || NOT_A_NAME.test(n) || n.length > 20 || /[A-Za-z]{3,}/.test(n) || seen.has(n)) return;
    seen.add(n);
    voices.push({ name: n, article, linked, afterArrow });
  };
  // リンクを目印に置き換えてから区切る。リンクの有無にかかわらず、書かれた順に名前を残す。
  // 「→」の後ろの人だけが交代（afterArrow）。「、」などで並んだ人は同時に演じている。
  const links = [];
  const masked = head
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => `\u0000${links.push({ target, label }) - 1}\u0000`)
    .replace(/[（(][^）)]*[）)]/g, "");
  const parts = masked.split(/([、,，→]|\s+と\s+)/);
  for (let i = 0; i < parts.length; i += 2) {
    const afterArrow = i > 0 && parts[i - 1] === "→";
    const part = parts[i];
    const refs = [...part.matchAll(/\u0000(\d+)\u0000/g)];
    if (refs.length) {
      for (const [, k] of refs) push(links[k].label ?? links[k].target, links[k].target, true, afterArrow);
      continue;
    }
    // 「上田麗奈 小野大輔」のように空白で並んだ 2 人。「上田 麗奈」（姓と名の間の空白）は分けない。
    const tokens = plain(part).trim().split(/\s+/);
    if (tokens.length > 1 && tokens.every((t) => Array.from(t).length >= 3)) tokens.forEach((t) => push(t, undefined, false, afterArrow));
    else push(plain(part), undefined, false, afterArrow);
  }
  return voices;
}

const CREDIT = /^[:：]+\s*(?:\[\[声優\|)?(?:声|声優|CV|キャラクターボイス)(?:\]\])?\s*[-－‐–:：]\s*(.+)$/;

/** 定義リスト（「; 名前」の次の行に「: 声 - 声優」）を読む。 */
export function parseDefinitionLists(text) {
  const out = [];
  let current = null;
  for (const line of text.split("\n")) {
    if (/^;[^;:]/.test(line)) {
      current = line.slice(1).split(/\s:\s/)[0];
      // 「; 名前 : 声 - 声優」のように 1 行に書かれていることもある。
      const inline = line.match(/\s:\s*(?:声|声優)\s*[-－‐–:：]\s*(.+)$/);
      if (inline) {
        out.push({ raw: current, voices: parseVoices(inline[1]) });
        current = null;
      }
      continue;
    }
    if (/^[^:;]/.test(line) || line.startsWith(":;")) {
      if (/^=/.test(line)) current = null;
      continue;
    }
    const credit = line.match(CREDIT);
    if (credit && current) {
      out.push({ raw: current, voices: parseVoices(credit[1]) });
      current = null;
    }
  }
  return out;
}

/** 表のセルから属性（style=… |）を外す。 */
function cellText(cell) {
  const m = cell.match(/^\s*(?:[a-z-]+\s*=\s*("[^"]*"|\S+)\s*)+\|(?!\|)(.*)$/is);
  return (m ? m[2] : cell).trim();
}

/**
 * 表（wikitable）を読む。見出しに「名前」「真名」「名称」の列と、「声」「声優」の列がある表だけを対象にする。
 * 声の列が「日本語・中国語…」に分かれている表は、最初（日本語）の列を使う。
 */
export function parseTables(text) {
  const out = [];
  const tables = text.match(/\{\|[\s\S]*?\n\|\}/g) ?? [];
  for (const table of tables) {
    const rows = table.split(/\n\|-[^\n]*/).map((row) =>
      row
        .split("\n")
        .filter((l) => /^[|!]/.test(l) && !/^\{\||^\|\}|^\|\+/.test(l))
        .flatMap((l) => l.slice(1).split(/\|\||!!/))
        .map(cellText),
    );
    const headers = rows.filter((r, i) => i < 3 && table.split(/\n\|-[^\n]*/)[i].split("\n").some((l) => l.startsWith("!")));
    if (!headers.length) continue;
    const first = headers[0].map((h) => plain(h));
    // 「colspan=2|名前」は名前の列が 2 つある（日本語・英語）。列の位置は colspan を数えて求める。
    const raw = table.split(/\n\|-[^\n]*/)[0].split("\n").filter((l) => l.startsWith("!")).flatMap((l) => l.slice(1).split("!!"));
    let col = 0;
    let nameCol = -1;
    let voiceCol = -1;
    raw.forEach((h, i) => {
      const span = Number(h.match(/colspan\s*=\s*"?(\d+)/)?.[1] ?? 1);
      const label = first[i] ?? "";
      if (nameCol < 0 && /名前|真名|名称|キャラクター/.test(label)) nameCol = col;
      if (voiceCol < 0 && /声/.test(label)) voiceCol = col;
      col += span;
    });
    if (nameCol < 0 || voiceCol < 0) continue;
    for (const row of rows.slice(headers.length)) {
      if (row.length <= voiceCol) continue;
      out.push({ raw: row[nameCol], voices: parseVoices(row[voiceCol]) });
    }
  }
  return out;
}

// ---- データへの反映 ----

const readJson = async (name) => JSON.parse(await readFile(join(OUT, name), "utf8"));
const norm = (s) => s.normalize("NFKC").replace(/[\s　・=＝]/g, "").replace(/﨑/g, "崎").replace(/髙/g, "高");
const hash = (s) => createHash("sha1").update(s).digest("hex").slice(0, 10);

const voiceActors = await readJson("voice_actors.json");
const characters = await readJson("characters.json");
const works = await readJson("works.json");
const casts = await readJson("casts.json");
const appearances = await readJson("appearances.json");
const series = await readJson("series.json").catch(() => []);

// 前回の実行で足した行を消す。
const isWp = (id) => typeof id === "string" && id.includes(":wp-");
const keep = (list, test) => list.filter((x) => !test(x));
const vaList = keep(voiceActors, (v) => isWp(v.id));
const gameIds = new Set(GAMES.map((g) => g.id));
const chList = keep(characters, (c) => isWp(c.id));
const wkList = keep(works, (w) => isWp(w.id));
const castList = keep(casts, (c) => c.medium === "game" || isWp(c.voiceActor) || isWp(c.character));
const appList = keep(appearances, (a) => gameIds.has(a.work) || isWp(a.work) || isWp(a.character));

const vaByName = new Map();
for (const v of vaList) {
  vaByName.set(norm(v.name), v);
  for (const a of v.aliases ?? []) if (!vaByName.has(norm(a))) vaByName.set(norm(a), v);
}
const workTitle = new Map(wkList.map((w) => [w.id, [w.title, ...(w.parts ?? [])].join(" ")]));
const chById = new Map(chList.map((c) => [c.id, c]));
/** アニメ版のキャラ（ゲームの名前を含む作品に登場する）を、名前から引けるようにする。 */
function animeCharacters(game) {
  const map = new Map();
  for (const a of appList) {
    const title = workTitle.get(a.work) ?? "";
    if (!game.match.some((m) => title.includes(m))) continue;
    const c = chById.get(a.character);
    if (!c) continue;
    for (const n of [c.name, ...(c.aliases ?? [])]) if (!map.has(norm(n))) map.set(norm(n), c);
  }
  return map;
}

const item_count = (found) => [...found.values()].reduce((n, i) => n + i.voices.length, 0);
const newVas = new Map();
const newChars = new Map();
const newCasts = [];
const newApps = [];
const report = [];
for (const game of GAMES) {
  const found = new Map();
  for (const title of game.pages) {
    const text = await wikitext(title);
    for (const entry of [...parseDefinitionLists(text), ...parseTables(text)]) {
      const { name, reading } = splitName(entry.raw ?? "");
      if (!name || name.length > 30 || !entry.voices.length) continue;
      const key = norm(name);
      if (!found.has(key)) found.set(key, { name, reading, voices: [], page: title });
      const item = found.get(key);
      for (const v of entry.voices) if (!item.voices.some((x) => norm(x.name) === norm(v.name))) item.voices.push(v);
    }
  }
  // リンクの無い名前は、その記事のどこかでリンクされている声優か、既存の声優のときだけ使う（表の別の列を拾わない）。
  const linkedNames = new Set();
  for (const item of found.values()) for (const v of item.voices) if (v.linked) linkedNames.add(norm(v.name));
  for (const item of found.values()) item.voices = item.voices.filter((v) => v.linked || linkedNames.has(norm(v.name)) || vaByName.has(norm(v.name)));
  for (const [key, item] of found) if (!item.voices.length) found.delete(key);
  const anime = animeCharacters(game);
  let merged = 0;
  let matchedVas = 0;
  for (const item of found.values()) {
    const existing = anime.get(norm(item.name));
    let chId;
    if (existing) {
      chId = existing.id;
      merged++;
      // 出典に Wikipedia の記事も足す（前回足した分は重ねない）。
      const url = pageUrl(item.page);
      existing.sources = [...(existing.sources ?? []).filter((s) => s.url !== url), { source: "wikipedia", url, fetchedAt: today }];
    } else {
      chId = `ch:wp-${hash(`${game.id}|${item.name}`)}`;
      if (!newChars.has(chId)) {
        newChars.set(chId, {
          id: chId,
          name: item.name,
          reading: item.reading,
          sources: [{ source: "wikipedia", url: pageUrl(item.page), fetchedAt: today }],
        });
      }
    }
    newApps.push({ character: chId, work: game.id, role: "SUPPORTING" });
    item.voices.forEach((voice) => {
      let va = vaByName.get(norm(voice.name));
      if (va && !isWp(va.id)) matchedVas++;
      if (!va) {
        const id = `va:wp-${hash(norm(voice.name))}`;
        va = newVas.get(id);
        if (!va) {
          va = {
            id,
            name: voice.name,
            wikipediaTitle: voice.article,
            sources: [{ source: "wikipedia", url: pageUrl(voice.article ?? item.page), fetchedAt: today }],
          };
          newVas.set(id, va);
        }
        vaByName.set(norm(voice.name), va);
      }
      // 「A → B」は交代。「→」の後ろの人だけを replacement にする。
      newCasts.push({ voiceActor: va.id, character: chId, medium: "game", work: game.id, ...(voice.afterArrow ? { kind: "replacement" } : {}) });
    });
  }
  report.push(`  ${game.title}: キャラ ${found.size}（アニメ版とまとめた ${merged}）、配役 ${item_count(found)} のうち AniList の声優に一致 ${matchedVas}`);
}

// ゲームそのものの作品ノード。
const gameWorks = GAMES.map((g) => ({
  id: g.id,
  title: g.title,
  reading: g.reading,
  format: "GAME",
  year: g.year,
  series: g.title,
  sources: g.pages.map((p) => ({ source: "wikipedia", url: pageUrl(p), fetchedAt: today })),
}));

// アニメ版とゲームをシリーズの線でつなぐ（ゲーム化・アニメ化）。
const gameSeries = [];
for (const g of GAMES) {
  for (const w of wkList) if (g.match.some((m) => workTitle.get(w.id).includes(m))) gameSeries.push({ from: g.id, to: w.id, relation: "ADAPTATION" });
}

// 同じ配役の重複を外す。
const castKey = (c) => `${c.voiceActor}|${c.character}|${c.medium}|${c.work ?? ""}`;
const castsOut = [...new Map([...castList, ...newCasts].map((c) => [castKey(c), c])).values()];
const appsOut = [...new Map([...appList, ...newApps].map((a) => [`${a.character}|${a.work}`, a])).values()];
const seriesOut = [...keep(series, (s) => gameIds.has(s.from) || gameIds.has(s.to)), ...gameSeries];

const strip = (list) => list.map((item) => Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))));
const byId = (a, b) => (a.id < b.id ? -1 : 1);
const write = (name, list) => writeFile(join(OUT, name), `[\n${list.map((item) => JSON.stringify(item)).join(",\n")}\n]\n`);
await write("voice_actors.json", strip([...vaList, ...newVas.values()].sort(byId)));
await write("characters.json", strip([...chList, ...newChars.values()].sort(byId)));
await write("works.json", strip([...wkList, ...gameWorks].sort(byId)));
await write("casts.json", castsOut);
await write("appearances.json", appsOut);
await write("series.json", seriesOut);
console.log("ゲームごとの取り込み:");
console.log(report.join("\n"));
console.log(`追加: 作品 ${gameWorks.length} / キャラ ${newChars.size} / 声優 ${newVas.size}（Wikipedia 由来）/ 配役 ${newCasts.length} → ${OUT}`);
