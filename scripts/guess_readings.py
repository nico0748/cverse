#!/usr/bin/env python3
"""読みが取れなかった作品に、漢字かな変換（pykakasi）で推定した読みを付ける（docs/data-schema.md の形式）。

    pip install pykakasi
    python3 scripts/guess_readings.py [--out data/source]

- 対象は reading の無い作品だけ。AniList のローマ字、Wikidata のかな表記、Wikipedia の冒頭の読み
  （scripts/enrich-wikidata.mjs）のどれでも決まらなかったもの
- 推定した読みには `readingGuessed: true` を付ける。辞書の読みなので固有名詞は外れることがある
  （「鬼滅」を「おにほろ」と読むなど）。ひらがな検索で見つかりやすくするための補助で、画面に読みとして出すものではない
- かな以外（英字・数字・記号）は読みから外す。タイトルそのものは別に検索の対象になっている
- 何度実行しても同じ結果になる（前回推定した読みは付け直す）
"""

import argparse
import json
import re
import unicodedata
from pathlib import Path

import pykakasi

KANA = re.compile(r"[ぁ-ゖァ-ヺー]")
KANJI = re.compile(r"[㐀-鿿豈-﫿々〆]")


def guess(title: str, kakasi) -> str | None:
    text = unicodedata.normalize("NFKC", title)
    hira = "".join(part["hira"] for part in kakasi.convert(text))
    if KANJI.search(hira):  # 読めなかった漢字が残った
        return None
    hira = "".join(KANA.findall(hira))
    hira = re.sub(r"[ァ-ヶ]", lambda m: chr(ord(m.group()) - 0x60), hira)
    return hira if len(hira) >= 2 else None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "data" / "source"))
    args = parser.parse_args()
    path = Path(args.out) / "works.json"
    works = json.loads(path.read_text(encoding="utf-8"))
    kakasi = pykakasi.kakasi()
    guessed = 0
    for work in works:
        if work.get("readingGuessed"):
            work.pop("reading", None)
            work.pop("readingGuessed", None)
        if work.get("reading"):
            continue
        reading = guess(work["title"], kakasi)
        if reading:
            work["reading"] = reading
            if KANJI.search(work["title"]):  # かなだけのタイトルは読みがそのまま決まる
                work["readingGuessed"] = True
            guessed += 1
    path.write_text("[\n" + ",\n".join(json.dumps(w, ensure_ascii=False, separators=(",", ":")) for w in works) + "\n]\n", encoding="utf-8")
    filled = sum(1 for w in works if w.get("reading"))
    print(f"推定した読み: {guessed} 件 / 読みのある作品: {filled}/{len(works)}")


if __name__ == "__main__":
    main()
