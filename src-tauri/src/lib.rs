mod account;
mod cloud_compile;
mod excludes;
mod files;
pub mod git;
mod git_accounts;
mod github;
mod gitlab;
mod hosting;
mod guard;
mod logparse;
mod profile;
mod secrets;
mod comments;
mod assets;
mod grammar;
mod ai;
mod bib_lookup;
mod settings;
mod snapshots;
mod spell;
mod templates;
mod zotero;

use serde::{Deserialize, Serialize};
use std::fs;
use std::process::Command;

use tauri::Manager;
use files::{read_external_file, list_bib_files, FileEntry};
use settings::{Settings, SettingsState, SourceDef};
use bib_lookup::lookup_bibtex;
use zotero::zotero_local_fetch;

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
    pub xelatex: ToolInfo,
    pub lualatex: ToolInfo,
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
    /// The engine latexmk drove, e.g. "xelatex".
    pub engine: String,
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

/// Validate the main/input file handed to latexmk and synctex: a
/// project-relative .tex path that cannot be read as an option.
fn validate_tex_arg(project_dir: &str, tex: &str) -> Result<(), String> {
    project_file(project_dir, tex)?;
    if tex.starts_with('-') {
        return Err(format!("unsupported file name: {tex}"));
    }
    Ok(())
}

/// The latexmk rc files the user installed (system-wide, then personal),
/// in latexmk's own lookup order. latexmk runs with -norc so an rc file
/// inside a project — Perl code that came with the project — never runs;
/// these trusted ones are passed back explicitly with -r.
fn trusted_latexmk_rc_files() -> Vec<std::path::PathBuf> {
    use std::path::PathBuf;
    let mut out = Vec::new();
    let system: Vec<PathBuf> = match std::env::var_os("LATEXMKRCSYS") {
        Some(path) => vec![PathBuf::from(path)],
        None if cfg!(windows) => vec![PathBuf::from(r"C:\latexmk\LatexMk")],
        None => [
            "/opt/local/share/latexmk/LatexMk",
            "/usr/local/share/latexmk/LatexMk",
            "/usr/local/lib/latexmk/LatexMk",
        ]
        .iter()
        .map(PathBuf::from)
        .collect(),
    };
    if let Some(first) = system.into_iter().find(|p| p.is_file()) {
        out.push(first);
    }
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from);
    let xdg = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| home.as_ref().map(|h| h.join(".config")));
    let user = [
        xdg.map(|d| d.join("latexmk").join("latexmkrc")),
        home.map(|h| h.join(".latexmkrc")),
    ];
    if let Some(first) = user.into_iter().flatten().find(|p| p.is_file()) {
        out.push(first);
    }
    out
}

enum RunError {
    /// The program could not be started (not installed, not on PATH).
    Spawn(String),
    TimedOut,
}

/// Run a command to completion, killing it (and the TeX processes it
/// spawned) when it outlives `timeout`.
fn output_with_timeout(
    mut command: Command,
    timeout: std::time::Duration,
) -> Result<std::process::Output, RunError> {
    use std::io::Read;
    use std::process::Stdio;
    #[cfg(unix)]
    {
        // Own process group, so a timeout kills the whole tree.
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| RunError::Spawn(e.to_string()))?;
    // Drain the pipes on threads so a chatty child never blocks on a full pipe.
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut pipe) = pipe {
                let _ = pipe.read_to_end(&mut buf);
            }
            buf
        })
    };
    let stdout = drain(child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let stderr = drain(child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let start = std::time::Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| RunError::Spawn(e.to_string()))? {
            break status;
        }
        if start.elapsed() > timeout {
            // Signal the group directly: the `kill` binary is no option,
            // procps-ng misreads a negative group id (`kill -KILL -1234`
            // signals group -1, i.e. every process of the user).
            #[cfg(unix)]
            unsafe {
                libc::killpg(child.id() as libc::pid_t, libc::SIGKILL);
            }
            #[cfg(windows)]
            let _ = Command::new("taskkill")
                .args(["/T", "/F", "/PID", &child.id().to_string()])
                .status();
            let _ = child.kill();
            let _ = child.wait();
            return Err(RunError::TimedOut);
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    };
    Ok(std::process::Output {
        status,
        stdout: stdout.join().unwrap_or_default(),
        stderr: stderr.join().unwrap_or_default(),
    })
}

/// The compile command for a project. -norc: an rc file inside the
/// project is Perl that came with the project and must never run; the
/// user's own rc files are passed back explicitly.
fn latexmk_command(dir: &std::path::Path, main_tex: &str, engine: profile::Engine) -> Command {
    let mut command = Command::new("latexmk");
    command.arg("-norc");
    for rc in trusted_latexmk_rc_files() {
        command.arg("-r").arg(rc);
    }
    command
        .arg(engine.latexmk_flag())
        .args([
            "-interaction=nonstopmode",
            "-file-line-error",
            "-synctex=1",
            "-outdir=build",
        ])
        .arg(main_tex)
        .current_dir(dir);
    command
}

/// Longest a single compile may run before it is killed.
const COMPILE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10 * 60);

/// The canonical folder of an open project; any other folder is refused.
fn canonical_project(project_dir: &str) -> Result<std::path::PathBuf, String> {
    let dir = fs::canonicalize(project_dir)
        .map_err(|e| format!("project directory not accessible: {e}"))?;
    if !guard::is_allowed(&dir) {
        return Err("not an open project".into());
    }
    Ok(dir)
}

/// A project-relative path inside an open project.
fn project_file(project_dir: &str, rel_path: &str) -> Result<std::path::PathBuf, String> {
    canonical_project(project_dir)?;
    files::resolve_in_project(project_dir, rel_path)
}

/// A project the user knows: open this session, or on the recent list
/// (which only ever gains folders through open/create).
fn known_project(app: &tauri::AppHandle, path: &str) -> Result<std::path::PathBuf, String> {
    let dir = fs::canonicalize(path)
        .map_err(|e| format!("project directory not accessible: {e}"))?;
    if guard::is_allowed(&dir) {
        return Ok(dir);
    }
    let state = app.state::<SettingsState>();
    let settings = state.0.lock().map_err(|e| e.to_string())?;
    let known = settings
        .recent_projects
        .iter()
        .map(|r| r.path.as_str())
        .chain(settings.last_project_path.as_deref())
        .any(|path| fs::canonicalize(path).is_ok_and(|p| p == dir));
    drop(settings);
    if known {
        Ok(dir)
    } else {
        Err("unknown project folder; open it with Open Folder… first".into())
    }
}

// --- TeX detection ---------------------------------------------------------

#[tauri::command]
fn detect_tex() -> TexStatus {
    TexStatus {
        pdflatex: probe("pdflatex"),
        xelatex: probe("xelatex"),
        lualatex: probe("lualatex"),
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
    // Store the canonical path, like open_project does, so both routes
    // key the recent list and per-project settings the same way.
    let dir = fs::canonicalize(&dir).map_err(|e| format!("failed to create project: {e}"))?;
    for (path, content) in template.files {
        let target = dir.join(path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create folder: {e}"))?;
        }
        fs::write(&target, content)
            .map_err(|e| format!("failed to write template file {path}: {e}"))?;
    }
    guard::allow(&dir);
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
    let dir = known_project(&app, &path)?;
    admit_project(&app, &dir)
}

/// Open a folder the user picks in a native dialog; None when cancelled.
/// The dialog runs here, not in the webview, so the path is the user's
/// choice rather than whatever a script passes in.
#[tauri::command]
async fn open_project_dialog(app: tauri::AppHandle) -> Result<Option<ProjectInfo>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_title("Open project folder")
        .blocking_pick_folder();
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let dir = fs::canonicalize(&path).map_err(|e| format!("cannot open project folder: {e}"))?;
    admit_project(&app, &dir).map(Some)
}

