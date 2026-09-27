use serde::Serialize;
use std::fs;
use std::path::Path;
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
