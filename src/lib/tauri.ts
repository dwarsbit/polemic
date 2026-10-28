import { invoke } from "@tauri-apps/api/core";

export interface ToolInfo {
  found: boolean;
  version: string | null;
  path: string | null;
}

export interface TexStatus {
  pdflatex: ToolInfo;
  xelatex: ToolInfo;
  lualatex: ToolInfo;
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
  /** The .tex editor's face: "visual" or "code"; null = code. */
  texEditorMode: string | null;
  /** The .bib editor's face: "visual" or "code"; null = visual. */
  bibEditorMode: string | null;
  /** Opt-in: DOI/arXiv import may contact doi.org. */
  onlineLookup: boolean | null;
  /** The AI quickfix provider; null until configured. */
  ai: AiSettings | null;
  grammar: GrammarSettings;
  /** The Polemic server for the account; null means app.polemicapp.com. */
  accountServer: string | null;
  /** The name on suggestions (track changes); null until set. */
  authorName: string | null;
  /** The author's initials, the suggestion id; null derives them. */
  authorInitials: string | null;
}

/** Grammar checking: built-in Harper (English), LanguageTool on the
 *  Polemic account's server (Professional), or the user's own LanguageTool. */
export interface GrammarSettings {
  /** null means on. */
  enabled: boolean | null;
  /** null: "languagetool" when a URL is set, else "builtin". */
  provider: GrammarProvider | null;
  /** A LanguageTool server up to /v2; null uses the built-in checker. */
  languageToolUrl: string | null;
  /** "en-US" (default), "en-GB", "en-AU", "en-CA", "en-IN". */
  englishVariant: string | null;
  /** Rule ids switched off. */
  disabledRules: string[];
}

export type GrammarProvider = "builtin" | "polemic" | "languagetool";

/** Why a grammar check failed (the Rust `GrammarError`). */
export interface GrammarError {
  kind:
    "signedOut" | "planRequired" | "tooLong" | "rateLimited" | "unavailable" | "failed";
  message: string;
  /** Seconds, for "rateLimited". */
  retryAfter: number | null;
}

/** A grammar or style issue in a prose block (UTF-16 offsets). */
export interface GrammarIssue {
  from: number;
  to: number;
  message: string;
  rule: string;
  category: string;
  replacements: string[];
}

export interface GrammarRule {
  id: string;
  description: string;
}

/** An OpenAI-compatible chat-completions endpoint for the AI
 *  quickfix, configured in settings. */
export interface AiSettings {
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
}

/** Save the AI quickfix provider; replaces the whole block. */
export function updateAiSettings(
  baseUrl: string | null,
  apiKey: string | null,
  model: string | null,
): Promise<Settings> {
  return invoke<Settings>("update_ai_settings", { baseUrl, apiKey, model });
}

/** One chat completion against the configured provider; returns the
 *  assistant message's content. */
export function aiChat(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
}): Promise<string> {
  return invoke<string>("ai_chat", { args });
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
  /** A reply to a suggestion's note: the note's key (see
   *  lib/suggestion-notes), so the thread follows the suggestion. */
  suggestion?: string | null;
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  /** What the template needs from the TeX distribution (publisher
   *  classes and their fonts); nothing is bundled. */
  requires: TemplateRequirement[];
}

/** A file to look up (`kpsewhich`) and the package that ships it. */
export interface TemplateRequirement {
  file: string;
  package: string;
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
  /** The error's context block from the log: the `l.N …` line showing
   *  the source up to the point of the error, plus its wrapped
   *  continuation lines. Empty for warnings. */
  detail: string[];
  /** What to do about it, when the message alone does not say (a
   *  crashed biber, a missing .bib file). */
  hint?: string | null;
}

export interface CompileOutcome {
  success: boolean;
  issues: CompileIssue[];
  log: string;
  /** The engine latexmk drove, e.g. "xelatex". */
  engine: TexEngine;
}

export type TexEngine = "pdflatex" | "xelatex" | "lualatex";

/** Per-project settings in `.polemic/project.json`. */
export interface ProjectConfig {
  /** null or "auto": magic comment, then a preamble guess. */
  engine: TexEngine | "auto" | null;
  /** Words the spellcheck accepts in this project only. */
  ignoredWords?: string[];
}

export function getProjectConfig(projectDir: string): Promise<ProjectConfig> {
  return invoke<ProjectConfig>("get_project_config", { projectDir });
}

