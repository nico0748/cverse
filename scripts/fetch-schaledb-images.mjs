#!/usr/bin/env node
/**
 * ブルーアーカイブのキャラに、SchaleDB の生徒アイコンを付ける（AniList・Bangumi の画像より優先する）。
 *
 *   node scripts/fetch-schaledb-images.mjs [--out data/source] [--students path/to/students.json] [--refresh]
 *
 * - 生徒の一覧は SchaleDB（https://github.com/nico0748/SchaleDB 、lonqie/SchaleDB のフォーク）の data/jp/students.json。
 *   アイコンは同じリポジトリの images/student/icon/<Id>.webp を raw.githubusercontent.com から直接参照する（サイトには保存しない）。
 *   画像の権利は ブルーアーカイブ の権利者（NEXON Games / Yostar）にある
 * - 同じ人物とみなすのは、姓名（FamilyName + PersonalName）が正規化して一致するとき。声優が両方にあって食い違えば合わせない。
 *   姓名で合わないときは、名（PersonalName）と声優の両方が 1 人だけに合うときに使う
 * - 「アル（正月）」「ホシノ（臨戦）」などの別衣装は使わない（CVerse ではキャラ 1 人を 1 ノードにしている）。
 *   「シロコ＊テラー」のように別キャラとして登録されているものは、その名前そのものが一致したときだけ使う
 * - 対象は、ブルーアーカイブに配役がある全キャラ（アニメ由来の ch:al- も含む）。ゲームキャラの画像スクリプトのあとに実行する
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
const STUDENTS = option("--students", null);
const REFRESH = args.includes("--refresh");
const CACHE = join(here, ".cache");
const REPO = "nico0748/SchaleDB";
const BRANCH = "main";
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
const GAME = "wk:wp-bluearchive";
const UA = "CVerseDataCollector/0.1 (https://github.com/nico0748/cverse; portfolio project)";
const today = new Date().toISOString().slice(0, 10);

const iconUrl = (id) => `${RAW}/images/student/icon/${id}.webp`;
const pageUrl = (id) => `https://github.com/${REPO}/blob/${BRANCH}/images/student/icon/${id}.webp`;

export const norm = (s) =>
  (typeof s === "string" ? s : "")
    .normalize("NFKC")
    .replace(/[\s　・=＝.·]/g, "")
    .replace(/﨑/g, "崎")
    .replace(/髙/g, "高")
    .toLowerCase();

const isForm = (name) => /[（(]/.test(name ?? "");

/**
 * students.json の 1 人を照合用の形にする。別衣装（「（水着）」など）は null。
 * 名前が名・姓名のどちらでもないもの（「シロコ＊テラー」）は、その名前そのものだけで合わせる。
 */
export function toCandidate(s) {
  if (!s || isForm(s.Name)) return null;
  const full = norm(`${s.FamilyName ?? ""}${s.PersonalName ?? ""}`);
  const given = norm(s.PersonalName);
  const name = norm(s.Name);
  const base = name === given || name === full;
  return {
    id: s.Id,
    label: s.Name,
    names: base ? [...new Set([full, name].filter(Boolean))] : [name],
    given: base ? given : null,
    va: norm(s.CharacterVoice),
  };
}

/** CVerse のキャラ 1 人に合う生徒を選ぶ。`vas` はこちらの声優名（正規化済み）。 */
export function pick(name, vas, candidates) {
  const n = norm(name);
  if (!n || isForm(name)) return null;
  const vaOk = (c) => !c.va || vas.size === 0 || vas.has(c.va);
  const exact = candidates.filter((c) => c.names.includes(n));
  if (exact.length) {
    const ok = exact.filter(vaOk);
    if (ok.length === 1) return ok[0];
    const byVa = ok.filter((c) => vas.has(c.va));
    return byVa.length === 1 ? byVa[0] : null;
  }
  // 姓が書かれていない・表記が違うとき: 名と声優の両方が合う 1 人だけ。
  const partial = candidates.filter((c) => c.given && c.va && vas.has(c.va) && (n === c.given || n.endsWith(c.given)));
  return partial.length === 1 ? partial[0] : null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** URL を取って、本文（json）か存在の有無（head）を返す。結果は URL ごとにキャッシュする。 */
async function fetchCached(url, kind) {
  const file = join(CACHE, `schaledb-${createHash("sha1").update(`${kind}:${url}`).digest("hex").slice(0, 16)}.json`);
  if (!REFRESH) {
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch {
      // キャッシュに無ければ取りに行く。
    }
  }
  for (let attempt = 1; attempt <= 4; attempt++) {
    let response;
    try {
      response = await fetch(url, { method: kind === "head" ? "HEAD" : "GET", headers: { "User-Agent": UA } });
    } catch (error) {
      console.warn(`  通信に失敗（${attempt} 回目）: ${error.message}`);
      await sleep(3000 * attempt);
      continue;
    }
    let value;
    if (kind === "head") {
      if (response.status !== 200 && response.status !== 404) {
        await sleep(3000 * attempt);
        continue;
      }
      value = response.status === 200 && /^image\//.test(response.headers.get("content-type") ?? "");
    } else {
      if (!response.ok) {
        console.warn(`  応答が不正（${response.status}、${attempt} 回目）`);
        await sleep(3000 * attempt);
        continue;
      }
      value = await response.json();
    }
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, JSON.stringify(value));
    return value;
  }
  throw new Error(`SchaleDB から取得できませんでした: ${url}`);
}

