//! Linked projects (phase 5b): a shared folder syncs both ways with its
//! server copy, so the same project opens in the desktop app and in the
//! browser.
//!
//! The merging runs in the webview (`src/lib/link-sync.ts`), as the
//! publish does; this side keeps the webview's copy of the Yjs document
//! between runs, writes the server's changes into the folder and fetches
//! the assets they name. The copy lives in the app data folder, next to
//! the share links, never in the project, so drives and git never carry
//! it. With it goes the list of files a sync was writing when it
//! stopped, so the next run finishes them first.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::share::{self, ShareError, ShareErrorKind, ShareLink};

/// The webview's copy of a linked project's document.
#[derive(Serialize, Deserialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalState {
    /// The Yjs document as one update, base64; None before the first sync.
    pub state: Option<String>,
    /// Project paths a sync was writing; the next run writes them again.
    #[serde(default)]
    pub pending: Vec<String>,
}

/// An empty Y.Doc as an update: a project opened from the account
/// starts from nothing, so every server file is written into the folder.
pub const EMPTY_DOC: &str = "AAA=";

/// Where the copy of `link`'s document is kept: next to the links file,
/// one file per server and project.
fn state_path(links_file: &Path, link: &ShareLink) -> PathBuf {
    let server = crate::cloud_compile::hash_bytes(link.server.as_bytes());
    links_file
        .with_file_name("linked")
        .join(format!("{}-{}.json", &server[..12], link.project_id))
}

pub fn read_state(links_file: &Path, link: &ShareLink) -> LocalState {
    fs::read(state_path(links_file, link))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub fn write_state(links_file: &Path, link: &ShareLink, state: &LocalState) -> Result<(), String> {
    let path = state_path(links_file, link);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    let json = serde_json::to_vec(state).map_err(|e| e.to_string())?;
    crate::files::write_atomic(&path, &json)
        .map_err(|e| format!("could not save the project's sync state: {e}"))
}

/// Drops the copy, once the link is gone.
pub fn forget_state(links_file: &Path, link: &ShareLink) {
    let _ = fs::remove_file(state_path(links_file, link));
}

/// Writes `text` unless the file changed: `expected` is what the sync
/// last saw there (None: no file). Returns false, writing nothing, when
/// the file holds something else, so a save that just happened is never
/// overwritten; the webview then merges the two.
pub fn write_text_if(target: &Path, text: &str, expected: Option<&str>) -> Result<bool, String> {
    let current = match fs::read(target) {
        Ok(bytes) => Some(bytes),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("could not read {}: {e}", target.display())),
    };
    let unchanged = match (&current, expected) {
        (None, None) => true,
        (Some(bytes), Some(expected)) => bytes == expected.as_bytes(),
        // Already what the server has: nothing to do.
        (Some(bytes), None) => return Ok(bytes == text.as_bytes()),
        (None, Some(_)) => false,
    };
    if !unchanged {
        return Ok(false);
    }
    if current.as_deref() == Some(text.as_bytes()) {
        return Ok(true);
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create folder: {e}"))?;
    }
    crate::files::write_atomic(target, text.as_bytes())
        .map_err(|e| format!("failed to write {}: {e}", target.display()))?;
    Ok(true)
}

/// A name for a project opened from the account: `name`, else `name 2`,
/// `name 3`, … whichever is free in `root`.
pub fn free_folder(root: &Path, name: &str) -> PathBuf {
    let base: String = name
        .trim()
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .collect();
    let base = base.trim_start_matches('.').trim();
    let base = if base.is_empty() { "Untitled" } else { base };
    let mut dir = root.join(base);
    let mut n = 2;
    while dir.exists() {
        dir = root.join(format!("{base} {n}"));
        n += 1;
    }
    dir
}

// --- commands ------------------------------------------------------------------------

/// The webview's copy of the project's document, and the files the last
/// sync left unwritten.
#[tauri::command]
pub fn link_load(app: tauri::AppHandle, project_dir: String) -> Result<LocalState, ShareError> {
    let cx = share::context(&app, &project_dir)?;
    let link = cx.link()?;
    Ok(read_state(&cx.links, &link))
}

