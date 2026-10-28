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
    /// The `origin` remote's URL; None without a remote.
    pub remote: Option<String>,
    /// The branch's upstream ("origin/main"); None until the first push.
    pub upstream: Option<String>,
    /// Paths left unmerged by a pull (both sides changed them).
    pub conflicts: Vec<String>,
    /// A merge is in progress: conflicts to resolve, then commit.
    pub merging: bool,
}

/// What a pull did.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum PullOutcome {
    UpToDate,
    /// New commits came in (a fast-forward or a clean merge).
    Updated,
    /// The merge stopped on these paths; resolve, stage, commit.
    Conflicts { paths: Vec<String> },
}

/// The name of the one remote Polemic manages.
const REMOTE: &str = "origin";

/// Environment variable that turns the Polemic binary into git's askpass
/// helper (see `run_askpass`); the two below carry the answers.
const ASKPASS_FLAG: &str = "POLEMIC_ASKPASS";
const ASKPASS_USERNAME: &str = "POLEMIC_GIT_USERNAME";
const ASKPASS_PASSWORD: &str = "POLEMIC_GIT_PASSWORD";

/// The credentials for a remote URL: (username, password or token).
/// None lets git fall back to the user's own credential helper or SSH.
/// Filled in by the git accounts (GitHub, GitLab, custom remotes).
pub fn credentials_for(_url: &str) -> Option<(String, String)> {
    None
}

/// Git's prompts are "Username for 'https://host': " and "Password for
/// 'https://user@host': ". The answer for one, or None to refuse.
fn askpass_answer(prompt: &str, username: &str, password: &str) -> Option<String> {
    let lower = prompt.trim_start().to_ascii_lowercase();
    if lower.starts_with("username") {
        Some(username.to_string())
    } else if lower.starts_with("password") {
        Some(password.to_string())
    } else {
        None
    }
}