fn admit_project(app: &tauri::AppHandle, dir: &std::path::Path) -> Result<ProjectInfo, String> {
    if !dir.is_dir() {
        return Err("project path is not a directory".into());
    }
    guard::allow(dir);
    let info = project_info(dir);
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
    editor_font: Option<String>,
    syntax_theme: Option<String>,
    spellcheck: Option<bool>,
    supsub_braces: Option<bool>,
    convert_double_dollar: Option<bool>,
    format_on_save: Option<bool>,
    math_preview_engine: Option<String>,
    caret_style: Option<String>,
    caret_color: Option<String>,
    caret_custom_color: Option<String>,
    reopen_last_project: Option<bool>,
    auto_include_new_files: Option<bool>,
    tex_editor_mode: Option<String>,
    bib_editor_mode: Option<String>,
    online_lookup: Option<bool>,
    sources: Option<Vec<SourceDef>>,
    author_name: Option<String>,
    author_initials: Option<String>,
) -> Result<Settings, String> {
    settings::update(&app, |s| {
        if let Some(name) = author_name {
            let name = name.trim().to_string();
            s.author_name = (!name.is_empty()).then_some(name);
        }
        if let Some(initials) = author_initials {
            let initials: String = initials
                .chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .take(8)
                .collect();
            s.author_initials = (!initials.is_empty()).then_some(initials);
        }
        if theme.is_some() {
            s.theme = theme;
        }
        if auto_compile.is_some() {
            s.auto_compile = auto_compile;
        }
        if font_size.is_some() {
            s.font_size = font_size;
        }
        if editor_font.is_some() {
            s.editor_font = editor_font;
        }
        if syntax_theme.is_some() {
            s.syntax_theme = syntax_theme;
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
        if format_on_save.is_some() {
            s.format_on_save = format_on_save;
        }
        if math_preview_engine.is_some() {
            s.math_preview_engine = math_preview_engine;
        }
        if caret_style.is_some() {
            s.caret_style = caret_style;
        }
        if caret_color.is_some() {
            s.caret_color = caret_color;
        }
        if caret_custom_color.is_some() {
            s.caret_custom_color = caret_custom_color;
        }
        if reopen_last_project.is_some() {
            s.reopen_last_project = reopen_last_project;
        }
        if auto_include_new_files.is_some() {
            s.auto_include_new_files = auto_include_new_files;
        }
        if tex_editor_mode.is_some() {
            s.tex_editor_mode = tex_editor_mode;
        }
        if bib_editor_mode.is_some() {
            s.bib_editor_mode = bib_editor_mode;
        }
        if online_lookup.is_some() {
            s.online_lookup = online_lookup;
        }
        if let Some(sources) = sources {
            settings::check_bib_paths(&s.sources, &sources)?;
            s.sources = sources;
        }
        Ok(s.clone())
    })?
}

/// Add a bib source through a native picker: a .bib file, or a folder
/// searched for .bib files. The only way a bib path enters the
/// settings, since `read_external_file` reads only under them.
#[tauri::command]
async fn pick_bib_source(app: tauri::AppHandle, folder: bool) -> Result<Option<Settings>, String> {
    use tauri_plugin_dialog::DialogExt;
    let dialog = app.dialog().file();
    let picked = if folder {
        dialog.set_title("Add a folder of .bib files").blocking_pick_folder()
    } else {
        dialog
            .set_title("Add a .bib file")
            .add_filter("BibTeX", &["bib"])
            .blocking_pick_file()
    };
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let path = fs::canonicalize(&path).map_err(|e| format!("cannot add source: {e}"))?;
    if !folder && !files::is_bib(&path) {
        return Err("pick a .bib file".into());
    }
    settings::update(&app, |s| {
        s.sources.push(SourceDef {
            id: settings::new_source_id(),
            kind: "bib".into(),
            enabled: true,
            name: None,
            path: Some(path.to_string_lossy().to_string()),
            user_id: None,
            api_key: None,
        });
        s.clone()
    })
    .map(Some)
}

/// Configure the AI quickfix provider; replaces the whole block.
#[tauri::command]
fn update_ai_settings(
    app: tauri::AppHandle,
    base_url: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
) -> Result<Settings, String> {
    if let Some(url) = base_url.as_deref().filter(|u| !u.trim().is_empty()) {
        ai::check_base_url(url)?;
    }
    settings::update(&app, |s| {
        s.ai = Some(settings::AiSettings {
            base_url,
            api_key,
            model,
        });
        s.clone()
    })
}

#[tauri::command]
fn update_grammar_settings(
    app: tauri::AppHandle,
    grammar: settings::GrammarSettings,
) -> Result<Settings, String> {
    let mut grammar = grammar;
    grammar.language_tool_url = grammar
        .language_tool_url
        .map(|u| u.trim().to_string())
        .filter(|u| !u.is_empty());
    if let Some(url) = grammar.language_tool_url.as_deref() {
        ai::check_service_url(url, "the LanguageTool URL")?;
    }
    if let Some(provider) = grammar.provider.as_deref() {
        if !grammar::PROVIDERS.contains(&provider) {
            return Err(format!("unknown grammar provider: {provider}"));
        }
    }
    settings::update(&app, |s| {
        s.grammar = grammar;
        s.clone()
    })
}

/// The built-in grammar checker, built on first use (and again when
/// the English variant changes).
struct HarperState(std::sync::Mutex<Option<(String, grammar::Harper)>>);

/// Grammar issues per prose block: LanguageTool (the user's server or
/// the Polemic account's) when chosen, else Harper for English;
/// nothing for other languages.
#[tauri::command]
async fn check_grammar(
    app: tauri::AppHandle,
    harper: tauri::State<'_, HarperState>,
    blocks: Vec<String>,
) -> Result<Vec<Vec<grammar::GrammarIssue>>, grammar::GrammarError> {
    let cfg = settings::snapshot(&app)?;
    let language = cfg.spellcheck_language.clone().unwrap_or_else(|| "en".into());
    let variant = cfg.grammar.english_variant.clone().unwrap_or_else(|| "en-US".into());
    let lt_language = if language == "en" { variant.clone() } else { language.clone() };
    let disabled = &cfg.grammar.disabled_rules;
    match grammar::provider(&cfg.grammar) {
        grammar::Provider::Polemic => {
            let server = account::server_of(&app)?;
            let token = account::token_with(&server, &account::STORE)
                .ok_or_else(grammar::GrammarError::signed_out)?;
            let base_url = format!("{server}/api/grammar/v2");
            let endpoint = grammar::Endpoint {
                base_url: &base_url,
                bearer: Some(&token),
                max_chars: grammar::POLEMIC_MAX_CHARS,
            };
            let result = grammar::check_languagetool(&endpoint, &lt_language, &blocks, disabled).await;
            if matches!(&result, Err(e) if e.kind == grammar::GrammarErrorKind::SignedOut) {
                account::forget_rejected_with(&server, &token, &account::STORE);
            }
            return result;
        }
        grammar::Provider::LanguageTool(url) => {
            let endpoint = grammar::Endpoint {
                base_url: url,
                bearer: None,
                max_chars: usize::MAX,
            };
            return grammar::check_languagetool(&endpoint, &lt_language, &blocks, disabled).await;
        }
        grammar::Provider::Builtin => {}
    }
    if language != "en" {
        return Ok(vec![Vec::new(); blocks.len()]);
    }
    let mut guard = harper.0.lock().map_err(|e| e.to_string())?;
    if guard.as_ref().is_none_or(|(v, _)| *v != variant) {
        *guard = Some((variant.clone(), grammar::Harper::new(grammar::dialect_for(&variant))));
    }
    let (_, checker) = guard.as_mut().expect("set above");
    Ok(checker.check(&blocks, disabled))
}

/// Harper's rules with descriptions, for switching them off.
#[tauri::command]
fn grammar_rules(harper: tauri::State<'_, HarperState>) -> Result<Vec<grammar::GrammarRule>, String> {
    let mut guard = harper.0.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        *guard = Some(("en-US".into(), grammar::Harper::new(grammar::dialect_for("en-US"))));
    }
    Ok(guard.as_ref().expect("set above").1.rules())
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

#[tauri::command]
fn git_ignored(project_dir: String) -> Vec<String> {
    match canonical_project(&project_dir) {
        Ok(dir) => git::ignored(&dir),
        Err(_) => Vec::new(),
    }
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

/// Corrections for a misspelled word, closest first.
#[tauri::command]
fn spellcheck_suggestions(
    state: tauri::State<'_, std::sync::Mutex<spell::SpellState>>,
    word: String,
) -> Result<Vec<String>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    Ok(state.suggest(&word, 6))
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
    let dir = known_project(&app, &path)?;
    let parent = dir
        .parent()
        .ok_or("project has no parent folder")?
        .to_path_buf();
    let new_dir = parent.join(new_name.trim());
    if new_dir.exists() {
        return Err(format!("\"{}\" already exists", new_name.trim()));
    }
    fs::rename(&dir, &new_dir).map_err(|e| format!("failed to rename project: {e}"))?;
    if guard::is_allowed(&dir) {
        guard::forget(&dir);
        guard::allow(&new_dir);
    }
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
    let dir = known_project(&app, &path)?;
    trash::delete(&dir).map_err(|e| format!("failed to move project to trash: {e}"))?;
    guard::forget(&dir);
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
    let target = project_file(&project_dir, &path)?;
    fs::read_to_string(&target).map_err(|e| format!("failed to read {path}: {e}"))
}

#[tauri::command]
fn write_project_file(project_dir: String, path: String, content: String) -> Result<(), String> {
    let target = project_file(&project_dir, &path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("failed to create folder: {e}"))?;
    }
    fs::write(&target, content).map_err(|e| format!("failed to write {path}: {e}"))
}