#[tauri::command]
pub fn link_save(
    app: tauri::AppHandle,
    project_dir: String,
    state: String,
    pending: Vec<String>,
) -> Result<(), ShareError> {
    let cx = share::context(&app, &project_dir)?;
    let link = cx.link()?;
    share::decode_base64(&state)?;
    write_state(
        &cx.links,
        &link,
        &LocalState {
            state: Some(state),
            pending,
        },
    )
    .map_err(ShareError::from)
}

/// Turns a link that publishes one way into a two-way one: the server
/// lets the browser edit the project from then on.
#[tauri::command]
pub async fn link_enable(
    app: tauri::AppHandle,
    project_dir: String,
) -> Result<ShareLink, ShareError> {
    let cx = share::context(&app, &project_dir)?;
    let mut link = cx.link()?;
    if link.two_way {
        return Ok(link);
    }
    cx.check(cx.session()?.link_project(&link.project_id).await)?;
    link.two_way = true;
    share::set_link_in(&cx.links, &cx.dir, Some(link.clone()))?;
    Ok(link)
}

/// Writes a text file from the server unless it changed since the sync
/// read it (see `write_text_if`); false when it did.
#[tauri::command]
pub fn link_write_text(
    project_dir: String,
    path: String,
    text: String,
    expected: Option<String>,
) -> Result<bool, String> {
    let target = crate::project_file(&project_dir, &path)?;
    write_text_if(&target, &text, expected.as_deref())
}

/// Fetches an asset from the server copy into the folder.
#[tauri::command]
pub async fn link_write_asset(
    app: tauri::AppHandle,
    project_dir: String,
    path: String,
    hash: String,
) -> Result<(), ShareError> {
    let cx = share::context(&app, &project_dir)?;
    let target = crate::project_file(&project_dir, &path)?;
    let id = cx.link()?.project_id;
    let bytes = cx.check(cx.session()?.fetch_asset(&id, &hash).await)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create folder: {e}"))?;
    }
    crate::files::write_atomic(&target, &bytes)
        .map_err(|e| ShareError::from(format!("failed to write {path}: {e}")))
}

/// Moves a file the server moved. A file already at the target is
/// replaced, as the server's copy says.
#[tauri::command]
pub fn link_move(project_dir: String, from: String, to: String) -> Result<(), String> {
    let source = crate::project_file(&project_dir, &from)?;
    let target = crate::project_file(&project_dir, &to)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create folder: {e}"))?;
    }
    fs::rename(&source, &target).map_err(|e| format!("failed to move {from}: {e}"))
}

/// Moves a file the server deleted to the trash, so nothing is lost
/// for good.
#[tauri::command]
pub fn link_remove(project_dir: String, path: String) -> Result<(), String> {
    let target = crate::project_file(&project_dir, &path)?;
    if fs::symlink_metadata(&target).is_err() {
        return Ok(());
    }
    trash::delete(&target).map_err(|e| format!("failed to move {path} to trash: {e}"))
}

/// The projects on the account, for opening one in the desktop app.
#[tauri::command]
pub async fn link_account_projects(
    app: tauri::AppHandle,
) -> Result<Vec<share::ProjectInfo>, ShareError> {
    let server = crate::account::server_of(&app)?;
    let token = crate::account::token_with(&server, &crate::account::STORE)
        .ok_or_else(ShareError::signed_out)?;
    let result = share::Session::new(&server, &token)?.projects().await;
    if matches!(&result, Err(e) if e.kind == ShareErrorKind::SignedOut) {
        crate::account::forget_rejected_with(&server, &token, &crate::account::STORE);
    }
    result
}

