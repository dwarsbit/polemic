//! Compile with Polemic (phase 6): latexmk runs on the account's
//! server instead of a local TeX install, for Professional accounts.
//!
//! The editor sends a manifest of the project's files by SHA-256 (the
//! same files a linked project syncs, see `excludes`), uploads the ones
//! the server has not cached, and writes the outputs into build/ where
//! latexmk would, so the PDF viewer, export and the Problems list work
//! as after a local compile. The request stays open while the job runs;
//! dropping it (a newer compile, see `cancellable`) kills the job.
//!
//! The request and response shapes mirror the server's
//! `@polemic/contracts` ("Cloud compile").

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, SystemTime};
use tokio::sync::Notify;

use crate::excludes::Excluder;
use crate::profile::Engine;

/// The server's limits per compile (COMPILE_MAX_FILES and
/// COMPILE_MAX_PROJECT_BYTES); the walk stops there instead of hashing
/// a whole home folder.
const MAX_FILES: usize = 5_000;
const MAX_PROJECT_BYTES: u64 = 500_000_000;
/// Rounds of manifest and upload before giving up on a project whose
/// files keep changing (or a cache that keeps evicting them).
const MAX_ROUNDS: usize = 3;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
/// A job may run 4 minutes after waiting in the server's queue.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// When a 429 or 503 carries no usable Retry-After.
const DEFAULT_RETRY_AFTER: u64 = 10;

/// Why a compile failed, for the preview's error and its actions.
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CompileErrorKind {
    /// latexmk is not installed: offer compiling with Polemic.
    NoTex,
    /// No account token, or the server no longer accepts it.
    SignedOut,
    /// The account is on the free plan.
    PlanRequired,
    /// The server has no cloud compile.
    Disabled,
    /// More files or bytes than a compile takes.
    TooLarge,
    /// Too many compiles, or every slot busy; `retry_after` says when.
    RateLimited,
    /// The server or its compile service can't be reached.
    Unavailable,
    /// A newer compile of the same account (another window or computer).
    Superseded,
    /// A newer compile in this editor took over; not shown.
    Cancelled,
    Failed,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompileError {
    pub kind: CompileErrorKind,
    pub message: String,
    /// Seconds, for `RateLimited`.
    pub retry_after: Option<u64>,
}

impl CompileError {
    pub fn new(kind: CompileErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            retry_after: None,
        }
    }

    pub fn signed_out() -> Self {
        Self::new(
            CompileErrorKind::SignedOut,
            "Sign in to your Polemic account to compile with Polemic.",
        )
    }
}

impl From<String> for CompileError {
    fn from(message: String) -> Self {
        Self::new(CompileErrorKind::Failed, message)
    }
}

// --- the project's files -------------------------------------------------------

/// One file of the manifest (contracts' `compileFile`).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ManifestFile {
    pub path: String,
    pub hash: String,
    pub size: u64,
}

struct LocalFile {
    file: ManifestFile,
    abs: PathBuf,
}

/// Whether the server takes a project path (contracts' `projectPathProblem`;
/// the walk never yields empty, `.` or `..` segments, or build/).
fn sendable(path: &str) -> bool {
    path.len() <= 1024
        && !path.chars().any(|c| c < '\u{20}' || c == '\u{7f}' || c == '\\')
        && path.split('/').all(|segment| segment.len() <= 255)
}

/// Hashes by file, while size and modification time stay the same: a
/// recompile hashes the files that changed, not every image again.
static HASHES: LazyLock<Mutex<HashMap<PathBuf, (u64, SystemTime, String)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn hash_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn hash_file(abs: &Path, size: u64, modified: SystemTime) -> std::io::Result<String> {
    if let Some((s, m, hash)) = HASHES.lock().ok().and_then(|h| h.get(abs).cloned()) {
        if s == size && m == modified {
            return Ok(hash);
        }
    }
    let mut hasher = Sha256::new();
    std::io::copy(&mut fs::File::open(abs)?, &mut hasher)?;
    let hash = format!("{:x}", hasher.finalize());
    if let Ok(mut hashes) = HASHES.lock() {
        hashes.insert(abs.to_path_buf(), (size, modified, hash.clone()));
    }
    Ok(hash)
}

fn too_large() -> CompileError {
    CompileError::new(
        CompileErrorKind::TooLarge,
        format!(
            "A compile with Polemic takes at most {MAX_FILES} files and {} MB. \
             Add what LaTeX does not need to .gitignore.",
            MAX_PROJECT_BYTES / 1_000_000
        ),
    )
}

