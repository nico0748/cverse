//! CSR 形式のグラフ。
//!
//! ノードは 0 始まりの連番、隣接リストは `offsets` / `targets` の 2 本の配列で持つ。
//! ノード `u` の隣接は `targets[offsets[u]..offsets[u+1]]`。ポインタを辿らないので
//! キャッシュに乗りやすく、そのままバイト列として配信できる。
//!
//! エッジは無向で、両方向を格納する。エッジ属性は 1 バイトに詰める（[`EdgeAttr`]）。

/// ノードの種類。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum NodeKind {
    VoiceActor = 0,
    Character = 1,
    Work = 2,
}

impl NodeKind {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::VoiceActor),
            1 => Some(Self::Character),
            2 => Some(Self::Work),
            _ => None,
        }
    }
}

/// 作品の形態。作品以外のノードは `None`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum Format {
    None = 0,
    Tv = 1,
    TvShort = 2,
    Movie = 3,
    Ova = 4,
    Ona = 5,
    Special = 6,
    Game = 7,
}

impl Format {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Tv,
            2 => Self::TvShort,
            3 => Self::Movie,
            4 => Self::Ova,
            5 => Self::Ona,
            6 => Self::Special,
            7 => Self::Game,
            _ => Self::None,
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "TV" => Self::Tv,
            "TV_SHORT" => Self::TvShort,
            "MOVIE" => Self::Movie,
            "OVA" => Self::Ova,
            "ONA" => Self::Ona,
            "SPECIAL" => Self::Special,
            "GAME" => Self::Game,
            _ => return None,
        })
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "",
            Self::Tv => "TV",
            Self::TvShort => "TV_SHORT",
            Self::Movie => "MOVIE",
            Self::Ova => "OVA",
            Self::Ona => "ONA",
            Self::Special => "SPECIAL",
            Self::Game => "GAME",
        }
    }
}

/// エッジの種類（属性バイトの下位 2 ビット）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum EdgeType {
    /// 声優–キャラ「演じる」
    Voices = 0,
    /// キャラ–作品「登場する」
    Appears = 1,
    /// 作品–作品「シリーズ」
    Series = 2,
    /// キャラ–キャラ「関係」
    Relation = 3,
}

/// 役の重さ。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum Role {
    Main = 0,
    Supporting = 1,
    Background = 2,
}

/// エッジ属性。1 バイトに詰める。
///
/// ```text
/// bit 0-1: EdgeType
/// Voices : bit2 = アニメ, bit3 = ゲーム, bit4 = 代役・交代（regular 以外）
/// Appears: bit2-3 = Role
/// Series : bit2-4 = 関係コード（表示用。探索では使わない）
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EdgeAttr(pub u8);

impl EdgeAttr {
    pub const MEDIA_ANIME: u8 = 1;
    pub const MEDIA_GAME: u8 = 2;

    pub fn voices(media: u8, irregular: bool) -> Self {
        Self(EdgeType::Voices as u8 | ((media & 3) << 2) | ((irregular as u8) << 4))
    }
    pub fn appears(role: Role) -> Self {
        Self(EdgeType::Appears as u8 | ((role as u8) << 2))
    }
    pub fn series(code: u8) -> Self {
        Self(EdgeType::Series as u8 | ((code & 7) << 2))
    }
    pub fn relation() -> Self {
        Self(EdgeType::Relation as u8)
    }

    #[inline]
    pub fn edge_type(self) -> EdgeType {
        match self.0 & 3 {
            0 => EdgeType::Voices,
            1 => EdgeType::Appears,
            2 => EdgeType::Series,
            _ => EdgeType::Relation,
        }
    }
    /// Voices エッジの媒体ビット（bit0 = アニメ, bit1 = ゲーム）。
    #[inline]
    pub fn media(self) -> u8 {
        (self.0 >> 2) & 3
    }
    #[inline]
    pub fn irregular(self) -> bool {
        self.0 & 0x10 != 0
    }
    /// Appears エッジの役の重さ。
    #[inline]
    pub fn role(self) -> Role {
        match (self.0 >> 2) & 3 {
            0 => Role::Main,
            1 => Role::Supporting,
            _ => Role::Background,
        }
    }
    #[inline]
    pub fn series_code(self) -> u8 {
        (self.0 >> 2) & 7
    }
}

