//! Compile profiles: which TeX engine latexmk drives for a project.
//! Stored in the project's `.polemic/project.json`; "auto" (the
//! default) reads a `% !TEX program = …` magic comment in the main
//! file, then the engine a latexmkrc names (read, never run), then
//! guesses from the packages and class the preamble loads, following
//! the project's own .cls and .sty files, else pdflatex. Only the
//! three engines below are ever passed to latexmk, so a project cannot
//! smuggle in options.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectConfig {
    /// "auto", "pdflatex", "xelatex", or "lualatex"; None means auto.
    pub engine: Option<String>,
    /// Words the spellcheck accepts in this project only (names,
    /// jargon), unlike the personal dictionary.
    pub ignored_words: Vec<String>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
    Pdflatex,
    Xelatex,
    Lualatex,
}

impl Engine {
    pub fn parse(name: &str) -> Option<Engine> {
        match name.trim().to_ascii_lowercase().as_str() {
            "pdflatex" | "pdftex" => Some(Engine::Pdflatex),
            "xelatex" | "xetex" => Some(Engine::Xelatex),
            "lualatex" | "luatex" => Some(Engine::Lualatex),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Engine::Pdflatex => "pdflatex",
            Engine::Xelatex => "xelatex",
            Engine::Lualatex => "lualatex",
        }
    }

    /// The latexmk switch selecting this engine.
    pub fn latexmk_flag(self) -> &'static str {
        match self {
            Engine::Pdflatex => "-pdf",
            Engine::Xelatex => "-xelatex",
            Engine::Lualatex => "-lualatex",
        }
    }
}

fn config_file(project_dir: &Path) -> std::path::PathBuf {
    project_dir.join(".polemic").join("project.json")
}

pub fn load(project_dir: &Path) -> ProjectConfig {
    fs::read_to_string(config_file(project_dir))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(project_dir: &Path, config: &ProjectConfig) -> Result<(), String> {
    if let Some(engine) = config.engine.as_deref() {
        if engine != "auto" && Engine::parse(engine).is_none() {
            return Err(format!("unknown TeX engine: {engine}"));
        }
    }
    let file = config_file(project_dir);
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create .polemic folder: {e}"))?;
    }
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    crate::files::write_atomic(&file, json.as_bytes())
        .map_err(|e| format!("failed to write project settings: {e}"))
}

/// The engine a `% !TEX program = xelatex` (or `TS-program`) line asks
/// for. Only leading comment lines count, like TeXShop and TeXstudio.
fn magic_comment_engine(source: &str) -> Option<Engine> {
    for line in source.lines().take(20) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Some(rest) = line.strip_prefix('%') else {
            break;
        };
        let rest = rest.trim_start_matches('%').trim();
        let Some(rest) = rest.strip_prefix('!') else {
            continue;
        };
        let rest = rest.trim();
        let Some(rest) = rest
            .get(..3)
            .filter(|p| p.eq_ignore_ascii_case("tex"))
            .map(|_| rest[3..].trim())
        else {
            continue;
        };
        let lower = rest.to_ascii_lowercase();
        let value = lower
            .strip_prefix("ts-program")
            .or_else(|| lower.strip_prefix("program"))
            .map(str::trim)
            .and_then(|v| v.strip_prefix('='));
        if let Some(value) = value {
            return Engine::parse(value);
        }
    }
    None
}

/// The engine a latexmkrc asks for with `$pdf_mode = 4` (lualatex) or
/// `5` (xelatex). The file is Perl and is only read, never run.
fn latexmkrc_engine(source: &str) -> Option<Engine> {
    let mut engine = None;
    for line in source.lines() {
        let code = line.split('#').next().unwrap_or("").trim();
        let Some(rest) = code.strip_prefix("$pdf_mode") else {
            continue;
        };
        let value = rest
            .trim_start()
            .strip_prefix('=')
            .map(|v| v.trim().trim_end_matches(';').trim());
        engine = match value {
            Some("1") => Some(Engine::Pdflatex),
            Some("4") => Some(Engine::Lualatex),
            Some("5") => Some(Engine::Xelatex),
            _ => engine,
        };
    }
    engine
}

/// The engine a package or class needs, for those that only work on
/// XeTeX or LuaTeX. ctex's default fonts need one of them too.
fn package_engine(name: &str) -> Option<Engine> {
    let lua = [
        "luatexja",
        "ltjs",
        "ltjt",
        "luacode",
        "luatextra",
        "luamplib",
        "lualatex-math",
    ];
    if lua.iter().any(|p| name.starts_with(p)) {
        return Some(Engine::Lualatex);
    }
    let xe = [
        "fontspec",
        "unicode-math",
        "polyglossia",
        "mathspec",
        "xunicode",
        "xltxtra",
        "fontsetup",
        "xeCJK",
        "ctex",
    ];
    xe.iter()
        .any(|p| name.starts_with(p))
        .then_some(Engine::Xelatex)
}

