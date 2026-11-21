//! 検索と名寄せで共有する文字列正規化。
//!
//! 1. NFKC（全角英数 → 半角、半角カナ → 全角 など）
//! 2. 英字を小文字に
//! 3. カタカナをひらがなに統一
//! 4. 空白・中黒・記号を除去（文字と数字だけ残す。長音記号「ー」は残す）

use unicode_normalization::UnicodeNormalization;

/// 比較用のキーに正規化する。
pub fn normalize(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.nfkc() {
        let ch = match ch {
            // カタカナ（ァ〜ヶ）→ ひらがな
            '\u{30A1}'..='\u{30F6}' => char::from_u32(ch as u32 - 0x60).unwrap_or(ch),
            // カタカナの踊り字 ヽヾ → ゝゞ
            '\u{30FD}' | '\u{30FE}' => char::from_u32(ch as u32 - 0x60).unwrap_or(ch),
            _ => ch,
        };
        if ch.is_alphanumeric() {
            out.extend(ch.to_lowercase());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::normalize;

    #[test]
    fn folds_kana_width_and_case() {
        assert_eq!(normalize("ハナザワ カナ"), "はなざわかな");
        assert_eq!(normalize("ﾊﾅｻﾞﾜ"), "はなざわ");
        assert_eq!(normalize("ＦＡＴＥ／stay night"), "fatestaynight");
        assert_eq!(
            normalize("ヴァイオレット・エヴァーガーデン"),
            "ゔぁいおれっとえゔぁーがーでん"
        );
    }

    #[test]
    fn strips_symbols_but_keeps_kanji() {
        assert_eq!(normalize("けいおん！！"), "けいおん");
        assert_eq!(
            normalize("Re:ゼロから始める異世界生活"),
            "reぜろから始める異世界生活"
        );
        assert_eq!(normalize("　☆ "), "");
    }
}
