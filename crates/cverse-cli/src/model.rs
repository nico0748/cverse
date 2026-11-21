//! 収集データ（`data/source/*.json`）の型と読み込み・検証。形式は docs/data-schema.md を参照。

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

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

/// ノードに添える画像。サイトは画像を再配布せず、`url` を直接参照するだけにする。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Image {
    /// `https://` で始まる URL か、データのディレクトリからの相対パス。
    pub url: String,
    pub source: Option<String>,
    pub page_url: Option<String>,
    /// ライセンス表記（`CC BY-SA 4.0` など）。権利者の著作物で許諾が無いものは `null`。
    pub license: Option<String>,
    pub attribution: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

/// 画像をどこまで配信データに含めるか。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImagePolicy {
    /// すべて含める。
    All,
    /// `license` があるもの（Wikimedia Commons など）だけ含める。
    Licensed,
    /// 含めない（頭文字のアイコンだけで表示する）。
    None,
}

impl ImagePolicy {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "all" => Some(Self::All),
            "licensed" => Some(Self::Licensed),
            "none" => Some(Self::None),
            _ => None,
        }
    }
}

/// `image` は URL 文字列だけでも、オブジェクトでも受け付ける。
fn image_field<'de, D>(d: D) -> Result<Option<Image>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Either {
        Url(String),
        Full(Image),
    }
    Ok(Option::<Either>::deserialize(d)?.map(|e| match e {
        Either::Full(image) => image,
        Either::Url(url) => Image {
            url,
            source: None,
            page_url: None,
            license: None,
            attribution: None,
            width: None,
            height: None,
        },
    }))
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
    #[serde(default, deserialize_with = "image_field")]
    pub image: Option<Image>,
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
    #[serde(default, deserialize_with = "image_field")]
    pub image: Option<Image>,
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
    #[serde(default, deserialize_with = "image_field")]
    pub image: Option<Image>,
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
    /// 読み込み元のディレクトリ（相対パスの画像を探す基準）。
    pub root: PathBuf,
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
            root: dir.to_owned(),
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
                    if !is_web_url(&s.url) || !is_date(&s.fetched_at) {
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

        // 画像: 表示できない URL は警告して外す（ノード自体は残す）。
        let root = self.root.clone();
        let check_image = |r: &mut Report, id: &str, image: &mut Option<Image>| {
            let Some(img) = image else { return };
            if let Err(why) = check_image_url(&root, &img.url) {
                r.warnings
                    .push(format!("{id}: image を外しました（{why}）"));
                *image = None;
                return;
            }
            if img.page_url.as_deref().is_some_and(|u| !is_web_url(u)) {
                r.warnings.push(format!(
                    "{id}: image の pageUrl を外しました（http(s):// の URL ではありません）"
                ));
                img.page_url = None;
            }
            if img.license.is_some() && img.attribution.is_none() && img.page_url.is_none() {
                r.warnings.push(format!(
                    "{id}: image に license がありますが attribution も pageUrl もありません"
                ));
            }
        };
        for v in &mut self.voice_actors {
            check_image(&mut r, &v.id, &mut v.image);
        }
        for c in &mut self.characters {
            check_image(&mut r, &c.id, &mut c.image);
        }
        for w in &mut self.works {
            check_image(&mut r, &w.id, &mut w.image);
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

    /// 方針に合わない画像を外す。
    pub fn apply_image_policy(&mut self, policy: ImagePolicy) {
        let keep = |image: &Option<Image>| match policy {
            ImagePolicy::All => true,
            ImagePolicy::Licensed => image.as_ref().is_some_and(is_freely_licensed),
            ImagePolicy::None => false,
        };
        for image in self
            .voice_actors
            .iter_mut()
            .map(|v| &mut v.image)
            .chain(self.characters.iter_mut().map(|c| &mut c.image))
            .chain(self.works.iter_mut().map(|w| &mut w.image))
        {
            if !keep(image) {
                *image = None;
            }
        }
    }

    pub fn image_count(&self) -> usize {
        self.voice_actors
            .iter()
            .filter(|v| v.image.is_some())
            .count()
            + self.characters.iter().filter(|c| c.image.is_some()).count()
            + self.works.iter().filter(|w| w.image.is_some()).count()
    }
}

/// 画像 URL が `https://`（外部を直接参照）か、`root` 配下に実在する相対パスかを確かめる。
pub fn is_remote(url: &str) -> bool {
    url.starts_with("https://")
}

/// リンク先として出してよい URL か（`http://` か `https://` で始まり、空白を含まない）。
fn is_web_url(url: &str) -> bool {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"));
    rest.is_some_and(|r| !r.is_empty() && !url.contains(char::is_whitespace))
}

/// 再利用が許されている画像か（`--images licensed` で残す条件）。
///
/// `license` が書いてあるだけでは足りない（「All rights reserved」も書ける）ので、パブリックドメインか
/// CC0 / CC BY / CC BY-SA に限る。改変禁止（ND）と非営利限定（NC）は、切り抜いて表示するこのサイトの
/// 使い方に合わないことがあるので含めない。CC BY 系は、クレジットを出せるよう作者名か掲載元ページを求める。
fn is_freely_licensed(image: &Image) -> bool {
    let Some(license) = image.license.as_deref() else {
        return false;
    };
    let key: String = license
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    if key.starts_with("cc0") || key.starts_with("publicdomain") || key == "pd" || key == "pdm" {
        return true;
    }
    let attribution_share = key.starts_with("ccby") && !key.contains("nc") && !key.contains("nd");
    let credited = image
        .attribution
        .as_deref()
        .is_some_and(|a| !a.trim().is_empty())
        || image.page_url.is_some();
    attribution_share && credited
}

/// 同梱できる画像の拡張子。それ以外のファイル（データの JSON や設定ファイルなど）は公開しない。
const IMAGE_EXTENSIONS: [&str; 7] = ["png", "jpg", "jpeg", "webp", "avif", "gif", "svg"];

fn check_image_url(root: &Path, url: &str) -> Result<(), String> {
    if is_remote(url) {
        return if url.len() > "https://".len() && !url.contains(char::is_whitespace) {
            Ok(())
        } else {
            Err("URL が不正です".into())
        };
    }
    if url.contains("://") || url.starts_with("//") || url.starts_with("data:") {
        return Err("https:// 以外の URL は使えません".into());
    }
    // ここから先は、データのディレクトリに同梱した画像（相対パス）。配信先へそのまま写すので、
    // 画像でないファイルや、ディレクトリの外・隠しファイルを指すものは受け付けない。
    if url.is_empty()
        || url
            .chars()
            .any(|c| c.is_whitespace() || matches!(c, '?' | '#' | '%' | '\\'))
    {
        return Err("相対パスに空白や ? # % \\ は使えません".into());
    }
    let rel = Path::new(url);
    let inside = rel.components().all(|c| match c {
        std::path::Component::Normal(name) => !name.to_string_lossy().starts_with('.'),
        _ => false,
    });
    if !inside {
        return Err("相対パスはデータのディレクトリ配下に限ります（隠しファイルも不可）".into());
    }
    let extension = rel
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        return Err(format!("{url} は画像ではありません（拡張子）"));
    }
    let path = root.join(rel);
    let is_plain_file = std::fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_file());
    if !is_plain_file {
        return Err(format!("{url} がありません（リンクは不可）"));
    }
    // 途中のディレクトリがリンクで外を指していないことも確かめる。
    let escapes = match (path.canonicalize(), root.canonicalize()) {
        (Ok(file), Ok(base)) => !file.starts_with(base),
        _ => true,
    };
    if escapes {
        return Err(format!("{url} はデータのディレクトリの外を指しています"));
    }
    // SVG はサイトと同じ場所から配ると、中のスクリプトがサイトの権限で動く。動く要素を含むものは外す。
    if extension == "svg" {
        let text = std::fs::read_to_string(&path)
            .unwrap_or_default()
            .to_lowercase();
        let active = [
            "<script",
            "javascript:",
            "<foreignobject",
            "<iframe",
            "<embed",
            "<object",
        ]
        .iter()
        .any(|needle| text.contains(needle))
            || has_event_handler(&text);
        if text.is_empty() || active {
            return Err(format!("{url} はスクリプトなどを含む SVG です"));
        }
    }
    Ok(())
}

