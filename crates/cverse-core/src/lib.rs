//! CVerse のグラフ中核。
//!
//! データ生成（ネイティブ CLI）とブラウザ（WASM）の両方から同じコードを使うため、
//! I/O を持たず、依存も最小限にしている。
//!
//! - [`graph`] — CSR（Compressed Sparse Row）形式のグラフとバイナリ入出力
//! - [`filter`] — 絞り込み条件（媒体・形態・年代・主役のみ）
//! - [`path`] — 最短経路（双方向 BFS / 重み付きダイクストラ）
//! - [`view`] — 中心ノードから表示用の近傍を取り出す
//! - [`normalize`] — 検索と名寄せで共有する文字列正規化
//! - [`search`] — 名前・読みの部分一致検索
//! - [`similarity`] — 名寄せ用の文字列類似度（Jaro-Winkler）

pub mod filter;
pub mod graph;
pub mod normalize;
pub mod path;
pub mod search;
pub mod similarity;
pub mod view;

pub use filter::Filter;
pub use graph::{EdgeAttr, EdgeType, Format, Graph, GraphBuilder, NodeKind, Role};
