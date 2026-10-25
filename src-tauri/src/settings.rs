use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
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
    /// Opt-in: DOI/arXiv import may contact doi.org. Off unless true.
    pub online_lookup: Option<bool>,
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
    let mut settings: Settings = fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    let plaintext = crate::secrets::has_plaintext(&settings);
    crate::secrets::inject(&mut settings, &crate::secrets::VAULT.load());
    // Keys from before the credential store: move them out of the file.
    if plaintext {
        let _ = save(app, &settings);
    }
    settings
}

pub fn save(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    let disk = crate::secrets::VAULT.persist(settings);
    let json = serde_json::to_string_pretty(&disk).map_err(|e| e.to_string())?;
    crate::files::write_atomic(&path, json.as_bytes())
        .map_err(|e| format!("failed to write settings: {e}"))?;
    // The file may hold API keys (no credential store): keep it
    // readable by the user only.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
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

/// Bib source paths enter only through the native picker
/// (`pick_bib_source`): a sources update from the webview may reorder,
/// rename, toggle, or drop bib sources, but never add a path.
pub fn check_bib_paths(old: &[SourceDef], new: &[SourceDef]) -> Result<(), String> {
    let known: Vec<&str> = old
        .iter()
        .filter(|s| s.kind == "bib")
        .filter_map(|s| s.path.as_deref())
        .collect();
    for source in new.iter().filter(|s| s.kind == "bib") {
        if let Some(path) = source.path.as_deref() {
            if !known.contains(&path) {
                return Err("bib sources are added through the file picker".into());
            }
        }
    }
    Ok(())
}

/// Whether a canonical path is a configured bib source or lies inside
/// a bib source folder.
pub fn bib_source_covers(sources: &[SourceDef], path: &Path) -> bool {
    sources
        .iter()
        .filter(|s| s.kind == "bib")
        .filter_map(|s| s.path.as_deref())
        .filter_map(|p| fs::canonicalize(p).ok())
        .any(|root| root == path || (root.is_dir() && path.starts_with(&root)))
}

/// A fresh source id (the webview mints UUIDs for the other kinds).
pub fn new_source_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("bib-{nanos:x}-{:x}", COUNTER.fetch_add(1, Ordering::Relaxed))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bib(id: &str, path: &str) -> SourceDef {
        SourceDef {
            id: id.into(),
            kind: "bib".into(),
            enabled: true,
            name: None,
            path: Some(path.into()),
            user_id: None,
            api_key: None,
        }
    }

    #[test]
    fn sources_updates_cannot_add_bib_paths() {
        let old = vec![bib("a", "/refs/a.bib"), bib("b", "/refs/folder")];
        // Toggle, rename, reorder, remove: fine.
        let mut edited = vec![bib("b", "/refs/folder")];
        edited[0].enabled = false;
        edited[0].name = Some("Folder".into());
        assert!(check_bib_paths(&old, &edited).is_ok());
        // A new path, or a changed one: refused.
        assert!(check_bib_paths(&old, &[bib("c", "/etc")]).is_err());
        assert!(check_bib_paths(&old, &[bib("a", "/home/me/.ssh/id_rsa")]).is_err());
    }

    #[test]
    fn covers_only_configured_files_and_folders() {
        let dir = std::env::temp_dir().join(format!("polemic-bibsrc-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("folder/sub")).unwrap();
        fs::write(dir.join("one.bib"), "").unwrap();
        fs::write(dir.join("other.bib"), "").unwrap();
        fs::write(dir.join("folder/sub/deep.bib"), "").unwrap();
        let base = fs::canonicalize(&dir).unwrap();
        let sources = vec![
            bib("a", &dir.join("one.bib").to_string_lossy()),
            bib("b", &dir.join("folder").to_string_lossy()),
        ];
        assert!(bib_source_covers(&sources, &base.join("one.bib")));
        assert!(bib_source_covers(&sources, &base.join("folder/sub/deep.bib")));
        assert!(!bib_source_covers(&sources, &base.join("other.bib")));
        assert!(!bib_source_covers(&sources, &base));
        let _ = fs::remove_dir_all(&dir);
    }
}
