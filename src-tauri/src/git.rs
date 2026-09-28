//! Git integration via the user's `git` CLI. Polemic already relies on the
//! user's TeX installation, so depending on the git binary keeps the build
//! dependency-free.

use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Serialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitEntry {
    pub path: String,
    /// Porcelain X code: staged change ("?" when untracked, " " when none).
    pub x: String,
    /// Porcelain Y code: unstaged change ("?" when untracked, " " when none).
    pub y: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusInfo {
    pub available: bool,
    pub is_repo: bool,
    pub branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub entries: Vec<GitEntry>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitInfo {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub timestamp_millis: u64,
}

fn run_git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("git {} failed", args.join(" "))
    } else {
        stderr
    })
}

/// True when the `git` binary can be executed at all.
pub fn available() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn is_repo(dir: &Path) -> bool {
    Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(dir)
        .output()
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "true")
        .unwrap_or(false)
}

/// Parse `git status --porcelain=v1 -b` output (pure, unit-tested).
fn parse_status(output: &str) -> GitStatusInfo {
    let mut info = GitStatusInfo::default();
    for line in output.lines() {
        if let Some(branch_line) = line.strip_prefix("## ") {
            let name = branch_line.split("...").next().unwrap_or(branch_line);
            if let Some(branch) = name.strip_prefix("No commits yet on ") {
                info.branch = Some(branch.to_string());
            } else if name != "No branch" {
                info.branch = Some(name.to_string());
            }
            if let Some((ahead, behind)) = parse_ahead_behind(branch_line) {
                info.ahead = ahead;
                info.behind = behind;
            }
            continue;
        }
        if line.len() < 4 {
            continue;
        }
        let x = line.as_bytes()[0] as char;
        let y = line.as_bytes()[1] as char;
        let mut path = line[3..].to_string();
        // Renames are reported as "R  old -> new"; show the new path.
        if let Some((_, new)) = path.split_once(" -> ") {
            path = new.to_string();
        }
        info.entries.push(GitEntry {
            path,
            x: x.to_string(),
            y: y.to_string(),
        });
    }
    info
}

fn parse_ahead_behind(branch_line: &str) -> Option<(u32, u32)> {
    let mut ahead = 0;
    let mut behind = 0;
    let markers = branch_line
        .split('[')
        .nth(1)?
        .trim_end_matches(']')
        .split(", ");
    let mut found = false;
    for marker in markers {
        if let Some(count) = marker.strip_prefix("ahead ") {
            ahead = count.parse().unwrap_or(0);
            found = true;
        } else if let Some(count) = marker.strip_prefix("behind ") {
            behind = count.parse().unwrap_or(0);
            found = true;
        }
    }
    if found {
        Some((ahead, behind))
    } else {
        None
    }
}

pub fn status(dir: &Path) -> GitStatusInfo {
    let mut info = GitStatusInfo::default();
    if !available() {
        return info;
    }
    info.available = true;
    if !is_repo(dir) {
        return info;
    }
    info.is_repo = true;
    match run_git(dir, &["status", "--porcelain=v1", "-b"]) {
        Ok(output) => {
            let parsed = parse_status(&output);
            info.branch = parsed.branch;
            info.ahead = parsed.ahead;
            info.behind = parsed.behind;
            info.entries = parsed.entries;
        }
        Err(e) => {
            info.branch = Some(e);
        }
    }
    info
}

