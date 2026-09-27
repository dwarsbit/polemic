mod files;
mod logparse;
mod settings;
mod snapshots;

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

const STARTER_TEMPLATE: &str = r"\documentclass[11pt]{article}

\usepackage[T1]{fontenc}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage{hyperref}

\title{Untitled Document}
\author{}
\date{}

\begin{document}

\maketitle

\section{Introduction}

Write here.

\section{Conclusion}

\end{document}
";

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
fn create_project(app: tauri::AppHandle, name: String) -> Result<ProjectInfo, String> {
    validate_project_name(&name)?;
    let name = name.trim().to_string();
    let cfg = settings::effective(&app)?;
    let root = cfg.projects_root.expect("projects root is set by effective()");
    fs::create_dir_all(&root).map_err(|e| format!("failed to create projects root: {e}"))?;
    let dir = std::path::Path::new(&root).join(&name);
    if dir.exists() {
        return Err(format!("a project named \"{name}\" already exists"));
    }
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create project: {e}"))?;
    fs::write(dir.join("main.tex"), STARTER_TEMPLATE)
        .map_err(|e| format!("failed to write starter template: {e}"))?;
    let info = project_info(&dir);
    settings::update(&app, |s| {
        settings::upsert_recent(s, &info.name, &info.path);
    })?;
    Ok(info)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(SettingsState(std::sync::Mutex::new(settings::load(app.handle()))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            detect_tex,
            get_settings,
            set_projects_root,
            create_project,
            open_project,
            remove_recent_project,
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
            synctex_forward,
            synctex_backward,
            create_snapshot,
            list_snapshots,
            restore_snapshot,
            reveal_build_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
