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
    let target = base.join(rel_path);
    // Symlinks inside the project must not lead out of it: resolve the
    // deepest part of the path that exists (the target itself, or the
    // folder a new file will land in) and require it inside the project.
    let mut existing = target.as_path();
    while fs::symlink_metadata(existing).is_err() {
        existing = existing.parent().ok_or("path has no existing parent")?;
    }
    let real = fs::canonicalize(existing)
        .map_err(|e| format!("path not accessible: {e}"))?;
    if !real.starts_with(&base) {
        return Err("path leads outside the project folder".into());
    }
    Ok(target)
}

/// Replace a file's content atomically: write a sibling temp file, then
/// rename it over the target, so a crash mid-write never leaves a
/// truncated file behind.
pub fn write_atomic(path: &Path, content: &[u8]) -> std::io::Result<()> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let tmp = path.with_file_name(format!(".{name}.tmp-{}", std::process::id()));
    fs::write(&tmp, content)?;
    fs::rename(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
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

// ---------------------------------------------------------------------------
// External files (bib sources)

/// Read an arbitrary user-chosen file — the read-only side of bib
/// sources, which reference .bib files anywhere on the filesystem.
#[tauri::command]
pub fn read_external_file(path: String) -> Result<String, String> {
    let resolved = std::fs::canonicalize(&path)
        .map_err(|e| format!("file not accessible: {e}"))?;
    if !resolved.is_file() {
        return Err("not a file".into());
    }
    fs::read_to_string(&resolved).map_err(|e| format!("failed to read file: {e}"))
}

/// Every .bib file under a folder (recursively), or the file itself
/// when `path` is one. Dot-directories are skipped, like the project
/// tree.
#[tauri::command]
pub fn list_bib_files(path: String) -> Result<Vec<String>, String> {
    let resolved =
        std::fs::canonicalize(&path).map_err(|e| format!("path not accessible: {e}"))?;
    if resolved.is_file() {
        return Ok(vec![resolved.to_string_lossy().to_string()]);
    }
    if !resolved.is_dir() {
        return Err("not a file or folder".into());
    }
    let mut out = Vec::new();
    collect_bib(&resolved, &mut out);
    out.sort();
    Ok(out)
}

fn collect_bib(dir: &Path, out: &mut Vec<String>) {
    let Ok(read) = fs::read_dir(dir) else {
        return;
    };
    for entry in read.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            collect_bib(&entry.path(), out);
        } else if name.to_lowercase().ends_with(".bib") {
            out.push(entry.path().to_string_lossy().to_string());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_project(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("polemic-files-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("chapters")).unwrap();
        fs::write(dir.join("main.tex"), "x").unwrap();
        dir
    }

    #[test]
    fn resolves_paths_inside_the_project() {
        let dir = temp_project("inside");
        let base = fs::canonicalize(&dir).unwrap();
        let p = dir.to_string_lossy().to_string();
        assert_eq!(resolve_in_project(&p, "main.tex").unwrap(), base.join("main.tex"));
        // New files in new folders resolve against their existing ancestor.
        assert!(resolve_in_project(&p, "chapters/new/intro.tex").is_ok());
        assert!(resolve_in_project(&p, "../escape.tex").is_err());
        assert!(resolve_in_project(&p, "/etc/passwd").is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_that_leave_the_project() {
        let dir = temp_project("symlink");
        let outside = std::env::temp_dir().join(format!("polemic-outside-{}", std::process::id()));
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.txt"), "s").unwrap();
        std::os::unix::fs::symlink(outside.join("secret.txt"), dir.join("notes.tex")).unwrap();
        std::os::unix::fs::symlink(&outside, dir.join("linked")).unwrap();
        std::os::unix::fs::symlink(dir.join("main.tex"), dir.join("alias.tex")).unwrap();
        let p = dir.to_string_lossy().to_string();
        assert!(resolve_in_project(&p, "notes.tex").is_err());
        assert!(resolve_in_project(&p, "linked/secret.txt").is_err());
        assert!(resolve_in_project(&p, "linked/new.tex").is_err());
        assert!(resolve_in_project(&p, "alias.tex").is_ok());
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn writes_atomically() {
        let dir = temp_project("atomic");
        let file = dir.join("settings.json");
        write_atomic(&file, b"one").unwrap();
        write_atomic(&file, b"two").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "two");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 3);
        let _ = fs::remove_dir_all(&dir);
    }
}
