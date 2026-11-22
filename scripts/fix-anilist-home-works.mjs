#!/usr/bin/env node
/**
 * AniList 由来のキャラが「端役で出た別の作品」にだけつながり、本来の作品につながっていないのを直す。
 *
 *   node scripts/fix-anilist-home-works.mjs [--min-favourites 1] [--keep-cameos] [--add-characters] [--out data/source] [--refresh]
 *
 * なぜ起きるか: fetch-anilist.mjs は、人気上位の作品だけ配役を全部取り、ほかの作品は「集まった声優の出演作（人気順 25 作品）」
 * からその声優のキャラだけを足す。そのため、人気が上位に届かない作品（例: 俺の妹がこんなに可愛いわけがない）の主役でも、
 * 演じた声優の出演作の上位 25 作品にその作品が入らないと、本来の作品への登場が抜ける。一方で、人気上位の作品に端役で
 * 出たカメオ（例: エロマンガ先生の五更瑠璃）は配役の一覧から入るので、カメオの作品にだけつながってしまう。
 * 声の無い登場（例: 僕は友達が少ないの五更瑠璃。AniList では声優が空）も配役の一覧から入っていた。
 *
 * このスクリプトは、登場がすべて端役（BACKGROUND）のキャラについて、AniList のキャラのページ（出演作と各作品の声優）を取り、
 * - 収集済みの声優が演じている、収集済みの作品への登場を足す（端役より重い役なら役も上げる）。作品は増やさない
 * - そのキャラに日本語の声優がいない作品への登場を外す
 * そのあと、データ全体について、別の作品で主役・脇役のキャラが、シリーズでつながらない作品に端役で出ている登場（ゲスト出演）を
 * 外す（`--keep-cameos` で残す）。声優は増やさない（fetch-anilist.mjs の「声優は固定」と同じ方針）。
 *
 * fetch-anilist.mjs のあと、fetch-wikipedia-games.mjs の前に実行する。何度実行しても同じ結果になる。
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
  if (at < 0) return fallback;
  const value = args[at + 1];
  if (value === undefined || value === "" || value.startsWith("--")) {
    console.error(`${name} には値を指定してください`);
    process.exit(1);
  }
  return value;
};
const OUT = option("--out", join(here, "..", "data", "source"));
const MIN_FAVOURITES = Number(option("--min-favourites", 1));
if (!Number.isSafeInteger(MIN_FAVOURITES) || MIN_FAVOURITES < 0) {
  console.error("--min-favourites には 0 以上の整数を指定してください");
  process.exit(1);
}
const KEEP_CAMEOS = args.includes("--keep-cameos");
// 配役の一覧にいて、まだ収集していないキャラも足すか。既定では足さない（キャラが倍近くに増え、データの規模が変わるため）。
const ADD_CHARACTERS = args.includes("--add-characters");
const REFRESH = args.includes("--refresh");
const CACHE = join(here, ".cache");
const API = "https://graphql.anilist.co";

const ROLE_RANK = { MAIN: 3, SUPPORTING: 2, BACKGROUND: 1 };

const CHARACTER_QUERY = `query ($id: Int) {
  Character(id: $id) {
    media(type: ANIME, sort: POPULARITY_DESC, perPage: 25) {
      edges {
        characterRole
        voiceActors(language: JAPANESE) { id }
        node { id }
      }
    }
  }
}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastCall = 0;
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
    if (response.status === 404) return null;
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

const load = async (name) => JSON.parse(await readFile(join(OUT, name), "utf8"));
const characters = await load("characters.json");
const works = await load("works.json");
const appearances = await load("appearances.json");
const casts = await load("casts.json");
const series = await load("series.json");
const voiceActors = await load("voice_actors.json");

const charById = new Map(characters.map((c) => [c.id, c]));
const workById = new Map(works.map((w) => [w.id, w]));
/** AniList の作品 ID → まとめた先の作品（シーズン・劇場版は 1 つの作品の出典に並んでいる）。 */
const workOfMedia = new Map();
for (const w of works) {
  if (!w.id.startsWith("wk:al-")) continue;
  for (const s of w.sources ?? []) {
    const m = /anilist\.co\/anime\/(\d+)/.exec(s.url ?? "");
    if (m) workOfMedia.set(Number(m[1]), w.id);
  }
  if (w.anilistId) workOfMedia.set(w.anilistId, w.id);
}
/** 収集済みの声優（AniList の ID → 声優 ID）。 */
const vaOfAnilist = new Map(voiceActors.filter((v) => v.anilistId && v.id.startsWith("va:al-")).map((v) => [v.anilistId, v.id]));