/// CSR 形式のグラフ本体。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Graph {
    pub kind: Vec<u8>,
    pub format: Vec<u8>,
    /// 作品の開始年。不明・作品以外は 0。
    pub year: Vec<u16>,
    /// 表示優先度（声優: お気に入り数、作品: 人気、キャラ: 派生値）。
    pub score: Vec<u32>,
    pub offsets: Vec<u32>,
    pub targets: Vec<u32>,
    pub eattr: Vec<u8>,
}

const MAGIC: &[u8; 4] = b"CVG1";

#[derive(Debug, PartialEq, Eq)]
pub enum DecodeError {
    BadMagic,
    Truncated,
    Corrupt(&'static str),
}

impl core::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::BadMagic => write!(f, "not a CVG1 graph file"),
            Self::Truncated => write!(f, "graph file is truncated"),
            Self::Corrupt(what) => write!(f, "graph file is corrupt: {what}"),
        }
    }
}

impl std::error::Error for DecodeError {}

impl Graph {
    #[inline]
    pub fn node_count(&self) -> usize {
        self.kind.len()
    }

    /// 無向エッジの本数（格納は両方向なので半分）。
    #[inline]
    pub fn edge_count(&self) -> usize {
        self.targets.len() / 2
    }

    #[inline]
    pub fn kind_of(&self, u: u32) -> NodeKind {
        NodeKind::from_u8(self.kind[u as usize]).unwrap_or(NodeKind::Character)
    }

    #[inline]
    pub fn degree(&self, u: u32) -> usize {
        (self.offsets[u as usize + 1] - self.offsets[u as usize]) as usize
    }

    /// `u` の隣接ノードとエッジ属性。
    #[inline]
    pub fn neighbors(&self, u: u32) -> impl Iterator<Item = (u32, EdgeAttr)> + '_ {
        let lo = self.offsets[u as usize] as usize;
        let hi = self.offsets[u as usize + 1] as usize;
        self.targets[lo..hi]
            .iter()
            .zip(&self.eattr[lo..hi])
            .map(|(&v, &a)| (v, EdgeAttr(a)))
    }

    /// バイナリ形式（リトルエンディアン）に書き出す。
    ///
    /// ```text
    /// "CVG1" | n:u32 | m:u32 (片方向の格納本数)
    /// kind[n]:u8 | format[n]:u8 | (4 バイト境界まで 0 埋め)
    /// year[n]:u16 | (4 バイト境界まで 0 埋め)
    /// score[n]:u32 | offsets[n+1]:u32 | targets[m]:u32 | eattr[m]:u8
    /// ```
    pub fn to_bytes(&self) -> Vec<u8> {
        let n = self.node_count();
        let m = self.targets.len();
        let mut out = Vec::with_capacity(12 + n * 12 + m * 5 + 16);
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&(n as u32).to_le_bytes());
        out.extend_from_slice(&(m as u32).to_le_bytes());
        out.extend_from_slice(&self.kind);
        out.extend_from_slice(&self.format);
        pad4(&mut out);
        for y in &self.year {
            out.extend_from_slice(&y.to_le_bytes());
        }
        pad4(&mut out);
        for v in self.score.iter().chain(&self.offsets).chain(&self.targets) {
            out.extend_from_slice(&v.to_le_bytes());
        }
        out.extend_from_slice(&self.eattr);
        out
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, DecodeError> {
        let mut r = Reader { bytes, pos: 0 };
        if r.take(4)? != MAGIC {
            return Err(DecodeError::BadMagic);
        }
        let n = r.u32()? as usize;
        let m = r.u32()? as usize;
        let kind = r.take(n)?.to_vec();
        let format = r.take(n)?.to_vec();
        r.align4();
        let year = r
            .take(n.checked_mul(2).ok_or(DecodeError::Truncated)?)?
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| u16::from_le_bytes(*c))
            .collect();
        r.align4();
        let score = r.u32s(n)?;
        let offsets = r.u32s(n + 1)?;
        let targets = r.u32s(m)?;
        let eattr = r.take(m)?.to_vec();

        // 壊れたファイルで範囲外アクセスしないよう、不変条件を検査する。
        if offsets.first() != Some(&0) || offsets.last() != Some(&(m as u32)) {
            return Err(DecodeError::Corrupt("offsets"));
        }
        if offsets.windows(2).any(|w| w[0] > w[1]) {
            return Err(DecodeError::Corrupt("offsets not monotonic"));
        }
        if targets.iter().any(|&t| t as usize >= n) {
            return Err(DecodeError::Corrupt("target out of range"));
        }
        if kind.iter().any(|&k| k > 2) {
            return Err(DecodeError::Corrupt("node kind"));
        }
        Ok(Self {
            kind,
            format,
            year,
            score,
            offsets,
            targets,
            eattr,
        })
    }
}