#[tauri::command]
fn create_project_entry(project_dir: String, path: String, is_dir: bool) -> Result<(), String> {
    let target = project_file(&project_dir, &path)?;
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
    let from = project_file(&project_dir, &path)?;
    let to = project_file(&project_dir, &new_path)?;
    if to.exists() {
        return Err(format!("{new_path} already exists"));
    }
    fs::rename(&from, &to).map_err(|e| format!("failed to rename: {e}"))
}

/// Move a project file or folder to the OS trash (recoverable, like
/// deleting a whole project).
#[tauri::command]
fn delete_entry(project_dir: String, path: String) -> Result<(), String> {
    let target = project_file(&project_dir, &path)?;
    trash::delete(&target).map_err(|e| format!("failed to move {path} to trash: {e}"))
}

/// Read any project file as raw bytes (binary-safe), for asset previews.
#[tauri::command]
fn read_asset(project_dir: String, path: String) -> Result<tauri::ipc::Response, String> {
    let target = project_file(&project_dir, &path)?;
    let bytes = fs::read(&target).map_err(|e| format!("failed to read {path}: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Copy files into the project's assets/ folder (copy-in imports).
/// Sources already inside the project pass through untouched: their
/// relative path is returned without copying. Other name collisions
/// get a numeric suffix. An SVG, which LaTeX cannot embed, gets a PDF
/// beside it, and the PDF is returned (the SVG stays as the source).
/// Returns the relative paths of the results.
#[tauri::command]
fn import_assets(project_dir: String, sources: Vec<String>) -> Result<Vec<String>, String> {
    let dir = canonical_project(&project_dir)?;
    let assets = dir.join("assets");
    fs::create_dir_all(&assets)
        .map_err(|e| format!("failed to create assets folder: {e}"))?;
    let mut imported = Vec::new();
    for source in sources {
        let from = fs::canonicalize(&source)
            .map_err(|e| format!("cannot read source file {source}: {e}"))?;
        if !from.is_file() {
            return Err(format!("not a file: {source}"));
        }
        // Already in the project: no copy, just resolve the path.
        if from.strip_prefix(&dir).is_ok() {
            let usable = usable_graphic(&from, false);
            imported.push(usable.strip_prefix(&dir).unwrap().to_string_lossy().to_string());
            continue;
        }
        let name = from
            .file_name()
            .ok_or("source has no file name")?
            .to_string_lossy()
            .to_string();
        let stem = std::path::Path::new(&name)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| name.clone());
        let ext = std::path::Path::new(&name)
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy()))
            .unwrap_or_default();
        let mut dest = assets.join(&name);
        let mut n = 1;
        while dest.exists() {
            dest = assets.join(format!("{stem}-{n}{ext}"));
            n += 1;
        }
        fs::copy(&from, &dest).map_err(|e| format!("failed to copy {source}: {e}"))?;
        let dest = usable_graphic(&dest, true);
        let rel = dest
            .strip_prefix(&dir)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| name.clone());
        imported.push(rel);
    }
    Ok(imported)
}

