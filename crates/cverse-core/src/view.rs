//! 中心ノードから「表示する近傍」を取り出す（F-01, F-03, F-06）。
//!
//! 画面の 1 段目はグラフ上の距離 1 とは限らない。中心の種類ごとに、
//! 「声優と作品に 1 クリックで戻れる」ために必要なノードを 1 段目に含める。
//!
//! | 中心 | 1 段目 |
//! |---|---|
//! | 声優 | 演じたキャラ（[`Slot::Ring`]）と、その代表作品（[`Slot::Context`]） |
//! | キャラ | 担当声優（[`Slot::Top`]）、登場作品（[`Slot::Bottom`]）、同じ作品の他キャラ（[`Slot::Ring`]） |
//! | 作品 | 登場キャラ（[`Slot::Ring`]）、シリーズの前後作（[`Slot::Top`]） |
//!
//! 2 段目以降は、前の段のノードから 1 ホップずつ、優先度の高い順に少数だけ広げる。
//! 1 段目が多すぎる場合は主役・人気順に上位だけ残し、残りは件数だけ返す（「他 N 件」）。

use std::collections::HashMap;

use crate::filter::Filter;
use crate::graph::{EdgeAttr, EdgeType, Graph, NodeKind};

pub const NO_NODE: u32 = u32::MAX;
/// 役が定まらないノードの `role` 値。
pub const ROLE_NONE: u8 = 3;

/// レイアウト上の役割。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Slot {
    Center = 0,
    /// 上に固定するアンカー（キャラ中心の担当声優、作品中心のシリーズ作）。
    Top = 1,
    /// 下に固定するアンカー（キャラ中心の登場作品）。
    Bottom = 2,
    /// 1 段目の主役（周囲に並べるノード）。
    Ring = 3,
    /// 声優中心で、キャラをまとめる作品。
    Context = 4,
    /// 2 段目以降。
    Outer = 5,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ViewNode {
    pub idx: u32,
    /// 何段目か。中心は 0。
    pub level: u8,
    pub slot: Slot,
    /// まとまりの親。Ring のキャラなら所属作品、Outer なら広げた元のノード。
    pub group: u32,
    /// `group` の作品における役の重さ（0 = 主役, 1 = 脇役, 2 = その他, 3 = なし）。
    pub role: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ViewEdge {
    pub a: u32,
    pub b: u32,
    pub attr: u8,
}

/// 描ききれずに省いたノードの件数。`parent` の「他 N 件」として表示する。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Hidden {
    pub parent: u32,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct View {
    pub center: u32,
    pub nodes: Vec<ViewNode>,
    pub edges: Vec<ViewEdge>,
    pub hidden: Vec<Hidden>,
}

/// 描画数の上限。
#[derive(Debug, Clone, Copy)]
pub struct Caps {
    /// 1 段目に並べるキャラの上限（声優中心・作品中心）。
    pub ring: usize,
    /// キャラ中心で、同じ作品の他キャラを合計いくつまで出すか。
    pub co_characters: usize,
    /// アンカー（上・下）それぞれの上限。
    pub anchors: usize,
    /// 2 段目で 1 ノードから広げる数。
    pub fanout2: usize,
    /// 3 段目で 1 ノードから広げる数。
    pub fanout3: usize,
    /// 全体の上限。
    pub total: usize,
}

impl Default for Caps {
    fn default() -> Self {
        Self {
            ring: 60,
            co_characters: 48,
            anchors: 8,
            fanout2: 5,
            fanout3: 3,
            total: 420,
        }
    }
}

struct Collector {
    nodes: Vec<ViewNode>,
    index: HashMap<u32, usize>,
}

impl Collector {
    fn contains(&self, idx: u32) -> bool {
        self.index.contains_key(&idx)
    }
    fn push(&mut self, node: ViewNode) -> bool {
        if self.contains(node.idx) {
            return false;
        }
        self.index.insert(node.idx, self.nodes.len());
        self.nodes.push(node);
        true
    }
}

/// 優先度キー。小さいほど先に出す（役が重い → スコアが高い → 番号が若い）。
type Key = (u8, std::cmp::Reverse<u32>, u32);

fn key(g: &Graph, role: u8, v: u32) -> Key {
    (role, std::cmp::Reverse(g.score[v as usize]), v)
}

fn role_of(attr: EdgeAttr) -> u8 {
    if attr.edge_type() == EdgeType::Appears {
        attr.role() as u8
    } else {
        ROLE_NONE
    }
}

/// `u` から条件に合うエッジで辿れる、種類 `ty` の隣接。
fn passing<'a>(
    g: &'a Graph,
    f: &'a Filter,
    u: u32,
    ty: EdgeType,
) -> impl Iterator<Item = (u32, EdgeAttr)> + 'a {
    g.neighbors(u)
        .filter(move |&(v, a)| a.edge_type() == ty && f.edge_passes(g, u, v, a))
}