fn pad4(out: &mut Vec<u8>) {
    while !out.len().is_multiple_of(4) {
        out.push(0);
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, len: usize) -> Result<&'a [u8], DecodeError> {
        let end = self.pos.checked_add(len).ok_or(DecodeError::Truncated)?;
        let s = self
            .bytes
            .get(self.pos..end)
            .ok_or(DecodeError::Truncated)?;
        self.pos = end;
        Ok(s)
    }
    fn align4(&mut self) {
        self.pos = (self.pos + 3) & !3;
    }
    fn u32(&mut self) -> Result<u32, DecodeError> {
        let b = self.take(4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }
    fn u32s(&mut self, len: usize) -> Result<Vec<u32>, DecodeError> {
        let len_bytes = len.checked_mul(4).ok_or(DecodeError::Truncated)?;
        Ok(self
            .take(len_bytes)?
            .as_chunks::<4>()
            .0
            .iter()
            .map(|c| u32::from_le_bytes(*c))
            .collect())
    }
}

/// エッジのリストから CSR を組み立てる。
#[derive(Debug, Default)]
pub struct GraphBuilder {
    kind: Vec<u8>,
    format: Vec<u8>,
    year: Vec<u16>,
    score: Vec<u32>,
    edges: Vec<(u32, u32, u8)>,
}

impl GraphBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_node(&mut self, kind: NodeKind, format: Format, year: u16, score: u32) -> u32 {
        self.kind.push(kind as u8);
        self.format.push(format as u8);
        self.year.push(year);
        self.score.push(score);
        (self.kind.len() - 1) as u32
    }

    pub fn set_score(&mut self, u: u32, score: u32) {
        self.score[u as usize] = score;
    }

    /// 無向エッジを 1 本追加する。同じ端点・同じ種類の重複は `build` でまとめる。
    pub fn add_edge(&mut self, a: u32, b: u32, attr: EdgeAttr) {
        assert!((a as usize) < self.kind.len() && (b as usize) < self.kind.len());
        if a != b {
            self.edges.push((a, b, attr.0));
            self.edges.push((b, a, attr.0));
        }
    }

    pub fn build(mut self) -> Graph {
        let n = self.kind.len();
        self.edges.sort_unstable();
        // 同じ (端点, 種類) のエッジを 1 本にまとめる。
        // Voices は媒体ビットを OR、Appears は重い方の役（小さい値）を残す。
        let mut merged: Vec<(u32, u32, u8)> = Vec::with_capacity(self.edges.len());
        for (a, b, attr) in self.edges {
            if let Some(last) = merged.last_mut() {
                if last.0 == a && last.1 == b && last.2 & 3 == attr & 3 {
                    last.2 = match EdgeAttr(attr).edge_type() {
                        // 媒体は OR。代役フラグは「すべて代役」のときだけ残す。
                        EdgeType::Voices => {
                            (last.2 | (attr & 0x0c)) & (0xef | (last.2 & attr & 0x10))
                        }
                        EdgeType::Appears => last.2.min(attr),
                        _ => last.2,
                    };
                    continue;
                }
            }
            merged.push((a, b, attr));
        }
        let mut offsets = vec![0u32; n + 1];
        for &(a, _, _) in &merged {
            offsets[a as usize + 1] += 1;
        }
        for i in 0..n {
            offsets[i + 1] += offsets[i];
        }
        let targets = merged.iter().map(|e| e.1).collect();
        let eattr = merged.iter().map(|e| e.2).collect();
        Graph {
            kind: self.kind,
            format: self.format,
            year: self.year,
            score: self.score,
            offsets,
            targets,
            eattr,
        }
    }
}