fn walk(
    root: &Path,
    folder: &Path,
    rel: &str,
    excluder: &mut Excluder,
    out: &mut Vec<LocalFile>,
    total: &mut u64,
) -> Result<(), CompileError> {
    let gitignore = fs::read_to_string(folder.join(".gitignore")).ok();
    if let Some(text) = &gitignore {
        excluder.push(rel, text);
    }
    let entries = fs::read_dir(folder)
        .map_err(|e| format!("could not read {}: {e}", folder.display()))?;
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
            // A link counts only when it stays inside the project, and a
            // linked folder is never walked (it could loop).
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
                walk(root, &abs, &path, excluder, out, total)?;
            }
            continue;
        }
        if !meta.is_file() || excluder.excluded(&path, false, meta.len()) || !sendable(&path) {
            continue;
        }
        *total += meta.len();
        if out.len() >= MAX_FILES || *total > MAX_PROJECT_BYTES {
            return Err(too_large());
        }
        let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        let hash = hash_file(&abs, meta.len(), modified)
            .map_err(|e| format!("could not read {path}: {e}"))?;
        out.push(LocalFile {
            file: ManifestFile {
                path,
                hash,
                size: meta.len(),
            },
            abs,
        });
    }
    if gitignore.is_some() {
        excluder.pop();
    }
    Ok(())
}

/// The files a compile sends, by path: what a linked project would
/// sync (no .git, no build output, .gitignore applied, nothing over
/// 50 MB), hashed.
fn local_files(dir: &Path) -> Result<Vec<LocalFile>, CompileError> {
    let root = fs::canonicalize(dir).map_err(|e| format!("project not accessible: {e}"))?;
    let mut out = Vec::new();
    walk(&root, &root, "", &mut Excluder::default(), &mut out, &mut 0)?;
    out.sort_by(|a, b| a.file.path.cmp(&b.file.path));
    Ok(out)
}

/// The manifest for `dir`, as the server gets it.
#[cfg(test)]
pub fn manifest(dir: &Path) -> Result<Vec<ManifestFile>, CompileError> {
    Ok(local_files(dir)?.into_iter().map(|f| f.file).collect())
}

// --- the server ------------------------------------------------------------------

#[derive(Serialize)]
struct CompileRequest<'a> {
    main: &'a str,
    engine: &'a str,
    files: Vec<&'a ManifestFile>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompileResponse {
    status: String,
    engine: String,
    output: String,
    outputs: Vec<OutputLink>,
}

#[derive(Deserialize)]
struct OutputLink {
    kind: String,
    url: String,
}

/// Non-2xx bodies (contracts' `errorResponse`, plus `missing` for 409
/// files_missing).
#[derive(Deserialize, Default)]
struct ErrorBody {
    #[serde(default)]
    error: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    missing: Vec<String>,
}

