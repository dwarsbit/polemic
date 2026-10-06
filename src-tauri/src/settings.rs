use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub name: String,
    pub path: String,
}

/// One reference source: where "Add from Sources…" searches. Bib
/// sources point at a .bib file or folder anywhere on the filesystem,
/// referenced in place; the Zotero kinds carry their connection
/// details.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SourceDef {
    pub id: String,
    /// "bib", "zotero-app", or "zotero-cloud".
    pub kind: String,
    pub enabled: bool,
    pub name: Option<String>,
    /// Absolute path of a .bib file or of a folder with .bib files.
    /// Bib sources only.
    pub path: Option<String>,
    /// Zotero cloud credentials; "zotero-cloud" sources only.
    pub user_id: Option<String>,
    pub api_key: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    /// Base URL of an OpenAI-compatible chat-completions API,
    /// e.g. https://api.mistral.ai/v1.
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub projects_root: Option<String>,
    /// The user's reference sources: .bib files/folders anywhere on
    /// the filesystem plus Zotero connections.
    pub sources: Vec<SourceDef>,
    pub recent_projects: Vec<RecentProject>,
    pub main_files: HashMap<String, String>,
    pub open_files: HashMap<String, Vec<String>>,
    pub pinned_projects: Vec<String>,
    pub last_project_path: Option<String>,
    pub theme: Option<String>,
    pub auto_compile: Option<bool>,
    pub font_size: Option<u32>,
    pub editor_font: Option<String>,
    pub syntax_theme: Option<String>,
    pub panel_layout: Option<HashMap<String, f64>>,
    pub preview_zoom: Option<f64>,
    pub spellcheck: Option<bool>,
    pub spellcheck_language: Option<String>,
    pub supsub_braces: Option<bool>,
    pub convert_double_dollar: Option<bool>,
    pub format_on_save: Option<bool>,
    pub math_preview_engine: Option<String>,
    /// Text cursor style: "line" or "block".
    pub caret_style: Option<String>,
    /// Text cursor color: "primary" (theme) or "custom".
    pub caret_color: Option<String>,
    /// Hex color used when caret_color is "custom".
    pub caret_custom_color: Option<String>,
    pub reopen_last_project: Option<bool>,
    pub auto_include_new_files: Option<bool>,
    /// "git" or "snapshots"; None means auto (git when installed).
    pub version_control: Option<String>,
    /// Editor face for .tex files: "visual" or "code".
    pub tex_editor_mode: Option<String>,
    /// Editor face for .bib files: "visual" or "code".
    pub bib_editor_mode: Option<String>,
    /// The AI quickfix provider, configured in settings.
    pub ai: Option<AiSettings>,
    pub user_words: Vec<String>,
}

/// Managed state holding the in-memory settings.
pub struct SettingsState(pub Mutex<Settings>);

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no app config dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create config dir: {e}"))?;
    Ok(dir.join("settings.json"))
}

fn default_projects_root() -> String {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".into());
    PathBuf::from(home)
        .join("Documents")
        .join("Polemic")
        .to_string_lossy()
        .to_string()
}

pub fn load(app: &AppHandle) -> Settings {
    let path = match settings_path(app) {
        Ok(path) => path,
        Err(_) => return Settings::default(),
    };
    fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| format!("failed to write settings: {e}"))
}

/// Mutate the managed settings and persist them.
pub fn update<T>(app: &AppHandle, f: impl FnOnce(&mut Settings) -> T) -> Result<T, String> {
    let state = app.state::<SettingsState>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let out = f(&mut guard);
    save(app, &guard)?;
    Ok(out)
}

/// The settings with a guaranteed concrete projects root.
pub fn effective(app: &AppHandle) -> Result<Settings, String> {
    update(app, |s| {
        if s.projects_root.is_none() {
            s.projects_root = Some(default_projects_root());
        }
        s.clone()
    })
}

pub fn upsert_recent(settings: &mut Settings, name: &str, path: &str) {
    settings.recent_projects.retain(|r| r.path != path);
    settings
        .recent_projects
        .insert(0, RecentProject {
            name: name.to_string(),
            path: path.to_string(),
        });
    settings.recent_projects.truncate(20);
}
