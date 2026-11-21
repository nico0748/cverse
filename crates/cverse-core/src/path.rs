//! 最短経路（F-10）。
//!
//! エッジに重みがないので、基本は幅優先探索で最短が求まる。両端から同時に広げる
//! 双方向 BFS にすると、調べるノード数がおおよそ「分岐数の (距離/2) 乗 × 2」に減る。
//!
//! 登場キャラが数百人いる長寿作品（ハブ）を通ると誰とでも 2〜3 ステップでつながって
//! しまうので、次の 2 つのモードも用意する。
//!
//! - 主役のみ: [`Filter::main_only`] を付けた双方向 BFS
//! - 重み付き: 脇役のエッジを重くした [`dijkstra`]。「知っているつながり」を優先する

use std::cmp::Reverse;
use std::collections::BinaryHeap;

use crate::filter::Filter;
use crate::graph::{EdgeAttr, EdgeType, Graph, NodeKind, Role};

const UNSEEN: u32 = u32::MAX;

/// 経路探索の結果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PathResult {
    /// 始点から終点までのノード列（両端を含む）。
    pub nodes: Vec<u32>,
    /// 経路のコスト。BFS ではホップ数、ダイクストラでは重みの合計。
    pub cost: u32,
    /// 探索中に訪れたノード数（計測用）。
    pub visited: u32,
}

impl PathResult {
    pub fn hops(&self) -> u32 {
        self.nodes.len().saturating_sub(1) as u32
    }
}

/// 双方向 BFS。
///
/// 毎回、フロンティアが小さい側を 1 段ぶん丸ごと広げる。相手側が訪問済みのノードに
/// 触れたら候補として記録し、その段を最後まで調べてから最短のものを返す
/// （段の途中で打ち切ると 1 ホップ長い経路を返すことがあるため）。
pub fn bidirectional_bfs(g: &Graph, src: u32, dst: u32, filter: &Filter) -> Option<PathResult> {
    let n = g.node_count();
    if src as usize >= n || dst as usize >= n {
        return None;
    }
    if src == dst {
        return Some(PathResult {
            nodes: vec![src],
            cost: 0,
            visited: 1,
        });
    }
    // dist[side][v], parent[side][v]
    let mut dist = [vec![UNSEEN; n], vec![UNSEEN; n]];
    let mut parent = [vec![UNSEEN; n], vec![UNSEEN; n]];
    let mut frontier = [vec![src], vec![dst]];
    dist[0][src as usize] = 0;
    dist[1][dst as usize] = 0;
    let mut visited = 2u32;

    while !frontier[0].is_empty() && !frontier[1].is_empty() {
        let side = if frontier[0].len() <= frontier[1].len() {
            0
        } else {
            1
        };
        let other = 1 - side;
        let mut next = Vec::new();
        // (合計距離, 自分側のノード, 相手側のノード)
        let mut best: Option<(u32, u32, u32)> = None;

        for &u in &frontier[side] {
            let du = dist[side][u as usize];
            for (v, attr) in g.neighbors(u) {
                if !filter.edge_passes(g, u, v, attr) {
                    continue;
                }
                let dv_other = dist[other][v as usize];
                if dv_other != UNSEEN {
                    let total = du + 1 + dv_other;
                    if best.is_none_or(|b| total < b.0) {
                        best = Some((total, u, v));
                    }
                } else if dist[side][v as usize] == UNSEEN {
                    dist[side][v as usize] = du + 1;
                    parent[side][v as usize] = u;
                    visited += 1;
                    next.push(v);
                }
            }
        }

        if let Some((total, u, v)) = best {
            // u は side 側、v は other 側。始点→終点の向きに並べ直す。
            let (a, b) = if side == 0 { (u, v) } else { (v, u) };
            let mut nodes = walk(&parent[0], a);
            nodes.reverse();
            nodes.extend(walk(&parent[1], b));
            return Some(PathResult {
                nodes,
                cost: total,
                visited,
            });
        }
        frontier[side] = next;
    }
    None
}

