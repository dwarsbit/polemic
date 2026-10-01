use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    /// File size in bytes (files only). */
    pub size: Option<u64>,
    /// Last modified, unix seconds (files only). */
    pub modified: Option<u64>,
    pub children: Vec<FileEntry>,
}

/// Directories that are generated or internal and never shown in the tree.
const SKIP_DIRS: [&str; 4] = ["build", ".snapshots", ".git", "node_modules"];

/// Resolve a user-supplied relative path inside a project, rejecting absolute
/// paths and parent traversal so the editor cannot escape the project folder.
pub fn resolve_in_project(project_dir: &str, rel_path: &str) -> Result<PathBuf, String> {
    if rel_path.is_empty() {
        return Err("empty path".into());
    }
    if Path::new(rel_path).is_absolute() {
        return Err("absolute paths are not allowed".into());
    }
    if Path::new(rel_path)
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("path traversal is not allowed".into());
    }
    let base = fs::canonicalize(project_dir)
        .map_err(|e| format!("project directory not accessible: {e}"))?;
    Ok(base.join(rel_path))
}

pub fn list_tree(dir: &Path, rel_prefix: &str) -> Vec<FileEntry> {
    let Ok(read) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut entries: Vec<FileEntry> = read
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
                return None;
            }
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let path = if rel_prefix.is_empty() {
                name.clone()
            } else {
                format!("{rel_prefix}/{name}")
            };
            let children = if is_dir {
                list_tree(&entry.path(), &path)
            } else {
                Vec::new()
            };
            let (size, modified) = if is_dir {
                (None, None)
            } else {
                let metadata = entry.metadata().ok();
                let modified = metadata
                    .as_ref()
                    .and_then(|m| m.modified().ok())
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|duration| duration.as_secs());
                (metadata.map(|m| m.len()), modified)
            };
            Some(FileEntry {
                name,
                path,
                is_dir,
                size,
                modified,
                children,
            })
        })
        .collect();
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });
    entries
}