#[cfg(test)]
pub(crate) mod testutil {
    use super::*;

    /// テスト用の小さなグラフ。
    ///
    /// ```text
    /// va0 ─ ch3 ─(main)─ wk7 ─(main)─ ch4 ─ va1
    ///                     │(supporting)
    ///                    ch5 ─ va2
    ///                     │(main)
    ///                    wk8(GAME, 2020) ─(supporting)─ ch6 ─ va1
    /// wk7(TV, 2010) ─series─ wk9(MOVIE, 2012)
    /// ```
    pub fn sample() -> Graph {
        let mut b = GraphBuilder::new();
        for i in 0..3 {
            b.add_node(NodeKind::VoiceActor, Format::None, 0, 100 - i);
        }
        for i in 0..4 {
            b.add_node(NodeKind::Character, Format::None, 0, 50 - i);
        }
        b.add_node(NodeKind::Work, Format::Tv, 2010, 1000);
        b.add_node(NodeKind::Work, Format::Game, 2020, 500);
        b.add_node(NodeKind::Work, Format::Movie, 2012, 300);
        let anime = EdgeAttr::voices(EdgeAttr::MEDIA_ANIME, false);
        let game = EdgeAttr::voices(EdgeAttr::MEDIA_GAME, false);
        b.add_edge(0, 3, anime);
        b.add_edge(1, 4, anime);
        b.add_edge(2, 5, anime);
        b.add_edge(2, 5, game);
        b.add_edge(1, 6, game);
        b.add_edge(3, 7, EdgeAttr::appears(Role::Main));
        b.add_edge(4, 7, EdgeAttr::appears(Role::Main));
        b.add_edge(5, 7, EdgeAttr::appears(Role::Supporting));
        b.add_edge(5, 8, EdgeAttr::appears(Role::Main));
        b.add_edge(6, 8, EdgeAttr::appears(Role::Supporting));
        b.add_edge(7, 9, EdgeAttr::series(1));
        b.build()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_bytes() {
        let g = testutil::sample();
        let bytes = g.to_bytes();
        assert_eq!(Graph::from_bytes(&bytes).unwrap(), g);
    }

    #[test]
    fn rejects_bad_input() {
        let g = testutil::sample();
        let bytes = g.to_bytes();
        assert_eq!(Graph::from_bytes(b"nope"), Err(DecodeError::BadMagic));
        assert_eq!(
            Graph::from_bytes(&bytes[..bytes.len() - 3]),
            Err(DecodeError::Truncated)
        );
        let mut bad = bytes.clone();
        let n = g.node_count();
        // targets の先頭を範囲外にする
        let targets_at = bytes.len() - g.targets.len() * 5;
        bad[targets_at..targets_at + 4].copy_from_slice(&(n as u32 + 5).to_le_bytes());
        assert!(matches!(
            Graph::from_bytes(&bad),
            Err(DecodeError::Corrupt(_))
        ));
    }

    #[test]
    fn merges_parallel_edges() {
        let g = testutil::sample();
        // va2–ch5 はアニメとゲームの 2 行が 1 本にまとまる
        let (v, attr) = g.neighbors(2).next().unwrap();
        assert_eq!(v, 5);
        assert_eq!(g.degree(2), 1);
        assert_eq!(attr.media(), EdgeAttr::MEDIA_ANIME | EdgeAttr::MEDIA_GAME);
        assert_eq!(g.edge_count(), 10);
    }

    #[test]
    fn edge_attr_bits() {
        let a = EdgeAttr::appears(Role::Supporting);
        assert_eq!(a.edge_type(), EdgeType::Appears);
        assert_eq!(a.role(), Role::Supporting);
        let v = EdgeAttr::voices(EdgeAttr::MEDIA_GAME, true);
        assert_eq!(v.edge_type(), EdgeType::Voices);
        assert!(v.irregular());
        assert_eq!(v.media(), EdgeAttr::MEDIA_GAME);
    }
}