/// The file LaTeX can embed for an asset: the asset itself, or for an
/// SVG a PDF converted beside it. A PDF already there is reused unless
/// `fresh` asks for a new one (a fresh import never overwrites a file).
/// When conversion fails the SVG is returned as it is.
fn usable_graphic(path: &std::path::Path, fresh: bool) -> std::path::PathBuf {
    if !assets::is_svg(path) {
        return path.to_path_buf();
    }
    let mut pdf = path.with_extension("pdf");
    if pdf.exists() && !fresh {
        return pdf;
    }
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let mut n = 1;
    while pdf.exists() {
        pdf = path.with_file_name(format!("{stem}-{n}.pdf"));
        n += 1;
    }
    match assets::svg_to_pdf(path, &pdf) {
        Ok(()) => pdf,
        Err(e) => {
            eprintln!("svg conversion: {e}");
            path.to_path_buf()
        }
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

/// The outcome of a compile whose files are in build/: issues from the
/// .log, and a bibliography tool failure from latexmk's output and a
/// .blg written since `started`.
fn compile_outcome(
    dir: &std::path::Path,
    main_tex: &str,
    success: bool,
    log: String,
    engine: &str,
    started: std::time::SystemTime,
) -> CompileOutcome {
    let base = dir.join("build").join(pdf_output_path(main_tex));
    let mut issues = fs::read_to_string(base.with_extension("log"))
        .map(|text| logparse::parse_issues(&text))
        .unwrap_or_default();
    // A .blg left over from an earlier run says nothing about this one.
    let blg_path = base.with_extension("blg");
    let blg = fs::metadata(&blg_path)
        .and_then(|meta| meta.modified())
        .is_ok_and(|modified| modified >= started)
        .then(|| fs::read_to_string(&blg_path).ok())
        .flatten();
    if let Some(failure) = logparse::parse_bib_tool_failure(&log, blg.as_deref()) {
        issues.retain(|issue| !logparse::is_rerun_bib_tool_warning(issue));
        issues.insert(0, failure);
    }
    CompileOutcome {
        success,
        issues,
        log,
        engine: engine.into(),
    }
}

/// Compiles on this computer, or with Polemic when Settings → Compile
/// says so; either way the outputs land in build/.
#[tauri::command]
async fn compile_project(
    app: tauri::AppHandle,
    project_dir: String,
    main_tex: String,
) -> Result<CompileOutcome, cloud_compile::CompileError> {
    let dir = canonical_project(&project_dir)?;
    validate_tex_arg(&project_dir, &main_tex)?;
    let main_source = fs::read_to_string(project_file(&project_dir, &main_tex)?)
        .unwrap_or_default();
    let engine = profile::resolve(&profile::load(&dir), &main_source);
    if settings::snapshot(&app)?.compile_provider.as_deref() == Some("polemic") {
        return compile_with_polemic(&app, &dir, &main_tex, engine).await;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let started = std::time::SystemTime::now();
        let output = output_with_timeout(latexmk_command(&dir, &main_tex, engine), COMPILE_TIMEOUT).map_err(|e| match e {
            RunError::Spawn(e) => cloud_compile::CompileError::new(
                cloud_compile::CompileErrorKind::NoTex,
                format!("failed to run latexmk: {e}\n\nIs a TeX distribution (TeX Live, MacTeX, or MiKTeX) installed and on your PATH?"),
            ),
            RunError::TimedOut => format!(
                "the compile was stopped after {} minutes. The document may loop forever; check recent macro changes.",
                COMPILE_TIMEOUT.as_secs() / 60
            )
            .into(),
        })?;
        let mut log = String::from_utf8_lossy(&output.stdout).to_string();
        log.push_str(&String::from_utf8_lossy(&output.stderr));
        Ok(compile_outcome(&dir, &main_tex, output.status.success(), log, engine.name(), started))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Longest a compile runs on the server (its 4 minutes).
const CLOUD_COMPILE_MINUTES: u64 = 4;

async fn compile_with_polemic(
    app: &tauri::AppHandle,
    dir: &std::path::Path,
    main_tex: &str,
    engine: profile::Engine,
) -> Result<CompileOutcome, cloud_compile::CompileError> {
    let server = account::server_of(app)?;
    let token = account::token_with(&server, &account::STORE)
        .ok_or_else(cloud_compile::CompileError::signed_out)?;
    let main = main_tex.replace('\\', "/");
    let started = std::time::SystemTime::now();
    let result = cloud_compile::cancellable(cloud_compile::compile_with(
        &server, &token, dir, &main, engine,
    ))
    .await;
    if matches!(&result, Err(e) if e.kind == cloud_compile::CompileErrorKind::SignedOut) {
        account::forget_rejected_with(&server, &token, &account::STORE);
    }
    let compiled = result?;
    let mut outcome = compile_outcome(
        dir,
        main_tex,
        compiled.status == "success",
        compiled.output,
        &compiled.engine,
        started,
    );
    logparse::add_font_hints(&mut outcome.issues);
    if compiled.status == "timeout" {
        outcome.issues.insert(
            0,
            logparse::CompileIssue {
                severity: "error".into(),
                file: None,
                line: None,
                message: format!(
                    "The compile was stopped after {CLOUD_COMPILE_MINUTES} minutes on the Polemic server."
                ),
                detail: Vec::new(),
                hint: Some(
                    "The document may loop forever; check recent macro changes. A long document can compile on this computer, which allows 10 minutes.".into(),
                ),
            },
        );
    }
    Ok(outcome)
}

/// Stops a compile with Polemic that is still running (a newer compile
/// or another project is on its way).
#[tauri::command]
fn cancel_compile() {
    cloud_compile::cancel();
}

#[tauri::command]
fn set_compile_provider(app: tauri::AppHandle, provider: String) -> Result<Settings, String> {
    if provider != "local" && provider != "polemic" {
        return Err(format!("unknown compile provider: {provider}"));
    }
    settings::update(&app, |s| {
        s.compile_provider = Some(provider.clone());
        s.clone()
    })
}

/// Whether the account can compile with Polemic, for Settings.
#[tauri::command]
async fn cloud_compile_status(app: tauri::AppHandle) -> Result<cloud_compile::Availability, String> {
    let server = account::server_of(&app)?;
    let Some(token) = account::token_with(&server, &account::STORE) else {
        return Ok(cloud_compile::Availability::SignedOut);
    };
    Ok(cloud_compile::availability_with(&server, &token).await)
}

#[tauri::command]
fn get_project_config(project_dir: String) -> Result<profile::ProjectConfig, String> {
    let dir = canonical_project(&project_dir)?;
    Ok(profile::load(&dir))
}

#[tauri::command]
fn save_project_config(project_dir: String, config: profile::ProjectConfig) -> Result<(), String> {
    let dir = canonical_project(&project_dir)?;
    profile::save(&dir, &config)
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
    input: Option<String>,
    line: u32,
    col: u32,
) -> Result<SynctexForward, String> {
    let dir = canonical_project(&project_dir)?;
    // The PDF is named after the main file; the line lives in `input`
    // (the edited file, e.g. an \input chapter), defaulting to main.
    let input = input.unwrap_or_else(|| main_tex.clone());
    validate_tex_arg(&project_dir, &main_tex)?;
    validate_tex_arg(&project_dir, &input)?;
    // Still the `synctex` program, which a user who compiles with
    // Polemic may not have; phase 6 step 4 reads .synctex.gz itself.
    let output = Command::new("synctex")
        .arg("view")
        .arg("-i")
        .arg(format!("{line}:{col}:{input}"))
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
    // The `synctex` program, as in synctex_forward (step 4 replaces it).
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
    // A compile with Polemic records project-relative names.
    let rel = fs::canonicalize(dir.join(&file))
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
fn list_comments(project_dir: String) -> Result<Vec<comments::Comment>, String> {
    Ok(comments::list(&canonical_project(&project_dir)?))
}

#[tauri::command]
fn save_comments(
    project_dir: String,
    comments: Vec<comments::Comment>,
) -> Result<(), String> {
    comments::save(&canonical_project(&project_dir)?, &comments)
}

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

#[tauri::command]
fn git_set_remote(project_dir: String, url: String) -> Result<(), String> {
    let dir = canonical_project(&project_dir)?;
    git::set_remote(&dir, &url)
}

#[tauri::command]
fn git_abort_merge(project_dir: String) -> Result<(), String> {
    let dir = canonical_project(&project_dir)?;
    git::abort_merge(&dir)
}

#[tauri::command]
fn git_resolve_conflict(
    project_dir: String,
    path: String,
    side: git::ConflictSide,
) -> Result<(), String> {
    let dir = canonical_project(&project_dir)?;
    project_file(&project_dir, &path)?;
    git::resolve_conflict(&dir, &path, side)
}

#[tauri::command]
fn git_mark_resolved(project_dir: String, path: String) -> Result<(), String> {
    let dir = canonical_project(&project_dir)?;
    let file = project_file(&project_dir, &path)?;
    git::mark_resolved(&dir, &path, file.exists().then_some(file.as_path()))
}

/// The credentials for an account, its OAuth token renewed first when
/// it is about to expire (GitLab's live two hours).
async fn account_credentials(account: &settings::GitAccount) -> Result<git::Credentials, String> {
    let Some(secret) = git_accounts::secret_with(&git_accounts::STORE, &account.id) else {
        return Ok(None);
    };
    let token = match git_accounts::due_for_refresh(&secret, git_accounts::now_secs()) {
        None => secret.access_token().to_string(),
        Some(refresh_token) => {
            let expired = || {
                "The GitLab sign-in has expired: sign in to GitLab again in the git accounts"
                    .to_string()
            };
            if account.host != gitlab::HOST {
                return Err(expired());
            }
            let client_id = gitlab::client_id().ok_or_else(expired)?;
            let tokens =
                gitlab::refresh(&gitlab::Endpoints::default(), &client_id, refresh_token).await?;
            let renewed = oauth_secret(&tokens, refresh_token);
            git_accounts::set_secret_with(&git_accounts::STORE, &account.id, &renewed)?;
            renewed.access_token().to_string()
        }
    };
    Ok(Some((account.username.clone(), token)))
}

/// What to keep from a sign-in or a refresh: GitLab's tokens expire and
/// come with a refresh token (rotated on each refresh).
fn oauth_secret(tokens: &hosting::Tokens, previous_refresh: &str) -> git_accounts::Secret {
    git_accounts::Secret::OAuth(git_accounts::OAuthToken {
        access_token: tokens.access_token.clone(),
        refresh_token: tokens
            .refresh_token
            .clone()
            .unwrap_or_else(|| previous_refresh.to_string()),
        expires_at: git_accounts::now_secs() + tokens.expires_in.unwrap_or(gitlab::DEFAULT_LIFETIME),
    })
}

/// The credentials for a remote URL from the git accounts.
async fn git_credentials(app: &tauri::AppHandle, url: &str) -> Result<git::Credentials, String> {
    let accounts = settings::snapshot(app)?.git_accounts;
    match git_accounts::account_for(&accounts, url) {
        Some(account) => account_credentials(account).await,
        None => Ok(None),
    }
}

/// The credentials for a project's origin.
async fn origin_credentials(
    app: &tauri::AppHandle,
    dir: &std::path::Path,
) -> Result<git::Credentials, String> {
    match git::remote_url(dir) {
        Some(url) => git_credentials(app, &url).await,
        None => Ok(None),
    }
}

// The network operations run off the main thread: a slow remote must
// not freeze the window.
#[tauri::command]
async fn git_fetch(app: tauri::AppHandle, project_dir: String) -> Result<(), String> {
    let dir = canonical_project(&project_dir)?;
    let credentials = origin_credentials(&app, &dir).await?;
    tauri::async_runtime::spawn_blocking(move || git::fetch(&dir, credentials))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_pull(app: tauri::AppHandle, project_dir: String) -> Result<git::PullOutcome, String> {
    let dir = canonical_project(&project_dir)?;
    let credentials = origin_credentials(&app, &dir).await?;
    tauri::async_runtime::spawn_blocking(move || git::pull(&dir, credentials))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_push(app: tauri::AppHandle, project_dir: String) -> Result<(), String> {
    let dir = canonical_project(&project_dir)?;
    let credentials = origin_credentials(&app, &dir).await?;
    tauri::async_runtime::spawn_blocking(move || git::push(&dir, credentials))
        .await
        .map_err(|e| e.to_string())?
}

// --- git accounts ------------------------------------------------------------

#[tauri::command]
fn git_accounts(app: tauri::AppHandle) -> Result<Vec<git_accounts::GitAccountView>, String> {
    let accounts = settings::snapshot(&app)?.git_accounts;
    Ok(git_accounts::views_with(&accounts, &git_accounts::STORE))
}

/// Add an account, or update one by id. A new account needs a token;
/// an existing one keeps its token when none is given.
#[tauri::command]
fn git_account_save(
    app: tauri::AppHandle,
    id: Option<String>,
    host: String,
    username: String,
    token: Option<String>,
) -> Result<Vec<git_accounts::GitAccountView>, String> {
    let host = git_accounts::normalize_host(&host)?;
    let username = username.trim().to_string();
    if username.is_empty() {
        return Err("The username is empty".into());
    }
    let token = token
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .map(git_accounts::Secret::Token);
    // An account edited by hand is no longer a sign-in's: drop the name.
    save_git_account(&app, id, host, username, None, token)?;
    git_accounts(app)
}

/// Add or update a git account (see `git_account_save`); its id.
fn save_git_account(
    app: &tauri::AppHandle,
    id: Option<String>,
    host: String,
    username: String,
    name: Option<String>,
    secret: Option<git_accounts::Secret>,
) -> Result<String, String> {
    let existing = settings::snapshot(app)?.git_accounts;
    let id = match id {
        Some(id) if existing.iter().any(|a| a.id == id) => id,
        Some(_) => return Err("That account no longer exists".into()),
        None => {
            if secret.is_none() {
                return Err("A new account needs a token".into());
            }
            // The same host and user twice would be one account.
            existing
                .iter()
                .find(|a| a.host == host && a.username == username)
                .map(|a| a.id.clone())
                .unwrap_or(git_accounts::new_id()?)
        }
    };
    // The token first: without a credential store the account is not kept.
    if let Some(secret) = secret {
        git_accounts::set_secret_with(&git_accounts::STORE, &id, &secret)?;
    }
    settings::update(app, |s| {
        let account = settings::GitAccount { id: id.clone(), host, username, name };
        match s.git_accounts.iter_mut().find(|a| a.id == id) {
            Some(slot) => *slot = account,
            None => s.git_accounts.push(account),
        }
    })?;
    Ok(id)
}

// --- GitHub and GitLab: sign-in and Publish ----------------------------------

#[derive(serde::Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Hosting {
    Github,
    Gitlab,
}

impl Hosting {
    fn name(self) -> &'static str {
        match self {
            Hosting::Github => "GitHub",
            Hosting::Gitlab => "GitLab",
        }
    }

    fn host(self) -> &'static str {
        match self {
            Hosting::Github => github::HOST,
            Hosting::Gitlab => gitlab::HOST,
        }
    }

    fn client_id(self) -> Result<String, String> {
        match self {
            Hosting::Github => github::client_id(),
            Hosting::Gitlab => gitlab::client_id(),
        }
        .ok_or_else(|| format!("{} sign-in is not set up in this build", self.name()))
    }
}

/// The device code waiting to be entered, its host, and its cancel flag.
static SIGN_IN_PENDING: std::sync::Mutex<
    Option<(Hosting, hosting::DeviceCode, std::sync::Arc<std::sync::atomic::AtomicBool>)>,
> = std::sync::Mutex::new(None);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SignIn {
    user_code: String,
    verification_uri: String,
    expires_in: u64,
}

/// Whether this build can sign in to the host (it has a client ID).
#[tauri::command]
fn hosting_sign_in_available(provider: Hosting) -> bool {
    provider.client_id().is_ok()
}

/// Start a sign-in: the code for the user to type, with the browser
/// opened at the page to type it on.
#[tauri::command]
async fn hosting_sign_in_start(app: tauri::AppHandle, provider: Hosting) -> Result<SignIn, String> {
    use tauri_plugin_opener::OpenerExt;
    let client_id = provider.client_id()?;
    let code = match provider {
        Hosting::Github => {
            github::request_device_code(&github::Endpoints::default(), &client_id).await?
        }
        Hosting::Gitlab => {
            gitlab::request_device_code(&gitlab::Endpoints::default(), &client_id).await?
        }
    };
    let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    if let Ok(mut pending) = SIGN_IN_PENDING.lock() {
        if let Some((_, _, old)) = pending.replace((provider, code.clone(), cancel)) {
            old.store(true, std::sync::atomic::Ordering::Relaxed);
        }
    }
    let _ = app.opener().open_url(&code.verification_uri, None::<&str>);
    Ok(SignIn {
        user_code: code.user_code,
        verification_uri: code.verification_uri,
        expires_in: code.expires_in,
    })
}

/// Wait for the code to be entered, then keep the token as the host's
/// git account for the signed-in user.
#[tauri::command]
async fn hosting_sign_in_finish(
    app: tauri::AppHandle,
    provider: Hosting,
) -> Result<Vec<git_accounts::GitAccountView>, String> {
    let client_id = provider.client_id()?;
    let (pending_for, code, cancel) = SIGN_IN_PENDING
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| format!("No {} sign-in is waiting", provider.name()))?;
    if pending_for != provider {
        return Err(format!("No {} sign-in is waiting", provider.name()));
    }
    let unit = std::time::Duration::from_secs(1);
    let result = match provider {
        Hosting::Github => github::wait_for_token(
            &github::Endpoints::default(),
            &client_id,
            &code,
            cancel.clone(),
            unit,
        )
        .await
        .map(|token| hosting::Tokens { access_token: token, refresh_token: None, expires_in: None }),
        Hosting::Gitlab => {
            gitlab::wait_for_tokens(&gitlab::Endpoints::default(), &client_id, &code, cancel.clone(), unit)
                .await
        }
    };
    if let Ok(mut pending) = SIGN_IN_PENDING.lock() {
        if pending.as_ref().is_some_and(|(_, _, c)| std::sync::Arc::ptr_eq(c, &cancel)) {
            *pending = None;
        }
    }
    let tokens = result?;
    match provider {
        Hosting::Github => {
            let login = github::login_of(&github::Endpoints::default(), &tokens.access_token).await?;
            let secret = git_accounts::Secret::Token(tokens.access_token);
            save_git_account(&app, None, github::HOST.into(), login, None, Some(secret))?;
        }
        Hosting::Gitlab => {
            let user =
                gitlab::username_of(&gitlab::Endpoints::default(), &tokens.access_token).await?;
            let secret = match &tokens.refresh_token {
                Some(refresh) => oauth_secret(&tokens, refresh),
                None => git_accounts::Secret::Token(tokens.access_token.clone()),
            };
            save_git_account(
                &app,
                None,
                gitlab::HOST.into(),
                gitlab::OAUTH_USERNAME.into(),
                Some(user),
                Some(secret),
            )?;
        }
    }
    git_accounts(app)
}

#[tauri::command]
fn hosting_sign_in_cancel() {
    if let Ok(mut pending) = SIGN_IN_PENDING.lock() {
        if let Some((_, _, cancel)) = pending.take() {
            cancel.store(true, std::sync::atomic::Ordering::Relaxed);
        }
    }
}

/// Publish a project to a new repository on the host, with the first
/// account there that has a token; the repository's URL.
#[tauri::command]
async fn hosting_publish(
    app: tauri::AppHandle,
    provider: Hosting,
    project_dir: String,
    name: String,
    private: bool,
) -> Result<String, String> {
    let dir = canonical_project(&project_dir)?;
    let accounts = settings::snapshot(&app)?.git_accounts;
    let account = accounts
        .iter()
        .filter(|a| a.host == provider.host())
        .find(|a| git_accounts::secret_with(&git_accounts::STORE, &a.id).is_some())
        .ok_or_else(|| {
            format!(
                "Add a {p} account in Settings first: sign in with {p} or add a token",
                p = provider.name()
            )
        })?;
    let (username, token) = account_credentials(account)
        .await?
        .ok_or_else(|| format!("The {} account has no token", provider.name()))?;
    match provider {
        Hosting::Github => {
            github::publish_with(&github::Endpoints::default(), &dir, &username, &token, &name, private)
                .await
        }
        Hosting::Gitlab => {
            gitlab::publish_with(&gitlab::Endpoints::default(), &dir, &username, &token, &name, private)
                .await
        }
    }
}

#[tauri::command]
fn git_account_remove(
    app: tauri::AppHandle,
    id: String,
) -> Result<Vec<git_accounts::GitAccountView>, String> {
    settings::update(&app, |s| s.git_accounts.retain(|a| a.id != id))?;
    git_accounts::remove_token_with(&git_accounts::STORE, &id)?;
    git_accounts(app)
}

/// Clone a repository into the projects root as a new project.
#[tauri::command]
async fn git_clone_project(
    app: tauri::AppHandle,
    url: String,
    name: String,
) -> Result<ProjectInfo, String> {
    validate_project_name(&name)?;
    let name = name.trim().to_string();
    let cfg = settings::effective(&app)?;
    let root = cfg.projects_root.expect("projects root is set by effective()");
    let dest = std::path::Path::new(&root).join(&name);
    if dest.exists() {
        return Err(format!("a project named \"{name}\" already exists"));
    }
    let clone_dest = dest.clone();
    let credentials = git_credentials(&app, &url).await?;
    tauri::async_runtime::spawn_blocking(move || git::clone(&url, &clone_dest, credentials))
        .await
        .map_err(|e| e.to_string())??;
    let dir = fs::canonicalize(&dest).map_err(|e| format!("failed to open the clone: {e}"))?;
    admit_project(&app, &dir)
}

// --- asset metadata ---------------------------------------------------------

/// Asset tags, persisted in the project's .polemic/assets.json.
#[tauri::command]
fn list_asset_meta(
    project_dir: String,
) -> Result<std::collections::HashMap<String, Vec<String>>, String> {
    Ok(assets::list(&canonical_project(&project_dir)?))
}

#[tauri::command]
fn save_asset_meta(
    project_dir: String,
    tags: std::collections::HashMap<String, Vec<String>>,
) -> Result<(), String> {
    assets::save(&canonical_project(&project_dir)?, &tags)
}

// --- TeX packages -----------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TexPackageInfo {
    /// Whether the package's file resolves in the local TeX dist.
    pub installed: bool,
    /// Short description from the local distribution, if available.
    pub description: Option<String>,
}

/// Resolve packages against the local TeX distribution: `kpsewhich`
/// decides installed, `tlmgr info` provides the short description
/// (empty when tlmgr is unavailable, e.g. on MiKTeX). Async with
/// spawn_blocking — the probes spawn TeX processes, which must never
/// block the main thread (a synchronous command would freeze the UI
/// for seconds).
#[tauri::command]
async fn tex_package_info(names: Vec<String>) -> Result<Vec<TexPackageInfo>, String> {
    Ok(tauri::async_runtime::spawn_blocking(move || {
        names
            .iter()
            .map(|name| {
                let installed = ["sty", "tex", "cls"].iter().any(|ext| {
                    Command::new("kpsewhich")
                        .arg(format!("{name}.{ext}"))
                        .output()
                        .map(|out| {
                            out.status.success()
                                && !String::from_utf8_lossy(&out.stdout).trim().is_empty()
                        })
                        .unwrap_or(false)
                });
                let description = if installed {
                    Command::new("tlmgr")
                        .args(["info", "--data", "shortdesc", name])
                        .output()
                        .ok()
                        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
                        .filter(|text| !text.is_empty())
                } else {
                    None
                };
                TexPackageInfo {
                    installed,
                    description,
                }
            })
            .collect::<Vec<TexPackageInfo>>()
    })
    .await
    .map_err(|e| e.to_string())?)
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
const PROJECT_MENU_ITEMS: [&str; 30] = [
    "new_project",
    "save",
    "compile",
    "export_pdf",
    "reveal_build",
    "close_project",
    "find_in_file",
    "search",
    "format",
    "add_comment",
    "insert_table",
    "wrap_figure",
    "insert_tikz",
    "insert_csv",
    "insert_citation",
    "insert_reference",
    "insert_footnote",
    "insert_display_math",
    "face_visual",
    "face_code",
    "toggle_sidebar",
    "toggle_preview",
    "toggle_right",
    "issues",
    "log",
    "zoom_reset",
    "zoom_in",
    "zoom_out",
    "packages",
    "document_settings",
];

/// Project items beyond the fixed-size list above (kept separate so the
/// array length stays readable).
const PROJECT_MENU_ITEMS_MORE: [&str; 4] =
    ["sources", "take_snapshot", "commit", "toggle_comment"];

/// Menu item id → the frontend event it emits.
const MENU_EVENTS: [(&str, &str); 42] = [
    ("new_project", "menu://new-project"),
    ("open_project", "menu://open-project"),
    ("save", "menu://save"),
    ("compile", "menu://compile"),
    ("export_pdf", "menu://export-pdf"),
    ("reveal_build", "menu://reveal-build"),
    ("close_project", "menu://close-project"),
    ("find_in_file", "menu://find"),
    ("search", "menu://toggle-search"),
    ("format", "menu://format"),
    ("add_comment", "menu://add-comment"),
    ("toggle_comment", "menu://toggle-comment"),
    ("insert_table", "menu://insert-table"),
    ("wrap_figure", "menu://wrap-figure"),
    ("insert_tikz", "menu://insert-tikz"),
    ("insert_csv", "menu://insert-csv"),
    ("insert_citation", "menu://insert-citation"),
    ("insert_reference", "menu://insert-reference"),
    ("insert_footnote", "menu://insert-footnote"),
    ("insert_display_math", "menu://insert-display-math"),
    ("face_visual", "menu://face-visual"),
    ("face_code", "menu://face-code"),
    ("toggle_sidebar", "menu://toggle-sidebar"),
    ("toggle_preview", "menu://toggle-preview"),
    ("toggle_right", "menu://toggle-right"),
    ("issues", "menu://toggle-issues"),
    ("log", "menu://toggle-log"),
    ("command_palette", "menu://palette"),
    ("zoom_reset", "menu://zoom-reset"),
    ("zoom_in", "menu://zoom-in"),
    ("zoom_out", "menu://zoom-out"),
    ("packages", "menu://packages"),
    ("document_settings", "menu://document-settings"),
    ("sources", "menu://sources"),
    ("take_snapshot", "menu://take-snapshot"),
    ("commit", "menu://commit"),
    ("settings", "menu://settings"),
    ("help", "menu://help"),
    ("shortcuts", "menu://shortcuts"),
    ("report_issue", "menu://report-issue"),
    ("about", "menu://about"),
    ("component_gallery", "menu://component-gallery"),
];

/// Find a menu item by id, searching through the menu's submenus.
/// (Menu::get only looks at direct children.)
fn find_menu_item(
    menu: &tauri::menu::Menu<tauri::Wry>,
    id: &str,
) -> Option<tauri::menu::MenuItemKind<tauri::Wry>> {
    for item in menu.items().unwrap_or_default() {
        match item {
            tauri::menu::MenuItemKind::Submenu(submenu) => {
                if let Some(found) = submenu.get(id) {
                    return Some(found);
                }
            }
            other => {
                if other.id() == id {
                    return Some(other);
                }
            }
        }
    }
    None
}

/// Enable or disable a plain or check item.
fn set_item_enabled(item: &tauri::menu::MenuItemKind<tauri::Wry>, enabled: bool) -> tauri::Result<()> {
    match item {
        tauri::menu::MenuItemKind::MenuItem(item) => item.set_enabled(enabled),
        tauri::menu::MenuItemKind::Check(item) => item.set_enabled(enabled),
        _ => Ok(()),
    }
}

/// Enable or disable the menu items that need an open project.
#[tauri::command]
fn set_project_menu_enabled(
    state: tauri::State<MenuState>,
    enabled: bool,
) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let Some(menu) = guard.as_ref() else {
        return Ok(());
    };
    for id in PROJECT_MENU_ITEMS.iter().chain(PROJECT_MENU_ITEMS_MORE.iter()) {
        if let Some(item) = find_menu_item(menu, id) {
            set_item_enabled(&item, enabled)
                .map_err(|e| format!("failed to update menu item {id}: {e}"))?;
        }
    }
    Ok(())
}

/// Set the checkmark of a View menu item (panels, the editor face), so
/// the menu mirrors what the window shows.
#[tauri::command]
fn set_menu_checked(
    state: tauri::State<MenuState>,
    id: String,
    checked: bool,
) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let Some(menu) = guard.as_ref() else {
        return Ok(());
    };
    if let Some(tauri::menu::MenuItemKind::Check(item)) = find_menu_item(menu, &id) {
        item.set_checked(checked)
            .map_err(|e| format!("failed to check menu item {id}: {e}"))?;
    }
    Ok(())
}

/// Build the native OS menu and forward its items to the frontend.
///
/// The order follows the platform: File, Edit, then the app's Insert,
/// View and Project menus, then Window (macOS) and Help. Native menus
/// use Title Case; an ellipsis marks items that open a dialog. View
/// lists panels as check items named after the panel.
fn build_app_menu(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{CheckMenuItem, MenuBuilder, MenuItem, SubmenuBuilder};

    let handle = app.handle();
    let item = |id: &str, text: &str, accel: Option<&str>| {
        MenuItem::with_id(handle, id, text, true, accel)
    };
    let check = |id: &str, text: &str, checked: bool, accel: Option<&str>| {
        CheckMenuItem::with_id(handle, id, text, true, checked, accel)
    };

    // File
    let new_project = item("new_project", "New Project…", Some("CmdOrCtrl+N"))?;
    let open_project = item("open_project", "Open Project…", Some("CmdOrCtrl+O"))?;
    let save = item("save", "Save", Some("CmdOrCtrl+S"))?;
    let compile = item("compile", "Compile", Some("CmdOrCtrl+Shift+R"))?;
    let export_pdf = item("export_pdf", "Export PDF…", Some("CmdOrCtrl+E"))?;
    let reveal_build = item("reveal_build", "Reveal Build Folder", Some("CmdOrCtrl+Shift+E"))?;
    let close_project = item("close_project", "Close Project", Some("CmdOrCtrl+Shift+W"))?;

    // Edit (after the predefined clipboard items)
    let find_in_file = item("find_in_file", "Find in File", Some("CmdOrCtrl+F"))?;
    let search = item("search", "Find in Project…", Some("CmdOrCtrl+Shift+F"))?;
    let format = item("format", "Format Document", Some("Shift+Alt+F"))?;
    let add_comment = item("add_comment", "Add Comment", Some("CmdOrCtrl+Alt+C"))?;
    let toggle_comment = item("toggle_comment", "Toggle Line Comment", Some("CmdOrCtrl+/"))?;

    // Insert
    let insert_table = item("insert_table", "Table…", Some("CmdOrCtrl+Shift+T"))?;
    let wrap_figure = item("wrap_figure", "Figure from Image…", Some("CmdOrCtrl+Alt+G"))?;
    let insert_tikz = item("insert_tikz", "TikZ Picture…", Some("CmdOrCtrl+Alt+T"))?;
    let insert_csv = item("insert_csv", "Table or Plot from CSV…", None)?;
    let insert_citation = item("insert_citation", "Citation…", Some("CmdOrCtrl+Shift+C"))?;
    let insert_reference = item("insert_reference", "Reference…", None)?;
    let insert_footnote = item("insert_footnote", "Footnote", None)?;
    let insert_display_math = item("insert_display_math", "Display Math", None)?;

    // View
    let face_code = check("face_code", "Code", true, Some("CmdOrCtrl+Alt+1"))?;
    let face_visual = check("face_visual", "Visual", false, Some("CmdOrCtrl+Alt+2"))?;
    let toggle_sidebar = check("toggle_sidebar", "Navigator", true, Some("CmdOrCtrl+Alt+B"))?;
    let toggle_preview = check("toggle_preview", "PDF Preview", true, Some("CmdOrCtrl+Shift+P"))?;
    let toggle_right = check("toggle_right", "Properties", false, Some("CmdOrCtrl+J"))?;
    let issues = check("issues", "Issues", true, Some("CmdOrCtrl+Shift+M"))?;
    let log = check("log", "Compile Log", false, None)?;
    let palette = item("command_palette", "Command Palette…", Some("CmdOrCtrl+P"))?;
    let zoom_reset = item("zoom_reset", "Actual Size", Some("CmdOrCtrl+0"))?;
    let zoom_in = item("zoom_in", "Zoom In", Some("CmdOrCtrl+="))?;
    let zoom_out = item("zoom_out", "Zoom Out", Some("CmdOrCtrl+-"))?;

    // Project
    let packages = item("packages", "Packages…", Some("CmdOrCtrl+Alt+P"))?;
    let document_settings = item("document_settings", "Document Settings…", None)?;
    let sources = item("sources", "Bibliography Sources…", None)?;
    let take_snapshot = item("take_snapshot", "Take Snapshot", None)?;
    let commit = item("commit", "Commit…", Some("CmdOrCtrl+K"))?;

    // App and Help
    let settings = item("settings", "Settings…", Some("CmdOrCtrl+,"))?;
    let help = item("help", "Polemic Help", None)?;
    let shortcuts = item("shortcuts", "Keyboard Shortcuts", Some("CmdOrCtrl+Alt+/"))?;
    let report_issue = item("report_issue", "Report an Issue…", None)?;
    let about = item("about", "About Polemic", None)?;

    // The Develop menu: tools that only exist in dev builds. The whole
    // submenu is compiled out in release, so the menu item never ships.
    #[cfg(debug_assertions)]
    let component_gallery = item("component_gallery", "Component Gallery", None)?;
    #[cfg(debug_assertions)]
    let develop_menu = SubmenuBuilder::new(handle, "Develop")
        .item(&component_gallery)
        .build()?;

    let file_builder = SubmenuBuilder::new(handle, "File")
        .item(&new_project)
        .item(&open_project)
        .separator()
        .item(&save)
        .item(&compile)
        .item(&export_pdf)
        .item(&reveal_build)
        .separator()
        .item(&close_project);
    // The native Edit menu: its predefined items deliver Cmd+X/C/V and
    // friends to the focused webview (the custom menu replaced the
    // Tauri default, which ships this submenu).
    let edit_builder = SubmenuBuilder::new(handle, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&find_in_file)
        .item(&search)
        .separator()
        .item(&format)
        .item(&toggle_comment)
        .item(&add_comment);
    let insert_menu = SubmenuBuilder::new(handle, "Insert")
        .item(&insert_table)
        .item(&wrap_figure)
        .item(&insert_tikz)
        .item(&insert_csv)
        .separator()
        .item(&insert_citation)
        .item(&insert_reference)
        .separator()
        .item(&insert_footnote)
        .item(&insert_display_math)
        .build()?;
    let view_menu = SubmenuBuilder::new(handle, "View")
        .item(&face_code)
        .item(&face_visual)
        .separator()
        .item(&toggle_sidebar)
        .item(&toggle_preview)
        .item(&toggle_right)
        .item(&issues)
        .item(&log)
        .separator()
        .item(&palette)
        .separator()
        .item(&zoom_reset)
        .item(&zoom_in)
        .item(&zoom_out)
        .build()?;
    let project_menu = SubmenuBuilder::new(handle, "Project")
        .item(&packages)
        .item(&document_settings)
        .item(&sources)
        .separator()
        .item(&take_snapshot)
        .item(&commit)
        .build()?;
    let help_builder = SubmenuBuilder::new(handle, "Help")
        .item(&help)
        .item(&shortcuts)
        .separator()
        .item(&report_issue);

    #[cfg(target_os = "macos")]
    let menu = {
        let app_menu = SubmenuBuilder::new(handle, "Polemic")
            .item(&about)
            .separator()
            .item(&settings)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        let window_menu = SubmenuBuilder::new(handle, "Window")
            .minimize()
            .maximize_with_text("Zoom")
            .separator()
            .fullscreen()
            .build()?;
        let file_menu = file_builder.build()?;
        let edit_menu = edit_builder.build()?;
        let help_menu = help_builder.build()?;
        let menu_builder = MenuBuilder::new(handle).items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &insert_menu,
            &view_menu,
            &project_menu,
            &window_menu,
            &help_menu,
        ]);
        #[cfg(debug_assertions)]
        let menu_builder = menu_builder.item(&develop_menu);
        menu_builder.build()?
    };

    // Windows and Linux have no app menu: Settings ends Edit, Exit ends
    // File, and About ends Help.
    #[cfg(not(target_os = "macos"))]
    let menu = {
        let file_menu = file_builder.separator().quit_with_text("Exit").build()?;
        let edit_menu = edit_builder.separator().item(&settings).build()?;
        let help_menu = help_builder.separator().item(&about).build()?;
        let menu_builder = MenuBuilder::new(handle).items(&[
            &file_menu,
            &edit_menu,
            &insert_menu,
            &view_menu,
            &project_menu,
            &help_menu,
        ]);
        #[cfg(debug_assertions)]
        let menu_builder = menu_builder.item(&develop_menu);
        menu_builder.build()?
    };

    #[cfg(target_os = "macos")]
    handle.set_menu(menu.clone())?;
    #[cfg(not(target_os = "macos"))]
    if let Some(window) = handle.get_webview_window("main") {
        window.set_menu(menu.clone())?;
    }

    // Keep the menu so menu items can be enabled/disabled at runtime.
    // Start with project items disabled; the frontend enables them on open.
    for id in PROJECT_MENU_ITEMS.iter().chain(PROJECT_MENU_ITEMS_MORE.iter()) {
        if let Some(item) = find_menu_item(&menu, id) {
            let _ = set_item_enabled(&item, false);
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
        if let Some((_, event_name)) = MENU_EVENTS.iter().find(|(item, _)| *item == id) {
            let _ = app.emit(event_name, ());
        } else if let Some(action) = id.strip_prefix("ctx/") {
            // Context menu items (show_context_menu) carry a "ctx/"
            // prefix; forward the selection to the frontend.
            let _ = app.emit("menu://context", action);
        }
    });

    Ok(())
}

