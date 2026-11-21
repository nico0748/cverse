//! 名寄せ（エンティティ解決）用の文字列類似度。
//!
//! 読みの表記ゆれ（長音・促音の有無、1 文字違い）に強い Jaro-Winkler を使う。
//! 編集距離と違って 0〜1 に正規化されており、短い人名でもしきい値を決めやすい。
//! 先頭が一致するほど加点されるので、姓が同じ別表記を拾いやすい。

/// Jaro 類似度（0.0〜1.0）。
pub fn jaro(a: &str, b: &str) -> f64 {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    if a.is_empty() && b.is_empty() {
        return 1.0;
    }
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let window = (a.len().max(b.len()) / 2).saturating_sub(1);
    let mut a_matched = vec![false; a.len()];
    let mut b_matched = vec![false; b.len()];
    let mut matches = 0usize;
    for (i, &ca) in a.iter().enumerate() {
        let lo = i.saturating_sub(window);
        let hi = (i + window + 1).min(b.len());
        for j in lo..hi {
            if !b_matched[j] && b[j] == ca {
                a_matched[i] = true;
                b_matched[j] = true;
                matches += 1;
                break;
            }
        }
    }
    if matches == 0 {
        return 0.0;
    }
    // 転置: 一致した文字を順に並べたとき、位置が食い違う数の半分。
    let mut transpositions = 0usize;
    let mut j = 0;
    for (i, &ca) in a.iter().enumerate() {
        if !a_matched[i] {
            continue;
        }
        while !b_matched[j] {
            j += 1;
        }
        if ca != b[j] {
            transpositions += 1;
        }
        j += 1;
    }
    let m = matches as f64;
    (m / a.len() as f64 + m / b.len() as f64 + (m - transpositions as f64 / 2.0) / m) / 3.0
}

/// Jaro-Winkler 類似度。先頭の共通部分（最大 4 文字）に応じて加点する。
pub fn jaro_winkler(a: &str, b: &str) -> f64 {
    let j = jaro(a, b);
    let prefix = a
        .chars()
        .zip(b.chars())
        .take(4)
        .take_while(|(x, y)| x == y)
        .count();
    j + prefix as f64 * 0.1 * (1.0 - j)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-3
    }

    #[test]
    fn textbook_values() {
        assert!(close(jaro("martha", "marhta"), 0.9444));
        assert!(close(jaro_winkler("martha", "marhta"), 0.9611));
        assert!(close(jaro("dixon", "dicksonx"), 0.7667));
        assert!(close(jaro_winkler("dixon", "dicksonx"), 0.8133));
        assert!(close(jaro("crate", "trace"), 0.7333));
    }

    #[test]
    fn edge_cases_and_kana() {
        assert_eq!(jaro("", ""), 1.0);
        assert_eq!(jaro("a", ""), 0.0);
        assert_eq!(jaro("abc", "xyz"), 0.0);
        assert_eq!(jaro_winkler("はなざわかな", "はなざわかな"), 1.0);
        // 1 文字違いの読みは高く、別人は低い
        assert!(jaro_winkler("さいとうそうま", "さいとうそーま") > 0.9);
        assert!(jaro_winkler("さいとうそうま", "かみやひろし") < 0.6);
    }
}
