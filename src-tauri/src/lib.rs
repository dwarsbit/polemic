mod files;
mod git;
mod logparse;
mod settings;
mod snapshots;
mod spell;
mod templates;

use serde::Serialize;
use std::fs;
use std::process::Command;

use tauri::Manager;
use files::FileEntry;
use settings::{Settings, SettingsState};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TexStatus {
    pub pdflatex: ToolInfo,
    pub latexmk: ToolInfo,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub found: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileOutcome {
    pub success: bool,
    pub issues: Vec<logparse::CompileIssue>,
    pub log: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SynctexForward {
    pub page: u32,
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SynctexBackward {
    pub file: String,
    pub line: u32,
}


fn probe(tool: &str) -> ToolInfo {
    match Command::new(tool).arg("--version").output() {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let version = stdout.lines().next().map(str::to_string);
            let path = locate(tool);
            ToolInfo {
                found: true,
                version,
                path,
            }
        }
        _ => ToolInfo {
            found: false,
            version: None,
            path: None,
        },
    }
}

fn locate(tool: &str) -> Option<String> {
    #[cfg(unix)]
    let output = Command::new("which").arg(tool).output();
    #[cfg(windows)]
    let output = Command::new("where").arg(tool).output();
    output
        .ok()
        .filter(|out| out.status.success())
        .and_then(|out| String::from_utf8_lossy(&out.stdout).lines().next().map(str::to_string))
}

fn validate_project_name(name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("project name is empty".into());
    }
    if name.starts_with('.') || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("invalid project name".into());
    }
    Ok(())
}

fn project_info(dir: &std::path::Path) -> ProjectInfo {
    ProjectInfo {
        name: dir
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "project".into()),
        path: dir.to_string_lossy().to_string(),
    }
}

/// build/<stem>.pdf from e.g. chapters/intro.tex
fn pdf_output_path(main_tex: &str) -> std::path::PathBuf {
    let stem = std::path::Path::new(main_tex)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "main".into());
    std::path::PathBuf::from(format!("{stem}.pdf"))
}

fn canonical_project(project_dir: &str) -> Result<std::path::PathBuf, String> {
    fs::canonicalize(project_dir)
        .map_err(|e| format!("project directory not accessible: {e}"))
}

// --- TeX detection ---------------------------------------------------------

#[tauri::command]
fn detect_tex() -> TexStatus {
    TexStatus {
        pdflatex: probe("pdflatex"),
        latexmk: probe("latexmk"),
    }
}

// --- settings / projects ---------------------------------------------------

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    settings::effective(&app)
}

#[tauri::command]
fn set_projects_root(app: tauri::AppHandle, path: String) -> Result<Settings, String> {
    settings::update(&app, |s| {
        s.projects_root = Some(path);
        s.clone()
    })
}

#[tauri::command]
fn create_project(
    app: tauri::AppHandle,
    name: String,
    template_id: String,
) -> Result<ProjectInfo, String> {
    validate_project_name(&name)?;
    let template = templates::find(&template_id)
        .ok_or_else(|| format!("unknown template: {template_id}"))?;
    let name = name.trim().to_string();
    let cfg = settings::effective(&app)?;
    let root = cfg.projects_root.expect("projects root is set by effective()");
    fs::create_dir_all(&root).map_err(|e| format!("failed to create projects root: {e}"))?;
    let dir = std::path::Path::new(&root).join(&name);
    if dir.exists() {
        return Err(format!("a project named \"{name}\" already exists"));
    }
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create project: {e}"))?;
    for (path, content) in template.files {
        let target = dir.join(path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create folder: {e}"))?;
        }
        fs::write(&target, content)
            .map_err(|e| format!("failed to write template file {path}: {e}"))?;
    }
    let info = project_info(&dir);
    settings::update(&app, |s| {
        settings::upsert_recent(s, &info.name, &info.path);
    })?;
    Ok(info)
}

#[tauri::command]
fn list_templates() -> Vec<templates::TemplateInfo> {
    templates::infos()
}