/// The packages and classes a file loads, in order: `\usepackage`,
/// `\RequirePackage`, `\documentclass` and `\LoadClass`, with `.sty` or
/// `.cls` added. Only the preamble of a document counts.
fn loaded_files(source: &str) -> Vec<String> {
    let preamble = source
        .find("\\begin{document}")
        .map_or(source, |i| &source[..i]);
    let code: String = preamble
        .lines()
        .map(|line| line.split('%').next().unwrap_or(""))
        .collect::<Vec<_>>()
        .join("\n");
    let commands = [
        ("\\usepackage", ".sty"),
        ("\\RequirePackage", ".sty"),
        ("\\documentclass", ".cls"),
        ("\\LoadClass", ".cls"),
    ];
    let mut found: Vec<(usize, String)> = Vec::new();
    for (command, ext) in commands {
        for (at, _) in code.match_indices(command) {
            let mut rest = code[at + command.len()..].trim_start();
            if let Some(after) = rest.strip_prefix('[') {
                let Some(end) = after.find(']') else { continue };
                rest = after[end + 1..].trim_start();
            }
            let Some(names) = rest
                .strip_prefix('{')
                .and_then(|r| r.split_once('}'))
                .map(|(n, _)| n)
            else {
                continue;
            };
            for name in names.split(',').map(str::trim).filter(|n| !n.is_empty()) {
                found.push((at, format!("{name}{ext}")));
            }
        }
    }
    found.sort_by_key(|(at, _)| *at);
    found.into_iter().map(|(_, file)| file).collect()
}

/// The engine the packages and classes of a file need, following the
/// project's own .cls and .sty files a few levels deep.
fn packages_engine(
    source: &str,
    main_dir: &str,
    read: &dyn Fn(&str) -> Option<String>,
    seen: &mut Vec<String>,
) -> Option<Engine> {
    for file in loaded_files(source) {
        let name = file.trim_end_matches(".sty").trim_end_matches(".cls");
        if let Some(engine) = package_engine(name) {
            return Some(engine);
        }
        if seen.len() >= 20 || seen.contains(&file) {
            continue;
        }
        seen.push(file.clone());
        // TeX finds it next to the main file or at the project root.
        let near_main = (!main_dir.is_empty()).then(|| format!("{main_dir}/{file}"));
        let own = near_main.iter().chain([&file]).find_map(|path| read(path));
        // A class or package that tests the engine works on all of them.
        let any_engine = |text: &str| {
            [
                "\\ifxetex",
                "\\ifluatex",
                "\\iftutex",
                "\\ifpdftex",
                "\\ifPDFTeX",
                "\\ifXeTeX",
                "\\ifLuaTeX",
                "\\sys_if_engine",
            ]
            .iter()
            .any(|test| text.contains(test))
        };
        if let Some(own) = own.filter(|text| !any_engine(text)) {
            if let Some(engine) = packages_engine(&own, main_dir, read, seen) {
                return Some(engine);
            }
        }
    }
    None
}

/// The engine for a compile: the project setting, else the main file's
/// magic comment, else a guess from the preamble.
pub fn resolve(config: &ProjectConfig, main_source: &str) -> Engine {
    resolve_in_project(config, "main.tex", main_source, &|_| None)
}

