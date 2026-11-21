//! CVerse CLI。
//!
//! ```text
//! cverse-cli validate <source-dir>
//! cverse-cli build <source-dir> --out <out-dir> [--images all|licensed|none]
//! cverse-cli path <data-dir> <id-a> <id-b> [--mode bfs|main|weighted]
//! cverse-cli bench <data-dir> [--pairs N]
//! cverse-cli candidates <source-dir>
//! ```

mod build;
mod model;
mod resolve;

use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use anyhow::{bail, Context, Result};
use cverse_core::path::{bfs, bidirectional_bfs, costar_steps, dijkstra, Weights};
use cverse_core::{Filter, Graph, NodeKind};

const USAGE: &str = "\
使い方:
  cverse-cli validate <source-dir>                 収集データを検証する
  cverse-cli build <source-dir> --out <out-dir> [--images all|licensed|none]
                                                   配信データを生成する（--images で載せる画像を選ぶ。
                                                   licensed は再利用できるライセンスの画像だけ
                                                   （パブリックドメイン、CC0、クレジット付きの CC BY / BY-SA）、
                                                   none は画像なし）
  cverse-cli path <data-dir> <id-a> <id-b> [--mode bfs|main|weighted]
                                                   最短経路を表示する
  cverse-cli bench <data-dir> [--pairs N]          片方向 BFS と双方向 BFS を比べる
  cverse-cli candidates <source-dir>               名寄せの候補を JSON で出す";

/// 値を取るオプション。
const FLAGS: [&str; 4] = ["--out", "--images", "--mode", "--pairs"];

/// 引数を確かめて `--name value` の形にそろえる。`--images=none` も受け付け、知らないオプションや
/// 値の無いオプションはエラーにする（打ち間違いで画像の方針が既定に戻る、といった事故を防ぐ）。
fn normalize_args(raw: Vec<String>) -> Result<Vec<String>> {
    let mut args = Vec::with_capacity(raw.len());
    let mut iter = raw.into_iter();
    while let Some(arg) = iter.next() {
        if !arg.starts_with("--") {
            args.push(arg);
            continue;
        }
        let (name, inline) = match arg.split_once('=') {
            Some((name, value)) => (name.to_string(), Some(value.to_string())),
            None => (arg, None),
        };
        if !FLAGS.contains(&name.as_str()) {
            bail!("知らないオプションです: {name}\n\n{USAGE}");
        }
        let value = match inline.or_else(|| iter.next()) {
            Some(value) if !value.is_empty() && !value.starts_with("--") => value,
            _ => bail!("{name} には値が必要です"),
        };
        args.push(name);
        args.push(value);
    }
    Ok(args)
}

fn main() -> Result<()> {
    let args = normalize_args(std::env::args().skip(1).collect())?;
    let flag = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .map(String::as_str)
    };
    let pos = |i: usize| args.get(i).map(String::as_str);
    match (pos(0), pos(1)) {
        (Some("validate"), Some(dir)) => {
            let mut ds = model::Dataset::load(Path::new(dir))?;
            let report = ds.validate();
            report.print();
            if !report.errors.is_empty() {
                bail!("検証に失敗しました");
            }
            println!(
                "OK: 声優 {} / キャラ {} / 作品 {} / 配役 {} / 登場 {} / 画像 {}",
                ds.voice_actors.len(),
                ds.characters.len(),
                ds.works.len(),
                ds.casts.len(),
                ds.appearances.len(),
                ds.image_count()
            );
        }
        (Some("build"), Some(dir)) => {
            let out = PathBuf::from(flag("--out").context("--out <out-dir> を指定してください")?);
            let mut ds = model::Dataset::load(Path::new(dir))?;
            let report = ds.validate();
            report.print();
            if !report.errors.is_empty() {
                bail!("検証に失敗したため生成を中止しました");
            }
            let policy = flag("--images").unwrap_or("all");
            let policy = model::ImagePolicy::parse(policy).with_context(|| {
                format!("--images は all / licensed / none のいずれかです: {policy}")
            })?;
            ds.apply_image_policy(policy);
            let built = build::build(&ds);
            std::fs::create_dir_all(&out)?;
            build::write(&built, Path::new(dir), &out, &today())?;
            println!(
                "生成: {} ノード / {} エッジ / 画像 {} 件 / graph.bin {} KB → {}",
                built.graph.node_count(),
                built.graph.edge_count(),
                ds.image_count(),
                built.graph.to_bytes().len() / 1024,
                out.display()
            );
        }
        (Some("path"), Some(dir)) => {
            let (graph, ids, labels) = load_data(Path::new(dir))?;
            let find = |id: Option<&str>| -> Result<u32> {
                let id = id.context("ID を 2 つ指定してください")?;
                let i = ids
                    .iter()
                    .position(|x| x == id)
                    .with_context(|| format!("{id} がありません"))?;
                Ok(i as u32)
            };
            let (a, b) = (find(pos(2))?, find(pos(3))?);
            let started = Instant::now();
            let result = match flag("--mode").unwrap_or("bfs") {
                "bfs" => bidirectional_bfs(&graph, a, b, &Filter::ALL),
                "main" => bidirectional_bfs(&graph, a, b, &Filter::main_only()),
                "weighted" => dijkstra(&graph, a, b, &Filter::ALL, &Weights::default()),
                other => bail!("不明なモード: {other}"),
            };
            let elapsed = started.elapsed();
            match result {
                None => println!("経路なし（{elapsed:?}）"),
                Some(p) => {
                    for &u in &p.nodes {
                        let kind = match graph.kind_of(u) {
                            NodeKind::VoiceActor => "声優",
                            NodeKind::Character => "キャラ",
                            NodeKind::Work => "作品",
                        };
                        println!("  [{kind}] {} ({})", labels[u as usize], ids[u as usize]);
                    }
                    println!(
                        "{} ホップ / 共演 {} ステップ / 訪問 {} ノード / {elapsed:?}",
                        p.hops(),
                        costar_steps(&graph, &p.nodes),
                        p.visited
                    );
                }
            }
        }
        (Some("bench"), Some(dir)) => {
            let (graph, _, _) = load_data(Path::new(dir))?;
            let pairs: u32 = flag("--pairs").map(str::parse).transpose()?.unwrap_or(1000);
            bench(&graph, pairs);
        }
        (Some("candidates"), Some(dir)) => {
            let mut ds = model::Dataset::load(Path::new(dir))?;
            ds.validate();
            let list = resolve::candidates(&ds);
            let auto = list.iter().filter(|c| c.decision == "auto").count();
            eprintln!(
                "候補 {} 件（自動統合 {} / 確認待ち {}）",
                list.len(),
                auto,
                list.len() - auto
            );
            println!("{}", serde_json::to_string_pretty(&list)?);
        }
        _ => {
            eprintln!("{USAGE}");
            std::process::exit(2);
        }
    }
    Ok(())
}