#[tauri::command]
fn open_project(app: tauri::AppHandle, path: String) -> Result<ProjectInfo, String> {
    let dir = fs::canonicalize(&path).map_err(|e| format!("cannot open project folder: {e}"))?;
    if !dir.is_dir() {
        return Err("project path is not a directory".into());
    }
    let info = project_info(&dir);
    settings::update(&app, |s| {
        settings::upsert_recent(s, &info.name, &info.path);
        s.last_project_path = Some(info.path.clone());
    })?;
    Ok(info)
}

#[tauri::command]
fn remove_recent_project(app: tauri::AppHandle, path: String) -> Result<Settings, String> {
    settings::update(&app, |s| {
        s.recent_projects.retain(|r| r.path != path);
        s.clone()
    })
}

#[tauri::command]
fn update_preferences(
    app: tauri::AppHandle,
    theme: Option<String>,
    auto_compile: Option<bool>,
    font_size: Option<u32>,
    spellcheck: Option<bool>,
    supsub_braces: Option<bool>,
    convert_double_dollar: Option<bool>,
    reopen_last_project: Option<bool>,
) -> Result<Settings, String> {
    settings::update(&app, |s| {
        if theme.is_some() {
            s.theme = theme;
        }
        if auto_compile.is_some() {
            s.auto_compile = auto_compile;
        }
        if font_size.is_some() {
            s.font_size = font_size;
        }
        if spellcheck.is_some() {
            s.spellcheck = spellcheck;
        }
        if supsub_braces.is_some() {
            s.supsub_braces = supsub_braces;
        }
        if convert_double_dollar.is_some() {
            s.convert_double_dollar = convert_double_dollar;
        }
        if reopen_last_project.is_some() {
            s.reopen_last_project = reopen_last_project;
        }
        s.clone()
    })
}

#[tauri::command]
fn set_version_control(app: tauri::AppHandle, value: String) -> Result<settings::Settings, String> {
    if value != "git" && value != "snapshots" {
        return Err("invalid version control setting".into());
    }
    settings::update(&app, |s| {
        s.version_control = Some(value.clone());
        s.clone()
    })
}

#[tauri::command]
fn git_available() -> bool {
    git::available()
}

// --- spellcheck ------------------------------------------------------------

#[tauri::command]
fn check_words(
    state: tauri::State<'_, std::sync::Mutex<spell::SpellState>>,
    words: Vec<String>,
) -> Result<Vec<bool>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    Ok(state.check(&words))
}

#[tauri::command]
fn add_spellcheck_word(
    app: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Mutex<spell::SpellState>>,
    word: String,
) -> Result<(), String> {
    let word = word.trim().to_lowercase();
    if word.is_empty() {
        return Err("empty word".into());
    }
    state.lock().map_err(|e| e.to_string())?.add(&word);
    settings::update(&app, |s| {
        if !s.user_words.contains(&word) {
            s.user_words.push(word.clone());
        }
    })
}

// --- spellcheck languages --------------------------------------------------

/// Wordlists that can be downloaded on demand (hermitdave/FrequencyWords, MIT).
const DOWNLOADABLE_LANGUAGES: [&str; 5] = ["de", "fr", "es", "it", "nl"];

fn spelling_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("spelling");
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create spelling dir: {e}"))?;
    Ok(dir)
}

fn load_language_wordlist(
    app: &tauri::AppHandle,
    lang: &str,
    user_words: &[String],
) -> Result<spell::SpellState, String> {
    if lang == "en" {
        return Ok(spell::SpellState::new(user_words));
    }
    let file = spelling_dir(app)?.join(format!("{lang}.txt"));
    let content = fs::read_to_string(&file)
        .map_err(|e| format!("dictionary for \"{lang}\" is not downloaded: {e}"))?;
    Ok(spell::SpellState::from_words(
        spell::parse_frequency_list(&content),
        user_words,
    ))
}