// 登場: キャラ → 作品 → 役
const roles = new Map();
for (const a of appearances) {
  if (!roles.has(a.character)) roles.set(a.character, new Map());
  roles.get(a.character).set(a.work, a.role);
}
// アニメの配役: キャラ → 作品 → 声優の集合（作品を添えない行は、そのキャラが出るすべてのアニメ作品に当てはまる）
const animeCasts = casts.filter((c) => c.medium === "anime" && c.character.startsWith("ch:al-"));
const otherCasts = casts.filter((c) => !(c.medium === "anime" && c.character.startsWith("ch:al-")));
const voicedIn = new Map();
const voice = (ch, work, va) => {
  if (!voicedIn.has(ch)) voicedIn.set(ch, new Map());
  const byWork = voicedIn.get(ch);
  if (!byWork.has(work)) byWork.set(work, new Set());
  byWork.get(work).add(va);
};
for (const c of animeCasts) {
  if (c.work) voice(c.character, c.work, c.voiceActor);
  else for (const w of roles.get(c.character)?.keys() ?? []) if (w.startsWith("wk:al-")) voice(c.character, w, c.voiceActor);
}

const isAnime = (w) => w.startsWith("wk:al-");
// 「その他声」のように、作品をまたいで同じ人物ではない役（fetch-anilist.mjs の GENERIC と同じ）。無関係な声優どうしがつながるので外す。
const GENERIC = /^(ナレーター|ナレーション|語り|語り手|その他声|その他の声|Narrator|Narration|Sonohokasei)$/i;
let removedGeneric = 0;
for (const c of characters) {
  if (!c.id.startsWith("ch:al-") || !(GENERIC.test(c.name) || GENERIC.test(c.nameEn ?? ""))) continue;
  removedGeneric += roles.get(c.id)?.size ?? 0;
  roles.delete(c.id);
  voicedIn.delete(c.id);
}
// ---- 1. 配役の埋め直し ----
// 人気上位に入らない作品は、声優の出演作から「その声優のキャラ」だけが入っている。そのため主役でも、演じた声優の出演作の
// 上位にその作品が無いと登場が抜け（俺の妹がこんなに可愛いわけがないの五更瑠璃）、別の声優（幼少期の声など）だけが
// 残ることがある（夏目友人帳の夏目貴志が藤村歩だけになり、神谷浩史が抜けていた）。
// 各作品（まとめたシーズンそれぞれ）の配役の 1 ページ目（主役が先、25 人）を取り、収集済みのキャラと声優のぶんを入れ直す。
const FILL_QUERY = (ids) => `{${ids
  .map(
    (id) => `m${id}: Media(id: ${id}) { id characters(page: 1, perPage: 25, sort: [ROLE, FAVOURITES_DESC]) { edges {
      role
      node { id name { native full first last alternative } image { large } favourites siteUrl }
      voiceActorRoles(language: JAPANESE) { roleNotes voiceActor { id } }
    } } }`,
  )
  .join("\n")}}`;