async function main() {
  const readJson = async (name) => JSON.parse(await readFile(join(OUT, name), "utf8"));
  const [characters, casts, voiceActors] = await Promise.all(["characters.json", "casts.json", "voice_actors.json"].map(readJson));
  const students = STUDENTS
    ? JSON.parse(await readFile(STUDENTS, "utf8"))
    : await fetchCached(`${RAW}/data/jp/students.json`, "json");
  const candidates = Object.values(students).map(toCandidate).filter(Boolean);

  const byId = new Map(characters.map((c) => [c.id, c]));
  const vaName = new Map(voiceActors.map((v) => [v.id, norm(v.name)]));
  const targets = new Map();
  for (const cast of casts) {
    if (cast.work !== GAME) continue;
    const ch = byId.get(cast.character);
    if (!ch) continue;
    const entry = targets.get(ch.id) ?? { ch, vas: new Set() };
    if (vaName.get(cast.voiceActor)) entry.vas.add(vaName.get(cast.voiceActor));
    targets.set(ch.id, entry);
  }

  const used = new Map();
  const counts = { replaced: new Map(), added: 0 };
  const loose = [];
  const missing = [];
  for (const { ch, vas } of targets.values()) {
    ch.sources = (ch.sources ?? []).filter((s) => s.source !== "schaledb");
    // 前回付けた画像は外して照合し直す（合わなくなったら画像なしに戻る。Bangumi のスクリプトを実行し直せば埋まる）。
    if (ch.image?.source === "schaledb") delete ch.image;
    const found = pick(ch.name, vas, candidates);
    if (!found) {
      missing.push(ch.name);
      continue;
    }
    if (used.has(found.id)) {
      console.warn(`  同じ生徒に 2 人が合ったので、あとの方は使いません: ${used.get(found.id)} / ${ch.name} → ${found.label}`);
      continue;
    }
    if (!(await fetchCached(iconUrl(found.id), "head"))) {
      console.warn(`  アイコンがリポジトリに無い: ${found.label}（${found.id}）`);
      missing.push(ch.name);
      continue;
    }
    used.set(found.id, ch.name);
    if (ch.image) {
      const from = ch.image.source ?? "?";
      counts.replaced.set(from, (counts.replaced.get(from) ?? 0) + 1);
    } else counts.added++;
    // Bangumi の出典は画像のためだけにあるので、画像を差し替えたら外す（AniList は anilistId のリンクがあるので残す）。
    if (ch.image?.source === "bangumi") ch.sources = ch.sources.filter((s) => s.source !== "bangumi");
    ch.image = { url: iconUrl(found.id), source: "schaledb", pageUrl: pageUrl(found.id), license: null, attribution: null };
    ch.sources.push({ source: "schaledb", url: pageUrl(found.id), fetchedAt: today });
    if (!found.names.includes(norm(ch.name))) loose.push(`${ch.name} → ${found.label}`);
  }

  await writeFile(join(OUT, "characters.json"), `[\n${characters.map((item) => JSON.stringify(item)).join(",\n")}\n]\n`);
  const replaced = [...counts.replaced].map(([k, v]) => `${k} ${v}`).join("、") || "なし";
  console.log(`SchaleDB の生徒 ${candidates.length} 人（別衣装を除く）、ブルーアーカイブのキャラ ${targets.size} 人`);
  console.log(`  アイコンを付けた: ${used.size} 人（差し替え: ${replaced}、新たに付けた: ${counts.added}）`);
  if (loose.length) console.log(`  名と声優で合わせたもの ${loose.length} 件:\n    ${loose.join("\n    ")}`);
  console.log(`  合わなかったもの ${missing.length} 人（もとの画像のまま）: ${missing.join("、")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
