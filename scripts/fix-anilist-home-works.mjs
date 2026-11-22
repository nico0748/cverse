#!/usr/bin/env node
/**
 * AniList 由来のキャラが「端役で出た別の作品」にだけつながり、本来の作品につながっていないのを直す。
 *
 *   node scripts/fix-anilist-home-works.mjs [--min-favourites 1] [--keep-cameos] [--add-characters]
 *     [--supporting-favourites 100] [--fixed-voice-actors] [--out data/source] [--refresh]
 *
 * なぜ起きるか: fetch-anilist.mjs は、人気上位の作品だけ配役を全部取り、ほかの作品は「集まった声優の出演作（人気順 25 作品）」
 * からその声優のキャラだけを足す。そのため、人気が上位に届かない作品（例: 俺の妹がこんなに可愛いわけがない）の主役でも、
 * 演じた声優の出演作の上位 25 作品にその作品が入らないと、本来の作品への登場が抜ける。一方で、人気上位の作品に端役で
 * 出たカメオ（例: エロマンガ先生の五更瑠璃）は配役の一覧から入るので、カメオの作品にだけつながってしまう。
 * 声の無い登場（例: 僕は友達が少ないの五更瑠璃。AniList では声優が空）も配役の一覧から入っていた。
 *
 * 同じ理由で、主役ごと抜ける作品もある（魔都精兵のスレイブの羽前京香・出雲天花）。そこで、まず全作品の配役 1 ページ目を取り、
 * 収集済みのキャラの登場・役・声優を入れ直し、まだ収集していない主役（MAIN）と人気の脇役を足す。主役の声優をまだ収集して
 * いなければ、その声優も足す（`--fixed-voice-actors` で足さない）。足したあと主役が残っていないかは check-main-cast.mjs で確かめる。
 *
 * 次に、登場がすべて端役（BACKGROUND）のキャラについて、AniList のキャラのページ（出演作と各作品の声優）を取り、
 * - 収集済みの声優が演じている、収集済みの作品への登場を足す（端役より重い役なら役も上げる）。作品は増やさない
 * - そのキャラに日本語の声優がいない作品への登場を外す
 * そのあと、データ全体について、別の作品で主役・脇役のキャラが、シリーズでつながらない作品に端役で出ている登場（ゲスト出演）を
 * 外す（`--keep-cameos` で残す）。主役の声優を除き、声優は増やさない（fetch-anilist.mjs の「声優は固定」と同じ方針）。
 *
 * fetch-anilist.mjs のあと、fetch-wikipedia-games.mjs の前に実行する。何度実行しても同じ結果になる。
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toHiragana } from "./romaji.mjs";
import { call as callApi, clean, fetchFirstCastPages, GENERIC, mainVoices, workOfMediaMap } from "./anilist-cast.mjs";

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
// 配役の一覧にいて、まだ収集していないキャラをすべて足すか。既定では足さない（キャラが倍近くに増え、データの規模が変わるため）。
const ADD_CHARACTERS = args.includes("--add-characters");
// 既定でも、まだ収集していない主役（MAIN）は足す。脇役（SUPPORTING）は、お気に入りがこの数以上で、声優を収集済みのものだけ足す。
const SUPPORTING_FAVOURITES = Number(option("--supporting-favourites", 100));
if (!Number.isSafeInteger(SUPPORTING_FAVOURITES) || SUPPORTING_FAVOURITES < 0) {
  console.error("--supporting-favourites には 0 以上の整数を指定してください");
  process.exit(1);
}
// 主役の声優をまだ収集していなければ、その声優も足す（主役が抜けないように）。`--fixed-voice-actors` で声優を増やさない。
const FIXED_VOICE_ACTORS = args.includes("--fixed-voice-actors");
const REFRESH = args.includes("--refresh");
const call = (query, variables) => callApi(query, variables, { refresh: REFRESH });

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
const workOfMedia = workOfMediaMap(works);
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
// まだ収集していないキャラでも、主役（と人気の脇役）は足す。人気上位に入らない作品は、声優の出演作の上位に入らないと
// 主役ごと抜ける（魔都精兵のスレイブの羽前京香・出雲天花。1,779 作品で主役が 1 人もいなかった）。
const isKana = (s) => /^[぀-ヿ・ー\s・＝=]+$/.test(s);
function personReading(name) {
  const native = clean(name.native);
  if (native && isKana(native)) return native;
  const parts = [name.last, name.first].map(clean).filter(Boolean);
  const kana = (parts.length ? parts : [clean(name.full)]).map(toHiragana);
  return kana.every(Boolean) ? kana.join("") : undefined;
}
const today = new Date().toISOString().slice(0, 10);
const anilistImage = (url, pageUrl) => (url && !/\/default\.(jpg|png)$/.test(url) ? { url, source: "anilist", pageUrl, license: null, attribution: null } : undefined);
/** AniList の人物（キャラ・声優）を収集データの形にする。 */
function person(prefix, p, extra = {}) {
  const name = clean(p.name.native) || clean(p.name.full);
  if (!name) return null;
  return {
    id: `${prefix}:al-${p.id}`,
    name,
    reading: personReading(p.name),
    nameEn: clean(p.name.full) || undefined,
    ...extra,
    anilistId: p.id,
    favourites: p.favourites ?? 0,
    image: anilistImage(p.image?.large, p.siteUrl),
    sources: [{ source: "anilist", url: p.siteUrl, fetchedAt: today }],
  };
}
/** 収集していないキャラを、この役なら足すか。 */
function shouldAdd(role, c, vasCollected) {
  if (ADD_CHARACTERS) return true;
  if (role === "MAIN") return true;
  return role === "SUPPORTING" && vasCollected && (c.favourites ?? 0) >= SUPPORTING_FAVOURITES;
}
const castPages = await fetchFirstCastPages([...workOfMedia.keys()], { refresh: REFRESH });
/** キャラ → 作品 → { role, vas: Set, voiced } */
const listed = new Map();
const addedCharacters = [];
const addedVoiceActors = [];
for (const [id, edges] of castPages) {
  const work = workOfMedia.get(id);
  for (const e of edges) {
    const c = e.node;
    if (!c?.id) continue;
    const chId = `ch:al-${c.id}`;
    if (GENERIC.test(clean(c.name.native)) || GENERIC.test(clean(c.name.full))) continue;
    const voices = mainVoices(e);
    const role = ["MAIN", "SUPPORTING", "BACKGROUND"].includes(e.role) ? e.role : "BACKGROUND";
    if (!charById.has(chId) && voices.length) {
      const collected = voices.some((v) => vaOfAnilist.has(v.id));
      if (!shouldAdd(role, c, collected)) continue;
      // 声優を増やさないときは、収集済みの声優が演じるキャラだけ足す。
      if (!collected && (FIXED_VOICE_ACTORS || role !== "MAIN")) continue;
      const record = person("ch", c, { aliases: (c.name.alternative ?? []).map(clean).filter((a) => a && a.length <= 40).slice(0, 6) });
      if (!record) continue;
      characters.push(record);
      charById.set(chId, record);
      addedCharacters.push({ name: record.name, favourites: record.favourites, role, work: workById.get(work)?.title ?? work });
    }
    if (!charById.has(chId)) continue;
    if (role === "MAIN" && !FIXED_VOICE_ACTORS) {
      for (const v of voices) {
        if (vaOfAnilist.has(v.id)) continue;
        const record = person("va", v);
        if (!record) continue;
        voiceActors.push(record);
        vaOfAnilist.set(v.id, record.id);
        addedVoiceActors.push(record.name);
      }
    }
    const use = voices.map((v) => vaOfAnilist.get(v.id)).filter(Boolean);
    if (!listed.has(chId)) listed.set(chId, new Map());
    const p = listed.get(chId).get(work) ?? { role: "BACKGROUND", vas: new Set(), voiced: false };
    if (ROLE_RANK[role] > ROLE_RANK[p.role]) p.role = role;
    if (voices.length) p.voiced = true;
    for (const v of use) p.vas.add(v);
    listed.get(chId).set(work, p);
  }
}
console.log(`配役の一覧から、まだ収集していないキャラを ${addedCharacters.length} 人、声優を ${addedVoiceActors.length} 人足しました`);
addedCharacters.sort((a, b) => b.favourites - a.favourites);
for (const c of addedCharacters.slice(0, Number(process.env.SHOW ?? 25))) console.log(`  ${c.name}（${c.work}、${c.role}）`);
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