/// An entry of a native context menu, as sent by the frontend.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum ContextMenuItem {
    Separator,
    Item { id: String, text: String },
}

/// Pop up the OS-native context menu at the cursor with the given
/// items. Blocks until the menu is dismissed; the picked item (if any)
/// arrives in the frontend as a `menu://context` event, like the app
/// menu items.
#[tauri::command]
fn show_context_menu(
    app: tauri::AppHandle,
    window: tauri::Window,
    items: Vec<ContextMenuItem>,
) -> Result<(), String> {
    use tauri::menu::{ContextMenu, MenuBuilder, MenuItem};

    let mut builder = MenuBuilder::new(&app);
    for item in items {
        match item {
            ContextMenuItem::Separator => builder = builder.separator(),
            ContextMenuItem::Item { id, text } => {
                let menu_item = MenuItem::with_id(
                    &app,
                    format!("ctx/{id}"),
                    text,
                    true,
                    Option::<&str>::None,
                )
                .map_err(|e| e.to_string())?;
                builder = builder.item(&menu_item);
            }
        }
    }
    let menu = builder.build().map_err(|e| e.to_string())?;
    menu.popup(window).map_err(|e| e.to_string())
}

/// The main window is created programmatically so the macOS traffic
/// lights can be centered in the custom top bar (builder-only API).
#[cfg(target_os = "macos")]
fn create_main_window(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::utils::config::WindowEffectsConfig;
    use tauri::utils::{WindowEffect, WindowEffectState};
    use tauri::{LogicalPosition, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};
    WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title("Polemic")
        .inner_size(1400.0, 900.0)
        .min_inner_size(960.0, 600.0)
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
        // Frosted-glass backdrop: the vibrancy material shows through
        // the transparent webview wherever the app's surfaces are
        // translucent (html.mac overrides in index.css).
        // WindowBackground is the light window-surface material in
        // light appearance (UnderWindowBackground stays dark gray
        // even in light mode) and follows the system dark mode.
        .transparent(true)
        .effects(WindowEffectsConfig {
            effects: vec![WindowEffect::WindowBackground],
            state: Some(WindowEffectState::Active),
            radius: None,
            color: None,
            interactive: false,
        })
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
            app.manage(HarperState(std::sync::Mutex::new(None)));
            build_app_menu(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            account::account_status,
            account::account_set_server,
            account::account_sign_in,
            account::account_cancel_sign_in,
            account::account_sign_out,
            detect_tex,
            get_settings,
            set_projects_root,
            read_external_file,
            list_bib_files,
            pick_bib_source,
            zotero_local_fetch,
            lookup_bibtex,
            create_project,
            list_templates,
            open_project,
            open_project_dialog,
            remove_recent_project,
            update_preferences,
            check_words,
            add_spellcheck_word,
            spellcheck_suggestions,
            check_grammar,
            grammar_rules,
            update_grammar_settings,
            list_spellcheck_languages,
            install_spellcheck_language,
            set_spellcheck_language,
            set_project_menu_enabled,
            set_menu_checked,
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
            read_asset,
            import_assets,
            list_asset_meta,
            save_asset_meta,
            tex_package_info,
            set_main_file,
            set_open_files,
            compile_project,
            cancel_compile,
            set_compile_provider,
            cloud_compile_status,
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
            git_set_remote,
            git_abort_merge,
            git_resolve_conflict,
            git_mark_resolved,
            git_fetch,
            git_pull,
            git_push,
            git_clone_project,
            git_accounts,
            git_account_save,
            git_account_remove,
            hosting_sign_in_available,
            hosting_sign_in_start,
            hosting_sign_in_finish,
            hosting_sign_in_cancel,
            hosting_publish,
            git_available,
            git_ignored,
            set_version_control,
            reveal_build_folder,
            show_context_menu,
            list_comments,
            save_comments,
            ai::ai_chat,
            update_ai_settings,
            get_project_config,
            save_project_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_tex_args_that_read_as_options() {
        let tmp = fs::canonicalize(std::env::temp_dir()).unwrap();
        let dir = tmp.to_string_lossy().to_string();
        assert!(validate_tex_arg(&dir, "chapters/intro.tex").is_err(), "not an open project");
        guard::allow(&tmp);
        assert!(validate_tex_arg(&dir, "-pdflatex=evil.tex").is_err());
        assert!(validate_tex_arg(&dir, "../main.tex").is_err());
        assert!(validate_tex_arg(&dir, "chapters/intro.tex").is_ok());
    }

    /// Needs latexmk on PATH; skipped otherwise.
    #[cfg(unix)]
    #[test]
    fn project_latexmkrc_never_runs() {
        if Command::new("latexmk").arg("--version").output().is_err() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("polemic-latexmkrc-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("main.tex"),
            "\\documentclass{article}\\begin{document}Hi\\end{document}\n",
        )
        .unwrap();
        let rc = "system(\"touch PWNED\");\n";
        fs::write(dir.join("latexmkrc"), rc).unwrap();
        fs::write(dir.join(".latexmkrc"), rc).unwrap();
        let output =
            output_with_timeout(latexmk_command(&dir, "main.tex", profile::Engine::Pdflatex), COMPILE_TIMEOUT).ok().unwrap();
        assert!(!dir.join("PWNED").exists(), "the project's latexmkrc ran");
        if Command::new("pdflatex").arg("--version").output().is_ok() {
            assert!(output.status.success());
            assert!(dir.join("build/main.pdf").is_file());
        }
        let _ = fs::remove_dir_all(&dir);
    }

    /// Needs latexmk and xelatex on PATH; skipped otherwise.
    #[test]
    fn compiles_with_the_resolved_engine() {
        let have = |tool: &str| Command::new(tool).arg("--version").output().is_ok();
        if !have("latexmk") || !have("xelatex") {
            return;
        }
        let dir = std::env::temp_dir().join(format!("polemic-engine-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        // \XeTeXversion exists only under xetex: pdflatex would fail.
        let source = "% !TEX program = xelatex\n\\documentclass{article}\\begin{document}\\the\\XeTeXversion\\end{document}\n";
        fs::write(dir.join("main.tex"), source).unwrap();
        let engine = profile::resolve(&profile::load(&dir), source);
        assert_eq!(engine, profile::Engine::Xelatex);
        let output =
            output_with_timeout(latexmk_command(&dir, "main.tex", engine), COMPILE_TIMEOUT).ok().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stdout));
        assert!(dir.join("build/main.pdf").is_file());
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn kills_commands_that_run_too_long() {
        // The shell's child stands in for the TeX run latexmk starts: the
        // timeout must take down the whole tree, and only that tree.
        let pid_file = std::env::temp_dir().join(format!("polemic-timeout-{}", std::process::id()));
        let mut slow = Command::new("sh");
        slow.arg("-c")
            .arg(format!("sleep 30 & echo $! > {}; wait", pid_file.display()));
        let start = std::time::Instant::now();
        let result = output_with_timeout(slow, std::time::Duration::from_millis(300));
        assert!(matches!(result, Err(RunError::TimedOut)));
        assert!(start.elapsed() < std::time::Duration::from_secs(5));
        let grandchild: libc::pid_t = fs::read_to_string(&pid_file).unwrap().trim().parse().unwrap();
        let _ = fs::remove_file(&pid_file);
        std::thread::sleep(std::time::Duration::from_millis(100));
        // Gone, or a zombie waiting to be reaped (no init in containers).
        let state = fs::read_to_string(format!("/proc/{grandchild}/stat")).unwrap_or_default();
        let alive = unsafe { libc::kill(grandchild, 0) } == 0
            && !state.split_whitespace().nth(2).is_some_and(|s| s == "Z");
        if alive {
            unsafe { libc::kill(grandchild, libc::SIGKILL) };
        }
        assert!(!alive, "the TeX process outlived the timeout");

        let mut quick = Command::new("sh");
        quick.args(["-c", "echo out; echo err >&2"]);
        let output = output_with_timeout(quick, std::time::Duration::from_secs(5)).ok().unwrap();
        assert_eq!(String::from_utf8_lossy(&output.stdout), "out\n");
        assert_eq!(String::from_utf8_lossy(&output.stderr), "err\n");
    }
}