/// When git started this process as its askpass helper, answer its
/// prompt and return true; the caller then exits instead of starting
/// the app. The answers travel in the environment of the git process
/// that Polemic itself started, never further.
pub fn run_askpass() -> bool {
    if std::env::var_os(ASKPASS_FLAG).is_none() {
        return false;
    }
    let prompt = std::env::args().nth(1).unwrap_or_default();
    let username = std::env::var(ASKPASS_USERNAME).unwrap_or_default();
    let password = std::env::var(ASKPASS_PASSWORD).unwrap_or_default();
    match askpass_answer(&prompt, &username, &password) {
        Some(answer) if !answer.is_empty() => {
            use std::io::Write;
            let mut out = std::io::stdout();
            let _ = writeln!(out, "{answer}");
            let _ = out.flush();
        }
        _ => std::process::exit(1),
    }
    true
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitInfo {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub timestamp_millis: u64,
}

/// Config keys whose value is a command git runs. A project folder can
/// come from anyone (a shared zip carrying its .git), so repository-local
/// values for these must never execute.
fn runs_command(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    let ends = |suffixes: &[&str]| suffixes.iter().any(|s| key.ends_with(s));
    matches!(
        key.as_str(),
        "core.fsmonitor"
            | "core.hookspath"
            | "core.sshcommand"
            | "core.editor"
            | "core.pager"
            | "core.askpass"
            | "diff.external"
            | "sequence.editor"
            | "credential.helper"
    ) || (key.starts_with("filter.") && ends(&[".clean", ".smudge", ".process"]))
        || (key.starts_with("diff.") && ends(&[".textconv", ".command"]))
        || (key.starts_with("merge.") && key.ends_with(".driver"))
        || (key.starts_with("gpg.") && key.ends_with("program"))
}

/// `-c` overrides that blank every command-running key the repository
/// config sets, so only the user's own (global) config can run programs.
/// Hooks are off as well: .git/hooks travels with a copied project.
fn safety_overrides(local_keys: &str) -> Vec<String> {
    let no_hooks = std::env::temp_dir().join("polemic-no-git-hooks");
    let mut out = vec![
        "core.fsmonitor=false".to_string(),
        format!("core.hooksPath={}", no_hooks.display()),
    ];
    let mut signing = false;
    for key in local_keys.lines().map(str::trim) {
        let lower = key.to_ascii_lowercase();
        if !runs_command(&lower) || lower == "core.fsmonitor" || lower == "core.hookspath" {
            continue;
        }
        out.push(format!("{key}="));
        // Subsection names are case-sensitive: take the driver from `key`.
        if let Some(driver) = lower
            .starts_with("filter.")
            .then(|| &key["filter.".len()..])
            .and_then(|rest| rest.rsplit_once('.'))
            .map(|(name, _)| name)
        {
            out.push(format!("filter.{driver}.required=false"));
        }
        signing |= lower.starts_with("gpg.");
    }
    if signing {
        out.push("commit.gpgSign=false".into());
        out.push("log.showSignature=false".into());
    }
    out.sort();
    out.dedup();
    out
}

/// A git command for `dir` with the repository's command-running config
/// neutralized (see `safety_overrides`).
fn git_command(dir: &Path) -> Command {
    // Reading the config list executes nothing.
    let local_keys = Command::new("git")
        .args(["config", "--local", "--includes", "--name-only", "--list"])
        .current_dir(dir)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    let mut command = Command::new("git");
    for value in safety_overrides(&local_keys) {
        command.arg("-c").arg(value);
    }
    command.current_dir(dir);
    // No window to type into: never wait for a terminal prompt.
    command.env("GIT_TERMINAL_PROMPT", "0");
    command
}

/// A git command that may talk to a remote: Polemic's own binary answers
/// the credential prompt with the account's token when there is one.
/// Without one git still tries the user's credential helper and SSH.
fn remote_git_command(dir: &Path, url: Option<&str>) -> Command {
    let mut command = git_command(dir);
    if let Ok(exe) = std::env::current_exe() {
        command.env("GIT_ASKPASS", exe);
        command.env(ASKPASS_FLAG, "1");
    }
    if let Some((username, password)) = url.and_then(credentials_for) {
        command.env(ASKPASS_USERNAME, username);
        command.env(ASKPASS_PASSWORD, password);
    }
    command
}

fn finish(output: std::process::Output, args: &[&str]) -> Result<String, String> {
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

fn run_git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let output = git_command(dir)
        .args(args)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    finish(output, args)
}

fn run_remote_git(dir: &Path, url: Option<&str>, args: &[&str]) -> Result<String, String> {
    let output = remote_git_command(dir, url)
        .args(args)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    finish(output, args)
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
    git_command(dir)
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "true")
        .unwrap_or(false)
}

/// Parse `git status --porcelain=v1 -b` output (pure, unit-tested).
fn parse_status(output: &str) -> GitStatusInfo {
    let mut info = GitStatusInfo::default();
    for line in output.lines() {
        if let Some(branch_line) = line.strip_prefix("## ") {
            let (name, rest) = branch_line
                .split_once("...")
                .unwrap_or((branch_line, ""));
            if let Some(branch) = name.strip_prefix("No commits yet on ") {
                info.branch = Some(branch.to_string());
            } else if name != "No branch" {
                info.branch = Some(name.to_string());
            }
            // "main...origin/main [ahead 1]": the upstream, then the counts.
            let upstream = rest.split(" [").next().unwrap_or("").trim();
            if !upstream.is_empty() {
                info.upstream = Some(upstream.to_string());
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
        if is_conflict(x, y) {
            info.conflicts.push(path);
            continue;
        }
        info.entries.push(GitEntry {
            path,
            x: x.to_string(),
            y: y.to_string(),
        });
    }
    info
}

/// The porcelain codes of an unmerged path: DD, AU, UD, UA, DU, AA, UU.
fn is_conflict(x: char, y: char) -> bool {
    x == 'U' || y == 'U' || (x == 'A' && y == 'A') || (x == 'D' && y == 'D')
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
            info.upstream = parsed.upstream;
            info.conflicts = parsed.conflicts;
        }
        Err(e) => {
            info.branch = Some(e);
        }
    }
    info.remote = remote_url(dir);
    info.merging = merge_in_progress(dir);
    info
}