/// A finished job whose outputs are in build/.
#[derive(Debug, PartialEq)]
pub struct Compiled {
    /// "success", "failure" or "timeout".
    pub status: String,
    pub engine: String,
    /// latexmk's own output.
    pub output: String,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .user_agent(concat!("Polemic/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

fn unreachable(server: &str) -> CompileError {
    CompileError::new(
        CompileErrorKind::Unavailable,
        format!("Could not reach {server}."),
    )
}

fn retry_after(response: &reqwest::Response) -> Option<String> {
    response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
}

/// The error for a non-2xx answer of the compile API.
fn error_for(status: u16, retry_after: Option<&str>, body: &ErrorBody) -> CompileError {
    use CompileErrorKind::*;
    let seconds = || {
        retry_after
            .and_then(|v| v.trim().parse::<u64>().ok())
            .unwrap_or(DEFAULT_RETRY_AFTER)
            .clamp(1, 3600)
    };
    let wait = |kind, text: &str| {
        let seconds = seconds();
        CompileError {
            retry_after: Some(seconds),
            ..CompileError::new(kind, format!("{text} Try again in {seconds} s."))
        }
    };
    match (status, body.error.as_str()) {
        (401, _) => CompileError::signed_out(),
        (402, _) => CompileError::new(
            PlanRequired,
            "Compiling with Polemic needs Polemic Professional.",
        ),
        (404, _) => CompileError::new(Disabled, "This Polemic server has no cloud compile."),
        (409, "superseded") => CompileError::new(
            Superseded,
            "A newer compile from your account (another window or computer) replaced this one.",
        ),
        (413, _) if !body.message.is_empty() => CompileError::new(TooLarge, body.message.clone()),
        (413, _) => too_large(),
        (429, _) => wait(RateLimited, "Too many compiles."),
        (503, _) => wait(RateLimited, "Every compile slot on the server is busy."),
        (500..=599, _) => CompileError::new(
            Unavailable,
            "Compiling with Polemic is unavailable right now. Try again later.",
        ),
        _ if !body.message.is_empty() => CompileError::new(Failed, body.message.clone()),
        _ => CompileError::new(Failed, format!("The Polemic server answered {status}.")),
    }
}

/// What an error answer carried.
async fn error_answer(response: reqwest::Response) -> (u16, Option<String>, ErrorBody) {
    let status = response.status().as_u16();
    let retry_after = retry_after(&response);
    let body = response.json::<ErrorBody>().await.unwrap_or_default();
    (status, retry_after, body)
}

/// Uploads the files the server asked for. False when a file changed
/// since it was hashed: the caller starts over with a fresh manifest.
async fn upload_missing(
    client: &reqwest::Client,
    server: &str,
    token: &str,
    files: &[LocalFile],
    missing: &[String],
) -> Result<bool, CompileError> {
    let by_hash: HashMap<&str, &LocalFile> =
        files.iter().map(|f| (f.file.hash.as_str(), f)).collect();
    for hash in missing {
        // Only hashes from this manifest: the server never picks a file.
        let Some(local) = by_hash.get(hash.as_str()) else {
            continue;
        };
        let abs = local.abs.clone();
        let bytes = tauri::async_runtime::spawn_blocking(move || fs::read(abs))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| format!("could not read {}: {e}", local.file.path))?;
        if hash_bytes(&bytes) != *hash {
            if let Ok(mut hashes) = HASHES.lock() {
                hashes.remove(&local.abs);
            }
            return Ok(false);
        }
        let response = client
            .put(format!("{server}/api/compile/files/{hash}"))
            .bearer_auth(token)
            .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
            .body(bytes)
            .send()
            .await
            .map_err(|_| unreachable(server))?;
        if response.status().is_success() {
            continue;
        }
        let (status, retry, body) = error_answer(response).await;
        if status == 400 && body.error == "hash_mismatch" {
            return Ok(false);
        }
        return Err(error_for(status, retry.as_deref(), &body));
    }
    Ok(true)
}

/// Where to fetch an output: the link's path on the account's own
/// server. The token goes to no other host, whatever the answer says.
fn output_url(server: &str, link: &str) -> Result<String, CompileError> {
    let link = url::Url::parse(link).map_err(|_| format!("unexpected output link: {link}"))?;
    let path = link.path();
    if !path.starts_with("/api/compile/outputs/") {
        return Err(format!("unexpected output link: {link}").into());
    }
    let server = url::Url::parse(server).map_err(|e| e.to_string())?;
    Ok(format!("{}{path}", server.origin().ascii_serialization()))
}

/// The output kinds the editor keeps, with their extension in build/.
const OUTPUTS: [(&str, &str); 4] = [
    ("pdf", "pdf"),
    ("synctex", "synctex.gz"),
    ("log", "log"),
    ("blg", "blg"),
];

/// Writes a compile's outputs as build/<stem>.pdf and the rest, each
/// atomically, and removes the .synctex.gz, .log and .blg of an earlier
/// compile that this one did not produce. latexmk's database of a local
/// compile goes too: it no longer describes what is in build/. A
/// failed compile keeps the last PDF, as latexmk does.
fn write_outputs(dir: &Path, main: &str, outputs: &[(&str, Vec<u8>)]) -> Result<(), String> {
    let build = dir.join("build");
    fs::create_dir_all(&build).map_err(|e| format!("could not create build/: {e}"))?;
    let pdf = build.join(crate::pdf_output_path(main));
    for (ext, bytes) in outputs {
        let path = pdf.with_extension(ext);
        crate::files::write_atomic(&path, bytes)
            .map_err(|e| format!("could not write {}: {e}", path.display()))?;
    }
    let stale = OUTPUTS
        .iter()
        .filter(|(kind, ext)| *kind != "pdf" && !outputs.iter().any(|(e, _)| e == ext))
        .map(|(_, ext)| *ext)
        .chain(["fdb_latexmk"]);
    for ext in stale {
        let _ = fs::remove_file(pdf.with_extension(ext));
    }
    Ok(())
}

/// Fetches every output into memory, then writes them all: a compile
/// stopped halfway leaves build/ as it was.
async fn fetch_outputs(
    client: &reqwest::Client,
    server: &str,
    token: &str,
    dir: &Path,
    main: &str,
    links: &[OutputLink],
) -> Result<(), CompileError> {
    let mut fetched: Vec<(&str, Vec<u8>)> = Vec::new();
    for link in links {
        let Some((_, ext)) = OUTPUTS.iter().find(|(kind, _)| *kind == link.kind) else {
            continue;
        };
        let response = client
            .get(output_url(server, &link.url)?)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| unreachable(server))?;
        if !response.status().is_success() {
            let (status, retry, body) = error_answer(response).await;
            return Err(match status {
                401 | 402 => error_for(status, retry.as_deref(), &body),
                _ => format!(
                    "Could not download the compile's {} ({status}). Compile again.",
                    link.kind
                )
                .into(),
            });
        }
        let bytes = response.bytes().await.map_err(|_| unreachable(server))?;
        fetched.push((ext, bytes.to_vec()));
    }
    write_outputs(dir, main, &fetched).map_err(CompileError::from)
}

/// Compiles `main` (project-relative, "/"-separated) of the project in
/// `dir` on `server` and writes the outputs into build/.
pub async fn compile_with(
    server: &str,
    token: &str,
    dir: &Path,
    main: &str,
    engine: Engine,
) -> Result<Compiled, CompileError> {
    let client = client()?;
    for _ in 0..MAX_ROUNDS {
        let root = dir.to_path_buf();
        let files = tauri::async_runtime::spawn_blocking(move || local_files(&root))
            .await
            .map_err(|e| e.to_string())??;
        let request = CompileRequest {
            main,
            engine: engine.name(),
            files: files.iter().map(|f| &f.file).collect(),
        };
        let response = client
            .post(format!("{server}/api/compile"))
            .bearer_auth(token)
            .json(&request)
            .send()
            .await
            .map_err(|_| unreachable(server))?;
        if response.status().is_success() {
            let answer: CompileResponse = response
                .json()
                .await
                .map_err(|e| format!("Unexpected answer from the server: {e}"))?;
            fetch_outputs(&client, server, token, dir, main, &answer.outputs).await?;
            return Ok(Compiled {
                status: answer.status,
                engine: answer.engine,
                output: answer.output,
            });
        }
        let (status, retry, body) = error_answer(response).await;
        if status == 409 && body.error == "files_missing" {
            upload_missing(&client, server, token, &files, &body.missing).await?;
            continue;
        }
        return Err(error_for(status, retry.as_deref(), &body));
    }
    Err("The project's files kept changing while they were uploaded. Compile again.".to_string().into())
}

// --- one compile at a time -----------------------------------------------------

/// The running compile's stop signal; a newer compile stops the older.
static RUNNING: Mutex<Option<Arc<Notify>>> = Mutex::new(None);

/// Runs `compile` until it finishes or a newer compile (or `cancel`)
/// stops it. Stopping drops its request, which ends the job on the server.
pub async fn cancellable<T>(
    compile: impl std::future::Future<Output = Result<T, CompileError>>,
) -> Result<T, CompileError> {
    let stop = Arc::new(Notify::new());
    if let Ok(mut running) = RUNNING.lock() {
        if let Some(old) = running.replace(stop.clone()) {
            old.notify_one();
        }
    }
    let result = tokio::select! {
        result = compile => result,
        _ = stop.notified() => Err(CompileError::new(
            CompileErrorKind::Cancelled,
            "A newer compile took over.",
        )),
    };
    if let Ok(mut running) = RUNNING.lock() {
        if running.as_ref().is_some_and(|r| Arc::ptr_eq(r, &stop)) {
            *running = None;
        }
    }
    result
}

/// Stops the running compile, if any.
pub fn cancel() {
    if let Ok(mut running) = RUNNING.lock() {
        if let Some(stop) = running.take() {
            stop.notify_one();
        }
    }
}

// --- availability ----------------------------------------------------------------

/// What Settings shows next to "With Polemic".
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Availability {
    Available,
    SignedOut,
    PlanRequired,
    /// The server has no cloud compile.
    Disabled,
    /// Could not tell (offline, server error).
    Unknown,
}

/// Asks the server without compiling: an output of a compile that
/// cannot exist answers 404 not_found where compile runs, 404
/// compile_disabled where it does not, and 401 or 402 before either.
pub async fn availability_with(server: &str, token: &str) -> Availability {
    let Ok(client) = client() else {
        return Availability::Unknown;
    };
    let probe = format!("{server}/api/compile/outputs/{}/pdf", "0".repeat(32));
    let Ok(response) = client
        .get(probe)
        .bearer_auth(token)
        .timeout(CONNECT_TIMEOUT)
        .send()
        .await
    else {
        return Availability::Unknown;
    };
    let (status, _, body) = error_answer(response).await;
    match (status, body.error.as_str()) {
        (401, _) => Availability::SignedOut,
        (402, _) => Availability::PlanRequired,
        (404, "compile_disabled") => Availability::Disabled,
        (404, _) => Availability::Available,
        _ => Availability::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    fn temp_project(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "polemic-cloud-{name}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(dir: &Path, path: &str, text: &str) {
        let path = dir.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    #[test]
    fn manifest_hashes_and_applies_the_excludes() {
        let dir = temp_project("manifest");
        write(&dir, "main.tex", "abc");
        write(&dir, "ch/intro.tex", "intro");
        write(&dir, ".gitignore", "*.bak\n");
        write(&dir, "ch/.gitignore", "draft.tex\n");
        write(&dir, "ch/draft.tex", "x");
        write(&dir, "old.bak", "x");
        write(&dir, "main.aux", "x");
        write(&dir, ".git/HEAD", "x");
        write(&dir, "build/main.pdf", "x");
        write(&dir, "node_modules/a.js", "x");
        // The server refuses a backslash in a path (a separator on Windows).
        #[cfg(unix)]
        write(&dir, "back\\slash.tex", "x");
        let paths: Vec<(String, u64)> = manifest(&dir)
            .unwrap()
            .into_iter()
            .map(|f| (f.path, f.size))
            .collect();
        assert_eq!(
            paths,
            [
                (".gitignore".to_string(), 6),
                ("ch/.gitignore".to_string(), 10),
                ("ch/intro.tex".to_string(), 5),
                ("main.tex".to_string(), 3),
            ]
        );
        let main = manifest(&dir)
            .unwrap()
            .into_iter()
            .find(|f| f.path == "main.tex")
            .unwrap();
        assert_eq!(
            main.hash,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        // A changed file gets a new hash, though the cache knew the path.
        std::thread::sleep(Duration::from_millis(20));
        write(&dir, "main.tex", "abcd");
        let main = manifest(&dir)
            .unwrap()
            .into_iter()
            .find(|f| f.path == "main.tex")
            .unwrap();
        assert_eq!(main.hash, hash_bytes(b"abcd"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn manifest_follows_links_only_inside_the_project() {
        let dir = temp_project("links");
        let outside = temp_project("links-outside");
        write(&dir, "main.tex", "x");
        write(&outside, "secret.txt", "s");
        std::os::unix::fs::symlink(outside.join("secret.txt"), dir.join("secret.txt")).unwrap();
        std::os::unix::fs::symlink(dir.join("main.tex"), dir.join("alias.tex")).unwrap();
        std::os::unix::fs::symlink(&dir, dir.join("loop")).unwrap();
        let paths: Vec<String> = manifest(&dir).unwrap().into_iter().map(|f| f.path).collect();
        assert_eq!(paths, ["alias.tex", "main.tex"]);
        fs::remove_dir_all(&dir).unwrap();
        fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn maps_server_answers_to_errors() {
        use CompileErrorKind::*;
        let body = |error: &str, message: &str| ErrorBody {
            error: error.into(),
            message: message.into(),
            missing: vec![],
        };
        let kind = |status| error_for(status, None, &ErrorBody::default()).kind;
        assert_eq!(kind(401), SignedOut);
        assert_eq!(kind(402), PlanRequired);
        assert_eq!(kind(404), Disabled);
        assert_eq!(kind(502), Unavailable);
        assert_eq!(error_for(409, None, &body("superseded", "x")).kind, Superseded);
        let large = error_for(413, None, &body("project_too_large", "At most 5000 files"));
        assert_eq!((large.kind, large.message.as_str()), (TooLarge, "At most 5000 files"));
        let limited = error_for(429, Some("30"), &body("rate_limited", "x"));
        assert_eq!((limited.kind, limited.retry_after), (RateLimited, Some(30)));
        let busy = error_for(503, None, &body("compile_busy", "x"));
        assert_eq!((busy.kind, busy.retry_after), (RateLimited, Some(DEFAULT_RETRY_AFTER)));
        let bad = error_for(400, None, &body("invalid_request", "\"a\" is a file and a folder"));
        assert_eq!((bad.kind, bad.message.as_str()), (Failed, "\"a\" is a file and a folder"));
    }

    #[test]
    fn output_links_resolve_on_the_account_server() {
        assert_eq!(
            output_url(
                "https://app.test",
                "https://elsewhere.test/api/compile/outputs/ab/pdf"
            )
            .unwrap(),
            "https://app.test/api/compile/outputs/ab/pdf"
        );
        assert_eq!(
            output_url("http://localhost:4000", "http://localhost/api/compile/outputs/ab/log").unwrap(),
            "http://localhost:4000/api/compile/outputs/ab/log"
        );
        assert!(output_url("https://app.test", "https://app.test/api/me").is_err());
        assert!(output_url("https://app.test", "not a url").is_err());
    }

    // --- against a stub server ---

    struct Seen {
        method: String,
        path: String,
        authorization: Option<String>,
        body: Vec<u8>,
    }

    /// Serves one canned answer per request, in order; returns the port
    /// and what each request carried.
    fn stub(answers: Vec<String>) -> (u16, std::thread::JoinHandle<Vec<Seen>>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let mut seen = Vec::new();
            for answer in answers {
                let (mut stream, _) = listener.accept().unwrap();
                let mut buf = Vec::new();
                let mut chunk = [0u8; 8192];
                let (head_end, length) = loop {
                    let n = stream.read(&mut chunk).unwrap();
                    buf.extend_from_slice(&chunk[..n]);
                    if let Some(at) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                        let head = String::from_utf8_lossy(&buf[..at]).to_ascii_lowercase();
                        let length = head
                            .lines()
                            .find_map(|l| l.strip_prefix("content-length:"))
                            .map_or(0, |v| v.trim().parse().unwrap());
                        break (at + 4, length);
                    }
                };
                while buf.len() < head_end + length {
                    let n = stream.read(&mut chunk).unwrap();
                    buf.extend_from_slice(&chunk[..n]);
                }
                let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
                let mut request_line = head.lines().next().unwrap().split(' ');
                let method = request_line.next().unwrap().to_string();
                let path = request_line.next().unwrap().to_string();
                let authorization = head.lines().find_map(|l| {
                    let (name, value) = l.split_once(':')?;
                    name.eq_ignore_ascii_case("authorization").then(|| value.trim().to_string())
                });
                seen.push(Seen {
                    method,
                    path,
                    authorization,
                    body: buf[head_end..head_end + length].to_vec(),
                });
                stream.write_all(answer.as_bytes()).unwrap();
            }
            seen
        });
        (port, handle)
    }

    fn answer(status: &str, headers: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    fn json(status: &str, body: &str) -> String {
        answer(status, "Content-Type: application/json\r\n", body)
    }

    fn compile(port: u16, dir: &Path) -> Result<Compiled, CompileError> {
        let server = format!("http://127.0.0.1:{port}");
        tauri::async_runtime::block_on(compile_with(&server, "tok", dir, "main.tex", Engine::Xelatex))
    }

    const MAIN: &str = "\\documentclass{article}";
    const PNG: &str = "png-bytes";

    fn finished(status: &str, kinds: &[&str]) -> String {
        let outputs: Vec<String> = kinds
            .iter()
            .map(|kind| {
                format!(
                    r#"{{"kind":"{kind}","size":3,"url":"https://public.example/api/compile/outputs/{}/{kind}"}}"#,
                    "c".repeat(32)
                )
            })
            .collect();
        json(
            "200 OK",
            &format!(
                r#"{{"id":"{}","status":"{status}","engine":"xelatex","durationMs":812,"output":"Latexmk: done","outputs":[{}],"expiresAt":"2026-10-30T12:00:00.000Z"}}"#,
                "c".repeat(32),
                outputs.join(",")
            ),
        )
    }

    #[test]
    fn uploads_what_is_missing_then_writes_the_outputs() {
        let dir = temp_project("flow");
        write(&dir, "main.tex", MAIN);
        write(&dir, "fig/a.png", PNG);
        // An earlier compile's bibliography log, and latexmk's database.
        write(&dir, "build/main.blg", "old");
        write(&dir, "build/main.fdb_latexmk", "old");
        let png_hash = hash_bytes(PNG.as_bytes());
        let (port, server) = stub(vec![
            json(
                "409 Conflict",
                &format!(r#"{{"error":"files_missing","message":"Upload","missing":["{png_hash}"]}}"#),
            ),
            json("201 Created", &format!(r#"{{"hash":"{png_hash}","size":9}}"#)),
            finished("success", &["pdf", "synctex", "log"]),
            answer("200 OK", "", "%PDF"),
            answer("200 OK", "", "gz"),
            answer("200 OK", "", "This is XeTeX"),
        ]);
        let compiled = compile(port, &dir).unwrap();
        assert_eq!(
            compiled,
            Compiled {
                status: "success".into(),
                engine: "xelatex".into(),
                output: "Latexmk: done".into()
            }
        );
        let seen = server.join().unwrap();
        let requests: Vec<(&str, &str)> =
            seen.iter().map(|s| (s.method.as_str(), s.path.as_str())).collect();
        let output = |kind: &str| format!("/api/compile/outputs/{}/{kind}", "c".repeat(32));
        assert_eq!(
            requests,
            [
                ("POST", "/api/compile"),
                ("PUT", format!("/api/compile/files/{png_hash}").as_str()),
                ("POST", "/api/compile"),
                ("GET", output("pdf").as_str()),
                ("GET", output("synctex").as_str()),
                ("GET", output("log").as_str()),
            ]
        );
        assert!(seen.iter().all(|s| s.authorization.as_deref() == Some("Bearer tok")));
        assert_eq!(seen[1].body, PNG.as_bytes());
        let manifest: serde_json::Value = serde_json::from_slice(&seen[0].body).unwrap();
        assert_eq!(
            manifest,
            serde_json::json!({
                "main": "main.tex",
                "engine": "xelatex",
                "files": [
                    { "path": "fig/a.png", "hash": png_hash, "size": 9 },
                    { "path": "main.tex", "hash": hash_bytes(MAIN.as_bytes()), "size": MAIN.len() },
                ]
            })
        );
        assert_eq!(seen[2].body, seen[0].body);
        let build = dir.join("build");
        assert_eq!(fs::read_to_string(build.join("main.pdf")).unwrap(), "%PDF");
        assert_eq!(fs::read_to_string(build.join("main.synctex.gz")).unwrap(), "gz");
        assert_eq!(fs::read_to_string(build.join("main.log")).unwrap(), "This is XeTeX");
        assert!(!build.join("main.blg").exists());
        assert!(!build.join("main.fdb_latexmk").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_failed_compile_keeps_the_last_pdf() {
        let dir = temp_project("failed");
        write(&dir, "main.tex", MAIN);
        write(&dir, "build/main.pdf", "old pdf");
        write(&dir, "build/main.synctex.gz", "old");
        let (port, server) = stub(vec![
            finished("failure", &["log"]),
            answer("200 OK", "", "! Undefined control sequence."),
        ]);
        let compiled = compile(port, &dir).unwrap();
        assert_eq!(compiled.status, "failure");
        assert_eq!(server.join().unwrap().len(), 2);
        let build = dir.join("build");
        assert_eq!(fs::read_to_string(build.join("main.pdf")).unwrap(), "old pdf");
        assert!(!build.join("main.synctex.gz").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn account_and_server_errors_stop_the_compile() {
        let dir = temp_project("errors");
        write(&dir, "main.tex", MAIN);
        let error = |status: &str, headers: &str, body: &str| {
            let (port, server) = stub(vec![answer(
                status,
                &format!("Content-Type: application/json\r\n{headers}"),
                body,
            )]);
            let result = compile(port, &dir);
            assert_eq!(server.join().unwrap().len(), 1);
            result.unwrap_err()
        };
        use CompileErrorKind::*;
        assert_eq!(error("401 Unauthorized", "", r#"{"error":"unauthorized","message":"x"}"#).kind, SignedOut);
        assert_eq!(error("402 Payment Required", "", r#"{"error":"plan_required","message":"x"}"#).kind, PlanRequired);
        assert_eq!(error("409 Conflict", "", r#"{"error":"superseded","message":"x"}"#).kind, Superseded);
        assert_eq!(error("404 Not Found", "", r#"{"error":"compile_disabled","message":"x"}"#).kind, Disabled);
        assert_eq!(error("502 Bad Gateway", "", r#"{"error":"compile_unavailable","message":"x"}"#).kind, Unavailable);
        let busy = error("503 Service Unavailable", "Retry-After: 7\r\n", r#"{"error":"compile_busy","message":"x"}"#);
        assert_eq!((busy.kind, busy.retry_after), (RateLimited, Some(7)));
        assert!(!dir.join("build").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_failed_download_writes_nothing() {
        let dir = temp_project("download");
        write(&dir, "main.tex", MAIN);
        let (port, server) = stub(vec![
            finished("success", &["pdf", "log"]),
            answer("200 OK", "", "%PDF"),
            json("404 Not Found", r#"{"error":"not_found","message":"expired"}"#),
        ]);
        let error = compile(port, &dir).unwrap_err();
        assert_eq!(error.kind, CompileErrorKind::Failed);
        assert!(error.message.contains("log"), "{}", error.message);
        server.join().unwrap();
        assert!(!dir.join("build/main.pdf").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn unreachable_servers_are_unavailable() {
        let dir = temp_project("unreachable");
        write(&dir, "main.tex", MAIN);
        let port = TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port();
        assert_eq!(compile(port, &dir).unwrap_err().kind, CompileErrorKind::Unavailable);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_newer_compile_stops_the_running_one() {
        // The stub accepts the first compile and never answers it.
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let (accepted_tx, accepted_rx) = std::sync::mpsc::channel();
        let held = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            accepted_tx.send(()).unwrap();
            // Reads until the editor drops the connection.
            let mut stream = stream;
            let mut buf = [0u8; 4096];
            while stream.read(&mut buf).is_ok_and(|n| n > 0) {}
        });
        let dir = temp_project("cancel");
        write(&dir, "main.tex", MAIN);
        let first_dir = dir.clone();
        let first = std::thread::spawn(move || {
            tauri::async_runtime::block_on(cancellable(async {
                let server = format!("http://127.0.0.1:{port}");
                compile_with(&server, "tok", &first_dir, "main.tex", Engine::Pdflatex).await
            }))
        });
        accepted_rx.recv_timeout(Duration::from_secs(10)).unwrap();
        // A newer compile starts (here: one that finishes at once).
        let second = tauri::async_runtime::block_on(cancellable(async { Ok(()) }));
        assert!(second.is_ok());
        let first = first.join().unwrap().unwrap_err();
        assert_eq!(first.kind, CompileErrorKind::Cancelled);
        // The dropped request closed the connection.
        held.join().unwrap();
        // With nothing running, cancel is a no-op.
        cancel();
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn availability_follows_the_probe() {
        let probe = |status: &str, body: &str| {
            let (port, server) = stub(vec![json(status, body)]);
            let result = tauri::async_runtime::block_on(availability_with(
                &format!("http://127.0.0.1:{port}"),
                "tok",
            ));
            let seen = server.join().unwrap();
            assert_eq!(seen[0].path, format!("/api/compile/outputs/{}/pdf", "0".repeat(32)));
            result
        };
        use Availability::*;
        assert_eq!(probe("404 Not Found", r#"{"error":"not_found","message":"x"}"#), Available);
        assert_eq!(probe("404 Not Found", r#"{"error":"compile_disabled","message":"x"}"#), Disabled);
        assert_eq!(probe("402 Payment Required", r#"{"error":"plan_required","message":"x"}"#), PlanRequired);
        assert_eq!(probe("401 Unauthorized", r#"{"error":"unauthorized","message":"x"}"#), SignedOut);
        assert_eq!(probe("500 Internal Server Error", "{}"), Unknown);
    }

    /// Against a running Polemic server with cloud compile (apps/api with
    /// BILLING=off, apps/compile) and a desktop token.
    ///
    /// POLEMIC_E2E_SERVER=http://localhost:4000 POLEMIC_E2E_TOKEN=… cargo test e2e_cloud -- --ignored
    #[test]
    #[ignore]
    fn e2e_cloud_compile() {
        let server = std::env::var("POLEMIC_E2E_SERVER").expect("POLEMIC_E2E_SERVER");
        let token = std::env::var("POLEMIC_E2E_TOKEN").expect("POLEMIC_E2E_TOKEN");
        let dir = temp_project("e2e");
        write(
            &dir,
            "main.tex",
            "\\documentclass{article}\n\\begin{document}\nHello \\input{ch/one}\n\\end{document}\n",
        );
        write(&dir, "ch/one.tex", "world.\n");
        let run = || {
            tauri::async_runtime::block_on(compile_with(&server, &token, &dir, "main.tex", Engine::Pdflatex))
                .unwrap()
        };
        let compiled = run();
        assert_eq!(compiled.status, "success", "{}", compiled.output);
        assert!(fs::read(dir.join("build/main.pdf")).unwrap().starts_with(b"%PDF"));
        assert!(dir.join("build/main.synctex.gz").exists());
        assert!(fs::read_to_string(dir.join("build/main.log")).unwrap().contains("ch/one.tex"));
        // A second compile finds every file cached.
        assert_eq!(run().status, "success");
        write(&dir, "main.tex", "\\documentclass{article}\n\\begin{document}\n\\oops\n\\end{document}\n");
        let failed = run();
        assert_eq!(failed.status, "failure");
        let log = fs::read_to_string(dir.join("build/main.log")).unwrap();
        // Project-relative, as after a local compile: the Problems list opens it.
        assert!(crate::logparse::parse_issues(&log).iter().any(|i| {
            i.message.contains("Undefined control sequence") && i.file.as_deref() == Some("main.tex")
        }));
        let available = tauri::async_runtime::block_on(availability_with(&server, &token));
        assert_eq!(available, Availability::Available);
        fs::remove_dir_all(&dir).unwrap();
    }
}