/// Makes a new folder in the projects folder for a project on the
/// account and links it; the first sync fills it. A folder already
/// linked to that project opens instead.
#[tauri::command]
pub async fn link_open_account_project(
    app: tauri::AppHandle,
    project_id: String,
    name: String,
) -> Result<crate::ProjectInfo, ShareError> {
    let server = crate::account::server_of(&app)?;
    if crate::account::token_with(&server, &crate::account::STORE).is_none() {
        return Err(ShareError::signed_out());
    }
    let links = share::links_path(&app)?;
    if let Some(dir) = share::folder_linked_to(&links, &server, &project_id) {
        if dir.is_dir() {
            return crate::admit_project(&app, &dir).map_err(ShareError::from);
        }
    }
    let root = crate::settings::effective(&app)?
        .projects_root
        .expect("projects root is set by effective()");
    fs::create_dir_all(&root).map_err(|e| format!("failed to create projects root: {e}"))?;
    let dir = free_folder(Path::new(&root), &name);
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create project: {e}"))?;
    let dir = fs::canonicalize(&dir).map_err(|e| format!("failed to create project: {e}"))?;
    let link = ShareLink {
        server,
        project_id,
        name,
        seen_comments: Default::default(),
        two_way: true,
    };
    write_state(
        &links,
        &link,
        &LocalState {
            state: Some(EMPTY_DOC.into()),
            pending: vec![],
        },
    )?;
    share::set_link_in(&links, &dir, Some(link))?;
    crate::admit_project(&app, &dir).map_err(ShareError::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("polemic-link-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writes_only_over_what_the_sync_saw() {
        let dir = temp("write");
        let file = dir.join("sections/intro.tex");
        // A new file.
        assert!(write_text_if(&file, "one", None).unwrap());
        assert_eq!(fs::read_to_string(&file).unwrap(), "one");
        // Changed since: refused.
        assert!(!write_text_if(&file, "two", Some("zero")).unwrap());
        assert_eq!(fs::read_to_string(&file).unwrap(), "one");
        assert!(write_text_if(&file, "two", Some("one")).unwrap());
        assert_eq!(fs::read_to_string(&file).unwrap(), "two");
        // A "new" file that is there already: fine only with the same text.
        assert!(write_text_if(&file, "two", None).unwrap());
        assert!(!write_text_if(&file, "three", None).unwrap());
        // Deleted here meanwhile: refused.
        fs::remove_file(&file).unwrap();
        assert!(!write_text_if(&file, "four", Some("two")).unwrap());
        assert!(!file.exists());
    }

    #[test]
    fn keeps_state_per_server_and_project() {
        let dir = temp("state");
        let links = dir.join("share-links.json");
        let link = |server: &str| ShareLink {
            server: server.into(),
            project_id: "AAAAAAAAAAAAAAAAAAAAAA".into(),
            name: "Paper".into(),
            seen_comments: Default::default(),
            two_way: true,
        };
        assert_eq!(
            read_state(&links, &link("https://a.test")),
            LocalState::default()
        );
        let state = LocalState {
            state: Some(EMPTY_DOC.into()),
            pending: vec!["main.tex".into()],
        };
        write_state(&links, &link("https://a.test"), &state).unwrap();
        assert_eq!(read_state(&links, &link("https://a.test")), state);
        assert_eq!(
            read_state(&links, &link("https://b.test")),
            LocalState::default()
        );
        forget_state(&links, &link("https://a.test"));
        assert_eq!(
            read_state(&links, &link("https://a.test")),
            LocalState::default()
        );
    }

    #[test]
    fn picks_a_free_folder_name() {
        let dir = temp("names");
        assert_eq!(free_folder(&dir, "Thesis"), dir.join("Thesis"));
        fs::create_dir_all(dir.join("Thesis")).unwrap();
        fs::create_dir_all(dir.join("Thesis 2")).unwrap();
        assert_eq!(free_folder(&dir, "Thesis"), dir.join("Thesis 3"));
        assert_eq!(free_folder(&dir, "a/b:c"), dir.join("a-b-c"));
        assert_eq!(free_folder(&dir, "  ..  "), dir.join("Untitled"));
    }
}
