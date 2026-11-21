//! 名寄せ（エンティティ解決）の候補出し。要件定義書 7.3 の手順に沿う。
//!
//! 1. 正規化: `cverse_core::normalize`
//! 2. 候補の絞り込み（ブロッキング）: 正規化した読み（無ければ名前）の先頭 2 文字で
//!    グループ分けし、同じグループの中だけを比べる。全組み合わせ O(n²) を避ける
//! 3. スコア: 読みの Jaro-Winkler と、グラフ上の証拠（隣接ノードの重なり＝Jaccard 係数）
//! 4. 判定: `AUTO` 以上は自動統合、`REVIEW` 以上は確認待ち、それ未満は別物
//!
//! 外部 ID（AniList ID・Wikidata ID）が一致すれば文字列に関係なく同一とみなし、
//! 両方に外部 ID があって食い違えば別物とみなす。
//!
//! しきい値は暫定値。手で正解を付けたサンプルで適合率・再現率を測って決め直す前提で、
//! このコマンドはデータを書き換えず、候補を JSON で出すだけにしている。

use std::collections::{HashMap, HashSet};

use cverse_core::normalize::normalize;
use cverse_core::similarity::jaro_winkler;
use serde::Serialize;

use crate::model::Dataset;

pub const AUTO: f64 = 0.93;
pub const REVIEW: f64 = 0.80;
/// 文字列類似度とグラフ上の証拠の配分。
const W_TEXT: f64 = 0.7;
const W_GRAPH: f64 = 0.3;

#[derive(Debug, Serialize, PartialEq)]
pub struct Candidate {
    pub a: String,
    pub b: String,
    pub name_a: String,
    pub name_b: String,
    pub text: f64,
    pub graph: f64,
    pub score: f64,
    pub decision: &'static str,
}

struct Entity<'a> {
    id: &'a str,
    name: &'a str,
    key: String,
    external: Option<u64>,
    /// 食い違っていたら自動統合しない属性（作品の形態・年）。続編は題名も出演者もほぼ同じになる。
    variant: Option<String>,
    neighbors: HashSet<&'a str>,
}

fn jaccard(a: &HashSet<&str>, b: &HashSet<&str>) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let inter = a.intersection(b).count() as f64;
    inter / (a.len() as f64 + b.len() as f64 - inter)
}

fn score_pair(a: &Entity, b: &Entity) -> Option<Candidate> {
    let text = jaro_winkler(&a.key, &b.key);
    let graph = jaccard(&a.neighbors, &b.neighbors);
    let score = match (a.external, b.external) {
        (Some(x), Some(y)) if x == y => 1.0,
        // 両方に外部 ID があって違うなら別物。
        (Some(_), Some(_)) => return None,
        // 片方が孤立していてグラフ上の証拠が取れないときは、文字列だけで判断する。
        _ if a.neighbors.is_empty() || b.neighbors.is_empty() => text,
        _ => W_TEXT * text + W_GRAPH * graph,
    };
    if score < REVIEW {
        return None;
    }
    Some(Candidate {
        a: a.id.to_owned(),
        b: b.id.to_owned(),
        name_a: a.name.to_owned(),
        name_b: b.name.to_owned(),
        text,
        graph,
        score,
        decision: if score >= AUTO && a.variant == b.variant {
            "auto"
        } else {
            "review"
        },
    })
}

fn candidates_in(entities: Vec<Entity>) -> Vec<Candidate> {
    let mut blocks: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, e) in entities.iter().enumerate() {
        let block: String = e.key.chars().take(2).collect();
        if !block.is_empty() {
            blocks.entry(block).or_default().push(i);
        }
    }
    let mut out = Vec::new();
    for members in blocks.values() {
        for (n, &i) in members.iter().enumerate() {
            for &j in &members[n + 1..] {
                out.extend(score_pair(&entities[i], &entities[j]));
            }
        }
    }
    out
}