/// ` onload=` のようなイベント属性があるか。
fn has_event_handler(text: &str) -> bool {
    let bytes = text.as_bytes();
    text.match_indices("on").any(|(i, _)| {
        let before =
            i == 0 || bytes[i - 1].is_ascii_whitespace() || matches!(bytes[i - 1], b'"' | b'\'');
        let rest = &text[i + 2..];
        let name_len = rest.bytes().take_while(u8::is_ascii_lowercase).count();
        before && name_len > 0 && rest[name_len..].trim_start().starts_with('=')
    })
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

#[cfg(test)]
mod tests {
    use super::*;

    fn actor(image: &str) -> VoiceActor {
        serde_json::from_str(&format!(
            r#"{{"id":"va:1","name":"テスト","image":{image},
                "sources":[{{"source":"manual","url":"https://example.com","fetchedAt":"2026-11-21"}}]}}"#
        ))
        .unwrap()
    }

    fn dataset(images: &[&str]) -> Dataset {
        Dataset {
            voice_actors: images
                .iter()
                .enumerate()
                .map(|(i, image)| VoiceActor {
                    id: format!("va:{i}"),
                    ..actor(image)
                })
                .collect(),
            ..Dataset::default()
        }
    }

    #[test]
    fn image_accepts_a_url_string_or_an_object() {
        assert_eq!(
            actor(r#""https://img.example/a.png""#).image.unwrap().url,
            "https://img.example/a.png"
        );
        let full = actor(
            r#"{"url":"https://img.example/a.png","source":"wikimedia-commons",
                "pageUrl":"https://commons.example/File:a.png","license":"CC BY-SA 4.0",
                "attribution":"Someone","unknownField":1}"#,
        )
        .image
        .unwrap();
        assert_eq!(full.license.as_deref(), Some("CC BY-SA 4.0"));
        assert_eq!(
            full.page_url.as_deref(),
            Some("https://commons.example/File:a.png")
        );
        assert!(actor("null").image.is_none());
    }

    #[test]
    fn images_that_cannot_be_shown_are_dropped_with_a_warning() {
        let mut ds = dataset(&[
            r#""https://img.example/a.png""#,
            r#""http://img.example/a.png""#,
            r#""../outside.png""#,
            r#""missing/file.png""#,
            r#""data:image/png;base64,AAAA""#,
        ]);
        let report = ds.validate();
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        let kept: Vec<bool> = ds.voice_actors.iter().map(|v| v.image.is_some()).collect();
        assert_eq!(kept, [true, false, false, false, false]);
        assert_eq!(
            report
                .warnings
                .iter()
                .filter(|w| w.contains("image"))
                .count(),
            4
        );
    }

    #[test]
    fn image_policy_keeps_only_what_it_allows() {
        let licensed =
            r#"{"url":"https://img.example/b.png","license":"CC0","pageUrl":"https://x.example"}"#;
        let plain = r#""https://img.example/a.png""#;
        for (policy, expected) in [
            (ImagePolicy::All, 2),
            (ImagePolicy::Licensed, 1),
            (ImagePolicy::None, 0),
        ] {
            let mut ds = dataset(&[plain, licensed]);
            ds.apply_image_policy(policy);
            assert_eq!(ds.image_count(), expected);
        }
        assert_eq!(ImagePolicy::parse("licensed"), Some(ImagePolicy::Licensed));
        assert_eq!(ImagePolicy::parse("some"), None);
    }

    #[test]
    fn licensed_means_a_license_that_allows_reuse() {
        let image = |license: &str, credit: &str| -> Image {
            serde_json::from_str(&format!(
                r#"{{"url":"https://img.example/a.png","license":{license}{credit}}}"#
            ))
            .unwrap()
        };
        let credited = r#","attribution":"Someone""#;
        let page = r#","pageUrl":"https://commons.example/File:a.png""#;
        for (license, credit, expected) in [
            (r#""CC0-1.0""#, "", true),
            (r#""Public domain""#, "", true),
            (r#""CC BY-SA 4.0""#, credited, true),
            (r#""cc-by-4.0""#, page, true),
            // クレジットを出せない CC BY は残さない。
            (r#""CC BY 4.0""#, "", false),
            (r#""CC BY-SA 4.0""#, r#","attribution":"  ""#, false),
            // ライセンスの欄に何か書いてあるだけでは残さない。
            (r#""""#, credited, false),
            (r#""All rights reserved""#, credited, false),
            (r#""fair use""#, credited, false),
            (r#""CC BY-NC 4.0""#, credited, false),
            (r#""CC BY-ND 4.0""#, credited, false),
            ("null", credited, false),
        ] {
            assert_eq!(
                is_freely_licensed(&image(license, credit)),
                expected,
                "{license} {credit}"
            );
        }
    }

    #[test]
    fn bundled_images_must_be_plain_image_files_inside_the_data_directory() {
        let root = std::env::temp_dir().join(format!("cverse-model-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("images")).unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="3"/></svg>"#;
        std::fs::write(root.join("images/ok.svg"), svg).unwrap();
        std::fs::write(root.join("images/ok.png"), [0x89, b'P', b'N', b'G']).unwrap();
        std::fs::write(root.join("images/.hidden.png"), [0u8]).unwrap();
        std::fs::write(
            root.join("images/script.svg"),
            svg.replace("<rect", "<script>1</script><rect"),
        )
        .unwrap();
        std::fs::write(
            root.join("images/handler.svg"),
            svg.replace("<rect", r#"<rect onload="x()""#),
        )
        .unwrap();
        std::fs::write(root.join("casts.json"), "[]").unwrap();
        std::fs::write(root.join(".git/config"), "x").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join("casts.json"), root.join("images/link.png")).unwrap();

        for ok in ["images/ok.svg", "images/ok.png"] {
            assert_eq!(check_image_url(&root, ok), Ok(()), "{ok}");
        }
        for bad in [
            "casts.json",
            ".git/config",
            "images/.hidden.png",
            "images/script.svg",
            "images/handler.svg",
            "images/missing.png",
            "images/ok.png?x=1",
            "images/ok.png#frag",
            "images/ok%2Epng",
            "images/o k.png",
            "../outside.png",
            "/etc/hosts.png",
            #[cfg(unix)]
            "images/link.png",
        ] {
            assert!(
                check_image_url(&root, bad).is_err(),
                "{bad} を受け付けてしまった"
            );
        }
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn links_from_data_must_be_web_urls() {
        assert!(is_web_url("https://anilist.co/staff/1"));
        assert!(is_web_url("http://example.com"));
        for bad in [
            "javascript:alert(1)",
            "data:text/html,x",
            "https://",
            "",
            "https://a b",
            "//example.com",
        ] {
            assert!(!is_web_url(bad), "{bad}");
        }
        assert!(has_event_handler(r#"<rect onclick="x">"#));
        assert!(!has_event_handler(r#"<path d="M0 0" font-family="one">"#));
    }
}
