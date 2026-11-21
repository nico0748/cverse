//! 絞り込み条件（F-09）。近傍抽出と最短経路の両方が同じ判定を使う。

use crate::graph::{EdgeAttr, EdgeType, Format, Graph, NodeKind, Role};

/// 絞り込み条件。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Filter {
    /// 媒体。bit0 = アニメ, bit1 = ゲーム。
    pub media: u8,
    /// 形態のビットマスク（`1 << Format`）。0 は「すべて」。
    pub formats: u16,
    /// 開始年の下限（含む）。0 は制限なし。
    pub year_min: u16,
    /// 開始年の上限（含む）。0 は制限なし。
    pub year_max: u16,
    /// 主役として登場する作品だけを辿る。
    pub main_only: bool,
}

impl Default for Filter {
    fn default() -> Self {
        Self::ALL
    }
}

impl Filter {
    pub const ALL: Filter = Filter {
        media: 3,
        formats: 0,
        year_min: 0,
        year_max: 0,
        main_only: false,
    };

    pub fn main_only() -> Self {
        Filter {
            main_only: true,
            ..Self::ALL
        }
    }

    #[inline]
    pub fn is_all(&self) -> bool {
        *self == Self::ALL
    }

    /// 作品ノードが条件に合うか。
    pub fn work_passes(&self, g: &Graph, w: u32) -> bool {
        let format = g.format[w as usize];
        let need = if format == Format::Game as u8 {
            EdgeAttr::MEDIA_GAME
        } else {
            EdgeAttr::MEDIA_ANIME
        };
        if self.media & need == 0 {
            return false;
        }
        if self.formats != 0 && self.formats & (1 << format) == 0 {
            return false;
        }
        if self.year_min != 0 || self.year_max != 0 {
            let y = g.year[w as usize];
            // 年が不明な作品は、年代で絞っているときは外す。
            if y == 0 || y < self.year_min || (self.year_max != 0 && y > self.year_max) {
                return false;
            }
        }
        true
    }

    /// キャラノードが条件に合うか（条件に合う「登場する」エッジを 1 本以上持つ）。
    pub fn character_passes(&self, g: &Graph, c: u32) -> bool {
        if self.is_all() {
            return true;
        }
        g.neighbors(c).any(|(w, a)| {
            a.edge_type() == EdgeType::Appears
                && (!self.main_only || a.role() == Role::Main)
                && self.work_passes(g, w)
        })
    }

    /// エッジ `u — v` を辿ってよいか。
    pub fn edge_passes(&self, g: &Graph, u: u32, v: u32, attr: EdgeAttr) -> bool {
        if self.is_all() {
            return true;
        }
        match attr.edge_type() {
            EdgeType::Voices => {
                if attr.media() & self.media == 0 {
                    return false;
                }
                let c = if g.kind_of(u) == NodeKind::Character {
                    u
                } else {
                    v
                };
                self.character_passes(g, c)
            }
            EdgeType::Appears => {
                if self.main_only && attr.role() != Role::Main {
                    return false;
                }
                let w = if g.kind_of(u) == NodeKind::Work { u } else { v };
                self.work_passes(g, w)
            }
            EdgeType::Series => self.work_passes(g, u) && self.work_passes(g, v),
            EdgeType::Relation => self.character_passes(g, u) && self.character_passes(g, v),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::testutil::sample;

    #[test]
    fn all_passes_everything() {
        let g = sample();
        for u in 0..g.node_count() as u32 {
            for (v, a) in g.neighbors(u) {
                assert!(Filter::ALL.edge_passes(&g, u, v, a));
            }
        }
    }

    #[test]
    fn media_and_format() {
        let g = sample();
        let anime = Filter {
            media: EdgeAttr::MEDIA_ANIME,
            ..Filter::ALL
        };
        assert!(anime.work_passes(&g, 7));
        assert!(!anime.work_passes(&g, 8));
        // ch6 はゲームにしか出ない
        assert!(!anime.character_passes(&g, 6));
        assert!(anime.character_passes(&g, 5));

        let movie = Filter {
            formats: 1 << Format::Movie as u8,
            ..Filter::ALL
        };
        assert!(movie.work_passes(&g, 9));
        assert!(!movie.work_passes(&g, 7));
    }

    #[test]
    fn year_range() {
        let g = sample();
        let f = Filter {
            year_min: 2011,
            year_max: 2019,
            ..Filter::ALL
        };
        assert!(!f.work_passes(&g, 7));
        assert!(f.work_passes(&g, 9));
        assert!(!f.work_passes(&g, 8));
        let open = Filter {
            year_min: 2011,
            ..Filter::ALL
        };
        assert!(open.work_passes(&g, 8));
    }

    #[test]
    fn main_only_drops_supporting() {
        let g = sample();
        let f = Filter::main_only();
        assert!(f.character_passes(&g, 5)); // wk8 では主役
        assert!(!f.character_passes(&g, 6));
        let a = g.neighbors(5).find(|(v, _)| *v == 7).unwrap().1;
        assert!(!f.edge_passes(&g, 5, 7, a));
    }
}
