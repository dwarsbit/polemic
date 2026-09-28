use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInfo {
    pub id: String,
    pub created_at_millis: u64,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("failed to create {}: {e}", dst.display()))?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let target = dst.join(entry.file_name());
        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Copy the project (excluding build/ and .snapshots/) into .snapshots/snap-<millis>/.
pub fn create(dir: &Path) -> Result<SnapshotInfo, String> {
    let millis = now_millis();
    let id = format!("snap-{millis}");
    let snapshot = dir.join(".snapshots").join(&id);
    fs::create_dir_all(&snapshot)
        .map_err(|e| format!("failed to create snapshot dir: {e}"))?;
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "build" || name == ".snapshots" {
            continue;
        }
        let target = snapshot.join(&name);
        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target).map_err(|e| e.to_string())?;
        }
    }
    Ok(SnapshotInfo {
        id,
        created_at_millis: millis,
    })
}

pub fn list(dir: &Path) -> Vec<SnapshotInfo> {
    let mut out = Vec::new();
    let Ok(read) = fs::read_dir(dir.join(".snapshots")) else {
        return out;
    };
    for entry in read.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().to_string();
        if let Some(millis) = name
            .strip_prefix("snap-")
            .and_then(|m| m.parse::<u64>().ok())
        {
            out.push(SnapshotInfo {
                id: name,
                created_at_millis: millis,
            });
        }
    }
    out.sort_by(|a, b| b.created_at_millis.cmp(&a.created_at_millis));
    out
}

/// Restore a snapshot. A safety snapshot of the current state is taken first.
pub fn restore(dir: &Path, id: &str) -> Result<(), String> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("invalid snapshot id".into());
    }
    let snapshot = dir.join(".snapshots").join(id);
    if !snapshot.is_dir() {
        return Err(format!("snapshot {id} does not exist"));
    }
    create(dir)?;
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "build" || name == ".snapshots" {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            fs::remove_dir_all(&path)
                .map_err(|e| format!("failed to remove {}: {e}", path.display()))?;
        } else {
            fs::remove_file(&path)
                .map_err(|e| format!("failed to remove {}: {e}", path.display()))?;
        }
    }
    copy_dir_recursive(&snapshot, dir)
}

// --- snapshot diff ----------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotChange {
    pub path: String,
    /// "added" (only in project), "removed" (only in snapshot), "modified".
    pub status: String,
    pub added_lines: usize,
    pub removed_lines: usize,
}

fn collect_files(dir: &Path, skip_top_level: &[&str], out: &mut BTreeMap<String, PathBuf>) {
    let Ok(read) = fs::read_dir(dir) else {
        return;
    };
    for entry in read.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(file_type) = entry.file_type() else { continue };
        if file_type.is_dir() {
            // Only the project root has build/ and .snapshots/ excluded,
            // mirroring what `create` copies into a snapshot.
            if skip_top_level.is_empty() || !skip_top_level.contains(&name.as_str()) {
                collect_files(&entry.path(), &[], out);
            }
        } else {
            let Ok(rel) = entry.path().strip_prefix(dir).map(Path::to_path_buf) else {
                continue;
            };
            out.insert(rel.to_string_lossy().to_string(), entry.path());
        }
    }
}

fn line_counts(old: &str, new: &str) -> (usize, usize) {
    use similar::{ChangeTag, TextDiff};
    let diff = TextDiff::from_lines(old, new);
    let mut added = 0;
    let mut removed = 0;
    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Insert => added += 1,
            ChangeTag::Delete => removed += 1,
            ChangeTag::Equal => {}
        }
    }
    (added, removed)
}

