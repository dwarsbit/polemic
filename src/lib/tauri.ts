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

/** A reference source: a .bib file/folder anywhere on the filesystem
 *  (referenced in place), or a Zotero connection. Searched by
 *  "Add from Sources…" when enabled. */
export interface SourceDef {
  id: string;
  kind: "bib" | "zotero-app" | "zotero-cloud";
  enabled: boolean;
  name: string | null;
  /** Absolute path of a .bib file or a folder containing them.
   *  Bib sources only. */
  path: string | null;
  /** Zotero cloud credentials; zotero-cloud sources only. */
  userId: string | null;
  apiKey: string | null;
}

export interface Settings {
  projectsRoot: string;
  /** The user's reference sources (see SourceDef). */
  sources: SourceDef[];
  recentProjects: RecentProject[];
  mainFiles: Record<string, string>;
  openFiles: Record<string, string[]>;
  pinnedProjects: string[];
  lastProjectPath: string | null;
  theme: string | null;
  autoCompile: boolean | null;
  fontSize: number | null;
  editorFont: string | null;
  syntaxTheme: string | null;
  panelLayout: Record<string, number> | null;
  previewZoom: number | null;
  spellcheck: boolean | null;
  spellcheckLanguage: string | null;
  supsubBraces: boolean | null;
  convertDoubleDollar: boolean | null;
  formatOnSave: boolean | null;
  mathPreviewEngine: string | null;
  caretStyle: string | null;
  caretColor: string | null;
  caretCustomColor: string | null;
  reopenLastProject: boolean | null;
  autoIncludeNewFiles: boolean | null;
  /** "git" or "snapshots"; null means auto (git when installed). */
  versionControl: string | null;
}

export interface ProjectInfo {
  name: string;
  path: string;
}

export interface CommentAnchor {
  text: string;
  /** 1-based line number at creation time. */
  line: number;
}

export interface Comment {
  id: string;
  /** Project-relative file path. */
  file: string;
  /** A COMMENT_CATEGORIES id (see lib/comment-categories). */
  category: string;
  text: string;
  createdAt: number;
  resolved: boolean;
  /** null: a whole-file comment. */
  anchor: CommentAnchor | null;
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
}

/** Languages with ready wordlists (bundled or downloadable on demand). */
export const DOWNLOADABLE_LANGUAGES = [
  { id: "de", name: "German" },
  { id: "fr", name: "French" },
  { id: "es", name: "Spanish" },
  { id: "it", name: "Italian" },
  { id: "nl", name: "Dutch" },
] as const;

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  /** File size in bytes (files only). */
  size: number | null;
  /** Last modified, unix seconds (files only). */
  modified: number | null;
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

export interface SnapshotChange {
  path: string;
  status: "added" | "removed" | "modified";
  addedLines: number;
  removedLines: number;
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

export function listTemplates(): Promise<TemplateInfo[]> {
  return invoke<TemplateInfo[]>("list_templates");
}

export function createProject(name: string, templateId: string): Promise<ProjectInfo> {
  return invoke<ProjectInfo>("create_project", { name, templateId });
}

export function openProject(path: string): Promise<ProjectInfo> {
  return invoke<ProjectInfo>("open_project", { path });
}

export function removeRecentProject(path: string): Promise<Settings> {
  return invoke<Settings>("remove_recent_project", { path });
}

export interface EditorPreferences {
  theme?: string;
  autoCompile?: boolean;
  fontSize?: number;
  editorFont?: string;
  syntaxTheme?: string;
  spellcheck?: boolean;
  supsubBraces?: boolean;
  convertDoubleDollar?: boolean;
  formatOnSave?: boolean;
  mathPreviewEngine?: string;
  caretStyle?: string;
  caretColor?: string;
  caretCustomColor?: string;
  reopenLastProject?: boolean;
  autoIncludeNewFiles?: boolean;
  /** The user's reference sources (see SourceDef). */
  sources?: SourceDef[];
}

export function updatePreferences(prefs: EditorPreferences): Promise<Settings> {
  const args: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(prefs)) {
    if (value !== undefined) args[key] = value;
  }
  return invoke<Settings>("update_preferences", args);
}

export function setVersionControl(value: "git" | "snapshots"): Promise<Settings> {
  return invoke<Settings>("set_version_control", { value });
}

/** A native context menu entry, shown by the show_context_menu command. */
export type ContextMenuSpec =
  | { kind: "item"; id: string; text: string }
  | { kind: "separator" };

/** Pop up the OS-native context menu at the cursor (blocks until dismissed). */
export function showContextMenu(items: ContextMenuSpec[]): Promise<void> {
  return invoke<void>("show_context_menu", { items });
}

export function listComments(projectDir: string): Promise<Comment[]> {
  return invoke<Comment[]>("list_comments", { projectDir });
}

export function saveComments(projectDir: string, comments: Comment[]): Promise<void> {
  return invoke<void>("save_comments", { projectDir, comments });
}

export function gitAvailable(): Promise<boolean> {
  if (!isTauri()) return Promise.resolve(false);
  return invoke<boolean>("git_available");
}

export function gitIgnored(projectDir: string): Promise<string[]> {
  return invoke<string[]>("git_ignored", { projectDir });
}

export function checkWords(words: string[]): Promise<boolean[]> {
  return invoke<boolean[]>("check_words", { words });
}

export function addSpellcheckWord(word: string): Promise<void> {
  return invoke<void>("add_spellcheck_word", { word });
}

