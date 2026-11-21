//! ブラウザ（Web Worker）から cverse-core を呼ぶための薄い層。
//!
//! 境界をまたぐデータは数値配列（`Uint32Array`）に平らに詰める。JSON を経由しないので
//! WASM 側にパーサが要らず、受け渡しも速い。配列の並びは `web/src/worker/decode.ts` と対になる。

use cverse_core::filter::Filter;
use cverse_core::path::{bidirectional_bfs, costar_steps, dijkstra, Weights};
use cverse_core::search::SearchIndex;
use cverse_core::view::{view, Caps};
use cverse_core::Graph;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Engine {
    graph: Graph,
    search: SearchIndex,
}

fn filter(media: u8, formats: u16, year_min: u16, year_max: u16, main_only: bool) -> Filter {
    Filter {
        media,
        formats,
        year_min,
        year_max,
        main_only,
    }
}

#[wasm_bindgen]
impl Engine {
    /// `graph` は `graph.bin`、`search_keys` は `search.txt`（1 行 1 ノード、キーはタブ区切り）。
    #[wasm_bindgen(constructor)]
    pub fn new(graph: &[u8], search_keys: &str) -> Result<Engine, JsError> {
        let graph = Graph::from_bytes(graph).map_err(|e| JsError::new(&e.to_string()))?;
        let keys: Vec<String> = search_keys.split('\n').map(str::to_owned).collect();
        if keys.len() < graph.node_count() {
            return Err(JsError::new("search index is shorter than the graph"));
        }
        Ok(Engine {
            graph,
            search: SearchIndex::from_normalized(keys),
        })
    }

    #[wasm_bindgen(js_name = nodeCount)]
    pub fn node_count(&self) -> u32 {
        self.graph.node_count() as u32
    }

    #[wasm_bindgen(js_name = edgeCount)]
    pub fn edge_count(&self) -> u32 {
        self.graph.edge_count() as u32
    }

    /// ノードごとの種類（0 = 声優, 1 = キャラ, 2 = 作品）。
    pub fn kinds(&self) -> Vec<u8> {
        self.graph.kind.clone()
    }

    pub fn formats(&self) -> Vec<u8> {
        self.graph.format.clone()
    }

    pub fn years(&self) -> Vec<u16> {
        self.graph.year.clone()
    }

    /// ノードごとの優先度（お気に入り数・人気）。並び順や代表作の選び方に使う。
    pub fn scores(&self) -> Vec<u32> {
        self.graph.score.clone()
    }

    /// `[隣接ノード, 属性, 隣接ノード, 属性, …]`
    pub fn neighbors(&self, u: u32) -> Vec<u32> {
        if u as usize >= self.graph.node_count() {
            return Vec::new();
        }
        self.graph
            .neighbors(u)
            .flat_map(|(v, a)| [v, a.0 as u32])
            .collect()
    }

    /// 表示用の近傍。
    ///
    /// `[ノード数, エッジ数, 省略数, (idx, level, slot, group, role)…, (a, b, attr)…, (parent, count)…]`
    /// 中心が範囲外なら空配列。
    #[allow(clippy::too_many_arguments)]
    pub fn view(
        &self,
        center: u32,
        levels: u8,
        media: u8,
        formats: u16,
        year_min: u16,
        year_max: u16,
        main_only: bool,
    ) -> Vec<u32> {
        let f = filter(media, formats, year_min, year_max, main_only);
        let Some(v) = view(
            &self.graph,
            center,
            levels.clamp(1, 3),
            &f,
            &Caps::default(),
        ) else {
            return Vec::new();
        };
        let mut out =
            Vec::with_capacity(3 + v.nodes.len() * 5 + v.edges.len() * 3 + v.hidden.len() * 2);
        out.extend([
            v.nodes.len() as u32,
            v.edges.len() as u32,
            v.hidden.len() as u32,
        ]);
        for n in &v.nodes {
            out.extend([n.idx, n.level as u32, n.slot as u32, n.group, n.role as u32]);
        }
        for e in &v.edges {
            out.extend([e.a, e.b, e.attr as u32]);
        }
        for h in &v.hidden {
            out.extend([h.parent, h.count]);
        }
        out
    }

    /// 最短経路。`mode`: 0 = 双方向 BFS, 1 = 主役のみ（双方向 BFS）, 2 = 重み付き（ダイクストラ）。
    ///
    /// `[見つかったか, コスト, 訪問ノード数, 共演ステップ数, 経路のノード…]`
    #[allow(clippy::too_many_arguments)]
    pub fn path(
        &self,
        src: u32,
        dst: u32,
        mode: u8,
        media: u8,
        formats: u16,
        year_min: u16,
        year_max: u16,
        main_only: bool,
    ) -> Vec<u32> {
        let f = filter(media, formats, year_min, year_max, main_only || mode == 1);
        let result = match mode {
            2 => dijkstra(&self.graph, src, dst, &f, &Weights::default()),
            _ => bidirectional_bfs(&self.graph, src, dst, &f),
        };
        match result {
            None => vec![0, 0, 0, 0],
            Some(p) => {
                let mut out = vec![1, p.cost, p.visited, costar_steps(&self.graph, &p.nodes)];
                out.extend(p.nodes);
                out
            }
        }
    }

    /// 名前検索。`kind_mask` は `1 << 種類` のビットマスク（0 は全種類）。
    pub fn search(&self, query: &str, kind_mask: u8, limit: u32) -> Vec<u32> {
        self.search
            .search(&self.graph, query, kind_mask, limit as usize)
    }
}