/** 幼少期・若い頃の声。ほかに声優がいれば、こちらは配役に入れない。 */
const YOUNG = /young|child|kid|幼少|幼年|少年期|少女期|子供/i;
const isKana = (s) => /^[぀-ヿ・ー\s・＝=]+$/.test(s);
const clean = (s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
function personReading(name) {
  const native = clean(name.native);
  if (native && isKana(native)) return native;
  const parts = [name.last, name.first].map(clean).filter(Boolean);
  const kana = (parts.length ? parts : [clean(name.full)]).map(toHiragana);
  return kana.every(Boolean) ? kana.join("") : undefined;
}
const mediaIds = [...workOfMedia.keys()].sort((a, b) => a - b);
const BATCH = 20;
console.log(`作品 ${mediaIds.length} 本の配役の 1 ページ目を取得します（約 ${Math.ceil((mediaIds.length / BATCH) * 2.2 / 60)} 分）`);
/** キャラ → 作品 → { role, vas: Set, voiced } */
const listed = new Map();
for (let i = 0; i < mediaIds.length; i += BATCH) {
  const ids = mediaIds.slice(i, i + BATCH);
  const data = await call(FILL_QUERY(ids), {});
  for (const id of ids) {
    const work = workOfMedia.get(id);
    for (const e of data?.[`m${id}`]?.characters?.edges ?? []) {
      const c = e.node;
      if (!c?.id) continue;
      const chId = `ch:al-${c.id}`;
      if (GENERIC.test(clean(c.name.native)) || GENERIC.test(clean(c.name.full))) continue;
      const vaRoles = (e.voiceActorRoles ?? []).filter((r) => r?.voiceActor?.id);
      const main = vaRoles.filter((r) => !YOUNG.test(r.roleNotes ?? ""));
      const use = (main.length ? main : vaRoles).map((r) => vaOfAnilist.get(r.voiceActor.id)).filter(Boolean);
      if (!listed.has(chId)) listed.set(chId, new Map());
      const p = listed.get(chId).get(work) ?? { role: "BACKGROUND", vas: new Set(), voiced: false };
      if (ROLE_RANK[e.role] > ROLE_RANK[p.role]) p.role = e.role;
      if (vaRoles.length) p.voiced = true;
      for (const v of use) p.vas.add(v);
      listed.get(chId).set(work, p);
      if (ADD_CHARACTERS && use.length && !charById.has(chId)) {
        const name = clean(c.name.native) || clean(c.name.full);
        if (!name) continue;
        const record = {
          id: chId,
          name,
          reading: personReading(c.name),
          nameEn: clean(c.name.full) || undefined,
          aliases: (c.name.alternative ?? []).map(clean).filter((a) => a && a.length <= 40).slice(0, 6),
          anilistId: c.id,
          favourites: c.favourites ?? 0,
          image: c.image?.large && !/\/default\.(jpg|png)$/.test(c.image.large) ? { url: c.image.large, source: "anilist", pageUrl: c.siteUrl, license: null, attribution: null } : undefined,
          sources: [{ source: "anilist", url: c.siteUrl, fetchedAt: new Date().toISOString().slice(0, 10) }],
        };
        characters.push(record);
        charById.set(chId, record);
      }
    }
  }
  if ((i / BATCH + 1) % 50 === 0) console.log(`  ${Math.min(i + BATCH, mediaIds.length)} / ${mediaIds.length}`);
}
let filledAppearances = 0;
let filledRoles = 0;
let replacedVoices = 0;
let filledSilent = 0;
const voiceFixes = [];
for (const [chId, byWork] of listed) {
  if (!charById.has(chId)) continue;
  if (!roles.has(chId)) roles.set(chId, new Map());
  const mine = roles.get(chId);
  for (const [work, p] of byWork) {
    if (!p.voiced) {
      // 配役の一覧に声優が空で載っている（声の無い登場）。
      if (mine.has(work)) {
        mine.delete(work);
        voicedIn.get(chId)?.delete(work);
        filledSilent++;
      }
      continue;
    }
    if (p.vas.size === 0) continue;
    if (!mine.has(work)) {
      mine.set(work, p.role);
      filledAppearances++;
    } else if (ROLE_RANK[p.role] > ROLE_RANK[mine.get(work)]) {
      mine.set(work, p.role);
      filledRoles++;
    }
    // 配役の一覧が正。声優の出演作から入った声優（幼少期の声など）は置き換える。
    const before = [...(voicedIn.get(chId)?.get(work) ?? [])].sort().join(",");
    const after = [...p.vas].sort().join(",");
    if (before !== after) {
      if (before) {
        replacedVoices++;
        voiceFixes.push({ name: charById.get(chId).name, favourites: charById.get(chId).favourites ?? 0, work: workById.get(work)?.title ?? work, before, after });
      }
      if (!voicedIn.has(chId)) voicedIn.set(chId, new Map());
      voicedIn.get(chId).set(work, new Set(p.vas));
    }
  }
}
console.log(`配役の一覧から、登場を ${filledAppearances} 件足し、役を ${filledRoles} 件上げ、声優を ${replacedVoices} 件入れ直し、声の無い登場を ${filledSilent} 件外しました`);
const vaName = new Map(voiceActors.map((v) => [v.id, v.name]));
const names = (ids) => ids.split(",").filter(Boolean).map((id) => vaName.get(id) ?? id).join("・");
voiceFixes.sort((a, b) => b.favourites - a.favourites);
if (voiceFixes.length) console.log("声優を入れ直したキャラ（お気に入り順の上位）:");
for (const f of voiceFixes.slice(0, Number(process.env.SHOW ?? 25))) console.log(`  ${f.name}（${f.work}）: ${names(f.before)} → ${names(f.after)}`);

// ---- 2. 端役だけのキャラの照合 ----
const targets = characters.filter((c) => {
  if (!c.anilistId || !c.id.startsWith("ch:al-") || (c.favourites ?? 0) < MIN_FAVOURITES) return false;
  const anime = [...(roles.get(c.id) ?? [])].filter(([w]) => isAnime(w));
  return anime.length > 0 && anime.every(([, r]) => r === "BACKGROUND");
});
console.log(`登場がすべて端役のキャラ（お気に入り ${MIN_FAVOURITES} 以上）${targets.length} 人の出演作を取得します（約 ${Math.ceil((targets.length * 2.2) / 60)} 分）`);

/** キャラ → AniList の作品 ID → { role, vas: AniList の声優 ID } */
const fetched = new Map();
let done = 0;
for (const c of targets) {
  const data = await call(CHARACTER_QUERY, { id: c.anilistId });
  const edges = data?.Character?.media?.edges ?? [];
  const byMedia = new Map();
  for (const e of edges) {
    const m = e.node;
    if (!m?.id) continue;
    byMedia.set(m.id, { role: e.characterRole, vas: (e.voiceActors ?? []).map((v) => v.id), media: m });
  }
  fetched.set(c.id, byMedia);
  if (++done % 100 === 0) console.log(`  ${done} / ${targets.length}`);
}

// 登場と配役を直す。
let addedAppearances = 0;
let raisedRoles = 0;
let removedSilent = 0;
const changed = [];
for (const [chId, byMedia] of fetched) {
  const mine = roles.get(chId) ?? new Map();
  roles.set(chId, mine);
  /** 作品 → { role, vas（収集済みの声優 ID）, voiced（日本語の声優がいるか） } */
  const perWork = new Map();
  for (const { role, vas, media } of byMedia.values()) {
    const work = workOfMedia.get(media.id);
    if (!work) continue;
    const p = perWork.get(work) ?? { role: "BACKGROUND", vas: new Set(), voiced: false };
    if (ROLE_RANK[role] > ROLE_RANK[p.role]) p.role = role;
    for (const v of vas) if (vaOfAnilist.has(v)) p.vas.add(vaOfAnilist.get(v));
    if (vas.length) p.voiced = true;
    perWork.set(work, p);
  }
  const before = [...mine].map(([w, r]) => `${workById.get(w)?.title ?? w}(${r})`).join(", ");
  for (const [work, p] of perWork) {
    if (!p.voiced) {
      // 声の無い登場。相関図では声優を介して線を引くので、外す。
      if (mine.has(work)) {
        mine.delete(work);
        voicedIn.get(chId)?.delete(work);
        removedSilent++;
      }
      continue;
    }
    if (p.vas.size === 0) continue;
    if (!mine.has(work)) {
      mine.set(work, p.role);
      addedAppearances++;
    } else if (ROLE_RANK[p.role] > ROLE_RANK[mine.get(work)]) {
      mine.set(work, p.role);
      raisedRoles++;
    }
    for (const va of p.vas) voice(chId, work, va);
  }
  const after = [...mine].map(([w, r]) => `${workById.get(w)?.title ?? w}(${r})`).join(", ");
  if (before !== after) changed.push({ name: charById.get(chId).name, favourites: charById.get(chId).favourites ?? 0, before, after });
}

// ゲスト出演: 別の作品で主役・脇役のキャラが、シリーズでつながらない作品に端役で出ている登場。
/** 作品名の共通部分が 4 文字以上あれば同じシリーズとみなす（とある科学の超電磁砲 と とある科学の一方通行、など）。 */
const NOISE = /劇場版|映画|THE ANIMATION|THE MOVIE|OVA|ONA|[\s　・:：\-–―~～〜!！?？()（）「」『』【】]/giu;
function sameSeries(a, b) {
  const x = Array.from((workById.get(a)?.title ?? "").replace(NOISE, ""));
  const y = Array.from((workById.get(b)?.title ?? "").replace(NOISE, ""));
  for (let i = 0; i + 4 <= x.length; i++) if (y.join("").includes(x.slice(i, i + 4).join(""))) return true;
  return false;
}
const linked = new Map();
const link = (a, b) => {
  if (!linked.has(a)) linked.set(a, new Set());
  linked.get(a).add(b);
};
for (const s of series) {
  link(s.from, s.to);
  link(s.to, s.from);
}
let removedCameos = 0;
const cameos = [];
if (!KEEP_CAMEOS) {
  for (const [chId, mine] of roles) {
    if (!chId.startsWith("ch:al-")) continue;
    const home = [...mine].filter(([w, r]) => r !== "BACKGROUND" && isAnime(w)).map(([w]) => w);
    if (home.length === 0) continue;
    for (const [work, role] of [...mine]) {
      if (role !== "BACKGROUND" || !isAnime(work)) continue;
      if (home.some((h) => linked.get(h)?.has(work) || sameSeries(h, work))) continue;
      mine.delete(work);
      voicedIn.get(chId)?.delete(work);
      removedCameos++;
      cameos.push({ name: charById.get(chId).name, favourites: charById.get(chId).favourites ?? 0, work: workById.get(work)?.title ?? work });
    }
  }
}

// 書き戻す。登場の並びは元のまま（消したものを除き、足したものを後ろに）。
const nextAppearances = [];
const seen = new Set();
for (const a of appearances) {
  const role = roles.get(a.character)?.get(a.work);
  if (role === undefined) continue;
  seen.add(`${a.character}|${a.work}`);
  nextAppearances.push({ ...a, role });
}
for (const [chId, mine] of roles) {
  for (const [work, role] of mine) if (!seen.has(`${chId}|${work}`)) nextAppearances.push({ character: chId, work, role });
}
// 配役の行は fetch-anilist.mjs と同じ形に作り直す。どの作品でも同じ声優なら作品を添えずに 1 行にまとめる。
const nextAnimeCasts = [];
for (const c of characters) {
  const byWork = voicedIn.get(c.id);
  if (!byWork) continue;
  const mine = roles.get(c.id) ?? new Map();
  const entries = [...byWork].filter(([w, set]) => mine.has(w) && set.size > 0);
  if (entries.length === 0) continue;
  const sets = entries.map(([, set]) => [...set].sort().join(","));
  if (sets.every((s) => s === sets[0])) {
    for (const va of [...entries[0][1]].sort()) nextAnimeCasts.push({ voiceActor: va, character: c.id, medium: "anime" });
  } else {
    for (const [work, set] of entries) for (const va of [...set].sort()) nextAnimeCasts.push({ voiceActor: va, character: c.id, medium: "anime", work });
  }
}
// 元の配役の並びをなるべく保つ（差分を読みやすくする）。
const key = (c) => `${c.voiceActor}|${c.character}|${c.work ?? ""}`;
const order = new Map(animeCasts.map((c, i) => [key(c), i]));
nextAnimeCasts.sort((a, b) => (order.get(key(a)) ?? Infinity) - (order.get(key(b)) ?? Infinity));
const nextCasts = [...nextAnimeCasts, ...otherCasts];
const castChars = new Set(nextCasts.map((c) => c.character));
const appearChars = new Set(nextAppearances.map((a) => a.character));
// 配役か登場が無くなったキャラは相関図でつながらないので外す。
const nextCharacters = characters.filter((c) => castChars.has(c.id) && appearChars.has(c.id));
const kept = new Set(nextCharacters.map((c) => c.id));
const finalAppearances = nextAppearances.filter((a) => kept.has(a.character));
const finalCasts = nextCasts.filter((c) => kept.has(c.character));
const appearing = new Set(finalAppearances.map((a) => a.work));
const nextWorks = works.filter((w) => appearing.has(w.id) || !w.id.startsWith("wk:al-"));
const workIds = new Set(nextWorks.map((w) => w.id));
const nextSeries = series.filter((s) => workIds.has(s.from) && workIds.has(s.to));

const strip = (list) => list.map((item) => Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))));
const write = (name, list) => writeFile(join(OUT, name), `[\n${list.map((item) => JSON.stringify(item)).join(",\n")}\n]\n`);
// 演じるキャラが 1 人もいなくなった声優（幼少期の声だけで入っていた声優など）は、孤立するので外す。
const castVas = new Set(finalCasts.map((c) => c.voiceActor));
const nextVoiceActors = voiceActors.filter((v) => castVas.has(v.id));
await write("voice_actors.json", strip(nextVoiceActors));
await write("characters.json", strip(nextCharacters));
await write("works.json", strip(nextWorks));
await write("appearances.json", finalAppearances);
await write("casts.json", finalCasts);
await write("series.json", nextSeries);

console.log(`登場を ${addedAppearances} 件足し、役を ${raisedRoles} 件上げ、声の無い登場を ${removedSilent} 件外しました`);
if (removedGeneric) console.log(`「その他声」などの役の登場を ${removedGeneric} 件外しました`);
if (!KEEP_CAMEOS) console.log(`ゲスト出演を ${removedCameos} 件外しました`);
console.log(`声優 ${voiceActors.length} → ${nextVoiceActors.length}、キャラ ${characters.length} → ${nextCharacters.length}、作品 ${works.length} → ${nextWorks.length}`);
changed.sort((a, b) => b.favourites - a.favourites);
console.log("登場が変わったキャラ（お気に入り順の上位）:");
for (const c of changed.slice(0, 25)) console.log(`  ${c.name}: ${c.before} → ${c.after}`);
cameos.sort((a, b) => b.favourites - a.favourites);
if (cameos.length) console.log("外したゲスト出演（お気に入り順の上位）:");
for (const c of cameos.slice(0, Number(process.env.SHOW ?? 25))) console.log(`  ${c.name} × ${c.work}`);
