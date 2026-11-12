//! The editor's side of a compile, for the corpus test: which files are
//! sent, which engine runs, and which issues the log turns into. Built
//! from the editor's own sources, so the test checks what users get.
//!
//!   corpus-probe files <project-dir>      JSON list of the paths a compile sends
//!   corpus-probe engine <project-dir> <main>  pdflatex, xelatex or lualatex
//!   corpus-probe issues <log> <latexmk-output> [blg]
//!                                         JSON list of issues, as the editor shows them

#![allow(dead_code)]

#[path = "../../../../src-tauri/src/excludes.rs"]
mod excludes;
#[path = "../../../../src-tauri/src/logparse.rs"]
mod logparse;
#[path = "../../../../src-tauri/src/profile.rs"]
mod profile;

/// profile.rs saves settings through this; the probe never saves.
mod files {
    pub fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
        std::fs::write(path, bytes)
    }
}

use std::fs;
use std::path::Path;

/// As cloud_compile::sendable.
fn sendable(path: &str) -> bool {
    path.len() <= 1024
        && !path.chars().any(|c| c < '\u{20}' || c == '\u{7f}' || c == '\\')
        && path.split('/').all(|segment| segment.len() <= 255)
}

/// As cloud_compile::walk, without hashing or the project size limit
/// (the compile service applies its own).
fn walk(root: &Path, folder: &Path, rel: &str, excluder: &mut excludes::Excluder, out: &mut Vec<String>) {
    let gitignore = fs::read_to_string(folder.join(".gitignore")).ok();
    if let Some(text) = &gitignore {
        excluder.push(rel, text);
    }
    if let Ok(entries) = fs::read_dir(folder) {
        for entry in entries.flatten() {
            let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            let path = if rel.is_empty() { name } else { format!("{rel}/{name}") };
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let abs = entry.path();
            let meta = if kind.is_symlink() {
                let Ok(target) = fs::canonicalize(&abs) else {
                    continue;
                };
                match fs::metadata(&target) {
                    Ok(meta) if target.starts_with(root) && meta.is_file() => meta,
                    _ => continue,
                }
            } else {
                let Ok(meta) = entry.metadata() else {
                    continue;
                };
                meta
            };
            if meta.is_dir() {
                if !excluder.excluded(&path, true, 0) {
                    walk(root, &abs, &path, excluder, out);
                }
                continue;
            }
            if !meta.is_file() || excluder.excluded(&path, false, meta.len()) || !sendable(&path) {
                continue;
            }
            out.push(path);
        }
    }
    if gitignore.is_some() {
        excluder.pop();
    }
}

fn read(path: &str) -> String {
    fs::read(path).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default()
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("files") if args.len() == 2 => {
            let root = fs::canonicalize(&args[1]).expect("project folder");
            let mut out = Vec::new();
            walk(&root, &root, "", &mut excludes::Excluder::default(), &mut out);
            out.sort();
            println!("{}", serde_json::to_string(&out).unwrap());
        }
        Some("engine") if args.len() == 3 => {
            // As compile_project: project files by their path from the root, never outside it.
            let root = fs::canonicalize(&args[1]).expect("project folder");
            let in_project = |rel: &str| {
                let path = fs::canonicalize(root.join(rel)).ok()?;
                path.starts_with(&root).then(|| fs::read_to_string(path).ok()).flatten()
            };
            let main = args[2].as_str();
            let engine = profile::resolve_in_project(
                &profile::ProjectConfig::default(),
                main,
                &read(root.join(main).to_str().unwrap()),
                &in_project,
            );
            println!("{}", engine.name());
        }
        Some("issues") if args.len() == 3 || args.len() == 4 => {
            // As compile_outcome plus the font hints of a server compile.
            let mut issues = logparse::parse_issues(&read(&args[1]));
            let blg = args.get(3).map(|p| read(p)).filter(|t| !t.is_empty());
            if let Some(failure) = logparse::parse_bib_tool_failure(&read(&args[2]), blg.as_deref()) {
                issues.retain(|issue| !logparse::is_rerun_bib_tool_warning(issue));
                issues.insert(0, failure);
            }
            if let Some(failure) = logparse::parse_run_failure(&read(&args[2])) {
                issues.insert(0, failure);
            }
            logparse::add_font_hints(&mut issues);
            println!("{}", serde_json::to_string(&issues).unwrap());
        }
        _ => {
            eprintln!("usage: corpus-probe files <dir> | engine <dir> <main.tex> | issues <log> <latexmk-output> [blg]");
            std::process::exit(2);
        }
    }
}