/// 中心 `center` の表示用近傍を返す。`levels` は 1〜3。
pub fn view(g: &Graph, center: u32, levels: u8, filter: &Filter, caps: &Caps) -> Option<View> {
    if center as usize >= g.node_count() {
        return None;
    }
    let mut c = Collector {
        nodes: Vec::new(),
        index: HashMap::new(),
    };
    let mut hidden = Vec::new();
    c.push(ViewNode {
        idx: center,
        level: 0,
        slot: Slot::Center,
        group: NO_NODE,
        role: ROLE_NONE,
    });

    match g.kind_of(center) {
        NodeKind::VoiceActor => voice_actor_ring(g, center, filter, caps, &mut c, &mut hidden),
        NodeKind::Character => character_ring(g, center, filter, caps, &mut c, &mut hidden),
        NodeKind::Work => work_ring(g, center, filter, caps, &mut c, &mut hidden),
    }

    // 2 段目以降: 前の段の各ノードから、優先度の高い隣接を少しだけ足す。
    let mut from = 1;
    for level in 2..=levels.min(3) {
        let fanout = if level == 2 {
            caps.fanout2
        } else {
            caps.fanout3
        };
        let to = c.nodes.len();
        'expand: for i in from..to {
            let u = c.nodes[i].idx;
            let mut cands: Vec<(Key, u32, u8)> = g
                .neighbors(u)
                .filter(|&(v, a)| !c.contains(v) && filter.edge_passes(g, u, v, a))
                .map(|(v, a)| (key(g, role_of(a).min(2), v), v, role_of(a)))
                .collect();
            cands.sort_unstable();
            for (_, v, role) in cands.into_iter().take(fanout) {
                if c.nodes.len() >= caps.total {
                    break 'expand;
                }
                c.push(ViewNode {
                    idx: v,
                    level,
                    slot: Slot::Outer,
                    group: u,
                    role,
                });
            }
        }
        from = to;
    }

    // 表示するノードどうしを結ぶエッジ（誘導部分グラフ）。
    let mut edges = Vec::new();
    for node in &c.nodes {
        let u = node.idx;
        for (v, a) in g.neighbors(u) {
            if u < v && c.contains(v) && filter.edge_passes(g, u, v, a) {
                edges.push(ViewEdge {
                    a: u,
                    b: v,
                    attr: a.0,
                });
            }
        }
    }

    Some(View {
        center,
        nodes: c.nodes,
        edges,
        hidden,
    })
}

/// 声優中心: 演じたキャラを代表作品ごとにまとめる。
fn voice_actor_ring(
    g: &Graph,
    center: u32,
    f: &Filter,
    caps: &Caps,
    c: &mut Collector,
    hidden: &mut Vec<Hidden>,
) {
    // (優先度, キャラ, 代表作品, その作品での役)
    let mut chars: Vec<(Key, u32, u32, u8)> = passing(g, f, center, EdgeType::Voices)
        .map(|(ch, _)| {
            // 代表作品 = 役が最も重く、人気が最も高い作品。1 キャラ 1 作品に絞ることで
            // 続編の数だけ作品ノードが増えるのを防ぐ。
            let best = passing(g, f, ch, EdgeType::Appears)
                .map(|(w, a)| (key(g, a.role() as u8, w), w, a.role() as u8))
                .min();
            match best {
                Some((k, w, role)) => ((k.0, k.1, ch), ch, w, role),
                None => (
                    (ROLE_NONE, std::cmp::Reverse(0), ch),
                    ch,
                    NO_NODE,
                    ROLE_NONE,
                ),
            }
        })
        .collect();
    chars.sort_unstable();
    let total = chars.len();
    chars.truncate(caps.ring);
    if total > chars.len() {
        hidden.push(Hidden {
            parent: center,
            count: (total - chars.len()) as u32,
        });
    }
    // 同じ作品のキャラが隣り合うよう、作品 → キャラの順で入れる。
    for &(_, _, w, _) in &chars {
        if w != NO_NODE {
            c.push(ViewNode {
                idx: w,
                level: 1,
                slot: Slot::Context,
                group: w,
                role: ROLE_NONE,
            });
        }
    }
    for (_, ch, w, role) in chars {
        c.push(ViewNode {
            idx: ch,
            level: 1,
            slot: Slot::Ring,
            group: w,
            role,
        });
    }
}