#[tauri::command]
fn list_spellcheck_languages(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let mut languages = vec!["en".to_string()];
    if let Ok(dir) = spelling_dir(&app) {
        if let Ok(read) = fs::read_dir(&dir) {
            for entry in read.filter_map(Result::ok) {
                let name = entry.file_name().to_string_lossy().to_string();
                if let Some(lang) = name.strip_suffix(".txt") {
                    if DOWNLOADABLE_LANGUAGES.contains(&lang) && !languages.iter().any(|l| l == lang) {
                        languages.push(lang.to_string());
                    }
                }
            }
        }
    }
    Ok(languages)
}

/// Store a wordlist downloaded by the frontend and switch the spellcheck to it.
#[tauri::command]
fn install_spellcheck_language(
    app: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Mutex<spell::SpellState>>,
    lang: String,
    content: String,
) -> Result<(), String> {
    if !DOWNLOADABLE_LANGUAGES.contains(&lang.as_str()) {
        return Err(format!("unsupported language: {lang}"));
    }
    let file = spelling_dir(&app)?.join(format!("{lang}.txt"));
    fs::write(&file, content).map_err(|e| format!("failed to store dictionary: {e}"))?;
    set_spellcheck_language_inner(&app, &state, &lang)?;
    settings::update(&app, |s| {
        s.spellcheck_language = Some(lang.clone());
    })
}

#[tauri::command]
fn set_spellcheck_language(
    app: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Mutex<spell::SpellState>>,
    lang: String,
) -> Result<(), String> {
    if lang != "en" && !DOWNLOADABLE_LANGUAGES.contains(&lang.as_str()) {
        return Err(format!("unsupported language: {lang}"));
    }
    set_spellcheck_language_inner(&app, &state, &lang)?;
    settings::update(&app, |s| {
        s.spellcheck_language = Some(lang.clone());
    })
}

fn set_spellcheck_language_inner(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, std::sync::Mutex<spell::SpellState>>,
    lang: &str,
) -> Result<(), String> {
    let user_words = app
        .state::<SettingsState>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .user_words
        .clone();
    let new_state = load_language_wordlist(app, lang, &user_words)?;
    *state.lock().map_err(|e| e.to_string())? = new_state;
    Ok(())
}

#[tauri::command]
fn set_pinned_project(app: tauri::AppHandle, path: String, pinned: bool) -> Result<Settings, String> {
    settings::update(&app, |s| {
        s.pinned_projects.retain(|p| p != &path);
        if pinned {
            s.pinned_projects.insert(0, path);
        }
        s.clone()
    })
}

#[tauri::command]
fn set_panel_layout(
    app: tauri::AppHandle,
    layout: std::collections::HashMap<String, f64>,
) -> Result<(), String> {
    settings::update(&app, |s| {
        s.panel_layout = Some(layout);
    })
}

#[tauri::command]
fn set_preview_zoom(app: tauri::AppHandle, zoom: f64) -> Result<(), String> {
    settings::update(&app, |s| {
        s.preview_zoom = Some(zoom);
    })
}

#[tauri::command]
fn rename_project(
    app: tauri::AppHandle,
    path: String,
    new_name: String,
) -> Result<ProjectInfo, String> {
    validate_project_name(&new_name)?;
    let dir = canonical_project(&path)?;
    let parent = dir
        .parent()
        .ok_or("project has no parent folder")?
        .to_path_buf();
    let new_dir = parent.join(new_name.trim());
    if new_dir.exists() {
        return Err(format!("\"{}\" already exists", new_name.trim()));
    }
    fs::rename(&dir, &new_dir).map_err(|e| format!("failed to rename project: {e}"))?;
    let old_path = dir.to_string_lossy().to_string();
    let new_path = new_dir.to_string_lossy().to_string();
    settings::update(&app, |s| {
        if let Some(v) = s.main_files.remove(&old_path) {
            s.main_files.insert(new_path.clone(), v);
        }
        if let Some(v) = s.open_files.remove(&old_path) {
            s.open_files.insert(new_path.clone(), v);
        }
        for recent in s.recent_projects.iter_mut() {
            if recent.path == old_path {
                recent.path = new_path.clone();
                recent.name = new_name.trim().to_string();
            }
        }
        for pinned in s.pinned_projects.iter_mut() {
            if *pinned == old_path {
                *pinned = new_path.clone();
            }
        }
        if s.last_project_path.as_deref() == Some(old_path.as_str()) {
            s.last_project_path = Some(new_path.clone());
        }
    })?;
    Ok(project_info(&new_dir))
}