fn load_data(dir: &Path) -> Result<(Graph, Vec<String>, Vec<String>)> {
    let bytes = std::fs::read(dir.join("graph.bin")).context("graph.bin を読めません")?;
    let graph = Graph::from_bytes(&bytes)?;
    #[derive(serde::Deserialize)]
    struct Index {
        ids: Vec<String>,
        labels: Vec<String>,
    }
    let index: Index = serde_json::from_slice(&std::fs::read(dir.join("index.json"))?)?;
    Ok((graph, index.ids, index.labels))
}

/// 声優どうしのランダムな組で、片方向 BFS と双方向 BFS の訪問ノード数と時間を比べる。
fn bench(graph: &Graph, pairs: u32) {
    let vas: Vec<u32> = (0..graph.node_count() as u32)
        .filter(|&u| graph.kind_of(u) == NodeKind::VoiceActor && graph.degree(u) > 0)
        .collect();
    if vas.len() < 2 {
        println!("声優が 2 人未満のため計測できません");
        return;
    }
    let mut seed = 0x9e37_79b9_7f4a_7c15u64;
    let mut next = || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        vas[(seed % vas.len() as u64) as usize]
    };
    let queries: Vec<(u32, u32)> = (0..pairs).map(|_| (next(), next())).collect();

    let run = |name: &str, f: &dyn Fn(u32, u32) -> Option<cverse_core::path::PathResult>| {
        let started = Instant::now();
        let (mut visited, mut found, mut hops) = (0u64, 0u32, 0u64);
        for &(a, b) in &queries {
            if let Some(p) = f(a, b) {
                visited += p.visited as u64;
                hops += p.hops() as u64;
                found += 1;
            }
        }
        let elapsed = started.elapsed();
        println!(
            "{name:<14} 平均 {:>9.1} µs / 訪問 {:>8.0} ノード / 平均 {:.2} ホップ / 到達 {found}/{pairs}",
            elapsed.as_secs_f64() * 1e6 / pairs as f64,
            visited as f64 / found.max(1) as f64,
            hops as f64 / found.max(1) as f64,
        );
    };
    println!(
        "{} ノード / {} エッジ / 声優 {} 人 / {pairs} 組",
        graph.node_count(),
        graph.edge_count(),
        vas.len()
    );
    run("片方向 BFS", &|a, b| bfs(graph, a, b, &Filter::ALL));
    run("双方向 BFS", &|a, b| {
        bidirectional_bfs(graph, a, b, &Filter::ALL)
    });
    run("主役のみ", &|a, b| {
        bidirectional_bfs(graph, a, b, &Filter::main_only())
    });
    run("重み付き", &|a, b| {
        dijkstra(graph, a, b, &Filter::ALL, &Weights::default())
    });
}

/// 今日の日付（UTC, YYYY-MM-DD）。
fn today() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Howard Hinnant の civil_from_days
    let z = (secs / 86_400) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    use super::normalize_args;

    fn run(args: &[&str]) -> Result<Vec<String>, String> {
        normalize_args(args.iter().map(|a| a.to_string()).collect()).map_err(|e| e.to_string())
    }

    #[test]
    fn options_are_checked_strictly() {
        assert_eq!(
            run(&["build", "data", "--out", "o", "--images=none"]).unwrap(),
            ["build", "data", "--out", "o", "--images", "none"]
        );
        // 打ち間違いや値の付け忘れを、黙って既定の動きにしない。
        assert!(run(&["build", "data", "--out", "o", "--image", "none"]).is_err());
        assert!(run(&["build", "data", "--out", "o", "--images"]).is_err());
        assert!(run(&["build", "data", "--images", "--out", "o"]).is_err());
        assert!(run(&["build", "data", "--out="]).is_err());
    }
}
