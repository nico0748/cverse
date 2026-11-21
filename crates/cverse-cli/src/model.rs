//! 収集データ（`data/source/*.json`）の型と読み込み・検証。形式は docs/data-schema.md を参照。

use std::collections::{HashMap, HashSet};
use std::path::Path;

use anyhow::{Context, Result};
use cverse_core::Format;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub source: String,
    pub url: String,
    pub fetched_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceActor {
    pub id: String,
    pub name: String,
    pub reading: Option<String>,
    pub name_en: Option<String>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub aliases: Vec<String>,
    pub agency: Option<String>,
    pub debut_year: Option<u32>,
    pub anilist_id: Option<u64>,
    pub wikipedia_title: Option<String>,
    pub wikidata_id: Option<String>,
    pub favourites: Option<u32>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub sources: Vec<Source>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Character {
    pub id: String,
    pub name: String,
    pub reading: Option<String>,
    pub name_en: Option<String>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub aliases: Vec<String>,
    pub anilist_id: Option<u64>,
    pub wikipedia_title: Option<String>,
    pub favourites: Option<u32>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub sources: Vec<Source>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Work {
    pub id: String,
    pub title: String,
    pub reading: Option<String>,
    pub title_en: Option<String>,
    pub format: String,
    pub year: Option<u16>,
    pub series: Option<String>,
    pub anilist_id: Option<u64>,
    pub wikipedia_title: Option<String>,
    pub popularity: Option<u32>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub sources: Vec<Source>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Period {
    pub from: Option<u16>,
    pub to: Option<u16>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cast {
    pub voice_actor: String,
    pub character: String,
    pub medium: String,
    pub work: Option<String>,
    pub period: Option<Period>,
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Appearance {
    pub character: String,
    pub work: String,
    pub role: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Series {
    pub from: String,
    pub to: String,
    pub relation: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Relation {
    pub a: String,
    pub b: String,
    pub label: Option<String>,
}

fn null_as_default<'de, D, T>(d: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(d)?.unwrap_or_default())
}

#[derive(Debug, Default)]
pub struct Dataset {
    pub voice_actors: Vec<VoiceActor>,
    pub characters: Vec<Character>,
    pub works: Vec<Work>,
    pub casts: Vec<Cast>,
    pub appearances: Vec<Appearance>,
    pub series: Vec<Series>,
    pub relations: Vec<Relation>,
}

fn read<T: for<'de> Deserialize<'de>>(dir: &Path, name: &str, required: bool) -> Result<Vec<T>> {
    let path = dir.join(name);
    if !path.exists() {
        if required {
            anyhow::bail!("{} が見つかりません", path.display());
        }
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(&path)
        .with_context(|| format!("{} を読めません", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("{} の形式が不正です", path.display()))
}

impl Dataset {
    pub fn load(dir: &Path) -> Result<Self> {
        Ok(Self {
            voice_actors: read(dir, "voice_actors.json", true)?,
            characters: read(dir, "characters.json", true)?,
            works: read(dir, "works.json", true)?,
            casts: read(dir, "casts.json", true)?,
            appearances: read(dir, "appearances.json", true)?,
            series: read(dir, "series.json", false)?,
            relations: read(dir, "relations.json", false)?,
        })
    }

    /// 検証して、問題のあるエッジを取り除く。
    ///
    /// ノードの不備（ID 重複・プレフィックス違い・必須欠落・不正な形態）は `errors`、
    /// エッジの不備（参照切れ・不正な値）は `warnings` に入れてそのエッジを捨てる。
    pub fn validate(&mut self) -> Report {
        let mut r = Report::default();
        let mut ids: HashSet<String> = HashSet::new();
        let mut check_node =
            |r: &mut Report, id: &str, prefix: &str, name: &str, sources: &[Source]| {
                if !id.starts_with(prefix) || id.len() == prefix.len() {
                    r.errors
                        .push(format!("{id}: ID は `{prefix}` で始まる必要があります"));
                }
                if !ids.insert(id.to_owned()) {
                    r.errors.push(format!("{id}: ID が重複しています"));
                }
                if name.trim().is_empty() {
                    r.errors.push(format!("{id}: 名前が空です"));
                }
                if sources.is_empty() {
                    r.warnings.push(format!("{id}: sources がありません"));
                }
                for s in sources {
                    if s.url.is_empty() || !is_date(&s.fetched_at) {
                        r.warnings
                            .push(format!("{id}: sources の url / fetchedAt が不正です"));
                    }
                }
            };
        for v in &self.voice_actors {
            check_node(&mut r, &v.id, "va:", &v.name, &v.sources);
        }
        for c in &self.characters {
            check_node(&mut r, &c.id, "ch:", &c.name, &c.sources);
        }
        for w in &self.works {
            check_node(&mut r, &w.id, "wk:", &w.title, &w.sources);
            if Format::parse(&w.format).is_none() {
                r.errors
                    .push(format!("{}: format `{}` は不正です", w.id, w.format));
            }
        }

        let kind_of: HashMap<&str, char> = self
            .voice_actors
            .iter()
            .map(|v| (v.id.as_str(), 'v'))
            .chain(self.characters.iter().map(|c| (c.id.as_str(), 'c')))
            .chain(self.works.iter().map(|w| (w.id.as_str(), 'w')))
            .collect();
        let is = |id: &str, k: char| kind_of.get(id) == Some(&k);

        let warnings = &mut r.warnings;
        self.casts.retain(|c| {
            let ok = is(&c.voice_actor, 'v')
                && is(&c.character, 'c')
                && matches!(c.medium.as_str(), "anime" | "game")
                && c.work.as_deref().is_none_or(|w| is(w, 'w'));
            if !ok {
                warnings.push(format!(
                    "casts: {} – {} を捨てました（参照切れか medium 不正）",
                    c.voice_actor, c.character
                ));
            }
            ok
        });
        self.appearances.retain(|a| {
            let ok = is(&a.character, 'c')
                && is(&a.work, 'w')
                && matches!(a.role.as_str(), "MAIN" | "SUPPORTING" | "BACKGROUND");
            if !ok {
                warnings.push(format!(
                    "appearances: {} – {} を捨てました（参照切れか role 不正）",
                    a.character, a.work
                ));
            }
            ok
        });
        self.series.retain(|s| {
            let ok = is(&s.from, 'w') && is(&s.to, 'w') && s.from != s.to;
            if !ok {
                warnings.push(format!("series: {} – {} を捨てました", s.from, s.to));
            }
            ok
        });
        self.relations.retain(|x| {
            let ok = is(&x.a, 'c') && is(&x.b, 'c') && x.a != x.b;
            if !ok {
                warnings.push(format!("relations: {} – {} を捨てました", x.a, x.b));
            }
            ok
        });

        // どのエッジにもつながらないノードは、検索しても何も出ないので知らせる。
        let mut linked: HashSet<&str> = HashSet::new();
        for c in &self.casts {
            linked.insert(&c.voice_actor);
            linked.insert(&c.character);
        }
        for a in &self.appearances {
            linked.insert(&a.character);
            linked.insert(&a.work);
        }
        r.isolated = kind_of.keys().filter(|id| !linked.contains(**id)).count();
        r
    }
}

const MAX_LISTED: usize = 200;

fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b[..10]
            .iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

#[derive(Debug, Default)]
pub struct Report {
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub isolated: usize,
}

impl Report {
    pub fn print(&self) {
        for (label, list) in [("error", &self.errors), ("warning", &self.warnings)] {
            for msg in list.iter().take(MAX_LISTED) {
                eprintln!("{label}: {msg}");
            }
            if list.len() > MAX_LISTED {
                eprintln!("{label}: … ほか {} 件", list.len() - MAX_LISTED);
            }
        }
        eprintln!(
            "検証: エラー {} 件、警告 {} 件、孤立ノード {} 件",
            self.errors.len(),
            self.warnings.len(),
            self.isolated
        );
    }
}
