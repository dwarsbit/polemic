//! Publish for review (phase 5a): the project's files go to the
//! account's server as a Yjs document plus assets, and review links
//! open the published version in a browser.
//!
//! The Yjs work runs in the webview (`src/lib/share.ts` and
//! `project-doc.ts`); this side reads the folder, holds the token and
//! talks to the server: the document routes exchange Yjs updates over
//! HTTP, assets go up by SHA-256, and a snapshot fixes the published
//! version with the PDF and SyncTeX of the last compile. Which server
//! project a folder publishes to is kept in the app data folder, never
//! in the project, so drives and git never carry it.
//!
//! The request and response shapes mirror the server's
//! `@polemic/contracts` ("Projects", "The document over HTTP").

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use base64::Engine as _;

use crate::cloud_compile::{self, CompileErrorKind};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
/// Uploads of up to 50 MiB on a slow line.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// The server's largest update (contracts: 16 MiB).
const MAX_UPDATE_BYTES: usize = 16 * 1024 * 1024;

// --- errors ----------------------------------------------------------------------

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ShareErrorKind {
    /// No account token, or the server no longer accepts it.
    SignedOut,
    /// The account is on the free plan.
    PlanRequired,
    /// The server copy is gone (deleted from another computer or the
    /// account page); the link is forgotten.
    NotFound,
    /// Over the storage quota, or a file or update too large.
    TooLarge,
    /// The server can't be reached, or failed.
    Unavailable,
    Failed,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShareError {
    pub kind: ShareErrorKind,
    pub message: String,
}

impl ShareError {
    fn new(kind: ShareErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn signed_out() -> Self {
        Self::new(
            ShareErrorKind::SignedOut,
            "Sign in to your Polemic account to share this project.",
        )
    }
}

impl From<String> for ShareError {
    fn from(message: String) -> Self {
        Self::new(ShareErrorKind::Failed, message)
    }
}

impl From<cloud_compile::CompileError> for ShareError {
    fn from(e: cloud_compile::CompileError) -> Self {
        match e.kind {
            CompileErrorKind::TooLarge => Self::new(
                ShareErrorKind::TooLarge,
                "A shared project holds at most 5000 files and 500 MB. \
                 Add what reviewers do not need to .gitignore.",
            ),
            _ => Self::new(ShareErrorKind::Failed, e.message),
        }
    }
}

/// Non-2xx bodies (contracts' `errorResponse`).
#[derive(Deserialize, Default)]
struct ErrorBody {
    #[serde(default)]
    error: String,
    #[serde(default)]
    message: String,
}

fn error_for(status: u16, body: &ErrorBody) -> ShareError {
    use ShareErrorKind::*;
    match (status, body.error.as_str()) {
        (401, _) => ShareError::signed_out(),
        (402, _) => ShareError::new(PlanRequired, "Sharing needs Polemic Professional."),
        (404, "not_found") => ShareError::new(
            NotFound,
            "The shared copy of this project no longer exists on the server.",
        ),
        (413, "quota_exceeded") => ShareError::new(
            TooLarge,
            "Your server storage is full. Delete shared projects you no longer need from your account page.",
        ),
        (413, _) if !body.message.is_empty() => ShareError::new(TooLarge, body.message.clone()),
        (500..=599, _) => ShareError::new(
            Unavailable,
            "Sharing is unavailable right now. Try again later.",
        ),
        _ if !body.message.is_empty() => ShareError::new(Failed, body.message.clone()),
        _ => ShareError::new(Failed, format!("The Polemic server answered {status}.")),
    }
}

fn unreachable(server: &str) -> ShareError {
    ShareError::new(
        ShareErrorKind::Unavailable,
        format!("Could not reach {server}."),
    )
}

// --- text or binary --------------------------------------------------------------

/// Always assets, even when the bytes happen to decode (project-doc's
/// BINARY_EXTENSIONS).
const BINARY_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "ico", "heic", "pdf", "zip", "gz",
    "tgz", "bz2", "xz", "7z", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
    "otf", "ttf", "woff", "woff2", "mp3", "mp4", "mov", "wav", "ogg", "webm", "xcf", "psd", "ai",
];

const MEDIA_TYPES: &[(&str, &str)] = &[
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("bmp", "image/bmp"),
    ("tif", "image/tiff"),
    ("tiff", "image/tiff"),
    ("pdf", "application/pdf"),
    ("eps", "application/postscript"),
    ("ps", "application/postscript"),
    ("zip", "application/zip"),
    ("otf", "font/otf"),
    ("ttf", "font/ttf"),
    ("woff", "font/woff"),
    ("woff2", "font/woff2"),
];

fn extension(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default()
}

fn is_binary_extension(path: &str) -> bool {
    BINARY_EXTENSIONS.contains(&extension(path).as_str())
}

/// The media type for an asset path (project-doc's `mediaType`).
pub fn media_type(path: &str) -> &'static str {
    let ext = extension(path);
    MEDIA_TYPES
        .iter()
        .find(|(e, _)| *e == ext)
        .map_or("application/octet-stream", |(_, t)| t)
}

