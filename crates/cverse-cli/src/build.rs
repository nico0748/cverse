//! 配信データの生成。
//!
//! ```text
//! out/
//!   meta.json        件数・生成日・シャード数・トップに出す声優
//!   graph.bin        CSR バイナリ（経路探索・近傍抽出用）
//!   index.json       { ids: [...], labels: [...] }（ノード番号 → ID・表示名）
//!   search.txt       検索キー（1 行 1 ノード、キーはタブ区切り）
//!   images.json      { bases: [...], refs: [...] }（ノード番号 → 画像 URL。画像が 1 件も無ければ出さない）
//!   local/…          データに同梱された画像（相対パスで指定されたもの）の写し
//!   nodes/<k>.json   詳細パネル用。ID のハッシュで分けたシャード
//! ```
//!
//! 仕様の「ノードごとの JSON 分割」は、ノード 1 件 1 ファイルだと数万ファイルになり
//! Cloudflare Pages のファイル数上限（2 万）に当たるため、ハッシュで束ねたシャードにしている。

use std::collections::HashMap;
use std::path::Path;

use anyhow::{Context, Result};
use cverse_core::graph::{EdgeAttr, GraphBuilder, NodeKind, Role};
use cverse_core::search::SearchIndex;
use cverse_core::{Format, Graph};
use serde_json::{json, Map, Value};

use crate::model::{is_remote, Dataset, Image, Source};

/// 1 シャードあたりの目安ノード数。
const NODES_PER_SHARD: usize = 120;

pub struct Built {
    pub graph: Graph,
    pub ids: Vec<String>,
    pub labels: Vec<String>,
    pub search_keys: Vec<String>,
    pub details: Vec<Value>,
    /// ノード番号 → 画像（ブラウザから見た URL に直したもの）。
    pub images: Vec<Option<Image>>,
    /// 配信先へ写す同梱画像（データのディレクトリからの相対パス）。
    pub local_files: Vec<String>,
    pub featured: Vec<String>,
    pub featured_works: Vec<String>,
    pub data_date: String,
}

/// FNV-1a（32 ビット）。ブラウザ側（web/src/lib/shard.ts）と同じ計算。
pub fn fnv1a(s: &str) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in s.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

pub fn shard_count(nodes: usize) -> u32 {
    (nodes.div_ceil(NODES_PER_SHARD) as u32)
        .max(1)
        .next_power_of_two()
}

fn role_of(s: &str) -> Role {
    match s {
        "MAIN" => Role::Main,
        "SUPPORTING" => Role::Supporting,
        _ => Role::Background,
    }
}

fn inverse_relation(rel: &str) -> &str {
    match rel {
        "SEQUEL" => "PREQUEL",
        "PREQUEL" => "SEQUEL",
        "SIDE_STORY" | "SPIN_OFF" => "PARENT",
        "ADAPTATION" => "SOURCE",
        other => other,
    }
}

/// `null` と空配列を落として JSON を小さくする。
fn compact(mut m: Map<String, Value>) -> Value {
    m.retain(|_, v| !v.is_null() && v.as_array().is_none_or(|a| !a.is_empty()));
    Value::Object(m)
}

fn obj(v: Value) -> Value {
    match v {
        Value::Object(m) => compact(m),
        other => other,
    }
}

fn sources_json(sources: &[Source]) -> Value {
    json!(sources)
}

/// 同梱画像の配信先（`<out>/local/…`）。
const LOCAL_PREFIX: &str = "local/";

/// 画像をブラウザから見た形に直す。同梱画像（相対パス）は `local/` 配下を指す。
fn published(image: &Option<Image>, local_files: &mut Vec<String>) -> Option<Image> {
    let mut image = image.clone()?;
    if !is_remote(&image.url) {
        local_files.push(image.url.clone());
        image.url = format!("{LOCAL_PREFIX}{}", image.url);
    }
    Some(image)
}

fn image_json(image: &Option<Image>) -> Value {
    match image {
        Some(i) => obj(json!(i)),
        None => Value::Null,
    }
}

/// 画像 URL の表を小さくまとめる。URL の「最後の `/` まで」を `bases` に 1 回だけ持ち、
/// ノードごとには `"<bases の番号>:<残り>"` を持つ（画像なしは空文字列）。
pub fn image_table(images: &[Option<Image>]) -> Value {
    let mut bases: Vec<&str> = Vec::new();
    let mut base_index: HashMap<&str, usize> = HashMap::new();
    let refs: Vec<String> = images
        .iter()
        .map(|image| {
            let Some(image) = image else {
                return String::new();
            };
            let cut = image.url.rfind('/').map_or(0, |i| i + 1);
            let (base, rest) = image.url.split_at(cut);
            let k = *base_index.entry(base).or_insert_with(|| {
                bases.push(base);
                bases.len() - 1
            });
            format!("{k}:{rest}")
        })
        .collect();
    json!({ "bases": bases, "refs": refs })
}

