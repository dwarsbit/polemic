//! The global library: a user-level folder (default
//! `~/Documents/Polemic Library`) holding the sources and assets that
//! outlive any single project. Commands mirror the project-scoped
//! ones but resolve inside the library root.

use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use tauri::AppHandle;

use crate::files::{self, FileEntry};
use crate::settings;

/// The library root as a concrete path, created when missing.
fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = settings::effective(app)?
        .library_root
        .unwrap_or_default();
    if root.is_empty() {
        return Err("no library root configured".into());
    }
    fs::create_dir_all(&root)
        .map_err(|e| format!("failed to create library folder: {e}"))?;
    Ok(PathBuf::from(root))
}

/// Resolve a relative path inside the library root, rejecting
/// absolute paths and parent traversal.
fn resolve(app: &AppHandle, rel_path: &str) -> Result<PathBuf, String> {
    let root = root(app)?;
    files::resolve_in_project(&root.to_string_lossy(), rel_path)
}

#[derive(Serialize)]
pub struct LibraryInfo {
    pub path: String,
}

#[tauri::command]
pub fn get_library_root(app: AppHandle) -> Result<LibraryInfo, String> {
    Ok(LibraryInfo {
        path: root(&app)?.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn set_library_root(app: AppHandle, path: String) -> Result<(), String> {
    settings::update(&app, |s| -> String {
        s.library_root = Some(path);
        s.library_root.clone().unwrap_or_default()
    })
    .map(|_| ())
}

#[tauri::command]
pub fn list_library_files(app: AppHandle) -> Result<Vec<FileEntry>, String> {
    let root = root(&app)?;
    Ok(files::list_tree(&root, ""))
}

#[tauri::command]
pub fn read_library_file(app: AppHandle, path: String) -> Result<String, String> {
    let path = resolve(&app, &path)?;
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_library_file(
    app: AppHandle,
    path: String,
    content: String,
) -> Result<(), String> {
    let path = resolve(&app, &path)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create folder: {e}"))?;
    }
    fs::write(path, content).map_err(|e| e.to_string())
}

/// Copy a file from anywhere on disk into the library root, picking a
/// non-colliding name (refs.bib → refs-2.bib). Returns the
/// library-relative destination path.
#[tauri::command]
pub fn import_library_file(app: AppHandle, source: String) -> Result<String, String> {
    let src = std::path::PathBuf::from(&source);
    if !src.is_file() {
        return Err("not a readable file".into());
    }
    let file_name = src
        .file_name()
        .ok_or("the path has no file name")?
        .to_string_lossy()
        .to_string();
    let (stem, ext) = match file_name.rsplit_once('.') {
        Some((stem, ext)) => (stem.to_string(), format!(".{ext}")),
        None => (file_name.clone(), String::new()),
    };
    let root = root(&app)?;
    let mut dest_rel = file_name.clone();
    let mut counter = 1;
    while root.join(&dest_rel).exists() {
        counter += 1;
        dest_rel = format!("{stem}-{counter}{ext}");
    }
    fs::copy(&src, root.join(&dest_rel)).map_err(|e| e.to_string())?;
    Ok(dest_rel)
}