/// 同じ種類のノードどうしで、同一かもしれない組を返す（スコアの高い順）。
pub fn candidates(ds: &Dataset) -> Vec<Candidate> {
    let mut neighbors: HashMap<&str, HashSet<&str>> = HashMap::new();
    for c in &ds.casts {
        neighbors
            .entry(&c.voice_actor)
            .or_default()
            .insert(&c.character);
        neighbors
            .entry(&c.character)
            .or_default()
            .insert(&c.voice_actor);
    }
    for a in &ds.appearances {
        neighbors.entry(&a.character).or_default().insert(&a.work);
        neighbors.entry(&a.work).or_default().insert(&a.character);
    }
    let mut take = |id: &str| neighbors.remove(id).unwrap_or_default();

    let vas = ds
        .voice_actors
        .iter()
        .map(|v| Entity {
            id: &v.id,
            name: &v.name,
            key: normalize(v.reading.as_deref().unwrap_or(&v.name)),
            external: v.anilist_id,
            variant: None,
            neighbors: take(&v.id),
        })
        .collect();
    let works = ds
        .works
        .iter()
        .map(|w| Entity {
            id: &w.id,
            name: &w.title,
            key: normalize(&w.title),
            external: w.anilist_id,
            variant: Some(format!("{}/{}", w.format, w.year.unwrap_or(0))),
            neighbors: take(&w.id),
        })
        .collect();
    let chars = ds
        .characters
        .iter()
        .map(|c| Entity {
            id: &c.id,
            name: &c.name,
            key: normalize(c.reading.as_deref().unwrap_or(&c.name)),
            external: c.anilist_id,
            variant: None,
            neighbors: take(&c.id),
        })
        .collect();

    let mut out = candidates_in(vas);
    out.extend(candidates_in(works));
    // キャラは同名の別人が多いので、文字列だけでは統合候補にしない（証拠が必要）。
    out.extend(
        candidates_in(chars)
            .into_iter()
            .filter(|c| c.graph > 0.0 || c.score >= 1.0),
    );
    out.sort_by(|x, y| y.score.total_cmp(&x.score).then_with(|| x.a.cmp(&y.a)));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dataset() -> Dataset {
        fn load<T: serde::de::DeserializeOwned>(json: &str) -> T {
            serde_json::from_str(json).unwrap()
        }
        Dataset {
            voice_actors: load(
                r#"[
                {"id":"va:a","name":"斉藤壮馬","reading":"さいとうそうま","anilistId":1},
                {"id":"va:b","name":"斉藤壮馬","reading":"さいとうそーま"},
                {"id":"va:c","name":"神谷浩史","reading":"かみやひろし"},
                {"id":"va:d","name":"斉藤壮真","reading":"さいとうそうま","anilistId":2}
            ]"#,
            ),
            characters: load(r#"[{"id":"ch:1","name":"A"},{"id":"ch:2","name":"B"}]"#),
            works: load(
                r#"[
                {"id":"wk:1","title":"けいおん!","format":"TV","year":2009},
                {"id":"wk:2","title":"けいおん!!","format":"TV","year":2010}
            ]"#,
            ),
            casts: load(
                r#"[
                {"voiceActor":"va:a","character":"ch:1","medium":"anime"},
                {"voiceActor":"va:a","character":"ch:2","medium":"anime"},
                {"voiceActor":"va:b","character":"ch:1","medium":"game"},
                {"voiceActor":"va:b","character":"ch:2","medium":"game"}
            ]"#,
            ),
            appearances: load(
                r#"[
                {"character":"ch:1","work":"wk:1","role":"MAIN"},
                {"character":"ch:1","work":"wk:2","role":"MAIN"}
            ]"#,
            ),
            ..Dataset::default()
        }
    }

    #[test]
    fn finds_spelling_variants_with_shared_roles() {
        let list = candidates(&dataset());
        let pair = list
            .iter()
            .find(|c| c.a == "va:a" && c.b == "va:b")
            .expect("a–b");
        assert_eq!(pair.decision, "auto");
        assert_eq!(pair.graph, 1.0);
        // 別人は候補に出ない
        assert!(!list.iter().any(|c| c.a == "va:c" || c.b == "va:c"));
    }

    #[test]
    fn conflicting_external_ids_are_never_merged() {
        // 読みが同じでも、AniList ID が違えば別人
        let list = candidates(&dataset());
        assert!(!list
            .iter()
            .any(|c| (c.a == "va:a" && c.b == "va:d") || (c.a == "va:d" && c.b == "va:a")));
    }

    #[test]
    fn sequels_are_sent_to_review_not_merged() {
        // 続編は題名も出演者もほぼ同じだが、年が違うので自動統合しない
        let list = candidates(&dataset());
        let pair = list.iter().find(|c| c.a.starts_with("wk:")).expect("works");
        assert_eq!(pair.decision, "review");
    }
}