/// Move a project folder to the OS trash.
#[tauri::command]
fn delete_project(app: tauri::AppHandle, path: String) -> Result<Settings, String> {
    let dir = canonical_project(&path)?;
    trash::delete(&dir).map_err(|e| format!("failed to move project to trash: {e}"))?;
    let old_path = dir.to_string_lossy().to_string();
    settings::update(&app, |s| {
        s.recent_projects.retain(|r| r.path != old_path);
        s.pinned_projects.retain(|p| *p != old_path);
        s.main_files.remove(&old_path);
        s.open_files.remove(&old_path);
        if s.last_project_path.as_deref() == Some(old_path.as_str()) {
            s.last_project_path = None;
        }
        s.clone()
    })
}

// --- project files ---------------------------------------------------------

#[tauri::command]
fn list_files(project_dir: String) -> Result<Vec<FileEntry>, String> {
    let dir = canonical_project(&project_dir)?;
    Ok(files::list_tree(&dir, ""))
}

#[tauri::command]
fn read_project_file(project_dir: String, path: String) -> Result<String, String> {
    let target = files::resolve_in_project(&project_dir, &path)?;
    fs::read_to_string(&target).map_err(|e| format!("failed to read {path}: {e}"))
}

#[tauri::command]
fn write_project_file(project_dir: String, path: String, content: String) -> Result<(), String> {
    let target = files::resolve_in_project(&project_dir, &path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create folder: {e}"))?;
    }
    fs::write(&target, content).map_err(|e| format!("failed to write {path}: {e}"))
}

#[tauri::command]
fn create_project_entry(project_dir: String, path: String, is_dir: bool) -> Result<(), String> {
    let target = files::resolve_in_project(&project_dir, &path)?;
    if target.exists() {
        return Err(format!("{path} already exists"));
    }
    if is_dir {
        fs::create_dir_all(&target).map_err(|e| format!("failed to create folder: {e}"))
    } else {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("failed to create folder: {e}"))?;
        }
        fs::write(&target, "").map_err(|e| format!("failed to create file: {e}"))
    }
}

#[tauri::command]
fn rename_entry(project_dir: String, path: String, new_path: String) -> Result<(), String> {
    let from = files::resolve_in_project(&project_dir, &path)?;
    let to = files::resolve_in_project(&project_dir, &new_path)?;
    if to.exists() {
        return Err(format!("{new_path} already exists"));
    }
    fs::rename(&from, &to).map_err(|e| format!("failed to rename: {e}"))
}

#[tauri::command]
fn delete_entry(project_dir: String, path: String) -> Result<(), String> {
    let target = files::resolve_in_project(&project_dir, &path)?;
    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| format!("failed to delete folder: {e}"))
    } else {
        fs::remove_file(&target).map_err(|e| format!("failed to delete file: {e}"))
    }
}

#[tauri::command]
fn set_main_file(
    app: tauri::AppHandle,
    project_dir: String,
    main_file: String,
) -> Result<(), String> {
    let dir = canonical_project(&project_dir)?;
    settings::update(&app, |s| {
        s.main_files
            .insert(dir.to_string_lossy().to_string(), main_file);
    })
}

#[tauri::command]
fn set_open_files(
    app: tauri::AppHandle,
    project_dir: String,
    files: Vec<String>,
) -> Result<(), String> {
    let dir = canonical_project(&project_dir)?;
    settings::update(&app, |s| {
        s.open_files
            .insert(dir.to_string_lossy().to_string(), files);
    })
}

// --- compilation ----------------------------------------------------------

