//! Which project files are left out: the rules of `src/lib/project-doc.ts`
//! (what a linked project syncs), here for the files a cloud compile
//! sends. Both run the cases in `src/lib/project-excludes.cases.json`,
//! so the two copies cannot drift apart unnoticed.

use regex::Regex;
use std::sync::LazyLock;

/// Largest file that is synced or sent (project-doc's MAX_FILE_BYTES).
pub const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;

/// Folders never synced, at any depth. `build` is latexmk's -outdir.
const EXCLUDED_DIRS: [&str; 4] = [".git", "build", ".snapshots", "node_modules"];

const EXCLUDED_NAMES: [&str; 3] = [".DS_Store", "Thumbs.db", "desktop.ini"];

/// LaTeX build output next to the sources.
static BUILD_OUTPUT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\.(aux|log|synctex|synctex\.gz|synctex\(busy\)|fls|fdb_latexmk|out|toc|lof|lot|bbl|blg|bcf|run\.xml|nav|snm|vrb|xdv|dvi|idx|ilg|ind|glo|gls|glg|acn|acr|alg|loa|thm)$",
    )
    .expect("valid regex")
});

/// Excluded whatever .gitignore says: version control, build output, OS clutter.
pub fn is_always_excluded(path: &str) -> bool {
    let parts: Vec<&str> = path.split('/').collect();
    let (name, dirs) = parts.split_last().expect("split yields one part");
    dirs.iter().any(|dir| EXCLUDED_DIRS.contains(dir))
        || EXCLUDED_DIRS.contains(name)
        || EXCLUDED_NAMES.contains(name)
        || BUILD_OUTPUT.is_match(name)
}

struct IgnoreRule {
    /// Folder of the .gitignore, "" for the project root.
    base: String,
    regex: Regex,
    negate: bool,
    dir_only: bool,
}

fn glob_to_regex(glob: &str) -> String {
    let chars: Vec<char> = glob.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '*' {
            if chars.get(i + 1) == Some(&'*') {
                let at_start = i == 0 || chars[i - 1] == '/';
                let at_end = i + 2 == chars.len() || chars[i + 2] == '/';
                if at_start && at_end {
                    // `**/` = any folders (or none); a trailing `**` = everything inside.
                    out.push_str(if i + 2 == chars.len() { ".*" } else { "(?:.*/)?" });
                    i += 3;
                    continue;
                }
            }
            out.push_str("[^/]*");
        } else if c == '?' {
            out.push_str("[^/]");
        } else if c == '[' {
            let close = (i + 2 < chars.len())
                .then(|| chars[i + 2..].iter().position(|&ch| ch == ']').map(|p| p + i + 2))
                .flatten();
            let Some(close) = close else {
                out.push_str(r"\[");
                i += 1;
                continue;
            };
            let mut body: String = chars[i + 1..close].iter().collect();
            // Backslashes are literal in a class, as in the TypeScript copy;
            // `[`, `&` and `~` are escaped because Rust's classes nest.
            body = body
                .replace('\\', r"\\")
                .replace('[', r"\[")
                .replace('&', r"\&")
                .replace('~', r"\~");
            if let Some(rest) = body.strip_prefix('!') {
                body = format!("^{rest}");
            }
            out.push('[');
            out.push_str(&body);
            out.push(']');
            i = close;
        } else if c == '\\' && i + 1 < chars.len() {
            i += 1;
            out.push_str(&regex::escape(&chars[i].to_string()));
        } else {
            out.push_str(&regex::escape(&c.to_string()));
        }
        i += 1;
    }
    out
}

/// A line without trailing whitespace, except one escaped with a backslash.
fn trim_line(raw: &str) -> &str {
    let trimmed = raw.trim_end();
    if trimmed.ends_with('\\') && trimmed.len() < raw.len() {
        let next = raw[trimmed.len()..].chars().next().map_or(0, char::len_utf8);
        &raw[..trimmed.len() + next]
    } else {
        trimmed
    }
}

/// The rules of one .gitignore in folder `base` ("" = project root).
fn parse_gitignore(text: &str, base: &str) -> Vec<IgnoreRule> {
    let mut rules = Vec::new();
    for raw in text.split('\n') {
        let mut line = trim_line(raw);
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut negate = false;
        if let Some(rest) = line.strip_prefix('!') {
            negate = true;
            line = rest;
        } else if line.starts_with("\\!") || line.starts_with("\\#") {
            line = &line[1..];
        }
        let mut dir_only = false;
        if line.ends_with('/') {
            dir_only = true;
            line = line.trim_end_matches('/');
        }
        if line.is_empty() {
            continue;
        }
        let anchored = line.contains('/');
        let glob = line.strip_prefix('/').unwrap_or(line);
        let prefix = if anchored { "^" } else { "^(?:.*/)?" };
        let Ok(regex) = Regex::new(&format!("{prefix}{}$", glob_to_regex(glob))) else {
            continue;
        };
        rules.push(IgnoreRule {
            base: base.to_string(),
            regex,
            negate,
            dir_only,
        });
    }
    rules
}