pub fn build(ds: &Dataset) -> Built {
    // ノード番号: 声優（お気に入り順）→ キャラ → 作品（人気順）。
    let mut vas: Vec<_> = ds.voice_actors.iter().collect();
    vas.sort_by_key(|v| (std::cmp::Reverse(v.favourites.unwrap_or(0)), v.id.as_str()));
    let mut works: Vec<_> = ds.works.iter().collect();
    works.sort_by_key(|w| (std::cmp::Reverse(w.popularity.unwrap_or(0)), w.id.as_str()));
    let mut chars: Vec<_> = ds.characters.iter().collect();
    chars.sort_by_key(|c| c.id.as_str());

    let mut gb = GraphBuilder::new();
    let mut idx: HashMap<&str, u32> = HashMap::new();
    let mut ids = Vec::new();
    let mut labels = Vec::new();
    let mut search_keys = Vec::new();
    let mut images: Vec<Option<Image>> = Vec::new();
    let mut local_files: Vec<String> = Vec::new();

    for v in &vas {
        let i = gb.add_node(
            NodeKind::VoiceActor,
            Format::None,
            0,
            v.favourites.unwrap_or(0),
        );
        idx.insert(&v.id, i);
        ids.push(v.id.clone());
        labels.push(v.name.clone());
        images.push(published(&v.image, &mut local_files));
        search_keys.push(SearchIndex::make_key(
            [
                Some(v.name.as_str()),
                v.reading.as_deref(),
                v.name_en.as_deref(),
            ]
            .into_iter()
            .flatten()
            .chain(v.aliases.iter().map(String::as_str)),
        ));
    }
    for c in &chars {
        let i = gb.add_node(
            NodeKind::Character,
            Format::None,
            0,
            c.favourites.unwrap_or(0),
        );
        idx.insert(&c.id, i);
        ids.push(c.id.clone());
        labels.push(c.name.clone());
        images.push(published(&c.image, &mut local_files));
        search_keys.push(SearchIndex::make_key(
            [
                Some(c.name.as_str()),
                c.reading.as_deref(),
                c.name_en.as_deref(),
            ]
            .into_iter()
            .flatten()
            .chain(c.aliases.iter().map(String::as_str)),
        ));
    }
    for w in &works {
        let format = Format::parse(&w.format).unwrap_or(Format::Tv);
        let i = gb.add_node(
            NodeKind::Work,
            format,
            w.year.unwrap_or(0),
            w.popularity.unwrap_or(0),
        );
        idx.insert(&w.id, i);
        ids.push(w.id.clone());
        labels.push(w.title.clone());
        images.push(published(&w.image, &mut local_files));
        search_keys.push(SearchIndex::make_key(
            [
                Some(w.title.as_str()),
                w.reading.as_deref(),
                w.title_en.as_deref(),
                w.series.as_deref(),
            ]
            .into_iter()
            .flatten(),
        ));
    }

    let va_by_id: HashMap<&str, _> = ds.voice_actors.iter().map(|v| (v.id.as_str(), v)).collect();
    let ch_by_id: HashMap<&str, _> = ds.characters.iter().map(|c| (c.id.as_str(), c)).collect();
    let wk_by_id: HashMap<&str, _> = ds.works.iter().map(|w| (w.id.as_str(), w)).collect();

    // エッジ
    for c in &ds.casts {
        let media = if c.medium == "game" {
            EdgeAttr::MEDIA_GAME
        } else {
            EdgeAttr::MEDIA_ANIME
        };
        let irregular = matches!(c.kind.as_deref(), Some("replacement" | "substitute"));
        gb.add_edge(
            idx[c.voice_actor.as_str()],
            idx[c.character.as_str()],
            EdgeAttr::voices(media, irregular),
        );
    }
    for a in &ds.appearances {
        gb.add_edge(
            idx[a.character.as_str()],
            idx[a.work.as_str()],
            EdgeAttr::appears(role_of(&a.role)),
        );
    }
    for s in &ds.series {
        gb.add_edge(
            idx[s.from.as_str()],
            idx[s.to.as_str()],
            EdgeAttr::series(0),
        );
    }
    for r in &ds.relations {
        gb.add_edge(idx[r.a.as_str()], idx[r.b.as_str()], EdgeAttr::relation());
    }

    // キャラの優先度: お気に入り数が無ければ「登場作品の人気 ÷ 役の重さ」の最大値。
    let mut derived: HashMap<&str, u32> = HashMap::new();
    for a in &ds.appearances {
        let pop = wk_by_id[a.work.as_str()].popularity.unwrap_or(0);
        let s = pop / [1, 3, 9][role_of(&a.role) as usize];
        let e = derived.entry(a.character.as_str()).or_default();
        *e = (*e).max(s);
    }
    for c in &chars {
        if c.favourites.is_none() {
            gb.set_score(
                idx[c.id.as_str()],
                derived.get(c.id.as_str()).copied().unwrap_or(0),
            );
        }
    }
    let graph = gb.build();

    // ---- 詳細パネル用データ ----
    let mut apps_by_ch: HashMap<&str, Vec<&crate::model::Appearance>> = HashMap::new();
    let mut apps_by_wk: HashMap<&str, Vec<&crate::model::Appearance>> = HashMap::new();
    for a in &ds.appearances {
        apps_by_ch.entry(&a.character).or_default().push(a);
        apps_by_wk.entry(&a.work).or_default().push(a);
    }
    let mut casts_by_va: HashMap<&str, Vec<&crate::model::Cast>> = HashMap::new();
    let mut casts_by_ch: HashMap<&str, Vec<&crate::model::Cast>> = HashMap::new();
    for c in &ds.casts {
        casts_by_va.entry(&c.voice_actor).or_default().push(c);
        casts_by_ch.entry(&c.character).or_default().push(c);
    }
    let pop = |w: &str| wk_by_id[w].popularity.unwrap_or(0);
    let work_ref = |a: &crate::model::Appearance| {
        let w = wk_by_id[a.work.as_str()];
        obj(
            json!({ "id": w.id, "name": w.title, "year": w.year, "format": w.format, "role": a.role }),
        )
    };
    // キャラの登場作品（役の重い順 → 人気順）
    let works_of = |ch: &str| -> Vec<Value> {
        let mut list: Vec<_> = apps_by_ch.get(ch).cloned().unwrap_or_default();
        list.sort_by_key(|a| {
            (
                role_of(&a.role),
                std::cmp::Reverse(pop(&a.work)),
                a.work.as_str(),
            )
        });
        list.dedup_by_key(|a| a.work.as_str());
        list.into_iter().map(work_ref).collect()
    };
    let cast_ref = |c: &crate::model::Cast| {
        let v = va_by_id[c.voice_actor.as_str()];
        obj(json!({
            "id": v.id, "name": v.name, "medium": c.medium,
            "kind": c.kind.as_deref().filter(|k| *k != "regular"),
            "period": c.period, "work": c.work,
        }))
    };

    let mut details: Vec<Value> = Vec::with_capacity(ids.len());
    for v in &vas {
        // 出演一覧: キャラごとに 1 行。媒体はまとめる。
        let mut by_ch: Vec<(&str, Vec<&crate::model::Cast>)> = Vec::new();
        for c in casts_by_va.get(v.id.as_str()).into_iter().flatten() {
            match by_ch.iter_mut().find(|(id, _)| *id == c.character) {
                Some((_, list)) => list.push(c),
                None => by_ch.push((&c.character, vec![c])),
            }
        }
        let mut roles: Vec<(Role, u32, Value)> = by_ch
            .into_iter()
            .map(|(ch_id, casts)| {
                let ch = ch_by_id[ch_id];
                let mut media: Vec<&str> = casts.iter().map(|c| c.medium.as_str()).collect();
                media.sort_unstable();
                media.dedup();
                let apps = apps_by_ch.get(ch_id).cloned().unwrap_or_default();
                let best = apps
                    .iter()
                    .map(|a| role_of(&a.role))
                    .min()
                    .unwrap_or(Role::Background);
                let top = apps.iter().map(|a| pop(&a.work)).max().unwrap_or(0);
                let kind = casts
                    .iter()
                    .filter_map(|c| c.kind.as_deref())
                    .find(|k| *k != "regular");
                let value = obj(json!({
                    "id": ch.id, "name": ch.name, "media": media, "kind": kind,
                    "works": works_of(ch_id),
                }));
                (best, top, value)
            })
            .collect();
        roles.sort_by_key(|r| (r.0, std::cmp::Reverse(r.1)));
        details.push(obj(json!({
            "id": v.id, "kind": "va", "name": v.name, "reading": v.reading, "nameEn": v.name_en,
            "aliases": v.aliases, "agency": v.agency, "debutYear": v.debut_year,
            "anilistId": v.anilist_id, "wikipediaTitle": v.wikipedia_title, "wikidataId": v.wikidata_id,
            "favourites": v.favourites, "sources": sources_json(&v.sources),
            "image": image_json(&images[idx[v.id.as_str()] as usize]),
            "roles": roles.into_iter().map(|r| r.2).collect::<Vec<_>>(),
        })));
    }
    for c in &chars {
        let voiced: Vec<Value> = casts_by_ch
            .get(c.id.as_str())
            .into_iter()
            .flatten()
            .map(|x| cast_ref(x))
            .collect();
        let relations: Vec<Value> = ds
            .relations
            .iter()
            .filter_map(|r| {
                let other = if r.a == c.id {
                    &r.b
                } else if r.b == c.id {
                    &r.a
                } else {
                    return None;
                };
                Some(obj(
                    json!({ "id": other, "name": ch_by_id[other.as_str()].name, "label": r.label }),
                ))
            })
            .collect();
        details.push(obj(json!({
            "id": c.id, "kind": "ch", "name": c.name, "reading": c.reading, "nameEn": c.name_en,
            "aliases": c.aliases, "anilistId": c.anilist_id, "wikipediaTitle": c.wikipedia_title,
            "sources": sources_json(&c.sources),
            "image": image_json(&images[idx[c.id.as_str()] as usize]),
            "voicedBy": voiced, "works": works_of(&c.id), "relations": relations,
        })));
    }
    for w in &works {
        let mut cast: Vec<_> = apps_by_wk.get(w.id.as_str()).cloned().unwrap_or_default();
        cast.sort_by_key(|a| {
            let score = graph.score[idx[a.character.as_str()] as usize];
            (
                role_of(&a.role),
                std::cmp::Reverse(score),
                a.character.as_str(),
            )
        });
        cast.dedup_by_key(|a| a.character.as_str());
        let cast: Vec<Value> = cast
            .into_iter()
            .map(|a| {
                let ch = ch_by_id[a.character.as_str()];
                // この作品に限定された配役があればそれを、無ければ媒体が合うものを出す。
                let all = casts_by_ch
                    .get(a.character.as_str())
                    .cloned()
                    .unwrap_or_default();
                let medium = if w.format == "GAME" { "game" } else { "anime" };
                let mut picked: Vec<_> = all
                    .iter()
                    .filter(|c| c.work.as_deref() == Some(w.id.as_str()))
                    .collect();
                if picked.is_empty() {
                    picked = all
                        .iter()
                        .filter(|c| c.work.is_none() && c.medium == medium)
                        .collect();
                }
                if picked.is_empty() {
                    picked = all.iter().filter(|c| c.work.is_none()).collect();
                }
                let vas: Vec<Value> = picked.into_iter().map(|c| cast_ref(c)).collect();
                obj(json!({ "id": ch.id, "name": ch.name, "role": a.role, "vas": vas }))
            })
            .collect();
        let related: Vec<Value> = ds
            .series
            .iter()
            .filter_map(|s| {
                let rel = s.relation.as_deref().unwrap_or("OTHER");
                let (other, rel) = if s.from == w.id {
                    (&s.to, rel)
                } else if s.to == w.id {
                    (&s.from, inverse_relation(rel))
                } else {
                    return None;
                };
                let o = wk_by_id[other.as_str()];
                Some(obj(json!({ "id": o.id, "name": o.title, "year": o.year, "format": o.format, "relation": rel })))
            })
            .collect();
        details.push(obj(json!({
            "id": w.id, "kind": "wk", "name": w.title, "reading": w.reading, "nameEn": w.title_en,
            "format": w.format, "year": w.year, "series": w.series,
            "anilistId": w.anilist_id, "wikipediaTitle": w.wikipedia_title,
            "sources": sources_json(&w.sources),
            "image": image_json(&images[idx[w.id.as_str()] as usize]),
            "cast": cast, "related": related,
        })));
    }

    let featured = vas.iter().take(24).map(|v| v.id.clone()).collect();
    let featured_works = works.iter().take(12).map(|w| w.id.clone()).collect();
    local_files.sort_unstable();
    local_files.dedup();
    let data_date = ds
        .voice_actors
        .iter()
        .flat_map(|v| &v.sources)
        .chain(ds.works.iter().flat_map(|w| &w.sources))
        .chain(ds.characters.iter().flat_map(|c| &c.sources))
        .map(|s| s.fetched_at.as_str())
        .max()
        .unwrap_or("")
        .to_owned();

    Built {
        graph,
        ids,
        labels,
        search_keys,
        details,
        images,
        local_files,
        featured,
        featured_works,
        data_date,
    }
}

