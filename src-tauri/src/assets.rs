use std::collections::HashMap;
use std::fs;
use std::path::Path;

/// Asset tags, stored in the project's `.polemic/assets.json`
/// (project-relative path -> tags). Mirrors the comments file.
fn meta_file(project_dir: &Path) -> std::path::PathBuf {
    project_dir.join(".polemic").join("assets.json")
}

pub fn list(project_dir: &Path) -> HashMap<String, Vec<String>> {
    fs::read_to_string(meta_file(project_dir))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(
    project_dir: &Path,
    tags: &HashMap<String, Vec<String>>,
) -> Result<(), String> {
    let file = meta_file(project_dir);
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create .polemic folder: {e}"))?;
    }
    let json = serde_json::to_string_pretty(tags).map_err(|e| e.to_string())?;
    fs::write(&file, json).map_err(|e| format!("failed to write asset tags: {e}"))
}