/// The origin URL, or None when the repository has no origin.
pub fn remote_url(dir: &Path) -> Option<String> {
    run_git(dir, &["remote", "get-url", REMOTE])
        .ok()
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty())
}

fn merge_in_progress(dir: &Path) -> bool {
    run_git(dir, &["rev-parse", "--git-path", "MERGE_HEAD"])
        .map(|path| dir.join(path.trim()).exists())
        .unwrap_or(false)
}

/// A remote URL as typed. HTTPS, SSH (`ssh://` or `git@host:path`),
/// `git://` and `file://` (a bare repository on a synced drive); nothing
/// git would read as an option.
pub fn check_remote_url(url: &str) -> Result<String, String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("The remote URL is empty".into());
    }
    if url.starts_with('-') || url.contains(char::is_whitespace) {
        return Err("That is not a remote URL".into());
    }
    let scheme_ok = ["https://", "http://", "ssh://", "git://", "file://"]
        .iter()
        .any(|scheme| url.starts_with(scheme));
    // scp-like: user@host:path, with no slash before the colon (a
    // single letter before it is a Windows drive, not a host).
    let scp_like = match url.split_once(':') {
        Some((host, path)) => host.len() > 1 && !host.contains('/') && !path.is_empty(),
        None => false,
    };
    if !scheme_ok && !scp_like {
        return Err(
            "The remote URL should look like https://github.com/you/paper.git or git@github.com:you/paper.git"
                .into(),
        );
    }
    Ok(url.to_string())
}

/// Set (or, with an empty URL, remove) the origin remote.
pub fn set_remote(dir: &Path, url: &str) -> Result<(), String> {
    if url.trim().is_empty() {
        if remote_url(dir).is_some() {
            run_git(dir, &["remote", "remove", REMOTE])?;
        }
        return Ok(());
    }
    let url = check_remote_url(url)?;
    if remote_url(dir).is_some() {
        run_git(dir, &["remote", "set-url", REMOTE, &url])?;
    } else {
        run_git(dir, &["remote", "add", REMOTE, &url])?;
    }
    Ok(())
}

fn need_remote(dir: &Path) -> Result<String, String> {
    remote_url(dir).ok_or_else(|| "This project has no remote yet".to_string())
}

fn current_branch(dir: &Path) -> Result<String, String> {
    let branch = run_git(dir, &["symbolic-ref", "--short", "-q", "HEAD"])
        .map(|b| b.trim().to_string())
        .unwrap_or_default();
    if branch.is_empty() {
        return Err("Not on a branch: check out a branch first".into());
    }
    Ok(branch)
}

fn has_upstream(dir: &Path) -> bool {
    run_git(dir, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).is_ok()
}

pub fn fetch(dir: &Path) -> Result<(), String> {
    let url = need_remote(dir)?;
    run_remote_git(dir, Some(&url), &["fetch", "--prune", REMOTE]).map(|_| ())
}

/// Pull the upstream (merging, never rebasing, so local history stays
/// as committed). The first pull of a branch sets its upstream.
pub fn pull(dir: &Path) -> Result<PullOutcome, String> {
    let url = need_remote(dir)?;
    if merge_in_progress(dir) {
        return Err("A merge is in progress: resolve the conflicts and commit, or abort the merge".into());
    }
    let branch = current_branch(dir)?;
    let before = head(dir);
    let mut args = vec!["pull", "--no-rebase", "--no-edit"];
    if !has_upstream(dir) {
        args.extend(["--set-upstream", REMOTE, branch.as_str()]);
    }
    match run_remote_git(dir, Some(&url), &args) {
        Ok(_) => Ok(if head(dir) == before {
            PullOutcome::UpToDate
        } else {
            PullOutcome::Updated
        }),
        Err(e) => {
            if merge_in_progress(dir) {
                let conflicts = status(dir).conflicts;
                if !conflicts.is_empty() {
                    return Ok(PullOutcome::Conflicts { paths: conflicts });
                }
            }
            Err(friendly_remote_error(&e))
        }
    }
}

