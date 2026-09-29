use serde::{Deserialize, Serialize};
use std::fs;

/// A local comment attached to a file, a line, or a text selection.
/// Stored in the project's `.polemic/comments.json`.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub file: String,
    pub category: String,
    pub text: String,
    pub created_at: u64,
    pub resolved: bool,
    /// null: a whole-file comment. Otherwise the anchored text and the
    /// line number at creation time (a hint; the text is the truth).
    pub anchor: Option<CommentAnchor>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommentAnchor {
    pub text: String,
    pub line: u32,
}

fn comments_file(project_dir: &std::path::Path) -> std::path::PathBuf {
    project_dir.join(".polemic").join("comments.json")
}

pub fn list(project_dir: &std::path::Path) -> Vec<Comment> {
    fs::read_to_string(comments_file(project_dir))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(project_dir: &std::path::Path, comments: &[Comment]) -> Result<(), String> {
    let dir = project_dir.join(".polemic");
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create .polemic: {e}"))?;
    let json = serde_json::to_string_pretty(comments).map_err(|e| e.to_string())?;
    fs::write(comments_file(project_dir), json)
        .map_err(|e| format!("failed to write comments: {e}"))
}