/// The file's text, or None when it is binary (project-doc's
/// `decodeText`): a known binary extension, a NUL byte in the first
/// 8000 bytes (git's test), or bytes that are not UTF-8. A byte-order
/// mark is kept.
pub fn decode_text(path: &str, bytes: Vec<u8>) -> Option<String> {
    if is_binary_extension(path) {
        return None;
    }
    if bytes[..bytes.len().min(8000)].contains(&0) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

/// One file of the folder, classified (project-doc's `FolderEntry`).
#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FolderEntry {
    Text {
        path: String,
        text: String,
    },
    Asset {
        path: String,
        hash: String,
        size: u64,
        #[serde(rename = "type")]
        media_type: String,
    },
}

/// The files a publish sends: what a linked project syncs (the cloud
/// compile's walk), text read whole, assets by hash.
pub fn folder_entries(dir: &Path) -> Result<Vec<FolderEntry>, ShareError> {
    let mut entries = Vec::new();
    for local in cloud_compile::local_files(dir)? {
        let path = local.file.path;
        // Only text candidates are read here; assets are read when uploaded.
        let text = if !is_binary_extension(&path) {
            let bytes = fs::read(&local.abs).map_err(|e| format!("could not read {path}: {e}"))?;
            decode_text(&path, bytes)
        } else {
            None
        };
        entries.push(match text {
            Some(text) => FolderEntry::Text { path, text },
            None => FolderEntry::Asset {
                media_type: media_type(&path).into(),
                path,
                hash: local.file.hash,
                size: local.file.size,
            },
        });
    }
    Ok(entries)
}

// --- links: which server project a folder publishes to --------------------------

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShareLink {
    pub server: String,
    pub project_id: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Default)]
struct LinkFile {
    /// Canonical project folder → its link.
    links: HashMap<String, ShareLink>,
}

static LINKS_LOCK: Mutex<()> = Mutex::new(());