/// Push the branch; the first push sets it to track the remote.
pub fn push(dir: &Path) -> Result<(), String> {
    let url = need_remote(dir)?;
    let branch = current_branch(dir)?;
    let mut args = vec!["push"];
    if !has_upstream(dir) {
        args.extend(["--set-upstream", REMOTE, branch.as_str()]);
    }
    run_remote_git(dir, Some(&url), &args)
        .map(|_| ())
        .map_err(|e| friendly_remote_error(&e))
}

/// Drop an unfinished merge, back to the state before the pull.
pub fn abort_merge(dir: &Path) -> Result<(), String> {
    run_git(dir, &["merge", "--abort"]).map(|_| ())
}

/// Which side of a conflict to keep.
#[derive(serde::Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ConflictSide {
    /// The local version (what was committed here).
    Ours,
    /// The remote version (what the pull brought in).
    Theirs,
}

/// Resolve a conflicted path by taking one side whole, then stage it.
/// A side that deleted the file deletes it.
pub fn resolve_conflict(dir: &Path, path: &str, side: ConflictSide) -> Result<(), String> {
    let flag = match side {
        ConflictSide::Ours => "--ours",
        ConflictSide::Theirs => "--theirs",
    };
    match run_git(dir, &["checkout", flag, "--", path]) {
        Ok(_) => stage(dir, &[path.to_string()]),
        Err(e) if e.contains("does not have") => {
            run_git(dir, &["rm", "-q", "--", path]).map(|_| ())
        }
        Err(e) => Err(e),
    }
}

/// The first line (1-based) that still opens or closes a conflict
/// hunk. A bare `=======` is not counted: it can be a line of its own.
pub fn conflict_marker_line(text: &str) -> Option<usize> {
    text.lines()
        .position(|line| line.starts_with("<<<<<<< ") || line.starts_with(">>>>>>> "))
        .map(|index| index + 1)
}

/// Stage a conflicted path the user edited by hand, unless markers
/// remain in it. `file` is the path on disk (None when deleted).
pub fn mark_resolved(dir: &Path, path: &str, file: Option<&Path>) -> Result<(), String> {
    if let Some(file) = file {
        if let Ok(text) = std::fs::read_to_string(file) {
            if let Some(line) = conflict_marker_line(&text) {
                return Err(format!(
                    "{path} still has conflict markers (line {line}): keep one side or edit them away first"
                ));
            }
        }
    }
    stage(dir, &[path.to_string()])
}

/// Clone `url` into `dest` (which must not exist yet).
pub fn clone(url: &str, dest: &Path) -> Result<(), String> {
    let url = check_remote_url(url)?;
    if dest.exists() {
        return Err(format!("{} already exists", dest.display()));
    }
    let parent = dest
        .parent()
        .ok_or_else(|| "The clone destination has no parent folder".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("failed to create projects root: {e}"))?;
    let dest_str = dest.to_string_lossy().to_string();
    run_remote_git(parent, Some(&url), &["clone", "--", &url, &dest_str])
        .map(|_| ())
        .map_err(|e| friendly_remote_error(&e))
}

fn head(dir: &Path) -> Option<String> {
    run_git(dir, &["rev-parse", "HEAD"]).ok().map(|h| h.trim().to_string())
}