pub fn init(dir: &Path) -> Result<(), String> {
    run_git(dir, &["init"]).map(|_| ())?;
    // Keep build artifacts and snapshots out of the repo by default.
    let gitignore = dir.join(".gitignore");
    let mut content = std::fs::read_to_string(&gitignore).unwrap_or_default();
    let mut changed = false;
    for entry in ["build/", ".snapshots/"] {
        if !content.lines().any(|line| line.trim() == entry) {
            if !content.is_empty() && !content.ends_with('\n') {
                content.push('\n');
            }
            content.push_str(entry);
            content.push('\n');
            changed = true;
        }
    }
    if changed {
        std::fs::write(&gitignore, content).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn stage(dir: &Path, paths: &[String]) -> Result<(), String> {
    let mut args = vec!["add", "--"];
    args.extend(paths.iter().map(String::as_str));
    run_git(dir, &args).map(|_| ())
}

pub fn unstage(dir: &Path, paths: &[String]) -> Result<(), String> {
    let mut args = vec!["reset", "-q", "HEAD", "--"];
    args.extend(paths.iter().map(String::as_str));
    // In a fresh repo (no commits yet) reset has no HEAD to reset to.
    if run_git(dir, &args).is_err() {
        let mut fallback = vec!["rm", "--cached", "-r", "-q", "--"];
        fallback.extend(paths.iter().map(String::as_str));
        run_git(dir, &fallback).map(|_| ())
    } else {
        Ok(())
    }
}

pub fn commit(dir: &Path, message: &str) -> Result<GitCommitInfo, String> {
    if message.trim().is_empty() {
        return Err("commit message is empty".into());
    }
    run_git(dir, &["commit", "-m", message])?;
    let hash = run_git(dir, &["rev-parse", "HEAD"])?.trim().to_string();
    Ok(GitCommitInfo {
        hash,
        message: message.to_string(),
        author: String::new(),
        timestamp_millis: 0,
    })
}

pub fn log(dir: &Path, limit: u32) -> Result<Vec<GitCommitInfo>, String> {
    let format = "%H%x1f%s%x1f%an%x1f%at";
    let output = run_git(
        dir,
        &[
            "log",
            &format!("-{limit}"),
            &format!("--format={format}"),
        ],
    )?;
    let mut commits = Vec::new();
    for line in output.lines() {
        let mut parts = line.split('\x1f');
        let (Some(hash), Some(message), Some(author), Some(timestamp)) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        commits.push(GitCommitInfo {
            hash: hash.to_string(),
            message: message.to_string(),
            author: author.to_string(),
            timestamp_millis: timestamp.parse::<u64>().unwrap_or(0) * 1000,
        });
    }
    Ok(commits)
}

/// The file's content as of HEAD, or None when the file is not in HEAD yet.
pub fn show_head(dir: &Path, path: &str) -> Result<Option<String>, String> {
    match run_git(dir, &["show", &format!("HEAD:{path}")]) {
        Ok(content) => Ok(Some(content)),
        Err(_) => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_and_entries() {
        let output = [
            "## main...origin/main [ahead 1, behind 2]",
            "M  main.tex",
            " M chapters/intro.tex",
            "A  new.tex",
            "D  gone.tex",
            "R  old.tex -> renamed.tex",
            "?? notes.tex",
        ]
        .join("\n");
        let info = parse_status(&output);

        assert_eq!(info.branch.as_deref(), Some("main"));
        assert_eq!(info.ahead, 1);
        assert_eq!(info.behind, 2);
        assert_eq!(info.entries.len(), 6);
        assert_eq!(info.entries[0], GitEntry { path: "main.tex".into(), x: "M".into(), y: " ".into() });
        assert_eq!(info.entries[1], GitEntry { path: "chapters/intro.tex".into(), x: " ".into(), y: "M".into() });
        assert_eq!(info.entries[4], GitEntry { path: "renamed.tex".into(), x: "R".into(), y: " ".into() });
        assert_eq!(info.entries[5], GitEntry { path: "notes.tex".into(), x: "?".into(), y: "?".into() });
    }

    #[test]
    fn parses_detached_head_and_unborn_branch() {
        let info = parse_status("## No branch\n?? x.tex\n");
        assert_eq!(info.branch, None);
        assert_eq!(info.entries.len(), 1);

        // An unborn branch still has a name.
        let info = parse_status("## No commits yet on main\n");
        assert_eq!(info.branch.as_deref(), Some("main"));
        assert_eq!(info.entries, vec![]);
    }

    #[test]
    fn stages_and_commits_in_a_temp_repo() {
        if !available() {
            return; // git not installed; parsing is covered by other tests
        }
        let dir = std::env::temp_dir().join("polemic-git-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("main.tex"), "hello\n").unwrap();

        init(&dir).unwrap();
        let gitignore = std::fs::read_to_string(dir.join(".gitignore")).unwrap();
        assert!(gitignore.contains("build/\n"));
        assert!(gitignore.contains(".snapshots/\n"));
        run_git(&dir, &["config", "user.email", "test@example.com"]).unwrap();
        run_git(&dir, &["config", "user.name", "Test"]).unwrap();

        let info = status(&dir);
        assert!(info.available && info.is_repo);
        // The default branch name depends on the runner's git config
        // ("main" locally, "master" on some CI runners); any name is fine.
        assert!(info.branch.is_some());
        // main.tex plus the .gitignore written by init().
        assert_eq!(info.entries.len(), 2);
        assert!(info.entries.iter().all(|entry| entry.x == "?"));

        stage(&dir, &["main.tex".into()]).unwrap();
        let staged_main = status(&dir)
            .entries
            .into_iter()
            .find(|entry| entry.path == "main.tex")
            .unwrap();
        assert_eq!(staged_main, GitEntry { path: "main.tex".into(), x: "A".into(), y: " ".into() });

        stage(&dir, &[".gitignore".into()]).unwrap();
        commit(&dir, "first").unwrap();
        assert_eq!(status(&dir).entries, vec![]);

        let log = log(&dir, 5).unwrap();
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].message, "first");
        assert_eq!(log[0].author, "Test");
        assert!(log[0].timestamp_millis > 0);

        assert_eq!(show_head(&dir, "main.tex").unwrap().as_deref(), Some("hello\n"));
        assert_eq!(show_head(&dir, "missing.tex").unwrap(), None);

        // Staged-then-edited files appear in both lists (MM).
        std::fs::write(dir.join("main.tex"), "hello world\n").unwrap();
        stage(&dir, &["main.tex".into()]).unwrap();
        std::fs::write(dir.join("main.tex"), "hello world!\n").unwrap();
        let info = status(&dir);
        assert_eq!(info.entries[0].x, "M");
        assert_eq!(info.entries[0].y, "M");
        unstage(&dir, &["main.tex".into()]).unwrap();
        let info = status(&dir);
        assert_eq!(info.entries[0].x, " ");
        assert_eq!(info.entries[0].y, "M");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
