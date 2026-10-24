//! Compile profiles: which TeX engine latexmk drives for a project.
//! Stored in the project's `.polemic/project.json`; "auto" (the
//! default) reads a `% !TEX program = …` magic comment in the main
//! file, then falls back to xelatex when the preamble loads fontspec
//! or unicode-math, else pdflatex. Only the three engines below are
//! ever passed to latexmk, so a project cannot smuggle in options.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectConfig {
    /// "auto", "pdflatex", "xelatex", or "lualatex"; None means auto.
    pub engine: Option<String>,
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

/// Does the preamble load a package that only works on xetex/luatex?
fn needs_unicode_engine(source: &str) -> bool {
    let preamble = source
        .find("\\begin{document}")
        .map_or(source, |i| &source[..i]);
    preamble.lines().any(|line| {
        let code = line.split('%').next().unwrap_or("");
        code.contains("\\usepackage")
            && (code.contains("fontspec") || code.contains("unicode-math"))
    })
}

/// The engine for a compile: the project setting, else the main file's
/// magic comment, else a guess from the preamble.
pub fn resolve(config: &ProjectConfig, main_source: &str) -> Engine {
    if let Some(engine) = config.engine.as_deref().and_then(Engine::parse) {
        return engine;
    }
    if let Some(engine) = magic_comment_engine(main_source) {
        return engine;
    }
    if needs_unicode_engine(main_source) {
        return Engine::Xelatex;
    }
    Engine::Pdflatex
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
    fn the_project_setting_wins() {
        let config = ProjectConfig { engine: Some("lualatex".into()) };
        assert_eq!(resolve(&config, "% !TEX program = xelatex\n"), Engine::Lualatex);
        let auto_set = ProjectConfig { engine: Some("auto".into()) };
        assert_eq!(resolve(&auto_set, "% !TEX program = xelatex\n"), Engine::Xelatex);
    }

    #[test]
    fn rejects_unknown_engines_on_save() {
        let dir = std::env::temp_dir().join(format!("polemic-profile-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let bad = ProjectConfig { engine: Some("-shell-escape".into()) };
        assert!(save(&dir, &bad).is_err());
        let good = ProjectConfig { engine: Some("xelatex".into()) };
        save(&dir, &good).unwrap();
        assert_eq!(load(&dir), good);
        let _ = fs::remove_dir_all(&dir);
    }
}