export function listSpellcheckLanguages(): Promise<string[]> {
  return invoke<string[]>("list_spellcheck_languages");
}

/** Download URL for an on-demand wordlist (hermitdave/FrequencyWords, MIT). */
export function spellcheckLanguageUrl(lang: string): string {
  return `https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/${lang}/${lang}_full.txt`;
}

export function installSpellcheckLanguage(
  lang: string,
  content: string,
): Promise<void> {
  return invoke<void>("install_spellcheck_language", { lang, content });
}

export function setSpellcheckLanguage(lang: string): Promise<void> {
  return invoke<void>("set_spellcheck_language", { lang });
}

export function exportPdf(
  projectDir: string,
  mainTex: string,
  destPath: string,
): Promise<void> {
  return invoke<void>("export_pdf", { projectDir, mainTex, destPath });
}

export function openPdf(projectDir: string, mainTex: string): Promise<void> {
  return invoke<void>("open_pdf", { projectDir, mainTex });
}

export function setProjectMenuEnabled(enabled: boolean): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke<void>("set_project_menu_enabled", { enabled });
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

/** Read an arbitrary user-chosen file (the read-only side of bib
 *  sources, which live anywhere on the filesystem). */
export function readExternalFile(path: string): Promise<string> {
  return invoke<string>("read_external_file", { path });
}

/** Every .bib file under a folder (recursively), or the file itself
 *  when `path` points at one. */
export function listBibFiles(path: string): Promise<string[]> {
  return invoke<string[]>("list_bib_files", { path });
}

/**
 * GET one path of the local Zotero API. Routed through Rust: Zotero
 * drops connections that carry an Origin header, so the webview
 * cannot fetch it directly.
 */
export function zoteroLocalFetch(path: string, query: string): Promise<string> {
  return invoke<string>("zotero_local_fetch", { path, query });
}

export function createProjectEntry(
  projectDir: string,
  path: string,
  isDir: boolean,
): Promise<void> {  return invoke<void>("create_project_entry", { projectDir, path, isDir });
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

/** Read any project file as raw bytes (binary-safe, e.g. images). */
export async function readAsset(projectDir: string, path: string): Promise<Uint8Array> {
  const res = await invoke<RawPdf>("read_asset", { projectDir, path });
  if (res instanceof Uint8Array) return res;
  if (res instanceof ArrayBuffer) return new Uint8Array(res);
  return new Uint8Array(res);
}

/** Copy files into the project's assets/ folder; returns the relative paths. */
export function importAssets(
  projectDir: string,
  sources: string[],
): Promise<string[]> {
  return invoke<string[]>("import_assets", { projectDir, sources });
}

/** Asset tags per project-relative path (`.polemic/assets.json`). */
export type AssetTags = Record<string, string[]>;

export function listAssetMeta(projectDir: string): Promise<AssetTags> {
  return invoke<AssetTags>("list_asset_meta", { projectDir });
}

export function saveAssetMeta(
  projectDir: string,
  tags: AssetTags,
): Promise<void> {
  return invoke<void>("save_asset_meta", { projectDir, tags });
}

/** Local TeX distribution info about a package. */
export interface TexPackageInfo {
  installed: boolean;
  description: string | null;
}

export function texPackageInfo(names: string[]): Promise<TexPackageInfo[]> {
  return invoke<TexPackageInfo[]>("tex_package_info", { names });
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

export function listSnapshotChanges(
  projectDir: string,
  id: string,
): Promise<SnapshotChange[]> {
  return invoke<SnapshotChange[]>("list_snapshot_changes", { projectDir, id });
}

export function readSnapshotFile(
  projectDir: string,
  id: string,
  path: string,
): Promise<string> {
  return invoke<string>("read_snapshot_file", { projectDir, id, path });
}

export function restoreSnapshotFile(
  projectDir: string,
  id: string,
  path: string,
): Promise<void> {
  return invoke<void>("restore_snapshot_file", { projectDir, id, path });
}

export function revealBuildFolder(projectDir: string): Promise<void> {
  return invoke<void>("reveal_build_folder", { projectDir });
}

// --- git --------------------------------------------------------------------

export interface GitEntry {
  path: string;
  /** Porcelain X code: staged change ("?" when untracked, " " when none). */
  x: string;
  /** Porcelain Y code: unstaged change ("?" when untracked, " " when none). */
  y: string;
}

export interface GitStatus {
  available: boolean;
  isRepo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  entries: GitEntry[];
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  timestampMillis: number;
}

export function gitStatus(projectDir: string): Promise<GitStatus> {
  return invoke<GitStatus>("git_status", { projectDir });
}

export function gitInit(projectDir: string): Promise<void> {
  return invoke<void>("git_init", { projectDir });
}

export function gitStage(projectDir: string, paths: string[]): Promise<void> {
  return invoke<void>("git_stage", { projectDir, paths });
}

export function gitUnstage(projectDir: string, paths: string[]): Promise<void> {
  return invoke<void>("git_unstage", { projectDir, paths });
}

export function gitCommit(projectDir: string, message: string): Promise<GitCommit> {
  return invoke<GitCommit>("git_commit", { projectDir, message });
}

export function gitLog(projectDir: string, limit: number): Promise<GitCommit[]> {
  return invoke<GitCommit[]>("git_log", { projectDir, limit });
}

export function gitShowHead(projectDir: string, path: string): Promise<string | null> {
  return invoke<string | null>("git_show_head", { projectDir, path });
}
