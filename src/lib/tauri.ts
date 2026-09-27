import { invoke } from "@tauri-apps/api/core";

export interface ToolInfo {
  found: boolean;
  version: string | null;
  path: string | null;
}

export interface TexStatus {
  pdflatex: ToolInfo;
  latexmk: ToolInfo;
}

export interface RecentProject {
  name: string;
  path: string;
}

export interface Settings {
  projectsRoot: string;
  recentProjects: RecentProject[];
  mainFiles: Record<string, string>;
  openFiles: Record<string, string[]>;
  pinnedProjects: string[];
  lastProjectPath: string | null;
  theme: string | null;
  autoCompile: boolean | null;
  fontSize: number | null;
  panelLayout: Record<string, number> | null;
  previewZoom: number | null;
}

export interface ProjectInfo {
  name: string;
  path: string;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  children: FileEntry[];
}

export interface CompileIssue {
  severity: "error" | "warning";
  file: string | null;
  line: number | null;
  message: string;
}

export interface CompileOutcome {
  success: boolean;
  issues: CompileIssue[];
  log: string;
}

export interface SynctexForward {
  page: number;
  x: number;
  y: number;
}

export interface SynctexBackward {
  file: string;
  line: number;
}

export interface SnapshotInfo {
  id: string;
  createdAtMillis: number;
}

type RawPdf = Uint8Array | ArrayBuffer | number[];

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function detectTex(): Promise<TexStatus | null> {
  if (!isTauri()) return null;
  return invoke<TexStatus>("detect_tex");
}

export function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

export function setProjectsRoot(path: string): Promise<Settings> {
  return invoke<Settings>("set_projects_root", { path });
}

export function createProject(name: string): Promise<ProjectInfo> {
  return invoke<ProjectInfo>("create_project", { name });
}

export function openProject(path: string): Promise<ProjectInfo> {
  return invoke<ProjectInfo>("open_project", { path });
}

export function removeRecentProject(path: string): Promise<Settings> {
  return invoke<Settings>("remove_recent_project", { path });
}

export function updatePreferences(
  theme?: string,
  autoCompile?: boolean,
  fontSize?: number,
): Promise<Settings> {
  const args: Record<string, unknown> = {};
  if (theme !== undefined) args.theme = theme;
  if (autoCompile !== undefined) args.autoCompile = autoCompile;
  if (fontSize !== undefined) args.fontSize = fontSize;
  return invoke<Settings>("update_preferences", args);
}

export function setPanelLayout(layout: Record<string, number>): Promise<void> {
  return invoke<void>("set_panel_layout", { layout });
}

export function setPreviewZoom(zoom: number): Promise<void> {
  return invoke<void>("set_preview_zoom", { zoom });
}

export function setPinnedProject(path: string, pinned: boolean): Promise<Settings> {
  return invoke<Settings>("set_pinned_project", { path, pinned });
}

export function renameProject(path: string, newName: string): Promise<ProjectInfo> {
  return invoke<ProjectInfo>("rename_project", { path, newName });
}

export function deleteProject(path: string): Promise<Settings> {
  return invoke<Settings>("delete_project", { path });
}

export function listFiles(projectDir: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("list_files", { projectDir });
}

export function readProjectFile(projectDir: string, path: string): Promise<string> {
  return invoke<string>("read_project_file", { projectDir, path });
}

export function writeProjectFile(
  projectDir: string,
  path: string,
  content: string,
): Promise<void> {
  return invoke<void>("write_project_file", { projectDir, path, content });
}

export function createProjectEntry(
  projectDir: string,
  path: string,
  isDir: boolean,
): Promise<void> {
  return invoke<void>("create_project_entry", { projectDir, path, isDir });
}

export function renameEntry(
  projectDir: string,
  path: string,
  newPath: string,
): Promise<void> {
  return invoke<void>("rename_entry", { projectDir, path, newPath });
}

export function deleteEntry(projectDir: string, path: string): Promise<void> {
  return invoke<void>("delete_entry", { projectDir, path });
}

export function setMainFile(projectDir: string, mainFile: string): Promise<void> {
  return invoke<void>("set_main_file", { projectDir, mainFile });
}

export function setOpenFiles(projectDir: string, files: string[]): Promise<void> {
  return invoke<void>("set_open_files", { projectDir, files });
}

export function compileProject(
  projectDir: string,
  mainTex: string,
): Promise<CompileOutcome> {
  return invoke<CompileOutcome>("compile_project", { projectDir, mainTex });
}

export async function getPdf(projectDir: string, mainTex: string): Promise<Uint8Array> {
  const res = await invoke<RawPdf>("get_pdf", { projectDir, mainTex });
  if (res instanceof Uint8Array) return res;
  if (res instanceof ArrayBuffer) return new Uint8Array(res);
  return new Uint8Array(res);
}

export function synctexForward(
  projectDir: string,
  mainTex: string,
  line: number,
  col: number,
): Promise<SynctexForward> {
  return invoke<SynctexForward>("synctex_forward", { projectDir, mainTex, line, col });
}

export function synctexBackward(
  projectDir: string,
  mainTex: string,
  page: number,
  x: number,
  y: number,
): Promise<SynctexBackward> {
  return invoke<SynctexBackward>("synctex_backward", {
    projectDir,
    mainTex,
    page,
    x,
    y,
  });
}

export function createSnapshot(projectDir: string): Promise<SnapshotInfo> {
  return invoke<SnapshotInfo>("create_snapshot", { projectDir });
}

export function listSnapshots(projectDir: string): Promise<SnapshotInfo[]> {
  return invoke<SnapshotInfo[]>("list_snapshots", { projectDir });
}

export function restoreSnapshot(projectDir: string, id: string): Promise<void> {
  return invoke<void>("restore_snapshot", { projectDir, id });
}

export function revealBuildFolder(projectDir: string): Promise<void> {
  return invoke<void>("reveal_build_folder", { projectDir });
}