export function saveProjectConfig(
  projectDir: string,
  config: ProjectConfig,
): Promise<void> {
  return invoke<void>("save_project_config", { projectDir, config });
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

/** Pick a project folder in a native dialog; null when cancelled. */
export function openProjectDialog(): Promise<ProjectInfo | null> {
  return invoke<ProjectInfo | null>("open_project_dialog");
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
  texEditorMode?: string;
  bibEditorMode?: string;
  onlineLookup?: boolean;
  /** The user's reference sources (see SourceDef). */
  sources?: SourceDef[];
  /** Empty clears it. */
  authorName?: string;
  /** Empty clears it. */
  authorInitials?: string;
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
  { kind: "item"; id: string; text: string } | { kind: "separator" };

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

/** Grammar issues per prose block (see lib/prose). Rejects with a
 *  `GrammarError`. */
export function checkGrammar(blocks: string[]): Promise<GrammarIssue[][]> {
  return invoke<GrammarIssue[][]>("check_grammar", { blocks });
}

/** The built-in checker's rules, for switching them off. */
export function grammarRules(): Promise<GrammarRule[]> {
  return invoke<GrammarRule[]>("grammar_rules");
}

export function updateGrammarSettings(grammar: GrammarSettings): Promise<Settings> {
  return invoke<Settings>("update_grammar_settings", { grammar });
}

/** Corrections for a misspelled word, closest first. */
export function spellcheckSuggestions(word: string): Promise<string[]> {
  return invoke<string[]>("spellcheck_suggestions", { word });
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

/** Set the checkmark of a View menu item (a panel, the editor face). */
export function setMenuChecked(id: string, checked: boolean): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke<void>("set_menu_checked", { id, checked });
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

/** Read one .bib file of a configured bib source (bib sources live
 *  anywhere on the filesystem; other paths are refused). */
export function readExternalFile(path: string): Promise<string> {
  return invoke<string>("read_external_file", { path });
}

/** Every .bib file under a configured bib source folder
 *  (recursively), or the file itself when the source is one. */
export function listBibFiles(path: string): Promise<string[]> {
  return invoke<string[]>("list_bib_files", { path });
}

/** Add a bib source through a native picker (a .bib file, or a folder
 *  of them); null when cancelled. The only way a bib path enters the
 *  settings. */
export function pickBibSource(folder: boolean): Promise<Settings | null> {
  return invoke<Settings | null>("pick_bib_source", { folder });
}

/**
 * GET one path of the local Zotero API. Routed through Rust: Zotero
 * drops connections that carry an Origin header, so the webview
 * cannot fetch it directly.
 */
export function zoteroLocalFetch(path: string, query: string): Promise<string> {
  return invoke<string>("zotero_local_fetch", { path, query });
}

/**
 * The BibTeX record of one DOI, fetched Rust-side from doi.org.
 * Rejects unless online lookup is enabled in settings.
 */
export function lookupBibtex(doi: string): Promise<string> {
  return invoke<string>("lookup_bibtex", { doi });
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

/** Read any project file as raw bytes (binary-safe, e.g. images). */
export async function readAsset(projectDir: string, path: string): Promise<Uint8Array> {
  const res = await invoke<RawPdf>("read_asset", { projectDir, path });
  if (res instanceof Uint8Array) return res;
  if (res instanceof ArrayBuffer) return new Uint8Array(res);
  return new Uint8Array(res);
}

/** Copy files into the project's assets/ folder; returns the relative paths. */
export function importAssets(projectDir: string, sources: string[]): Promise<string[]> {
  return invoke<string[]>("import_assets", { projectDir, sources });
}

/** Asset tags per project-relative path (`.polemic/assets.json`). */
export type AssetTags = Record<string, string[]>;

export function listAssetMeta(projectDir: string): Promise<AssetTags> {
  return invoke<AssetTags>("list_asset_meta", { projectDir });
}

export function saveAssetMeta(projectDir: string, tags: AssetTags): Promise<void> {
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
  input: string,
  line: number,
  col: number,
): Promise<SynctexForward> {
  return invoke<SynctexForward>("synctex_forward", {
    projectDir,
    mainTex,
    input,
    line,
    col,
  });
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
  /** The origin remote's URL; null without a remote. */
  remote: string | null;
  /** The branch's upstream ("origin/main"); null until the first push. */
  upstream: string | null;
  /** Paths left unmerged by a pull. */
  conflicts: string[];
  /** A merge is in progress: resolve the conflicts, stage, commit. */
  merging: boolean;
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

/** Set the origin remote; an empty URL removes it. */
export function gitSetRemote(projectDir: string, url: string): Promise<void> {
  return invoke<void>("git_set_remote", { projectDir, url });
}

export function gitFetch(projectDir: string): Promise<void> {
  return invoke<void>("git_fetch", { projectDir });
}

export type GitPullOutcome =
  { kind: "upToDate" } | { kind: "updated" } | { kind: "conflicts"; paths: string[] };

export function gitPull(projectDir: string): Promise<GitPullOutcome> {
  return invoke<GitPullOutcome>("git_pull", { projectDir });
}

export function gitPush(projectDir: string): Promise<void> {
  return invoke<void>("git_push", { projectDir });
}

export function gitAbortMerge(projectDir: string): Promise<void> {
  return invoke<void>("git_abort_merge", { projectDir });
}

/** Clone a repository into the projects root as the project `name`. */
export function gitCloneProject(url: string, name: string): Promise<ProjectInfo> {
  return invoke<ProjectInfo>("git_clone_project", { url, name });
}

/** The project name a remote URL suggests: its last path segment. */
export function projectNameFromRemote(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  const last = trimmed.split(/[/:]/).pop() ?? "";
  return last.replace(/\.git$/, "");
}

// --- Polemic account (Professional) -------------------------------------------

/** The signed-in user, as the server's GET /api/me returns it. */
export interface AccountUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  /** null from servers without billing. */
  plan: "free" | "professional" | null;
}

export interface AccountStatus {
  server: string;
  signedIn: boolean;
  /** null while signed out, or signed in but the server can't be reached. */
  user: AccountUser | null;
  /** Why the user could not be fetched (offline, expired sign-in). */
  problem: string | null;
}

export function accountStatus(): Promise<AccountStatus> {
  return invoke<AccountStatus>("account_status");
}

/** Changes the server (empty: app.polemicapp.com); signs out of the old one. */
export function accountSetServer(server: string): Promise<AccountStatus> {
  return invoke<AccountStatus>("account_set_server", { server });
}

/** Opens the browser and resolves once the user has allowed Polemic there. */
export function accountSignIn(): Promise<AccountUser> {
  return invoke<AccountUser>("account_sign_in");
}

export function accountCancelSignIn(): Promise<void> {
  return invoke("account_cancel_sign_in");
}

/** Revokes the token on the server and forgets it. */
export function accountSignOut(): Promise<void> {
  return invoke("account_sign_out");
}