/// `source` は収集データのディレクトリ（同梱画像の写し元）。
pub fn write(built: &Built, source: &Path, out: &Path, generated_at: &str) -> Result<()> {
    let nodes_dir = out.join("nodes");
    let local_dir = out.join(LOCAL_PREFIX);
    for (dir, name) in [(&nodes_dir, "nodes/"), (&local_dir, LOCAL_PREFIX)] {
        if dir.exists() {
            std::fs::remove_dir_all(dir).with_context(|| format!("古い {name} を消せません"))?;
        }
    }
    std::fs::create_dir_all(&nodes_dir)?;

    // 画像: URL の表と、同梱画像の写し。
    let image_count = built.images.iter().flatten().count();
    let images_path = out.join("images.json");
    if image_count > 0 {
        std::fs::write(
            &images_path,
            serde_json::to_vec(&image_table(&built.images))?,
        )?;
    } else if images_path.exists() {
        std::fs::remove_file(&images_path)?;
    }
    for rel in &built.local_files {
        let to = local_dir.join(rel);
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(source.join(rel), &to).with_context(|| format!("画像 {rel} を写せません"))?;
    }

    std::fs::write(out.join("graph.bin"), built.graph.to_bytes())?;
    std::fs::write(
        out.join("index.json"),
        serde_json::to_vec(&json!({ "ids": built.ids, "labels": built.labels }))?,
    )?;
    std::fs::write(out.join("search.txt"), built.search_keys.join("\n"))?;

    let shards = shard_count(built.ids.len());
    let mut buckets: Vec<Map<String, Value>> = vec![Map::new(); shards as usize];
    for (id, detail) in built.ids.iter().zip(&built.details) {
        buckets[(fnv1a(id) % shards) as usize].insert(id.clone(), detail.clone());
    }
    for (k, bucket) in buckets.into_iter().enumerate() {
        std::fs::write(
            nodes_dir.join(format!("{k}.json")),
            serde_json::to_vec(&Value::Object(bucket))?,
        )?;
    }

    let count = |k: NodeKind| built.graph.kind.iter().filter(|&&x| x == k as u8).count();
    let meta = json!({
        "version": 1,
        "generatedAt": generated_at,
        "dataDate": built.data_date,
        "counts": {
            "voiceActors": count(NodeKind::VoiceActor),
            "characters": count(NodeKind::Character),
            "works": count(NodeKind::Work),
            "edges": built.graph.edge_count(),
        },
        "shardCount": shards,
        "images": image_count,
        "featured": built.featured,
        "featuredWorks": built.featured_works,
    });
    std::fs::write(out.join("meta.json"), serde_json::to_vec_pretty(&meta)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fnv1a_matches_web_implementation() {
        // web/src/lib/url.test.ts と同じ期待値
        assert_eq!(fnv1a(""), 0x811c_9dc5);
        assert_eq!(fnv1a("a"), 0xe40c_292c);
        assert_eq!(fnv1a("声優"), 0xf271c860);
    }

    #[test]
    fn image_table_shares_url_prefixes() {
        let image = |url: &str| {
            Some(Image {
                url: url.to_owned(),
                source: None,
                page_url: None,
                license: None,
                attribution: None,
                width: None,
                height: None,
            })
        };
        let table = image_table(&[
            image("https://img.example/character/large/b1-abc.png"),
            None,
            image("https://img.example/character/large/b2-def.png"),
            image("local/images/va-001.svg"),
            image("plain.png"),
        ]);
        assert_eq!(
            table,
            json!({
                "bases": ["https://img.example/character/large/", "local/images/", ""],
                "refs": ["0:b1-abc.png", "", "0:b2-def.png", "1:va-001.svg", "2:plain.png"],
            })
        );
    }

    #[test]
    fn shard_count_is_a_power_of_two() {
        assert_eq!(shard_count(0), 1);
        assert_eq!(shard_count(120), 1);
        assert_eq!(shard_count(121), 2);
        assert_eq!(shard_count(30_000), 256);
    }
}