/// キャラ中心: 担当声優を上、登場作品を下、同じ作品の他キャラを周囲に。
fn character_ring(
    g: &Graph,
    center: u32,
    f: &Filter,
    caps: &Caps,
    c: &mut Collector,
    hidden: &mut Vec<Hidden>,
) {
    let mut vas: Vec<(Key, u32)> = passing(g, f, center, EdgeType::Voices)
        .map(|(v, a)| (key(g, a.irregular() as u8, v), v))
        .collect();
    vas.sort_unstable();
    for &(_, v) in vas.iter().take(caps.anchors) {
        c.push(ViewNode {
            idx: v,
            level: 1,
            slot: Slot::Top,
            group: center,
            role: ROLE_NONE,
        });
    }

    let mut works: Vec<(Key, u32, u8)> = passing(g, f, center, EdgeType::Appears)
        .map(|(w, a)| (key(g, a.role() as u8, w), w, a.role() as u8))
        .collect();
    works.sort_unstable();
    let total_works = works.len();
    works.truncate(caps.anchors);
    if total_works > works.len() {
        hidden.push(Hidden {
            parent: center,
            count: (total_works - works.len()) as u32,
        });
    }
    for &(_, w, role) in &works {
        c.push(ViewNode {
            idx: w,
            level: 1,
            slot: Slot::Bottom,
            group: center,
            role,
        });
    }

    // 同じ作品の他キャラ。作品ごとに枠を等分し、主役から順に入れる。
    let quota = (caps.co_characters / works.len().max(1)).max(3);
    for &(_, w, _) in &works {
        let mut cast: Vec<(Key, u32, u8)> = passing(g, f, w, EdgeType::Appears)
            .filter(|&(ch, _)| !c.contains(ch))
            .map(|(ch, a)| (key(g, a.role() as u8, ch), ch, a.role() as u8))
            .collect();
        cast.sort_unstable();
        let total = cast.len();
        cast.truncate(quota);
        if total > cast.len() {
            hidden.push(Hidden {
                parent: w,
                count: (total - cast.len()) as u32,
            });
        }
        for (_, ch, role) in cast {
            c.push(ViewNode {
                idx: ch,
                level: 1,
                slot: Slot::Ring,
                group: w,
                role,
            });
        }
    }

    // キャラ関係（兄弟・ライバルなど）があれば 1 段目に含める。
    let related: Vec<u32> = passing(g, f, center, EdgeType::Relation)
        .map(|x| x.0)
        .collect();
    for ch in related {
        c.push(ViewNode {
            idx: ch,
            level: 1,
            slot: Slot::Ring,
            group: NO_NODE,
            role: ROLE_NONE,
        });
    }
}