/// Git's remote errors, in the words of the panel.
fn friendly_remote_error(stderr: &str) -> String {
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("could not read username")
        || lower.contains("could not read password")
        || lower.contains("authentication failed")
        || lower.contains("terminal prompts disabled")
    {
        "The remote refused the credentials. Add a git account in Settings or check the token".into()
    } else if lower.contains("permission denied (publickey)") {
        "SSH key not accepted: add your key to the ssh agent or use an HTTPS remote".into()
    } else if lower.contains("host key verification failed") {
        "The SSH host is not known yet: connect once from a terminal to accept its key".into()
    } else if lower.contains("src refspec") {
        "Nothing to push yet: make a commit first".into()
    } else if lower.contains("fetch first") || lower.contains("non-fast-forward") {
        "The remote has commits you do not have: pull first, then push".into()
    } else if lower.contains("would be overwritten by merge") {
        "Commit or discard your local changes before pulling".into()
    } else if lower.contains("could not resolve host") || lower.contains("could not connect") {
        "The remote cannot be reached: check the connection".into()
    } else {
        stderr.to_string()
    }
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
    fn blanks_command_keys_from_the_repository_config() {
        let keys = "core.bare\ncore.fsmonitor\nfilter.lfs.process\nfilter.Evil.clean\ndiff.pdf.textconv\ngpg.ssh.program\nuser.name\n";
        let overrides = safety_overrides(keys);
        for expected in [
            "core.fsmonitor=false",
            "filter.lfs.process=",
            "filter.lfs.required=false",
            "filter.Evil.clean=",
            "filter.Evil.required=false",
            "diff.pdf.textconv=",
            "gpg.ssh.program=",
            "commit.gpgSign=false",
        ] {
            assert!(overrides.iter().any(|o| o == expected), "missing {expected}: {overrides:?}");
        }
        assert!(overrides.iter().any(|o| o.starts_with("core.hooksPath=")));
        assert!(!overrides.iter().any(|o| o.starts_with("user.name") || o.starts_with("core.bare")));
    }

    /// End to end: a repository whose config runs commands on `git status`.
    #[cfg(unix)]
    #[test]
    fn repository_config_cannot_run_commands() {
        if !available() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("polemic-git-evil-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let git = |args: &[&str]| {
            Command::new("git").args(args).current_dir(&dir).output().unwrap();
        };
        git(&["init", "-q"]);
        std::fs::write(dir.join(".gitattributes"), "*.tex filter=evil\n").unwrap();
        std::fs::write(dir.join("main.tex"), "x\n").unwrap();
        let marker = dir.join("PWNED");
        let cmd = format!("touch {}; cat", marker.display());
        git(&["config", "core.fsmonitor", &cmd]);
        git(&["config", "filter.evil.clean", &cmd]);
        std::fs::create_dir_all(dir.join(".git/hooks")).unwrap();
        let hook = dir.join(".git/hooks/pre-commit");
        std::fs::write(&hook, format!("#!/bin/sh\n{cmd}\n")).unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();

        let _ = status(&dir);
        let _ = stage(&dir, &["main.tex".into()]);
        let _ = run_git(&dir, &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "m"]);
        assert!(!marker.exists(), "repository config ran a command");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parses_upstream_and_conflicts() {
        let info = parse_status("## main...origin/main [ahead 1, behind 2]\nUU main.tex\nAA new.tex\nM  ok.tex\n");
        assert_eq!(info.upstream.as_deref(), Some("origin/main"));
        assert_eq!(info.conflicts, vec!["main.tex".to_string(), "new.tex".to_string()]);
        assert_eq!(info.entries.len(), 1);

        let info = parse_status("## main...origin/main\n");
        assert_eq!(info.upstream.as_deref(), Some("origin/main"));
        assert_eq!((info.ahead, info.behind), (0, 0));

        let info = parse_status("## main\n");
        assert_eq!(info.upstream, None);
    }

    #[test]
    fn checks_remote_urls() {
        for ok in [
            "https://github.com/you/paper.git",
            "git@github.com:you/paper.git",
            "ssh://git@gitlab.example.org:2222/you/paper.git",
            "https://git.overleaf.com/abc123",
            "file:///Volumes/Drive/paper.git",
        ] {
            assert!(check_remote_url(ok).is_ok(), "{ok}");
        }
        for bad in ["", "--upload-pack=evil", "C:\\paper", "/home/me/paper", "paper", "https://x y"] {
            assert!(check_remote_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn askpass_answers_git_prompts_only() {
        assert_eq!(
            askpass_answer("Username for 'https://github.com': ", "u", "p").as_deref(),
            Some("u")
        );
        assert_eq!(
            askpass_answer("Password for 'https://u@github.com': ", "u", "p").as_deref(),
            Some("p")
        );
        assert_eq!(askpass_answer("Enter passphrase for key: ", "u", "p"), None);
    }

    /// A temp repo with a user configured, for the end-to-end tests.
    fn temp_repo(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("polemic-git-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn configure_user(dir: &Path) {
        run_git(dir, &["config", "user.email", "test@example.com"]).unwrap();
        run_git(dir, &["config", "user.name", "Test"]).unwrap();
    }

    /// A file's text with git's line endings undone (Windows runners
    /// check out with autocrlf on).
    fn read(dir: &Path, path: &str) -> String {
        std::fs::read_to_string(dir.join(path)).unwrap().replace("\r\n", "\n")
    }

    fn write_and_commit(dir: &Path, path: &str, content: &str, message: &str) {
        std::fs::write(dir.join(path), content).unwrap();
        stage(dir, &[path.into()]).unwrap();
        commit(dir, message).unwrap();
    }

    #[test]
    fn pushes_pulls_and_merges_through_a_local_remote() {
        if !available() {
            return;
        }
        let bare = temp_repo("bare");
        run_git(&bare, &["init", "-q", "--bare", "-b", "main"]).unwrap();
        let bare_url = url::Url::from_file_path(&bare).unwrap().to_string();

        // Device A: a fresh project, published to the remote.
        let a = temp_repo("a");
        init(&a).unwrap();
        run_git(&a, &["checkout", "-q", "-b", "main"]).unwrap();
        configure_user(&a);
        write_and_commit(&a, "main.tex", "one\n", "first");
        assert_eq!(status(&a).remote, None);
        assert!(push(&a).is_err(), "push without a remote");
        set_remote(&a, &bare_url).unwrap();
        let info = status(&a);
        assert_eq!(info.remote.as_deref(), Some(bare_url.as_str()));
        assert_eq!(info.upstream, None);
        push(&a).unwrap();
        let info = status(&a);
        assert_eq!(info.upstream.as_deref(), Some("origin/main"));
        assert_eq!((info.ahead, info.behind), (0, 0));
        assert_eq!(pull(&a).unwrap(), PullOutcome::UpToDate);

        // Device B: a clone of the same project.
        let b = temp_repo("b");
        let _ = std::fs::remove_dir_all(&b);
        clone(&bare_url, &b).unwrap();
        configure_user(&b);
        assert_eq!(read(&b, "main.tex"), "one\n");
        assert_eq!(status(&b).upstream.as_deref(), Some("origin/main"));
        assert!(clone(&bare_url, &b).is_err(), "clone over an existing folder");

        // A commits and pushes; B sees it after a fetch, takes it with a pull.
        write_and_commit(&a, "main.tex", "one\ntwo\n", "second");
        assert_eq!(status(&a).ahead, 1);
        push(&a).unwrap();
        fetch(&b).unwrap();
        assert_eq!(status(&b).behind, 1);
        assert_eq!(pull(&b).unwrap(), PullOutcome::Updated);
        assert_eq!(read(&b, "main.tex"), "one\ntwo\n");

        // Both change different files: B's push is refused, its pull merges.
        write_and_commit(&a, "a.tex", "a\n", "a's file");
        push(&a).unwrap();
        write_and_commit(&b, "b.tex", "b\n", "b's file");
        let refused = push(&b).unwrap_err();
        assert!(refused.contains("pull first"), "{refused}");
        assert_eq!(pull(&b).unwrap(), PullOutcome::Updated);
        assert!(b.join("a.tex").exists());
        assert!(!status(&b).merging);
        push(&b).unwrap();

        // Both change the same line: the pull stops on the conflict.
        pull(&a).unwrap();
        write_and_commit(&a, "main.tex", "one\nA\n", "a's edit");
        push(&a).unwrap();
        write_and_commit(&b, "main.tex", "one\nB\n", "b's edit");
        assert_eq!(
            pull(&b).unwrap(),
            PullOutcome::Conflicts { paths: vec!["main.tex".into()] }
        );
        let info = status(&b);
        assert!(info.merging);
        assert_eq!(info.conflicts, vec!["main.tex".to_string()]);
        assert!(read(&b, "main.tex").contains("<<<<<<<"));
        assert!(pull(&b).is_err(), "pull during a merge");

        // Resolve by hand, stage, commit: the merge is done.
        std::fs::write(b.join("main.tex"), "one\nAB\n").unwrap();
        stage(&b, &["main.tex".into()]).unwrap();
        let info = status(&b);
        assert!(info.conflicts.is_empty() && info.merging);
        commit(&b, "merged").unwrap();
        assert!(!status(&b).merging);
        push(&b).unwrap();

        // Or abort: back to before the pull.
        assert_eq!(pull(&a).unwrap(), PullOutcome::Updated);
        write_and_commit(&a, "main.tex", "one\nAB\nA2\n", "a again");
        push(&a).unwrap();
        write_and_commit(&b, "main.tex", "one\nAB\nB2\n", "b again");
        assert!(matches!(pull(&b).unwrap(), PullOutcome::Conflicts { .. }));
        abort_merge(&b).unwrap();
        let info = status(&b);
        assert!(!info.merging && info.conflicts.is_empty());
        assert_eq!(read(&b, "main.tex"), "one\nAB\nB2\n");

        // Keep theirs on one conflict, keep mine on another; a file
        // one side deleted goes with that side.
        write_and_commit(&a, "main.tex", "one\nAB\nA3\n", "a third");
        write_and_commit(&a, "extra.tex", "extra\n", "extra file");
        run_git(&a, &["rm", "-q", "a.tex"]).unwrap();
        commit(&a, "drop a.tex").unwrap();
        push(&a).unwrap();
        write_and_commit(&b, "main.tex", "one\nAB\nB3\n", "b third");
        write_and_commit(&b, "extra.tex", "other\n", "extra too");
        write_and_commit(&b, "a.tex", "a edited\n", "edit a.tex");
        let outcome = pull(&b).unwrap();
        assert_eq!(
            outcome,
            PullOutcome::Conflicts { paths: vec!["a.tex".into(), "extra.tex".into(), "main.tex".into()] }
        );
        let marked = mark_resolved(&b, "main.tex", Some(&b.join("main.tex"))).unwrap_err();
        assert!(marked.contains("conflict markers"), "{marked}");
        resolve_conflict(&b, "main.tex", ConflictSide::Theirs).unwrap();
        assert_eq!(read(&b, "main.tex"), "one\nAB\nA3\n");
        resolve_conflict(&b, "extra.tex", ConflictSide::Ours).unwrap();
        assert_eq!(read(&b, "extra.tex"), "other\n");
        resolve_conflict(&b, "a.tex", ConflictSide::Theirs).unwrap();
        assert!(!b.join("a.tex").exists());
        let info = status(&b);
        assert!(info.conflicts.is_empty() && info.merging, "{:?}", info.conflicts);
        commit(&b, "merged by sides").unwrap();
        assert!(!status(&b).merging);
        push(&b).unwrap();

        // Removing the remote.
        set_remote(&b, "").unwrap();
        assert_eq!(status(&b).remote, None);

        for dir in [bare, a, b] {
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    /// An HTTPS remote that asks for credentials gets the account's
    /// token through the askpass helper, and fails fast without one.
    #[test]
    fn remote_commands_never_wait_for_a_terminal() {
        if !available() {
            return;
        }
        let dir = temp_repo("askpass");
        init(&dir).unwrap();
        // 127.0.0.1:9 (discard) answers nothing; git must give up on its
        // own rather than wait for a prompt. Any error is fine.
        set_remote(&dir, "https://127.0.0.1:9/paper.git").unwrap();
        let started = std::time::Instant::now();
        assert!(fetch(&dir).is_err());
        assert!(started.elapsed() < std::time::Duration::from_secs(60));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn finds_conflict_markers() {
        assert_eq!(conflict_marker_line("a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> origin\n"), Some(2));
        assert_eq!(conflict_marker_line("a\n=======\nb\n"), None);
        assert_eq!(conflict_marker_line("a\n>>>>>>> origin/main\n"), Some(2));
        assert_eq!(conflict_marker_line("a\n\\hrule % =======\n"), None);
        assert_eq!(conflict_marker_line(""), None);
    }

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

/// Files ignored by git (via .gitignore), for file-list coloring.
pub fn ignored(dir: &Path) -> Vec<String> {
    match run_git(dir, &["status", "--porcelain", "--ignored"]) {
        Ok(output) => output
            .lines()
            .filter_map(|line| line.strip_prefix("!! "))
            .map(str::to_string)
            .collect(),
        Err(_) => Vec::new(),
    }
}
