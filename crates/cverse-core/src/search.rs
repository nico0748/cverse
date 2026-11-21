//! 名前検索（F-08）。
//!
//! ノードごとに「名前・読み・別名」を [`normalize`](crate::normalize::normalize) した
//! キーを持ち、問い合わせも同じ正規化をかけてから部分一致で照合する。ひらがなで入力しても
//! カタカナ名に当たり、読みでも当たる。MVP 規模（数万ノード）なら線形走査で十分速い。

use crate::graph::Graph;
use crate::normalize::normalize;

#[derive(Debug, Default, Clone)]
pub struct SearchIndex {
    /// ノードごとの検索キー。複数キーはタブ区切り。先頭が名前。
    keys: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Rank {
    Exact = 0,
    Prefix = 1,
    Substring = 2,
}

impl SearchIndex {
    /// 正規化済みのキー列から作る（配信データを読むとき）。
    pub fn from_normalized(keys: Vec<String>) -> Self {
        Self { keys }
    }

    /// 生の文字列から 1 ノードぶんの検索キーを作る（データ生成時）。重複は除く。
    pub fn make_key<'a>(parts: impl IntoIterator<Item = &'a str>) -> String {
        let mut seen: Vec<String> = Vec::new();
        for p in parts {
            let n = normalize(p);
            if !n.is_empty() && !seen.contains(&n) {
                seen.push(n);
            }
        }
        seen.join("\t")
    }

    pub fn len(&self) -> usize {
        self.keys.len()
    }

    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    /// 検索する。`kind_mask` は `1 << NodeKind` のビットマスク（0 は全種類）。
    ///
    /// 並び順: 完全一致 → 前方一致 → 部分一致、同順位はスコアの高い順。
    pub fn search(&self, g: &Graph, query: &str, kind_mask: u8, limit: usize) -> Vec<u32> {
        let q = normalize(query);
        if q.is_empty() || limit == 0 {
            return Vec::new();
        }
        let mut hits: Vec<(Rank, std::cmp::Reverse<u32>, u32)> = Vec::new();
        for (i, keys) in self.keys.iter().enumerate().take(g.node_count()) {
            if kind_mask != 0 && kind_mask & (1 << g.kind[i]) == 0 {
                continue;
            }
            if !keys.contains(q.as_str()) {
                continue;
            }
            let rank = keys
                .split('\t')
                .filter_map(|k| {
                    if k == q {
                        Some(Rank::Exact)
                    } else if k.starts_with(q.as_str()) {
                        Some(Rank::Prefix)
                    } else if k.contains(q.as_str()) {
                        Some(Rank::Substring)
                    } else {
                        None
                    }
                })
                .min();
            if let Some(rank) = rank {
                hits.push((rank, std::cmp::Reverse(g.score[i]), i as u32));
            }
        }
        hits.sort_unstable();
        hits.truncate(limit);
        hits.into_iter().map(|h| h.2).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::{Format, GraphBuilder, NodeKind};

    fn fixture() -> (Graph, SearchIndex) {
        let mut b = GraphBuilder::new();
        let mut keys = Vec::new();
        let mut add = |kind, score, parts: &[&str]| {
            b.add_node(kind, Format::None, 0, score);
            keys.push(SearchIndex::make_key(parts.iter().copied()));
        };
        add(
            NodeKind::VoiceActor,
            10,
            &["花澤香菜", "はなざわ かな", "Kana Hanazawa"],
        );
        add(NodeKind::VoiceActor, 50, &["花江夏樹", "はなえ なつき"]);
        add(NodeKind::Character, 5, &["ナツキ・スバル", "なつき すばる"]);
        add(NodeKind::Work, 99, &["はなまる幼稚園"]);
        (b.build(), SearchIndex::from_normalized(keys))
    }

    #[test]
    fn matches_reading_kana_and_partial() {
        let (g, idx) = fixture();
        assert_eq!(idx.search(&g, "はなざわ", 0, 10), vec![0]);
        assert_eq!(idx.search(&g, "ハナザワ", 0, 10), vec![0]);
        assert_eq!(idx.search(&g, "香菜", 0, 10), vec![0]);
        assert_eq!(idx.search(&g, "hanazawa", 0, 10), vec![0]);
        // 「なつき」: 前方一致のキャラが、部分一致の声優より先
        assert_eq!(idx.search(&g, "なつき", 0, 10), vec![2, 1]);
    }

    #[test]
    fn ranks_by_score_and_respects_kind_and_limit() {
        let (g, idx) = fixture();
        // 「はな」は 3 件とも前方一致 → スコア順
        assert_eq!(idx.search(&g, "はな", 0, 10), vec![3, 1, 0]);
        assert_eq!(
            idx.search(&g, "はな", 1 << NodeKind::VoiceActor as u8, 10),
            vec![1, 0]
        );
        assert_eq!(idx.search(&g, "はな", 0, 1), vec![3]);
        assert!(idx.search(&g, "　", 0, 10).is_empty());
        assert!(idx.search(&g, "存在しない", 0, 10).is_empty());
    }
}