/// As [`resolve`], with the project's other files: `read` returns a
/// project file by its path from the project root. After the magic
/// comment come a latexmkrc next to the main file or at the root, then
/// the packages and classes the main file loads, including those it
/// loads through the project's own .cls and .sty files.
pub fn resolve_in_project(
    config: &ProjectConfig,
    main_tex: &str,
    main_source: &str,
    read: &dyn Fn(&str) -> Option<String>,
) -> Engine {
    if let Some(engine) = config.engine.as_deref().and_then(Engine::parse) {
        return engine;
    }
    if let Some(engine) = magic_comment_engine(main_source) {
        return engine;
    }
    let main_dir = main_tex.rsplit_once('/').map_or("", |(dir, _)| dir);
    let folders = if main_dir.is_empty() {
        vec![String::new()]
    } else {
        vec![format!("{main_dir}/"), String::new()]
    };
    for folder in &folders {
        for name in ["latexmkrc", ".latexmkrc"] {
            if let Some(engine) = read(&format!("{folder}{name}"))
                .as_deref()
                .and_then(latexmkrc_engine)
            {
                return engine;
            }
        }
    }
    packages_engine(main_source, main_dir, read, &mut Vec::new()).unwrap_or(Engine::Pdflatex)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn auto() -> ProjectConfig {
        ProjectConfig::default()
    }

    #[test]
    fn reads_magic_comments() {
        assert_eq!(
            resolve(&auto(), "% !TEX program = xelatex\n\\documentclass{article}"),
            Engine::Xelatex
        );
        assert_eq!(
            resolve(&auto(), "%!TEX TS-program = LuaLaTeX\n"),
            Engine::Lualatex
        );
        // Past the leading comment block it no longer counts.
        assert_eq!(
            resolve(&auto(), "\\documentclass{article}\n% !TEX program = xelatex\n"),
            Engine::Pdflatex
        );
        // An unknown program falls through to the default.
        assert_eq!(resolve(&auto(), "% !TEX program = rm -rf\n"), Engine::Pdflatex);
    }

    #[test]
    fn guesses_from_the_preamble() {
        let src = "\\documentclass{article}\n\\usepackage{fontspec}\n\\begin{document}\\end{document}";
        assert_eq!(resolve(&auto(), src), Engine::Xelatex);
        let commented = "\\documentclass{article}\n% \\usepackage{fontspec}\n\\begin{document}";
        assert_eq!(resolve(&auto(), commented), Engine::Pdflatex);
        let in_body = "\\begin{document}\\usepackage{fontspec}";
        assert_eq!(resolve(&auto(), in_body), Engine::Pdflatex);
    }

    #[test]
    fn guesses_from_cjk_and_luatex_packages() {
        assert_eq!(
            resolve(&auto(), "\\documentclass[UTF8]{ctexart}\n"),
            Engine::Xelatex
        );
        assert_eq!(
            resolve(
                &auto(),
                "\\documentclass{article}\n\\usepackage{amsmath, xeCJK}\n"
            ),
            Engine::Xelatex
        );
        assert_eq!(
            resolve(&auto(), "\\documentclass{ltjsarticle}\n"),
            Engine::Lualatex
        );
        assert_eq!(
            resolve(
                &auto(),
                "\\documentclass{article}\n\\usepackage[match]{luatexja-fontspec}\n"
            ),
            Engine::Lualatex
        );
        assert_eq!(
            resolve(&auto(), "\\documentclass{article}\n\\usepackage{amsmath}\n"),
            Engine::Pdflatex
        );
    }

    #[test]
    fn follows_the_projects_own_class_and_packages() {
        let files = |path: &str| match path {
            "tex/cv.cls" => {
                Some("\\LoadClass{article}\n\\RequirePackage[quiet]{fontspec}\n".to_string())
            }
            "mystyle.sty" => {
                Some("\\RequirePackage{xcolor}\n\\RequirePackage{inner}\n".to_string())
            }
            "inner.sty" => Some("\\RequirePackage{unicode-math}\n".to_string()),
            "both.sty" => Some("\\ifxetex\n\\RequirePackage{fontspec}\n\\fi\n".to_string()),
            _ => None,
        };
        // A class next to the main file, in a subfolder.
        assert_eq!(
            resolve_in_project(&auto(), "tex/main.tex", "\\documentclass{cv}\n", &files),
            Engine::Xelatex
        );
        // A package at the root that loads another one.
        assert_eq!(
            resolve_in_project(
                &auto(),
                "main.tex",
                "\\documentclass{article}\\usepackage{mystyle}\n",
                &files
            ),
            Engine::Xelatex
        );
        assert_eq!(
            resolve_in_project(&auto(), "main.tex", "\\documentclass{article}\n", &files),
            Engine::Pdflatex
        );
        // One that tests the engine also works with pdflatex.
        assert_eq!(
            resolve_in_project(
                &auto(),
                "main.tex",
                "\\documentclass{article}\\usepackage{both}\n",
                &files
            ),
            Engine::Pdflatex
        );
    }

    #[test]
    fn reads_the_engine_from_a_latexmkrc() {
        let files = |path: &str| match path {
            "latexmkrc" => Some("$out_dir = 'build';\n$pdf_mode = 4; # lualatex\n".to_string()),
            "doc/.latexmkrc" => Some("$pdf_mode=5;\n".to_string()),
            _ => None,
        };
        assert_eq!(
            resolve_in_project(&auto(), "main.tex", "\\documentclass{article}\n", &files),
            Engine::Lualatex
        );
        assert_eq!(
            resolve_in_project(
                &auto(),
                "doc/main.tex",
                "\\documentclass{article}\n",
                &files
            ),
            Engine::Xelatex
        );
        // The magic comment comes first.
        assert_eq!(
            resolve_in_project(
                &auto(),
                "main.tex",
                "% !TEX program = pdflatex\n\\documentclass{article}\n",
                &files
            ),
            Engine::Pdflatex
        );
    }

    #[test]
    fn the_project_setting_wins() {
        let config = ProjectConfig { engine: Some("lualatex".into()), ..Default::default() };
        assert_eq!(resolve(&config, "% !TEX program = xelatex\n"), Engine::Lualatex);
        let auto_set = ProjectConfig { engine: Some("auto".into()), ..Default::default() };
        assert_eq!(resolve(&auto_set, "% !TEX program = xelatex\n"), Engine::Xelatex);
    }

    #[test]
    fn rejects_unknown_engines_on_save() {
        let dir = std::env::temp_dir().join(format!("polemic-profile-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let bad = ProjectConfig { engine: Some("-shell-escape".into()), ..Default::default() };
        assert!(save(&dir, &bad).is_err());
        let good = ProjectConfig { engine: Some("xelatex".into()), ..Default::default() };
        save(&dir, &good).unwrap();
        assert_eq!(load(&dir), good);
        let _ = fs::remove_dir_all(&dir);
    }
}
