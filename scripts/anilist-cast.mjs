/**
 * AniList の API 呼び出しと、作品ごとの配役 1 ページ目の取得を、fix-anilist-home-works.mjs と check-main-cast.mjs で共有する。
 * 応答は scripts/.cache/ に問い合わせの内容ごとに置くので、同じ問い合わせはどちらのスクリプトからでも使い回せる。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CACHE = join(here, ".cache");
const API = "https://graphql.anilist.co";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastCall = 0;

/** API を 1 回呼ぶ。`refresh` が偽ならキャッシュを使う。404 は null。 */
export async function call(query, variables, { refresh = false } = {}) {
  const key = createHash("sha1").update(query + JSON.stringify(variables)).digest("hex").slice(0, 16);
  const file = join(CACHE, `${key}.json`);
  if (!refresh) {
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
    if (response.status === 404) return null;
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

const PERSON = "id name { native full first last alternative } image { large } favourites siteUrl";
/** 配役の 1 ページ目（主役が先、次にお気に入り順で 25 人）を、作品ごとに別名を付けて 1 回の問い合わせにまとめる。 */
const FIRST_CAST_QUERY = (ids) => `{${ids
  .map(
    (id) => `m${id}: Media(id: ${id}) { id characters(page: 1, perPage: 25, sort: [ROLE, FAVOURITES_DESC]) { edges {
      role
      node { ${PERSON} }
      voiceActorRoles(language: JAPANESE) { roleNotes voiceActor { ${PERSON} } }
    } } }`,
  )
  .join("\n")}}`;
// 1 回の問い合わせの複雑さの上限（500）に収まる本数。声優の詳細まで取ると 1 作品あたり約 31。
const BATCH = 15;

/** 作品（AniList の ID）ごとの配役 1 ページ目の edges。 */
export async function fetchFirstCastPages(mediaIds, { refresh = false, log = console.log } = {}) {
  const ids = [...new Set(mediaIds)].sort((a, b) => a - b);
  log(`作品 ${ids.length} 本の配役の 1 ページ目を取得します（キャッシュが無ければ約 ${Math.ceil(((ids.length / BATCH) * 2.2) / 60)} 分）`);
  const result = new Map();
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const data = await call(FIRST_CAST_QUERY(batch), {}, { refresh });
    for (const id of batch) result.set(id, data?.[`m${id}`]?.characters?.edges ?? []);
    if ((i / BATCH + 1) % 50 === 0) log(`  ${Math.min(i + BATCH, ids.length)} / ${ids.length}`);
  }
  return result;
}

/** 収集データの作品から、AniList の作品 ID → まとめた先の作品 ID（シーズン・劇場版は 1 つの作品の出典に並んでいる）。 */
export function workOfMediaMap(works) {
  const map = new Map();
  for (const w of works) {
    if (!w.id.startsWith("wk:al-")) continue;
    for (const s of w.sources ?? []) {
      const m = /anilist\.co\/anime\/(\d+)/.exec(s.url ?? "");
      if (m) map.set(Number(m[1]), w.id);
    }
    if (w.anilistId) map.set(w.anilistId, w.id);
  }
  return map;
}

/** 幼少期・若い頃の声。ほかに声優がいれば、こちらは配役に入れない。 */
export const YOUNG = /young|child|kid|幼少|幼年|少年期|少女期|子供/i;
/** 「ナレーター」のように、作品をまたいで同じ人物ではない役。 */
export const GENERIC = /^(ナレーター|ナレーション|語り|語り手|その他声|その他の声|Narrator|Narration|Sonohokasei)$/i;
export const clean = (s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

/** 配役の 1 件から、使う声優（幼少期の声は、ほかに声優がいれば外す）。 */
export function mainVoices(edge) {
  const roles = (edge.voiceActorRoles ?? []).filter((r) => r?.voiceActor?.id);
  const main = roles.filter((r) => !YOUNG.test(r.roleNotes ?? ""));
  return (main.length ? main : roles).map((r) => r.voiceActor);
}