/// 作品中心: 登場キャラを主役から順に、シリーズの前後作を上に。
fn work_ring(
    g: &Graph,
    center: u32,
    f: &Filter,
    caps: &Caps,
    c: &mut Collector,
    hidden: &mut Vec<Hidden>,
) {
    let mut series: Vec<(Key, u32)> = passing(g, f, center, EdgeType::Series)
        .map(|(w, _)| (key(g, 0, w), w))
        .collect();
    // シリーズは年代順に並べる。
    series.sort_unstable_by_key(|&(_, w)| (g.year[w as usize], w));
    for &(_, w) in series.iter().take(caps.anchors) {
        c.push(ViewNode {
            idx: w,
            level: 1,
            slot: Slot::Top,
            group: center,
            role: ROLE_NONE,
        });
    }

    let mut cast: Vec<(Key, u32, u8)> = passing(g, f, center, EdgeType::Appears)
        .map(|(ch, a)| (key(g, a.role() as u8, ch), ch, a.role() as u8))
        .collect();
    cast.sort_unstable();
    let total = cast.len();
    cast.truncate(caps.ring);
    if total > cast.len() {
        hidden.push(Hidden {
            parent: center,
            count: (total - cast.len()) as u32,
        });
    }
    for (_, ch, role) in cast {
        c.push(ViewNode {
            idx: ch,
            level: 1,
            slot: Slot::Ring,
            group: center,
            role,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::testutil::sample;
    use crate::graph::{Format, GraphBuilder, Role};

    fn slots(v: &View, slot: Slot) -> Vec<u32> {
        let mut out: Vec<u32> = v
            .nodes
            .iter()
            .filter(|n| n.slot == slot)
            .map(|n| n.idx)
            .collect();
        out.sort_unstable();
        out
    }

    #[test]
    fn character_center_has_anchors() {
        let g = sample();
        let v = view(&g, 5, 1, &Filter::ALL, &Caps::default()).unwrap();
        assert_eq!(v.nodes[0].slot, Slot::Center);
        assert_eq!(slots(&v, Slot::Top), vec![2]);
        assert_eq!(slots(&v, Slot::Bottom), vec![7, 8]);
        assert_eq!(slots(&v, Slot::Ring), vec![3, 4, 6]);
        // 主役の作品（wk8）が先
        let bottoms: Vec<u32> = v
            .nodes
            .iter()
            .filter(|n| n.slot == Slot::Bottom)
            .map(|n| n.idx)
            .collect();
        assert_eq!(bottoms, vec![8, 7]);
        // 他キャラは所属作品でまとまる
        let n6 = v.nodes.iter().find(|n| n.idx == 6).unwrap();
        assert_eq!((n6.group, n6.role), (8, Role::Supporting as u8));
    }

    #[test]
    fn voice_actor_center_groups_by_work() {
        let g = sample();
        let v = view(&g, 1, 1, &Filter::ALL, &Caps::default()).unwrap();
        assert_eq!(slots(&v, Slot::Ring), vec![4, 6]);
        assert_eq!(slots(&v, Slot::Context), vec![7, 8]);
        let n4 = v.nodes.iter().find(|n| n.idx == 4).unwrap();
        assert_eq!(n4.group, 7);
        // エッジは表示ノードどうしだけ
        for e in &v.edges {
            assert!(v.nodes.iter().any(|n| n.idx == e.a) && v.nodes.iter().any(|n| n.idx == e.b));
            assert!(e.a < e.b);
        }
    }

    #[test]
    fn work_center_and_series() {
        let g = sample();
        let v = view(&g, 7, 1, &Filter::ALL, &Caps::default()).unwrap();
        assert_eq!(slots(&v, Slot::Top), vec![9]);
        let ring: Vec<u32> = v
            .nodes
            .iter()
            .filter(|n| n.slot == Slot::Ring)
            .map(|n| n.idx)
            .collect();
        assert_eq!(ring, vec![3, 4, 5]); // 主役 2 人 → 脇役
    }

    #[test]
    fn levels_expand_outward() {
        let g = sample();
        let v1 = view(&g, 7, 1, &Filter::ALL, &Caps::default()).unwrap();
        let v2 = view(&g, 7, 2, &Filter::ALL, &Caps::default()).unwrap();
        let v3 = view(&g, 7, 3, &Filter::ALL, &Caps::default()).unwrap();
        assert!(v1.nodes.len() < v2.nodes.len() && v2.nodes.len() < v3.nodes.len());
        // 2 段目に声優と wk8 が入る
        assert_eq!(slots(&v2, Slot::Outer), vec![0, 1, 2, 8]);
        assert!(v2
            .nodes
            .iter()
            .filter(|n| n.slot == Slot::Outer)
            .all(|n| n.level == 2));
        assert_eq!(slots(&v3, Slot::Outer), vec![0, 1, 2, 6, 8]);
        // ノードは重複しない
        let mut ids: Vec<u32> = v3.nodes.iter().map(|n| n.idx).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), v3.nodes.len());
    }

    #[test]
    fn filter_is_applied() {
        let g = sample();
        let anime = Filter {
            media: 1,
            ..Filter::ALL
        };
        let v = view(&g, 5, 1, &anime, &Caps::default()).unwrap();
        assert_eq!(slots(&v, Slot::Bottom), vec![7]);
        assert_eq!(slots(&v, Slot::Ring), vec![3, 4]);
        let v = view(&g, 1, 1, &Filter::main_only(), &Caps::default()).unwrap();
        assert_eq!(slots(&v, Slot::Ring), vec![4]);
    }

    #[test]
    fn caps_report_hidden_counts() {
        // 100 人が登場する作品
        let mut b = GraphBuilder::new();
        let w = b.add_node(NodeKind::Work, Format::Tv, 2000, 1);
        for i in 0..100u32 {
            let ch = b.add_node(NodeKind::Character, Format::None, 0, i);
            let role = if i < 5 { Role::Main } else { Role::Supporting };
            b.add_edge(ch, w, EdgeAttr::appears(role));
        }
        let g = b.build();
        let v = view(&g, w, 1, &Filter::ALL, &Caps::default()).unwrap();
        assert_eq!(v.nodes.len(), 61);
        assert_eq!(
            v.hidden,
            vec![Hidden {
                parent: w,
                count: 40
            }]
        );
        // 主役 5 人は必ず入り、先頭に来る
        for n in &v.nodes[1..6] {
            assert_eq!(n.role, 0);
        }
        // キャラ中心では、同じ作品の他キャラが枠で切られる
        let v = view(&g, 1, 1, &Filter::ALL, &Caps::default()).unwrap();
        assert_eq!(
            v.hidden,
            vec![Hidden {
                parent: w,
                count: 99 - 48
            }]
        );
        assert!(view(&g, 9999, 1, &Filter::ALL, &Caps::default()).is_none());
    }
}