/// `from` から親を辿って根（始点または終点）までのノード列を返す。
fn walk(parent: &[u32], from: u32) -> Vec<u32> {
    let mut out = vec![from];
    let mut cur = from;
    while parent[cur as usize] != UNSEEN {
        cur = parent[cur as usize];
        out.push(cur);
    }
    out
}

/// 片方向 BFS。双方向との比較計測と、テストでの答え合わせに使う。
pub fn bfs(g: &Graph, src: u32, dst: u32, filter: &Filter) -> Option<PathResult> {
    let n = g.node_count();
    if src as usize >= n || dst as usize >= n {
        return None;
    }
    let mut dist = vec![UNSEEN; n];
    let mut parent = vec![UNSEEN; n];
    let mut queue = std::collections::VecDeque::from([src]);
    dist[src as usize] = 0;
    let mut visited = 1u32;
    while let Some(u) = queue.pop_front() {
        if u == dst {
            let mut nodes = walk(&parent, dst);
            nodes.reverse();
            return Some(PathResult {
                nodes,
                cost: dist[dst as usize],
                visited,
            });
        }
        for (v, attr) in g.neighbors(u) {
            if dist[v as usize] == UNSEEN && filter.edge_passes(g, u, v, attr) {
                dist[v as usize] = dist[u as usize] + 1;
                parent[v as usize] = u;
                visited += 1;
                queue.push_back(v);
            }
        }
    }
    None
}

/// 重み付き探索で使うエッジの重み。
#[derive(Debug, Clone, Copy)]
pub struct Weights {
    pub main: u32,
    pub supporting: u32,
    pub background: u32,
    pub voices: u32,
    /// 代役・交代後の配役に足す重み。
    pub irregular_penalty: u32,
    pub series: u32,
    pub relation: u32,
}

impl Default for Weights {
    fn default() -> Self {
        Self {
            main: 1,
            supporting: 3,
            background: 6,
            voices: 1,
            irregular_penalty: 1,
            series: 2,
            relation: 1,
        }
    }
}

impl Weights {
    #[inline]
    pub fn of(&self, attr: EdgeAttr) -> u32 {
        match attr.edge_type() {
            EdgeType::Voices => {
                self.voices
                    + if attr.irregular() {
                        self.irregular_penalty
                    } else {
                        0
                    }
            }
            EdgeType::Appears => match attr.role() {
                Role::Main => self.main,
                Role::Supporting => self.supporting,
                Role::Background => self.background,
            },
            EdgeType::Series => self.series,
            EdgeType::Relation => self.relation,
        }
    }
}

/// 脇役のエッジを重くしたダイクストラ法。
///
/// ホップ数は増えても、主役どうしのつながりを優先した経路を返す。
/// 重みが同じ経路どうしではホップ数の少ない方を選ぶ。
pub fn dijkstra(
    g: &Graph,
    src: u32,
    dst: u32,
    filter: &Filter,
    weights: &Weights,
) -> Option<PathResult> {
    let n = g.node_count();
    if src as usize >= n || dst as usize >= n {
        return None;
    }
    // (重み, ホップ数) の辞書順で最小化する。
    let mut dist = vec![(UNSEEN, UNSEEN); n];
    let mut parent = vec![UNSEEN; n];
    let mut heap = BinaryHeap::new();
    dist[src as usize] = (0, 0);
    heap.push(Reverse(((0u32, 0u32), src)));
    let mut visited = 0u32;
    while let Some(Reverse((d, u))) = heap.pop() {
        if d > dist[u as usize] {
            continue;
        }
        visited += 1;
        if u == dst {
            let mut nodes = walk(&parent, dst);
            nodes.reverse();
            return Some(PathResult {
                nodes,
                cost: d.0,
                visited,
            });
        }
        for (v, attr) in g.neighbors(u) {
            if !filter.edge_passes(g, u, v, attr) {
                continue;
            }
            let nd = (d.0 + weights.of(attr), d.1 + 1);
            if nd < dist[v as usize] {
                dist[v as usize] = nd;
                parent[v as usize] = u;
                heap.push(Reverse((nd, v)));
            }
        }
    }
    None
}