/// The project's exclude filter. Rules of deeper .gitignore files come
/// later and win, as in git, and nothing inside an ignored folder can be
/// re-included.
#[derive(Default)]
pub struct Excluder {
    rules: Vec<IgnoreRule>,
    /// Rules per added .gitignore, for `pop`.
    added: Vec<usize>,
}

impl Excluder {
    /// From the .gitignore files by folder ("" = root), in any order.
    #[cfg(test)]
    pub fn new(gitignores: &[(&str, &str)]) -> Self {
        let mut sorted = gitignores.to_vec();
        sorted.sort_by(|a, b| {
            let depth = |dir: &str| dir.split('/').count();
            depth(a.0).cmp(&depth(b.0)).then(a.0.cmp(b.0))
        });
        let mut excluder = Self::default();
        for (dir, text) in sorted {
            excluder.push(dir, text);
        }
        excluder
    }

    /// Adds the .gitignore of folder `dir`, deeper than any added before
    /// that is still on the stack (a walk adds on the way down).
    pub fn push(&mut self, dir: &str, text: &str) {
        let rules = parse_gitignore(text, dir);
        self.added.push(rules.len());
        self.rules.extend(rules);
    }

    /// Removes the .gitignore added last (a walk leaving its folder).
    pub fn pop(&mut self) {
        if let Some(count) = self.added.pop() {
            self.rules.truncate(self.rules.len() - count);
        }
    }

    fn ignored(&self, path: &str, is_dir: bool) -> bool {
        let mut result = false;
        for rule in &self.rules {
            if rule.dir_only && !is_dir {
                continue;
            }
            let local = if rule.base.is_empty() {
                path
            } else {
                match path.strip_prefix(&rule.base).and_then(|p| p.strip_prefix('/')) {
                    Some(local) => local,
                    None => continue,
                }
            };
            if rule.regex.is_match(local) {
                result = !rule.negate;
            }
        }
        result
    }

    /// True for a project-relative path that is left out.
    pub fn excluded(&self, path: &str, is_dir: bool, size: u64) -> bool {
        if is_always_excluded(path) || size > MAX_FILE_BYTES {
            return true;
        }
        let parts: Vec<&str> = path.split('/').collect();
        for i in 1..parts.len() {
            if self.ignored(&parts[..i].join("/"), true) {
                return true;
            }
        }
        self.ignored(path, is_dir)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Cases {
        max_file_bytes: u64,
        groups: Vec<Group>,
    }

    #[derive(Deserialize)]
    struct Group {
        name: String,
        gitignores: Vec<Gitignore>,
        cases: Vec<Case>,
    }

    #[derive(Deserialize)]
    struct Gitignore {
        dir: String,
        text: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Case {
        path: String,
        #[serde(default)]
        is_dir: bool,
        #[serde(default)]
        size: u64,
        excluded: bool,
    }

    #[test]
    fn follows_the_shared_cases() {
        let cases: Cases =
            serde_json::from_str(include_str!("../../src/lib/project-excludes.cases.json")).unwrap();
        assert_eq!(cases.max_file_bytes, MAX_FILE_BYTES);
        for group in cases.groups {
            let gitignores: Vec<(&str, &str)> = group
                .gitignores
                .iter()
                .map(|g| (g.dir.as_str(), g.text.as_str()))
                .collect();
            let excluder = Excluder::new(&gitignores);
            for case in group.cases {
                assert_eq!(
                    excluder.excluded(&case.path, case.is_dir, case.size),
                    case.excluded,
                    "{}: {}{}",
                    group.name,
                    case.path,
                    if case.is_dir { "/" } else { "" }
                );
            }
        }
    }

    #[test]
    fn a_walk_pushes_and_pops_gitignores() {
        let mut excluder = Excluder::default();
        excluder.push("", "*.tmp\n");
        excluder.push("fig", "*.svg\n");
        assert!(excluder.excluded("fig/a.svg", false, 0));
        excluder.pop();
        assert!(!excluder.excluded("fig/a.svg", false, 0));
        assert!(excluder.excluded("fig/a.tmp", false, 0));
    }
}