#[tauri::command]
async fn compile_project(
    project_dir: String,
    main_tex: String,
) -> Result<CompileOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = canonical_project(&project_dir)?;
        let output = Command::new("latexmk")
            .args([
                "-pdf",
                "-interaction=nonstopmode",
                "-file-line-error",
                "-synctex=1",
                "-outdir=build",
            ])
            .arg(&main_tex)
            .current_dir(&dir)
            .output()
            .map_err(|e| {
                format!("failed to run latexmk: {e}\n\nIs a TeX distribution (TeX Live, MacTeX, or MiKTeX) installed and on your PATH?")
            })?;
        let success = output.status.success();
        let mut log = String::from_utf8_lossy(&output.stdout).to_string();
        log.push_str(&String::from_utf8_lossy(&output.stderr));
        let issues = fs::read_to_string(dir.join("build").join(pdf_output_path(&main_tex).with_extension("log")))
            .map(|text| logparse::parse_issues(&text))
            .unwrap_or_default();
        Ok(CompileOutcome {
            success,
            issues,
            log,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Read the freshly compiled PDF as raw bytes.
#[tauri::command]
fn get_pdf(project_dir: String, main_tex: String) -> Result<tauri::ipc::Response, String> {
    let dir = canonical_project(&project_dir)?;
    let pdf_path = dir.join("build").join(pdf_output_path(&main_tex));
    let pdf = fs::read(&pdf_path)
        .map_err(|e| format!("no PDF found at {}: {e}", pdf_path.display()))?;
    Ok(tauri::ipc::Response::new(pdf))
}

/// Copy the built PDF to a location chosen by the user.
#[tauri::command]
fn export_pdf(project_dir: String, main_tex: String, dest_path: String) -> Result<(), String> {
    let dir = canonical_project(&project_dir)?;
    let pdf_path = dir.join("build").join(pdf_output_path(&main_tex));
    fs::copy(&pdf_path, std::path::Path::new(&dest_path))
        .map(|_| ())
        .map_err(|e| {
        format!(
            "failed to copy PDF to {}: {e}",
            std::path::Path::new(&dest_path).display()
        )
    })
}

/// Open the built PDF in the system viewer.
#[tauri::command]
fn open_pdf(app: tauri::AppHandle, project_dir: String, main_tex: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = canonical_project(&project_dir)?;
    let pdf_path = dir.join("build").join(pdf_output_path(&main_tex));
    if !pdf_path.is_file() {
        return Err("no compiled PDF yet".into());
    }
    app.opener()
        .open_path(pdf_path.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("failed to open PDF: {e}"))
}

// --- synctex navigation ----------------------------------------------------

#[tauri::command]
fn synctex_forward(
    project_dir: String,
    main_tex: String,
    line: u32,
    col: u32,
) -> Result<SynctexForward, String> {
    let dir = canonical_project(&project_dir)?;
    let output = Command::new("synctex")
        .arg("view")
        .arg("-i")
        .arg(format!("{line}:{col}:{main_tex}"))
        .arg("-o")
        .arg(format!("build/{}", pdf_output_path(&main_tex).display()))
        .current_dir(&dir)
        .output()
        .map_err(|e| {
            format!("failed to run synctex: {e}\n\nsynctex ships with TeX Live and MacTeX; check that it is on your PATH.")
        })?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut page: Option<u32> = None;
    let mut x: Option<f64> = None;
    let mut y: Option<f64> = None;
    for line in text.lines() {
        let line = line.trim();
        if let (None, Some(value)) = (page.clone(), line.strip_prefix("Page:")) {
            page = value.trim().parse().ok();
        } else if let (None, Some(value)) = (x, line.strip_prefix("x:")) {
            x = value.trim().parse().ok();
        } else if let (None, Some(value)) = (y, line.strip_prefix("y:")) {
            y = value.trim().parse().ok();
        }
        if page.is_some() && x.is_some() && y.is_some() {
            break;
        }
    }
    match (page, x, y) {
        (Some(page), Some(x), Some(y)) => Ok(SynctexForward { page, x, y }),
        _ => Err("synctex returned no usable result".into()),
    }
}

#[tauri::command]
fn synctex_backward(
    project_dir: String,
    main_tex: String,
    page: u32,
    x: f64,
    y: f64,
) -> Result<SynctexBackward, String> {
    let dir = canonical_project(&project_dir)?;
    let output = Command::new("synctex")
        .arg("edit")
        .arg("-o")
        .arg(format!("{page}:{x}:{y}:build/{}", pdf_output_path(&main_tex).display()))
        .current_dir(&dir)
        .output()
        .map_err(|e| format!("failed to run synctex: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut file: Option<String> = None;
    let mut line: Option<u32> = None;
    for raw in text.lines() {
        let line_text = raw.trim();
        if let Some(value) = line_text.strip_prefix("Input:") {
            if file.is_none() {
                file = Some(value.trim().to_string());
            }
        } else if let Some(value) = line_text.strip_prefix("Line:") {
            if line.is_none() {
                line = value.trim().parse().ok();
            }
        }
    }
    let file = file.ok_or("synctex returned no file")?;
    let line = line.ok_or("synctex returned no line")?;
    // synctex reports absolute paths that may contain "/./"; normalize to
    // a project-relative path.
    let rel = fs::canonicalize(&file)
        .ok()
        .and_then(|canon| canon.strip_prefix(&dir).ok().map(|p| p.to_string_lossy().to_string()))
        .or_else(|| {
            let prefix = format!("{}/./", dir.to_string_lossy());
            file.strip_prefix(&prefix).map(|p| p.to_string())
        })
        .unwrap_or(file);
    Ok(SynctexBackward { file: rel, line })
}

// --- snapshots -------------------------------------------------------------

#[tauri::command]
fn create_snapshot(project_dir: String) -> Result<snapshots::SnapshotInfo, String> {
    let dir = canonical_project(&project_dir)?;
    snapshots::create(&dir)
}

#[tauri::command]
fn list_snapshots(project_dir: String) -> Result<Vec<snapshots::SnapshotInfo>, String> {
    let dir = canonical_project(&project_dir)?;
    Ok(snapshots::list(&dir))
}

#[tauri::command]
fn restore_snapshot(project_dir: String, id: String) -> Result<(), String> {
    let dir = canonical_project(&project_dir)?;
    snapshots::restore(&dir, &id)
}

#[tauri::command]
fn list_snapshot_changes(
    project_dir: String,
    id: String,
) -> Result<Vec<snapshots::SnapshotChange>, String> {
    let dir = canonical_project(&project_dir)?;
    snapshots::list_changes(&dir, &id)
}

#[tauri::command]
fn read_snapshot_file(project_dir: String, id: String, path: String) -> Result<String, String> {
    let dir = canonical_project(&project_dir)?;
    snapshots::read_file(&dir, &id, &path)
}

#[tauri::command]
fn restore_snapshot_file(
    project_dir: String,
    id: String,
    path: String,
) -> Result<(), String> {
    let dir = canonical_project(&project_dir)?;
    snapshots::restore_file(&dir, &id, &path)
}

// --- git --------------------------------------------------------------------

#[tauri::command]
fn git_status(project_dir: String) -> Result<git::GitStatusInfo, String> {
    let dir = canonical_project(&project_dir)?;
    Ok(git::status(&dir))
}

#[tauri::command]
fn git_init(project_dir: String) -> Result<(), String> {
    let dir = canonical_project(&project_dir)?;
    git::init(&dir)
}

#[tauri::command]
fn git_stage(project_dir: String, paths: Vec<String>) -> Result<(), String> {
    let dir = canonical_project(&project_dir)?;
    git::stage(&dir, &paths)
}

#[tauri::command]
fn git_unstage(project_dir: String, paths: Vec<String>) -> Result<(), String> {
    let dir = canonical_project(&project_dir)?;
    git::unstage(&dir, &paths)
}

#[tauri::command]
fn git_commit(project_dir: String, message: String) -> Result<git::GitCommitInfo, String> {
    let dir = canonical_project(&project_dir)?;
    git::commit(&dir, &message)
}

#[tauri::command]
fn git_log(project_dir: String, limit: u32) -> Result<Vec<git::GitCommitInfo>, String> {
    let dir = canonical_project(&project_dir)?;
    git::log(&dir, limit)
}

#[tauri::command]
fn git_show_head(project_dir: String, path: String) -> Result<Option<String>, String> {
    let dir = canonical_project(&project_dir)?;
    git::show_head(&dir, &path)
}

// --- misc ------------------------------------------------------------------

#[tauri::command]
fn reveal_build_folder(app: tauri::AppHandle, project_dir: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = canonical_project(&project_dir)?;
    let build = dir.join("build");
    let target = if build.is_dir() { build } else { dir };
    app.opener()
        .reveal_item_in_dir(target)
        .map_err(|e| format!("failed to reveal folder: {e}"))
}

/// The app menu, kept around so items can be enabled/disabled at runtime.
pub struct MenuState(pub std::sync::Mutex<Option<tauri::menu::Menu<tauri::Wry>>>);

/// Menu items that only make sense with a project open.
const PROJECT_MENU_ITEMS: [&str; 4] = [
    "new_project",
    "save",
    "export_pdf",
    "reveal_build",
];

/// Find a menu item by id, searching through the menu's submenus.
/// (Menu::get only looks at direct children.)
fn find_menu_item(
    menu: &tauri::menu::Menu<tauri::Wry>,
    id: &str,
) -> Option<tauri::menu::MenuItemKind<tauri::Wry>> {
    for item in menu.items().unwrap_or_default() {
        match &item {
            tauri::menu::MenuItemKind::Submenu(submenu) => {
                if let Some(found) = submenu.get(id) {
                    return Some(found);
                }
            }
            _ => {
                if item.id().0 == id {
                    return Some(item.clone());
                }
            }
        }
    }
    None
}

#[tauri::command]
fn set_project_menu_enabled(
    state: tauri::State<MenuState>,
    enabled: bool,
) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let Some(menu) = guard.as_ref() else {
        return Ok(());
    };
    for id in PROJECT_MENU_ITEMS {
        if let Some(tauri::menu::MenuItemKind::MenuItem(item)) = find_menu_item(menu, id) {
            item.set_enabled(enabled)
                .map_err(|e| format!("failed to update menu item {id}: {e}"))?;
        }
    }
    Ok(())
}

/// Build the native OS menu and forward its items to the frontend.
fn build_app_menu(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};

    let handle = app.handle();
    let new_project =
        MenuItem::with_id(handle, "new_project", "New Project", true, Some("CmdOrCtrl+N"))?;
    let save = MenuItem::with_id(handle, "save", "Save", true, Some("CmdOrCtrl+S"))?;
    let export_pdf =
        MenuItem::with_id(handle, "export_pdf", "Export PDF as…", true, Some("CmdOrCtrl+E"))?;
    let reveal_build = MenuItem::with_id(
        handle,
        "reveal_build",
        "Reveal Build Folder",
        true,
        Some("CmdOrCtrl+Shift+E"),
    )?;
    let settings = MenuItem::with_id(handle, "settings", "Settings", true, Some("CmdOrCtrl+,"))?;
    let shortcuts =
        MenuItem::with_id(handle, "shortcuts", "Keyboard Shortcuts", true, Some("CmdOrCtrl+/"))?;
    let palette = MenuItem::with_id(
        handle,
        "command_palette",
        "Command Palette…",
        true,
        Some("CmdOrCtrl+P"),
    )?;
    let about = MenuItem::with_id(handle, "about", "About Polemic", true, Option::<&str>::None)?;

    #[cfg(target_os = "macos")]
    let menu = {
        let app_menu = SubmenuBuilder::new(handle, "Polemic")
            .item(&about)
            .separator()
            .item(&shortcuts)
            .item(&palette)
            .item(&settings)
            .separator()
            .services()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        let file_menu = SubmenuBuilder::new(handle, "File")
            .item(&new_project)
            .separator()
            .item(&save)
            .item(&export_pdf)
            .item(&reveal_build)
            .separator()
            .quit()
            .build()?;
        MenuBuilder::new(handle).items(&[&app_menu, &file_menu]).build()?
    };

    #[cfg(not(target_os = "macos"))]
    let menu = {
        let file_menu = SubmenuBuilder::new(handle, "File")
            .item(&new_project)
            .separator()
            .item(&save)
            .item(&export_pdf)
            .item(&reveal_build)
            .separator()
            .item(&settings)
            .item(&shortcuts)
            .item(&palette)
            .item(&about)
            .separator()
            .quit()
            .build()?;
        MenuBuilder::new(handle).items(&[&file_menu]).build()?
    };

    #[cfg(target_os = "macos")]
    handle.set_menu(menu.clone())?;
    #[cfg(not(target_os = "macos"))]
    if let Some(window) = handle.get_webview_window("main") {
        window.set_menu(menu.clone())?;
    }

    // Keep the menu so menu items can be enabled/disabled at runtime.
    // Start with project items disabled; the frontend enables them on open.
    for id in PROJECT_MENU_ITEMS {
        if let Some(tauri::menu::MenuItemKind::MenuItem(item)) =
            find_menu_item(&menu, id)
        {
            let _ = item.set_enabled(false);
        }
    }
    if let Some(state) = handle.try_state::<MenuState>() {
        if let Ok(mut guard) = state.0.lock() {
            *guard = Some(menu);
        }
    }

    handle.on_menu_event(|app, event| {
        use tauri::Emitter;
        let id = event.id().as_ref();
        let event_name = match id {
            "new_project" => "menu://new-project",
            "save" => "menu://save",
            "export_pdf" => "menu://export-pdf",
            "reveal_build" => "menu://reveal-build",
            "settings" => "menu://settings",
            "shortcuts" => "menu://shortcuts",
            "command_palette" => "menu://palette",
            "about" => "menu://about",
            _ => return,
        };
        let _ = app.emit(event_name, ());
    });

    Ok(())
}

/// The main window is created programmatically so the macOS traffic
/// lights can be centered in the custom top bar (builder-only API).
#[cfg(target_os = "macos")]
fn create_main_window(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::{LogicalPosition, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};
    WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title("Polemic")
        .inner_size(1400.0, 900.0)
        .min_inner_size(960.0, 600.0)
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
        // The builder insets the *title bar container* (button height + y);
        // the buttons keep their ~8px offset from the container bottom, so
        // the effective top offset is y - 8. y = 26 centers the 12px lights
        // in the 48px top bar.
        .traffic_light_position(LogicalPosition::new(12.0, 26.0))
        .build()?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn create_main_window(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title("Polemic")
        .inner_size(1400.0, 900.0)
        .min_inner_size(960.0, 600.0)
        .build()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            create_main_window(app)?;
            app.manage(SettingsState(std::sync::Mutex::new(settings::load(app.handle()))));
            let (user_words, lang) = {
                let settings_state = app.state::<SettingsState>();
                let guard = settings_state.0.lock().map_err(|e| e.to_string())?;
                (
                    guard.user_words.clone(),
                    guard
                        .spellcheck_language
                        .clone()
                        .unwrap_or_else(|| "en".into()),
                )
            };
            let spell_state =
                load_language_wordlist(app.handle(), &lang, &user_words)
                    .unwrap_or_else(|_| spell::SpellState::new(&user_words));
            app.manage(std::sync::Mutex::new(spell_state));
            app.manage(MenuState(std::sync::Mutex::new(None)));
            build_app_menu(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            detect_tex,
            get_settings,
            set_projects_root,
            create_project,
            list_templates,
            open_project,
            remove_recent_project,
            update_preferences,
            check_words,
            add_spellcheck_word,
            list_spellcheck_languages,
            install_spellcheck_language,
            set_spellcheck_language,
            set_project_menu_enabled,
            set_panel_layout,
            set_preview_zoom,
            set_pinned_project,
            rename_project,
            delete_project,
            list_files,
            read_project_file,
            write_project_file,
            create_project_entry,
            rename_entry,
            delete_entry,
            set_main_file,
            set_open_files,
            compile_project,
            get_pdf,
            export_pdf,
            open_pdf,
            synctex_forward,
            synctex_backward,
            create_snapshot,
            list_snapshots,
            restore_snapshot,
            list_snapshot_changes,
            read_snapshot_file,
            restore_snapshot_file,
            git_status,
            git_init,
            git_stage,
            git_unstage,
            git_commit,
            git_log,
            git_show_head,
            git_available,
            set_version_control,
            reveal_build_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