/// Compare a snapshot against the current project and list every changed file.
pub fn list_changes(dir: &Path, id: &str) -> Result<Vec<SnapshotChange>, String> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("invalid snapshot id".into());
    }
    let snapshot = dir.join(".snapshots").join(id);
    if !snapshot.is_dir() {
        return Err(format!("snapshot {id} does not exist"));
    }

    let mut old_files = BTreeMap::new();
    collect_files(&snapshot, &[], &mut old_files);
    let mut new_files = BTreeMap::new();
    collect_files(dir, &["build", ".snapshots"], &mut new_files);

    let mut changes = Vec::new();
    for (path, old_path) in &old_files {
        let new_path = new_files.get(path);
        let Some(new_path) = new_path else {
            // Only in the snapshot: the project no longer has the file.
            let removed = fs::read_to_string(old_path)
                .map(|c| c.lines().count())
                .unwrap_or(0);
            changes.push(SnapshotChange {
                path: path.clone(),
                status: "removed".into(),
                added_lines: 0,
                removed_lines: removed,
            });
            continue;
        };
        let Ok(old_bytes) = fs::read(old_path) else {
            changes.push(SnapshotChange {
                path: path.clone(),
                status: "modified".into(),
                added_lines: 0,
                removed_lines: 0,
            });
            continue;
        };
        let Ok(new_bytes) = fs::read(new_path) else {
            changes.push(SnapshotChange {
                path: path.clone(),
                status: "modified".into(),
                added_lines: 0,
                removed_lines: 0,
            });
            continue;
        };
        if old_bytes == new_bytes {
            continue;
        }
        let (added, removed) = line_counts(
            &String::from_utf8_lossy(&old_bytes),
            &String::from_utf8_lossy(&new_bytes),
        );
        changes.push(SnapshotChange {
            path: path.clone(),
            status: "modified".into(),
            added_lines: added,
            removed_lines: removed,
        });
    }
    for (path, new_path) in &new_files {
        if old_files.contains_key(path) {
            continue;
        }
        // Only in the project: the snapshot predates the file.
        let added = fs::read_to_string(new_path)
            .map(|c| c.lines().count())
            .unwrap_or(0);
        changes.push(SnapshotChange {
            path: path.clone(),
            status: "added".into(),
            added_lines: added,
            removed_lines: 0,
        });
    }
    changes.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(changes)
}

/// Validate a project-relative path used for snapshot file access.
fn safe_snapshot_rel_path(path: &str) -> Result<&str, String> {
    if path.is_empty()
        || path.starts_with('/')
        || path.starts_with('\\')
        || std::path::Path::new(path)
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("invalid path".into());
    }
    Ok(path)
}

/// Read one file from a snapshot.
pub fn read_file(dir: &Path, id: &str, path: &str) -> Result<String, String> {
    let path = safe_snapshot_rel_path(path)?;
    let snapshot = dir.join(".snapshots").join(id);
    let file = snapshot.join(path);
    fs::read_to_string(&file).map_err(|e| format!("failed to read {}: {e}", path))
}

/// Make the snapshot's version of one file win in the project.
/// Files that the snapshot does not have are deleted instead.
pub fn restore_file(dir: &Path, id: &str, path: &str) -> Result<(), String> {
    let path = safe_snapshot_rel_path(path)?;
    let snapshot = dir.join(".snapshots").join(id);
    if !snapshot.is_dir() {
        return Err(format!("snapshot {id} does not exist"));
    }
    let source = snapshot.join(path);
    let target = dir.join(path);
    if source.is_file() {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
        }
        fs::copy(&source, &target)
            .map_err(|e| format!("failed to restore {}: {e}", path))?;
    } else if target.is_file() {
        fs::remove_file(&target).map_err(|e| format!("failed to remove {}: {e}", path))?;
    } else {
        return Err(format!("snapshot has no file {path}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(dir: &Path, rel: &str, content: &str) {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    #[test]
    fn lists_changes_between_snapshot_and_project() {
        let dir = std::env::temp_dir().join(format!("polemic-snapdiff-{}", now_millis()));
        fs::create_dir_all(&dir).unwrap();
        write(&dir, "main.tex", "one\ntwo\n");
        write(&dir, "old.tex", "keep\n");
        write(&dir, "build/output.pdf", "binary\n");

        let info = create(&dir).unwrap();

        write(&dir, "main.tex", "one\nTWO\n");
        write(&dir, "new.tex", "fresh\n");
        fs::remove_file(dir.join("old.tex")).unwrap();

        let mut changes = list_changes(&dir, &info.id).unwrap();
        changes.sort_by(|a, b| a.path.cmp(&b.path));
        let by_path: std::collections::HashMap<_, _> = changes
            .iter()
            .map(|c| (c.path.as_str(), (c.status.as_str(), c.added_lines, c.removed_lines)))
            .collect();

        assert_eq!(by_path.len(), 3);
        assert_eq!(by_path["main.tex"], ("modified", 1, 1));
        assert_eq!(by_path["new.tex"], ("added", 1, 0));
        assert_eq!(by_path["old.tex"], ("removed", 0, 1));

        let content = read_file(&dir, &info.id, "old.tex").unwrap();
        assert_eq!(content, "keep\n");

        restore_file(&dir, &info.id, "old.tex").unwrap();
        assert!(dir.join("old.tex").is_file());
        // A file that only exists in the project is deleted by restore_file.
        restore_file(&dir, &info.id, "new.tex").unwrap();
        assert!(!dir.join("new.tex").exists());

        fs::remove_dir_all(&dir).unwrap();
    }
}
