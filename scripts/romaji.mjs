/**
 * ヘボン式ローマ字をひらがなに直す（AniList には読みが無いので、検索用の読みをローマ字から起こす）。
 * 完全ではない（「ou」と「oo」の区別、外来語の表記など）が、検索はローマ字由来の読みでも当たるようにする。
 * かなに直せない文字が残る場合は空文字列を返す（その作品・人物は名前そのものでしか検索に当たらない）。
 */
const TABLE = {
  kya: "きゃ", kyu: "きゅ", kyo: "きょ", gya: "ぎゃ", gyu: "ぎゅ", gyo: "ぎょ",
  sha: "しゃ", shu: "しゅ", sho: "しょ", she: "しぇ", shi: "し", sya: "しゃ", syu: "しゅ", syo: "しょ",
  ja: "じゃ", ju: "じゅ", jo: "じょ", je: "じぇ", ji: "じ", jya: "じゃ", jyu: "じゅ", jyo: "じょ",
  cha: "ちゃ", chu: "ちゅ", cho: "ちょ", che: "ちぇ", chi: "ち", tsu: "つ",
  nya: "にゃ", nyu: "にゅ", nyo: "にょ", hya: "ひゃ", hyu: "ひゅ", hyo: "ひょ",
  bya: "びゃ", byu: "びゅ", byo: "びょ", pya: "ぴゃ", pyu: "ぴゅ", pyo: "ぴょ",
  mya: "みゃ", myu: "みゅ", myo: "みょ", rya: "りゃ", ryu: "りゅ", ryo: "りょ",
  fa: "ふぁ", fi: "ふぃ", fu: "ふ", fe: "ふぇ", fo: "ふぉ", va: "ゔぁ", vi: "ゔぃ", vu: "ゔ", ve: "ゔぇ", vo: "ゔぉ",
  ti: "てぃ", di: "でぃ", tu: "とぅ", du: "どぅ", wi: "うぃ", we: "うぇ", dzu: "づ",
  ka: "か", ki: "き", ku: "く", ke: "け", ko: "こ", ga: "が", gi: "ぎ", gu: "ぐ", ge: "げ", go: "ご",
  sa: "さ", si: "し", su: "す", se: "せ", so: "そ", za: "ざ", zi: "じ", zu: "ず", ze: "ぜ", zo: "ぞ",
  ta: "た", te: "て", to: "と", da: "だ", de: "で", do: "ど",
  na: "な", ni: "に", nu: "ぬ", ne: "ね", no: "の", ha: "は", hi: "ひ", hu: "ふ", he: "へ", ho: "ほ",
  ba: "ば", bi: "び", bu: "ぶ", be: "べ", bo: "ぼ", pa: "ぱ", pi: "ぴ", pu: "ぷ", pe: "ぺ", po: "ぽ",
  ma: "ま", mi: "み", mu: "む", me: "め", mo: "も", ya: "や", yu: "ゆ", yo: "よ",
  ra: "ら", ri: "り", ru: "る", re: "れ", ro: "ろ", wa: "わ", wo: "を",
  la: "ら", li: "り", lu: "る", le: "れ", lo: "ろ",
  a: "あ", i: "い", u: "う", e: "え", o: "お",
};
const LONG = { ā: "aa", ī: "ii", ū: "uu", ē: "ee", ō: "ou", â: "aa", î: "ii", û: "uu", ê: "ee", ô: "ou" };

export function toHiragana(romaji) {
  let s = String(romaji ?? "")
    .toLowerCase()
    .replace(/[āīūēōâîûêô]/g, (c) => LONG[c])
    .replace(/n['’]/g, "ん")
    .replace(/[\s\-'’.:!?,・/&~()\[\]"“”*+×☆★♪]/g, "");
  if (!s || /[^a-z0-9ん]/.test(s)) return "";
  let out = "";
  while (s) {
    if (/^[0-9ん]/.test(s)) {
      out += s[0];
      s = s.slice(1);
      continue;
    }
    // 促音（同じ子音の連続）と撥音。
    if (s.length >= 2 && s[0] === s[1] && !"aiueon".includes(s[0])) {
      out += "っ";
      s = s.slice(1);
      continue;
    }
    if (s.startsWith("tch")) {
      out += "っ";
      s = s.slice(1);
      continue;
    }
    let hit = false;
    for (const len of [3, 2, 1]) {
      const kana = TABLE[s.slice(0, len)];
      if (kana) {
        out += kana;
        s = s.slice(len);
        hit = true;
        break;
      }
    }
    if (hit) continue;
    if (s[0] === "n" || s[0] === "m") {
      out += "ん";
      s = s.slice(1);
      continue;
    }
    return "";
  }
  return out;
}