/// 経路上の「共演」の回数。
///
/// 「声優 → キャラ → 作品 → キャラ → 声優」を共演 1 回と数える。経路上で作品ノードが
/// 連続する区間（シリーズをまたぐ場合）は 1 回にまとめる。
pub fn costar_steps(g: &Graph, nodes: &[u32]) -> u32 {
    let mut steps = 0;
    let mut in_work = false;
    for &u in nodes {
        let is_work = g.kind_of(u) == NodeKind::Work;
        if is_work && !in_work {
            steps += 1;
        }
        in_work = is_work;
    }
    steps
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::testutil::sample;
    use crate::graph::{Format, GraphBuilder};

    fn is_valid_path(g: &Graph, p: &PathResult, src: u32, dst: u32, f: &Filter) {
        assert_eq!(p.nodes.first(), Some(&src));
        assert_eq!(p.nodes.last(), Some(&dst));
        for w in p.nodes.windows(2) {
            let attr = g.neighbors(w[0]).find(|(v, _)| *v == w[1]).map(|x| x.1);
            let attr = attr.unwrap_or_else(|| panic!("{} - {} is not an edge", w[0], w[1]));
            assert!(f.edge_passes(g, w[0], w[1], attr));
        }
    }

    #[test]
    fn costars_in_one_step() {
        let g = sample();
        let p = bidirectional_bfs(&g, 0, 1, &Filter::ALL).unwrap();
        assert_eq!(p.nodes, vec![0, 3, 7, 4, 1]);
        assert_eq!(p.cost, 4);
        assert_eq!(costar_steps(&g, &p.nodes), 1);
    }

    #[test]
    fn same_node_and_out_of_range() {
        let g = sample();
        assert_eq!(
            bidirectional_bfs(&g, 4, 4, &Filter::ALL).unwrap().nodes,
            vec![4]
        );
        assert!(bidirectional_bfs(&g, 0, 99, &Filter::ALL).is_none());
        assert!(dijkstra(&g, 99, 0, &Filter::ALL, &Weights::default()).is_none());
    }

    #[test]
    fn main_only_takes_the_long_way_or_fails() {
        let g = sample();
        // va2 は wk7 では脇役。主役のみだと wk7 経由では va0 に届かない。
        assert!(bidirectional_bfs(&g, 2, 0, &Filter::ALL).is_some());
        assert!(bidirectional_bfs(&g, 2, 0, &Filter::main_only()).is_none());
    }

    #[test]
    fn weighted_prefers_main_roles() {
        // s ─ a ═(supporting)═ hub ═(supporting)═ b ─ t   … 4 ホップ、重み 1+3+3+1 = 8
        // s ─ c ─(main)─ w1 ─(main)─ d ─(main)─ w2 ─(main)─ e ─ t … 6 ホップ、重み 6
        let mut gb = GraphBuilder::new();
        let va = |gb: &mut GraphBuilder| gb.add_node(NodeKind::VoiceActor, Format::None, 0, 0);
        let ch = |gb: &mut GraphBuilder| gb.add_node(NodeKind::Character, Format::None, 0, 0);
        let wk = |gb: &mut GraphBuilder| gb.add_node(NodeKind::Work, Format::Tv, 2000, 0);
        let (s, t) = (va(&mut gb), va(&mut gb));
        let (a, b, c, d, e) = (
            ch(&mut gb),
            ch(&mut gb),
            ch(&mut gb),
            ch(&mut gb),
            ch(&mut gb),
        );
        let (hub, w1, w2) = (wk(&mut gb), wk(&mut gb), wk(&mut gb));
        let voice = EdgeAttr::voices(1, false);
        let main = EdgeAttr::appears(Role::Main);
        let sup = EdgeAttr::appears(Role::Supporting);
        // d は別の声優が演じる主役で、w1 と w2 の両方に出る
        for (x, y, at) in [
            (s, a, voice),
            (a, hub, sup),
            (hub, b, sup),
            (b, t, voice),
            (s, c, voice),
            (c, w1, main),
            (w1, d, main),
            (d, w2, main),
            (w2, e, main),
            (e, t, voice),
        ] {
            gb.add_edge(x, y, at);
        }
        let g = gb.build();
        let short = bidirectional_bfs(&g, s, t, &Filter::ALL).unwrap();
        assert_eq!(short.nodes, vec![s, a, hub, b, t]);
        let known = dijkstra(&g, s, t, &Filter::ALL, &Weights::default()).unwrap();
        assert_eq!(known.nodes, vec![s, c, w1, d, w2, e, t]);
        assert_eq!(known.cost, 6);
        assert_eq!(costar_steps(&g, &known.nodes), 2);
    }

    #[test]
    fn series_run_counts_once() {
        let g = sample();
        assert_eq!(costar_steps(&g, &[3, 7, 9]), 1);
        assert_eq!(costar_steps(&g, &[0, 3]), 0);
    }

    /// 乱数で作ったグラフで、双方向 BFS が片方向 BFS と同じ長さを返すことを確かめる。
    #[test]
    fn bidirectional_matches_unidirectional_on_random_graphs() {
        let mut seed = 0x2545_f491_4f6c_dd1du64;
        let mut rnd = move |m: u32| {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            (seed % m as u64) as u32
        };
        for round in 0..30 {
            let (nva, nch, nwk) = (12, 40, 10);
            let mut gb = GraphBuilder::new();
            for _ in 0..nva {
                gb.add_node(NodeKind::VoiceActor, Format::None, 0, 0);
            }
            for _ in 0..nch {
                gb.add_node(NodeKind::Character, Format::None, 0, 0);
            }
            for i in 0..nwk {
                let f = if i % 3 == 0 { Format::Game } else { Format::Tv };
                gb.add_node(NodeKind::Work, f, 1990 + rnd(35) as u16, 0);
            }
            for c in nva..nva + nch {
                if rnd(10) < 8 {
                    gb.add_edge(rnd(nva), c, EdgeAttr::voices(1 + rnd(3) as u8, false));
                }
                for _ in 0..1 + rnd(2) {
                    let role = [Role::Main, Role::Supporting, Role::Background][rnd(3) as usize];
                    gb.add_edge(c, nva + nch + rnd(nwk), EdgeAttr::appears(role));
                }
            }
            let g = gb.build();
            let filters = [
                Filter::ALL,
                Filter::main_only(),
                Filter {
                    media: 1,
                    ..Filter::ALL
                },
                Filter {
                    year_min: 2000,
                    year_max: 2015,
                    ..Filter::ALL
                },
            ];
            let n = g.node_count() as u32;
            for f in &filters {
                for _ in 0..40 {
                    let (s, t) = (rnd(n), rnd(n));
                    let uni = bfs(&g, s, t, f);
                    let bi = bidirectional_bfs(&g, s, t, f);
                    assert_eq!(
                        uni.as_ref().map(|p| p.cost),
                        bi.as_ref().map(|p| p.cost),
                        "round {round} {s}->{t} {f:?}"
                    );
                    if let Some(p) = &bi {
                        assert_eq!(p.hops(), p.cost);
                        is_valid_path(&g, p, s, t, f);
                    }
                    // 重みをすべて 1 にしたダイクストラも同じ長さになる
                    let unit = Weights {
                        main: 1,
                        supporting: 1,
                        background: 1,
                        voices: 1,
                        irregular_penalty: 0,
                        series: 1,
                        relation: 1,
                    };
                    let dj = dijkstra(&g, s, t, f, &unit);
                    assert_eq!(uni.as_ref().map(|p| p.cost), dj.as_ref().map(|p| p.cost));
                }
            }
        }
    }
}