fn read_links(file: &Path) -> LinkFile {
    fs::read(file)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// The folder's link to a project on `server`; links to another server
/// stay stored (signing back in there finds them) but don't count.
pub fn link_in(file: &Path, dir: &Path, server: &str) -> Option<ShareLink> {
    let _guard = LINKS_LOCK.lock().ok()?;
    read_links(file)
        .links
        .remove(&dir.to_string_lossy().to_string())
        .filter(|link| link.server == server)
}

/// Stores the folder's link, or forgets it (None).
pub fn set_link_in(file: &Path, dir: &Path, link: Option<ShareLink>) -> Result<(), String> {
    let _guard = LINKS_LOCK.lock().map_err(|e| e.to_string())?;
    let mut links = read_links(file);
    let key = dir.to_string_lossy().to_string();
    match link {
        Some(link) => {
            links.links.insert(key, link);
        }
        None => {
            links.links.remove(&key);
        }
    }
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    let json = serde_json::to_vec_pretty(&links).map_err(|e| e.to_string())?;
    crate::files::write_atomic(file, &json)
        .map_err(|e| format!("could not save the share link: {e}"))
}

// --- the server --------------------------------------------------------------------

/// Project and link ids are 128 random bits in base64url (the server's
/// `newProjectId`); nothing else goes into a URL.
fn valid_id(id: &str) -> bool {
    id.len() == 22
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn checked_id(id: &str) -> Result<&str, ShareError> {
    if valid_id(id) {
        Ok(id)
    } else {
        Err(format!("invalid id: {id}").into())
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .user_agent(concat!("Polemic/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

/// The account's server and token, as a session for the calls below.
pub struct Session<'a> {
    pub server: &'a str,
    pub token: &'a str,
    client: reqwest::Client,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
    pub role: String,
    pub writable: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSync {
    /// base64 Yjs update: what the caller's copy lacks.
    pub update: String,
    /// base64 state vector of the server's document.
    pub state_vector: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInfo {
    pub id: String,
    pub main: Option<String>,
    pub pdf: Option<String>,
    pub synctex: Option<String>,
    pub size: u64,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewLink {
    pub id: String,
    /// "commenter" or "viewer".
    pub role: String,
    pub expires_at: Option<String>,
    pub created_at: String,
    /// Only when the link was just made: the server keeps the token's hash.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Deserialize)]
struct Snapshots {
    snapshots: Vec<SnapshotInfo>,
}

#[derive(Deserialize)]
struct Links {
    links: Vec<ReviewLink>,
}

#[derive(Deserialize)]
struct StoredAsset {
    hash: String,
}

#[derive(Deserialize)]
struct Assets {
    assets: Vec<StoredAsset>,
}

impl<'a> Session<'a> {
    pub fn new(server: &'a str, token: &'a str) -> Result<Self, ShareError> {
        Ok(Self {
            server,
            token,
            client: client()?,
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.server)
    }

    async fn send(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<reqwest::Response, ShareError> {
        let response = request
            .bearer_auth(self.token)
            .send()
            .await
            .map_err(|_| unreachable(self.server))?;
        if response.status().is_success() {
            return Ok(response);
        }
        let status = response.status().as_u16();
        let body = response.json::<ErrorBody>().await.unwrap_or_default();
        Err(error_for(status, &body))
    }

    async fn json<T: serde::de::DeserializeOwned>(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<T, ShareError> {
        self.send(request)
            .await?
            .json()
            .await
            .map_err(|e| format!("Unexpected answer from the server: {e}").into())
    }

    pub async fn create_project(&self, name: &str) -> Result<ProjectInfo, ShareError> {
        let name: String = name.trim().chars().take(200).collect();
        let name = if name.is_empty() {
            "Untitled".to_string()
        } else {
            name
        };
        self.json(
            self.client
                .post(self.url("/api/projects"))
                .json(&serde_json::json!({ "name": name })),
        )
        .await
    }

    pub async fn delete_project(&self, id: &str) -> Result<(), ShareError> {
        let id = checked_id(id)?;
        self.send(self.client.delete(self.url(&format!("/api/projects/{id}"))))
            .await
            .map(drop)
    }

    pub async fn sync(&self, id: &str, state_vector: &str) -> Result<DocumentSync, ShareError> {
        let id = checked_id(id)?;
        self.json(
            self.client
                .post(self.url(&format!("/api/projects/{id}/document/sync")))
                .json(&serde_json::json!({ "stateVector": state_vector })),
        )
        .await
    }

    pub async fn push(&self, id: &str, update: Vec<u8>) -> Result<(), ShareError> {
        let id = checked_id(id)?;
        if update.len() > MAX_UPDATE_BYTES {
            return Err(ShareError::new(
                ShareErrorKind::TooLarge,
                "The project's text is too large to publish in one go (16 MiB).",
            ));
        }
        self.send(
            self.client
                .post(self.url(&format!("/api/projects/{id}/document/update")))
                .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
                .body(update),
        )
        .await
        .map(drop)
    }

    async fn stored_assets(&self, id: &str) -> Result<HashSet<String>, ShareError> {
        let assets: Assets = self
            .json(
                self.client
                    .get(self.url(&format!("/api/projects/{id}/assets"))),
            )
            .await?;
        Ok(assets.assets.into_iter().map(|a| a.hash).collect())
    }

    /// Uploads the file at `abs` as an asset unless `stored` has it.
    /// The file is hashed again as it is read: None when it changed
    /// since `hash` was taken.
    async fn upload(
        &self,
        id: &str,
        abs: &Path,
        hash: &str,
        media_type: &str,
        stored: &HashSet<String>,
    ) -> Result<Option<()>, ShareError> {
        if stored.contains(hash) {
            return Ok(Some(()));
        }
        let path = abs.to_path_buf();
        let bytes = tauri::async_runtime::spawn_blocking(move || fs::read(path))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| format!("could not read {}: {e}", abs.display()))?;
        if cloud_compile::hash_bytes(&bytes) != hash {
            return Ok(None);
        }
        self.send(
            self.client
                .put(self.url(&format!("/api/projects/{id}/assets/{hash}")))
                .header(reqwest::header::CONTENT_TYPE, media_type)
                .body(bytes),
        )
        .await?;
        Ok(Some(()))
    }

    /// Uploads the project's assets the server does not have, so the
    /// document never names an asset readers can't fetch. `hashes` are
    /// the ones the webview's document refers to; only files of this
    /// folder with those hashes go up.
    pub async fn upload_assets(
        &self,
        id: &str,
        dir: &Path,
        hashes: &[String],
    ) -> Result<(), ShareError> {
        let id = checked_id(id)?;
        let wanted: HashSet<&str> = hashes.iter().map(String::as_str).collect();
        let stored = self.stored_assets(id).await?;
        let root = dir.to_path_buf();
        let files = tauri::async_runtime::spawn_blocking(move || cloud_compile::local_files(&root))
            .await
            .map_err(|e| e.to_string())??;
        let mut sent = HashSet::new();
        for local in files {
            let hash = local.file.hash.as_str();
            if !wanted.contains(hash) || !sent.insert(hash.to_string()) {
                continue;
            }
            let uploaded = self
                .upload(id, &local.abs, hash, media_type(&local.file.path), &stored)
                .await?;
            if uploaded.is_none() {
                return Err(format!(
                    "{} changed while it was uploaded. Publish again.",
                    local.file.path
                )
                .into());
            }
        }
        Ok(())
    }

    /// Fixes the server's document as the published version, with the
    /// PDF and SyncTeX of the last compile of `main` when build/ has them.
    pub async fn publish(
        &self,
        id: &str,
        dir: &Path,
        main: Option<&str>,
    ) -> Result<SnapshotInfo, ShareError> {
        let id = checked_id(id)?;
        let mut body = serde_json::Map::new();
        if let Some(main) = main {
            body.insert("main".into(), main.into());
            let pdf = dir.join("build").join(crate::pdf_output_path(main));
            let outputs = [
                ("pdf", pdf.clone(), "application/pdf"),
                (
                    "synctex",
                    pdf.with_extension("synctex.gz"),
                    "application/gzip",
                ),
            ];
            let mut stored = None;
            for (field, path, media_type) in outputs {
                let Ok(bytes) = fs::read(&path) else {
                    continue;
                };
                let hash = cloud_compile::hash_bytes(&bytes);
                if stored.is_none() {
                    stored = Some(self.stored_assets(id).await?);
                }
                if self
                    .upload(id, &path, &hash, media_type, stored.as_ref().unwrap())
                    .await?
                    .is_none()
                {
                    return Err("The PDF changed while it was uploaded. Publish again."
                        .to_string()
                        .into());
                }
                body.insert(field.into(), hash.into());
            }
        }
        self.json(
            self.client
                .post(self.url(&format!("/api/projects/{id}/snapshots")))
                .json(&body),
        )
        .await
    }

    pub async fn snapshots(&self, id: &str) -> Result<Vec<SnapshotInfo>, ShareError> {
        let id = checked_id(id)?;
        let snapshots: Snapshots = self
            .json(
                self.client
                    .get(self.url(&format!("/api/projects/{id}/snapshots"))),
            )
            .await?;
        Ok(snapshots.snapshots)
    }

    pub async fn links(&self, id: &str) -> Result<Vec<ReviewLink>, ShareError> {
        let id = checked_id(id)?;
        let links: Links = self
            .json(
                self.client
                    .get(self.url(&format!("/api/projects/{id}/links"))),
            )
            .await?;
        Ok(links.links)
    }

    pub async fn create_link(
        &self,
        id: &str,
        role: &str,
        expires_in_days: Option<u32>,
    ) -> Result<ReviewLink, ShareError> {
        let id = checked_id(id)?;
        if role != "commenter" && role != "viewer" {
            return Err(format!("unknown link role: {role}").into());
        }
        let mut body = serde_json::json!({ "role": role });
        if let Some(days) = expires_in_days {
            body["expiresInDays"] = days.into();
        }
        let link: ReviewLink = self
            .json(
                self.client
                    .post(self.url(&format!("/api/projects/{id}/links")))
                    .json(&body),
            )
            .await?;
        // The link must open on the account's server: never hand out another host.
        let Some(url) = link.url.as_deref() else {
            return Err("The server did not return the link.".to_string().into());
        };
        let server_origin = url::Url::parse(self.server)
            .map_err(|e| e.to_string())?
            .origin();
        let link_url = url::Url::parse(url).map_err(|_| format!("unexpected link: {url}"))?;
        if link_url.origin() != server_origin || !link_url.path().starts_with("/r/") {
            return Err(format!("unexpected link: {url}").into());
        }
        Ok(link)
    }

    pub async fn delete_link(&self, id: &str, link_id: &str) -> Result<(), ShareError> {
        let id = checked_id(id)?;
        let link_id = checked_id(link_id)?;
        self.send(
            self.client
                .delete(self.url(&format!("/api/projects/{id}/links/{link_id}"))),
        )
        .await
        .map(drop)
    }
}

pub fn decode_base64(value: &str) -> Result<Vec<u8>, ShareError> {
    base64::engine::general_purpose::STANDARD
        .decode(value)
        .map_err(|e| format!("invalid base64: {e}").into())
}

pub fn links_file(app_data: &Path) -> PathBuf {
    app_data.join("share-links.json")
}

// --- commands ------------------------------------------------------------------------

/// What the Share dialog shows before it asks the server anything.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareStatus {
    pub server: String,
    pub signed_in: bool,
    /// The server project this folder publishes to, if any.
    pub link: Option<ShareLink>,
}

struct Context {
    server: String,
    token: String,
    dir: PathBuf,
    links: PathBuf,
}

fn links_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?;
    Ok(links_file(&data))
}

fn context(app: &tauri::AppHandle, project_dir: &str) -> Result<Context, ShareError> {
    let dir = crate::canonical_project(project_dir)?;
    let server = crate::account::server_of(app)?;
    let token = crate::account::token_with(&server, &crate::account::STORE)
        .ok_or_else(ShareError::signed_out)?;
    Ok(Context {
        server,
        token,
        dir,
        links: links_path(app)?,
    })
}

impl Context {
    fn link(&self) -> Result<ShareLink, ShareError> {
        link_in(&self.links, &self.dir, &self.server).ok_or_else(|| {
            ShareError::new(ShareErrorKind::NotFound, "This project is not shared yet.")
        })
    }

    fn session(&self) -> Result<Session<'_>, ShareError> {
        Session::new(&self.server, &self.token)
    }

    /// Passes a call's result on; a token the server refuses is
    /// forgotten, and so is the link to a server copy that no longer exists.
    fn check<T>(&self, result: Result<T, ShareError>) -> Result<T, ShareError> {
        match &result {
            Err(e) if e.kind == ShareErrorKind::SignedOut => {
                crate::account::forget_rejected_with(
                    &self.server,
                    &self.token,
                    &crate::account::STORE,
                );
            }
            Err(e) if e.kind == ShareErrorKind::NotFound => {
                let _ = set_link_in(&self.links, &self.dir, None);
            }
            _ => {}
        }
        result
    }
}

#[tauri::command]
pub fn share_status(app: tauri::AppHandle, project_dir: String) -> Result<ShareStatus, String> {
    let dir = crate::canonical_project(&project_dir)?;
    let server = crate::account::server_of(&app)?;
    let signed_in = crate::account::token_with(&server, &crate::account::STORE).is_some();
    let link = link_in(&links_path(&app)?, &dir, &server);
    Ok(ShareStatus {
        server,
        signed_in,
        link,
    })
}

/// The folder as the document should hold it.
#[tauri::command]
pub async fn share_folder(project_dir: String) -> Result<Vec<FolderEntry>, ShareError> {
    let dir = crate::canonical_project(&project_dir)?;
    tauri::async_runtime::spawn_blocking(move || folder_entries(&dir))
        .await
        .map_err(|e| e.to_string())?
}

/// Creates the server project for this folder (Professional) and
/// remembers it; an existing link is returned as it is.
#[tauri::command]
pub async fn share_create(
    app: tauri::AppHandle,
    project_dir: String,
    name: String,
) -> Result<ShareLink, ShareError> {
    let cx = context(&app, &project_dir)?;
    if let Ok(link) = cx.link() {
        return Ok(link);
    }
    let project = cx.check(cx.session()?.create_project(&name).await)?;
    let link = ShareLink {
        server: cx.server.clone(),
        project_id: project.id,
        name: project.name,
    };
    set_link_in(&cx.links, &cx.dir, Some(link.clone()))?;
    Ok(link)
}

#[tauri::command]
pub async fn share_sync(
    app: tauri::AppHandle,
    project_dir: String,
    state_vector: String,
) -> Result<DocumentSync, ShareError> {
    let cx = context(&app, &project_dir)?;
    let id = cx.link()?.project_id;
    cx.check(cx.session()?.sync(&id, &state_vector).await)
}

#[tauri::command]
pub async fn share_upload_assets(
    app: tauri::AppHandle,
    project_dir: String,
    hashes: Vec<String>,
) -> Result<(), ShareError> {
    let cx = context(&app, &project_dir)?;
    let id = cx.link()?.project_id;
    let dir = cx.dir.clone();
    cx.check(cx.session()?.upload_assets(&id, &dir, &hashes).await)
}

/// Sends a Yjs update (base64) to the server's document.
#[tauri::command]
pub async fn share_push(
    app: tauri::AppHandle,
    project_dir: String,
    update: String,
) -> Result<(), ShareError> {
    let cx = context(&app, &project_dir)?;
    let id = cx.link()?.project_id;
    let bytes = decode_base64(&update)?;
    cx.check(cx.session()?.push(&id, bytes).await)
}

/// Publishes the server's document with the PDF of the last compile.
#[tauri::command]
pub async fn share_publish(
    app: tauri::AppHandle,
    project_dir: String,
    main: Option<String>,
) -> Result<SnapshotInfo, ShareError> {
    let cx = context(&app, &project_dir)?;
    let id = cx.link()?.project_id;
    let main = match main {
        Some(main) => {
            let main = main.replace('\\', "/");
            crate::validate_tex_arg(&project_dir, &main)?;
            Some(main)
        }
        None => None,
    };
    let dir = cx.dir.clone();
    cx.check(cx.session()?.publish(&id, &dir, main.as_deref()).await)
}

#[tauri::command]
pub async fn share_snapshots(
    app: tauri::AppHandle,
    project_dir: String,
) -> Result<Vec<SnapshotInfo>, ShareError> {
    let cx = context(&app, &project_dir)?;
    let id = cx.link()?.project_id;
    cx.check(cx.session()?.snapshots(&id).await)
}

#[tauri::command]
pub async fn share_links(
    app: tauri::AppHandle,
    project_dir: String,
) -> Result<Vec<ReviewLink>, ShareError> {
    let cx = context(&app, &project_dir)?;
    let id = cx.link()?.project_id;
    cx.check(cx.session()?.links(&id).await)
}

#[tauri::command]
pub async fn share_create_link(
    app: tauri::AppHandle,
    project_dir: String,
    role: String,
    expires_in_days: Option<u32>,
) -> Result<ReviewLink, ShareError> {
    let cx = context(&app, &project_dir)?;
    let id = cx.link()?.project_id;
    cx.check(cx.session()?.create_link(&id, &role, expires_in_days).await)
}

#[tauri::command]
pub async fn share_delete_link(
    app: tauri::AppHandle,
    project_dir: String,
    link_id: String,
) -> Result<(), ShareError> {
    let cx = context(&app, &project_dir)?;
    let id = cx.link()?.project_id;
    cx.check(cx.session()?.delete_link(&id, &link_id).await)
}

/// Deletes the server copy (document, assets, snapshots and review
/// links) and forgets the link. The folder is not touched.
#[tauri::command]
pub async fn share_stop(app: tauri::AppHandle, project_dir: String) -> Result<(), ShareError> {
    let cx = context(&app, &project_dir)?;
    let Ok(link) = cx.link() else {
        return Ok(());
    };
    let id = link.project_id;
    match cx.check(cx.session()?.delete_project(&id).await) {
        Ok(()) => set_link_in(&cx.links, &cx.dir, None).map_err(ShareError::from),
        // Already gone: run() has forgotten the link.
        Err(e) if e.kind == ShareErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[derive(Deserialize)]
    struct TextCase {
        path: String,
        #[serde(default)]
        utf8: Option<String>,
        #[serde(default)]
        hex: Option<String>,
        text: bool,
        #[serde(rename = "type")]
        media_type: String,
    }

    #[derive(Deserialize)]
    struct TextCases {
        cases: Vec<TextCase>,
    }

    fn hex(value: &str) -> Vec<u8> {
        let digits: Vec<char> = value.chars().filter(|c| !c.is_whitespace()).collect();
        digits
            .chunks(2)
            .map(|pair| u8::from_str_radix(&pair.iter().collect::<String>(), 16).unwrap())
            .collect()
    }

    #[test]
    fn classifies_files_like_project_doc() {
        let cases: TextCases =
            serde_json::from_str(include_str!("../../src/lib/project-text.cases.json")).unwrap();
        for case in cases.cases {
            let bytes = match (&case.utf8, &case.hex) {
                (Some(text), None) => text.as_bytes().to_vec(),
                (None, Some(h)) => hex(h),
                _ => panic!("{}: utf8 or hex", case.path),
            };
            let decoded = decode_text(&case.path, bytes.clone());
            assert_eq!(decoded.is_some(), case.text, "{}", case.path);
            if let Some(text) = decoded {
                assert_eq!(text.as_bytes(), bytes, "{} keeps its bytes", case.path);
            }
            assert_eq!(media_type(&case.path), case.media_type, "{}", case.path);
        }
        // A NUL past the first 8000 bytes does not make a file binary (git's test).
        let mut late = vec![b'a'; 8000];
        late.push(0);
        assert!(decode_text("long.txt", late).is_some());
        assert!(decode_text("early.txt", [vec![b'a'; 7999], vec![0]].concat()).is_none());
    }

    fn temp_project(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("polemic-share-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::canonicalize(&dir).unwrap()
    }

    fn write(dir: &Path, rel: &str, content: &[u8]) {
        let path = dir.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    #[test]
    fn reads_the_folder_as_texts_and_assets() {
        let dir = temp_project("folder");
        write(&dir, "main.tex", b"\\documentclass{article}");
        write(&dir, "fig/a.png", b"png-bytes");
        write(&dir, "data.bin", &[0, 1, 2]);
        write(&dir, "build/main.pdf", b"%PDF");
        write(&dir, ".git/config", b"[core]");
        write(&dir, ".gitignore", b"*.secret\n");
        write(&dir, "notes.secret", b"no");
        let entries = folder_entries(&dir).unwrap();
        assert_eq!(
            entries,
            vec![
                FolderEntry::Text {
                    path: ".gitignore".into(),
                    text: "*.secret\n".into()
                },
                FolderEntry::Asset {
                    path: "data.bin".into(),
                    hash: cloud_compile::hash_bytes(&[0, 1, 2]),
                    size: 3,
                    media_type: "application/octet-stream".into()
                },
                FolderEntry::Asset {
                    path: "fig/a.png".into(),
                    hash: cloud_compile::hash_bytes(b"png-bytes"),
                    size: 9,
                    media_type: "image/png".into()
                },
                FolderEntry::Text {
                    path: "main.tex".into(),
                    text: "\\documentclass{article}".into()
                },
            ]
        );
        let json = serde_json::to_value(&entries[1]).unwrap();
        assert_eq!(json["kind"], "asset");
        assert_eq!(json["type"], "application/octet-stream");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn keeps_links_per_folder_and_server() {
        let data = temp_project("links");
        let file = links_file(&data);
        let a = Path::new("/projects/a");
        let b = Path::new("/projects/b");
        assert_eq!(link_in(&file, a, "https://app.test"), None);
        let link = ShareLink {
            server: "https://app.test".into(),
            project_id: "p".repeat(22),
            name: "Thesis".into(),
        };
        set_link_in(&file, a, Some(link.clone())).unwrap();
        assert_eq!(link_in(&file, a, "https://app.test"), Some(link.clone()));
        assert_eq!(link_in(&file, b, "https://app.test"), None);
        // Signed in to another server: the link waits for this one.
        assert_eq!(link_in(&file, a, "https://other.test"), None);
        assert_eq!(link_in(&file, a, "https://app.test"), Some(link));
        set_link_in(&file, a, None).unwrap();
        assert_eq!(link_in(&file, a, "https://app.test"), None);
        fs::remove_dir_all(&data).unwrap();
    }

    #[test]
    fn maps_server_answers_to_errors() {
        use ShareErrorKind::*;
        let body = |error: &str, message: &str| ErrorBody {
            error: error.into(),
            message: message.into(),
        };
        assert_eq!(error_for(401, &ErrorBody::default()).kind, SignedOut);
        assert_eq!(
            error_for(402, &body("plan_required", "x")).kind,
            PlanRequired
        );
        assert_eq!(
            error_for(404, &body("not_found", "No such project")).kind,
            NotFound
        );
        assert_eq!(error_for(413, &body("quota_exceeded", "x")).kind, TooLarge);
        let large = error_for(
            413,
            &body("asset_too_large", "Assets can be at most 50 MiB"),
        );
        assert_eq!(
            (large.kind, large.message.as_str()),
            (TooLarge, "Assets can be at most 50 MiB")
        );
        assert_eq!(error_for(502, &ErrorBody::default()).kind, Unavailable);
        let forbidden = error_for(
            403,
            &body("forbidden", "Only the project's owner can do this"),
        );
        assert_eq!(
            (forbidden.kind, forbidden.message.as_str()),
            (Failed, "Only the project's owner can do this")
        );
    }

    #[test]
    fn puts_only_valid_ids_into_urls() {
        assert!(valid_id("AbCdEfGhIjKlMnOpQrSt-_"));
        assert!(!valid_id("../../api/me/xxxxxxxxxx"));
        assert!(!valid_id("short"));
        assert!(!valid_id("AbCdEfGhIjKlMnOpQrSt?x"));
    }

    // --- against a stub server ---

    struct Seen {
        method: String,
        path: String,
        authorization: Option<String>,
        content_type: Option<String>,
        body: Vec<u8>,
    }

    /// Serves one canned answer per request, in order.
    fn stub(answers: Vec<String>) -> (String, std::thread::JoinHandle<Vec<Seen>>) {
        stub_for(|_| answers)
    }

    /// Like `stub`, with answers that may name the stub's own URL.
    fn stub_for(
        answers: impl FnOnce(&str) -> Vec<String>,
    ) -> (String, std::thread::JoinHandle<Vec<Seen>>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let answers = answers(&base);
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
                let header = |wanted: &str| {
                    head.lines().find_map(|l| {
                        let (name, value) = l.split_once(':')?;
                        name.eq_ignore_ascii_case(wanted)
                            .then(|| value.trim().to_string())
                    })
                };
                seen.push(Seen {
                    method,
                    path,
                    authorization: header("authorization"),
                    content_type: header("content-type"),
                    body: buf[head_end..head_end + length].to_vec(),
                });
                stream.write_all(answer.as_bytes()).unwrap();
            }
            seen
        });
        (base, handle)
    }

    fn json(status: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    fn block<T>(f: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(f)
    }

    const ID: &str = "AbCdEfGhIjKlMnOpQrSt-_";

    #[test]
    fn uploads_only_missing_assets_the_document_names() {
        let dir = temp_project("upload");
        write(&dir, "main.tex", b"x");
        write(&dir, "fig/a.png", b"png-a");
        write(&dir, "fig/copy.png", b"png-a");
        write(&dir, "fig/b.png", b"png-b");
        write(&dir, "fig/c.png", b"png-c");
        let (a, b) = (
            cloud_compile::hash_bytes(b"png-a"),
            cloud_compile::hash_bytes(b"png-b"),
        );
        let (server, handle) = stub(vec![
            json(
                "200 OK",
                &format!(
                    r#"{{"assets":[{{"hash":"{b}","size":5,"contentType":"image/png","createdAt":"2026-10-30T00:00:00.000Z"}}]}}"#
                ),
            ),
            json("201 Created", "{}"),
        ]);
        let session = Session::new(&server, "tok").unwrap();
        // c is in the folder but not in the document; a twice in the folder goes once.
        block(session.upload_assets(ID, &dir, &[a.clone(), b, "f".repeat(64)])).unwrap();
        let seen = handle.join().unwrap();
        assert_eq!(seen.len(), 2);
        assert_eq!(
            (seen[0].method.as_str(), seen[0].path.as_str()),
            ("GET", format!("/api/projects/{ID}/assets").as_str())
        );
        assert_eq!(
            (seen[1].method.as_str(), seen[1].path.clone()),
            ("PUT", format!("/api/projects/{ID}/assets/{a}"))
        );
        assert_eq!(seen[1].body, b"png-a");
        assert_eq!(seen[1].content_type.as_deref(), Some("image/png"));
        assert!(seen
            .iter()
            .all(|s| s.authorization.as_deref() == Some("Bearer tok")));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn publishes_with_the_pdf_and_synctex_of_the_main_file() {
        let dir = temp_project("publish");
        write(&dir, "chapters/thesis.tex", b"x");
        write(&dir, "build/thesis.pdf", b"%PDF-1.7");
        write(&dir, "build/thesis.synctex.gz", b"gz");
        let (pdf, synctex) = (
            cloud_compile::hash_bytes(b"%PDF-1.7"),
            cloud_compile::hash_bytes(b"gz"),
        );
        let snapshot = format!(
            r#"{{"id":"s","main":"chapters/thesis.tex","pdf":"{pdf}","synctex":"{synctex}","size":12,"createdAt":"2026-10-30T00:00:00.000Z"}}"#
        );
        let (server, handle) = stub(vec![
            json(
                "200 OK",
                &format!(
                    r#"{{"assets":[{{"hash":"{synctex}","size":2,"contentType":"application/gzip","createdAt":"2026-10-30T00:00:00.000Z"}}]}}"#
                ),
            ),
            json("201 Created", "{}"),
            json("201 Created", &snapshot),
        ]);
        let session = Session::new(&server, "tok").unwrap();
        let published = block(session.publish(ID, &dir, Some("chapters/thesis.tex"))).unwrap();
        assert_eq!(published.pdf.as_deref(), Some(pdf.as_str()));
        let seen = handle.join().unwrap();
        let requests: Vec<(&str, &str)> = seen
            .iter()
            .map(|s| (s.method.as_str(), s.path.as_str()))
            .collect();
        assert_eq!(
            requests,
            [
                ("GET", format!("/api/projects/{ID}/assets").as_str()),
                ("PUT", format!("/api/projects/{ID}/assets/{pdf}").as_str()),
                ("POST", format!("/api/projects/{ID}/snapshots").as_str()),
            ]
        );
        assert_eq!(seen[1].content_type.as_deref(), Some("application/pdf"));
        let body: serde_json::Value = serde_json::from_slice(&seen[2].body).unwrap();
        assert_eq!(
            body,
            serde_json::json!({ "main": "chapters/thesis.tex", "pdf": pdf, "synctex": synctex })
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn publishes_without_a_pdf_when_nothing_was_compiled() {
        let dir = temp_project("nopdf");
        let (server, handle) = stub(vec![json(
            "201 Created",
            r#"{"id":"s","main":"main.tex","pdf":null,"synctex":null,"size":2,"createdAt":"2026-10-30T00:00:00.000Z"}"#,
        )]);
        let session = Session::new(&server, "tok").unwrap();
        block(session.publish(ID, &dir, Some("main.tex"))).unwrap();
        let seen = handle.join().unwrap();
        let body: serde_json::Value = serde_json::from_slice(&seen[0].body).unwrap();
        assert_eq!(body, serde_json::json!({ "main": "main.tex" }));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn hands_out_review_links_only_on_the_account_server() {
        let link = |url: &str| {
            json(
                "201 Created",
                &format!(
                    r#"{{"id":"{ID}","role":"commenter","expiresAt":null,"createdAt":"2026-10-30T00:00:00.000Z","url":"{url}"}}"#
                ),
            )
        };
        let (server, handle) = stub_for(|base| {
            vec![
                link("http://evil.test/r/abc"),
                link(&format!("{base}/api/me")),
                link(&format!("{base}/r/tok")),
            ]
        });
        let session = Session::new(&server, "tok").unwrap();
        assert!(block(session.create_link(ID, "commenter", None)).is_err());
        assert!(block(session.create_link(ID, "commenter", None)).is_err());
        let made = block(session.create_link(ID, "viewer", Some(7))).unwrap();
        assert_eq!(made.url, Some(format!("{server}/r/tok")));
        let seen = handle.join().unwrap();
        let body: serde_json::Value = serde_json::from_slice(&seen[2].body).unwrap();
        assert_eq!(
            body,
            serde_json::json!({ "role": "viewer", "expiresInDays": 7 })
        );
        // Roles a link never grants are refused before any request.
        assert!(block(session.create_link(ID, "editor", None)).is_err());
    }

    /// Against a running Polemic server: POLEMIC_E2E_SERVER, a desktop
    /// token in POLEMIC_E2E_TOKEN, and a Yjs update in POLEMIC_E2E_UPDATE
    /// (base64) that names fig/a.png's asset. Keeps the project when
    /// POLEMIC_E2E_KEEP is set and prints its id.
    #[test]
    #[ignore]
    fn e2e_publish_against_a_server() {
        let server = std::env::var("POLEMIC_E2E_SERVER").expect("POLEMIC_E2E_SERVER");
        let token = std::env::var("POLEMIC_E2E_TOKEN").expect("POLEMIC_E2E_TOKEN");
        let update = decode_base64(&std::env::var("POLEMIC_E2E_UPDATE").expect("POLEMIC_E2E_UPDATE")).unwrap();
        let dir = temp_project("e2e");
        write(&dir, "main.tex", b"\\documentclass{article}");
        write(&dir, "fig/a.png", b"png-bytes");
        write(&dir, "build/main.pdf", b"%PDF-1.7 e2e");
        let png = cloud_compile::hash_bytes(b"png-bytes");
        let session = Session::new(&server, &token).unwrap();

        let project = block(session.create_project("E2E")).unwrap();
        let first = block(session.sync(&project.id, "AA==")).unwrap();
        assert_eq!(decode_base64(&first.update).unwrap(), [0, 0], "a new project's document is empty");
        block(session.upload_assets(&project.id, &dir, &[png.clone()])).unwrap();
        // The second upload finds the asset stored and sends nothing.
        block(session.upload_assets(&project.id, &dir, &[png])).unwrap();
        block(session.push(&project.id, update)).unwrap();
        let after = block(session.sync(&project.id, "AA==")).unwrap();
        assert!(decode_base64(&after.update).unwrap().len() > 2);

        let snapshot = block(session.publish(&project.id, &dir, Some("main.tex"))).unwrap();
        assert_eq!(snapshot.pdf, Some(cloud_compile::hash_bytes(b"%PDF-1.7 e2e")));
        assert_eq!(snapshot.synctex, None);
        assert_eq!(block(session.snapshots(&project.id)).unwrap()[0].id, snapshot.id);

        let made = block(session.create_link(&project.id, "commenter", Some(7))).unwrap();
        let url = made.url.clone().unwrap();
        let review_token = url.rsplit('/').next().unwrap().to_string();
        let review: serde_json::Value = block(async {
            client()
                .unwrap()
                .get(format!("{server}/api/review/{review_token}"))
                .send()
                .await
                .unwrap()
                .json()
                .await
                .unwrap()
        });
        assert_eq!(review["snapshot"]["id"], snapshot.id.as_str());
        assert_eq!(block(session.links(&project.id)).unwrap().len(), 1);
        block(session.delete_link(&project.id, &made.id)).unwrap();
        assert!(block(session.links(&project.id)).unwrap().is_empty());

        if std::env::var("POLEMIC_E2E_KEEP").is_ok() {
            println!("E2E_PROJECT={}", project.id);
        } else {
            block(session.delete_project(&project.id)).unwrap();
            let gone = block(session.sync(&project.id, "AA==")).unwrap_err();
            assert_eq!(gone.kind, ShareErrorKind::NotFound);
        }
        let bad = Session::new(&server, "not-a-token").unwrap();
        assert_eq!(block(bad.snapshots(&project.id)).unwrap_err().kind, ShareErrorKind::SignedOut);
        fs::remove_dir_all(&dir).unwrap();
    }
}
