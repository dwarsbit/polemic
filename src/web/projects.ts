/**
 * Projects in the browser build: the server's project documents in
 * place of folders on disk. A project's path is `/projects/<id>`, the
 * address it opens at; the file, comment and compile commands of
 * src/lib/tauri.ts are answered from its live document (layout in
 * src/lib/project-doc.ts), kept in sync with the server and everyone
 * else who has it open.
 */

import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import type {
  AssetTags,
  Comment,
  CompileError,
  CompileIssue,
  CompileOutcome,
  FileEntry,
  ProjectConfig,
  ProjectInfo,
  RecentProject,
  Settings,
  TexEngine,
} from "@/lib/tauri";
import { resolveEngine, parseEngine } from "@/lib/engine";
import {
  addFontHints,
  isRerunBibToolWarning,
  parseBibToolFailure,
  parseIssues,
} from "@/lib/logparse";
import {
  applyFileChange,
  applyFileDelete,
  applyRename,
  applyTextDiff,
  applyTextMerge,
  LOCAL_ORIGIN,
  normalizePath,
  projectFiles,
  textAt,
} from "@/lib/project-doc";
import { forward, parseSyncTex, sourceAt, type SyncTex } from "@/lib/synctex";
import { fetchBytes, request, ServerError, type ServerProject } from "@/web/server";
import { loadSettings, updateSettings } from "@/web/settings";

const PATH_PREFIX = "/projects/";
const SYNC_PATH = "/api/sync";

/** The address a project opens at, which is also its path in the editor. */
export const projectPath = (id: string) => PATH_PREFIX + id;

/** The project id of a path or address, or null. */
export function projectIdOf(path: string): string | null {
  if (!path.startsWith(PATH_PREFIX)) return null;
  const id = path.slice(PATH_PREFIX.length).replace(/\/+$/, "");
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}

interface OpenProject {
  id: string;
  path: string;
  info: ServerProject;
  doc: Y.Doc;
  provider: HocuspocusProvider;
  /** Folders made in this tab that hold no file yet (the document has no folders). */
  folders: Set<string>;
  /** Asset bytes by hash. */
  assets: Map<string, Uint8Array>;
  /** Comment ids this tab has read or written, for save_comments' deletes. */
  commentIds: Set<string>;
  pdf: Uint8Array | null;
  synctex: SyncTex | null;
}

let current: OpenProject | null = null;
let compileController: AbortController | null = null;

// --- remote changes ------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

/** Called (debounced) when the open project changes other than through
 *  this tab's own writes: someone else's edit, or a merge with one. */
export function onProjectChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifySoon() {
  if (notifyTimer !== null) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    for (const listener of listeners) listener();
  }, 250);
}

/** Whether edits of the open project have not reached the server yet. */
export function hasUnsyncedChanges(): boolean {
  return (current?.provider.unsyncedChanges ?? 0) > 0;
}

// --- opening -------------------------------------------------------------

function syncUrl(): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}${SYNC_PATH}`;
}

function notFound(): ServerError {
  return new ServerError(
    404,
    "not_found",
    "This project doesn't exist or isn't shared with you.",
  );
}

async function fetchInfo(id: string): Promise<ServerProject> {
  try {
    return await request<ServerProject>(`/api/projects/${id}`);
  } catch (e) {
    if (e instanceof ServerError && e.status === 404) throw notFound();
    throw e;
  }
}

/** Connects to the project's document; resolves once it has the server's copy. */
function connect(id: string, doc: Y.Doc): Promise<HocuspocusProvider> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      provider.destroy();
      reject(
        new Error("Could not load the project. Check your connection and try again."),
      );
    }, 30_000);
    const provider = new HocuspocusProvider({
      url: syncUrl(),
      name: id,
      // The session cookie signs the connection in.
      token: "",
      document: doc,
      onSynced: () => {
        clearTimeout(timer);
        resolve(provider);
      },
      onAuthenticationFailed: () => {
        clearTimeout(timer);
        provider.destroy();
        reject(notFound());
      },
    });
  });
}

function close() {
  compileController?.abort();
  compileController = null;
  current?.provider.destroy();
  current?.doc.destroy();
  current = null;
}

async function open(path: string): Promise<OpenProject> {
  if (current?.path === path) return current;
  const id = projectIdOf(path);
  if (!id) throw notFound();
  close();
  const info = await fetchInfo(id);
  const doc = new Y.Doc();
  const provider = await connect(id, doc);
  doc.on("update", (_update: Uint8Array, origin: unknown) => {
    if (origin !== LOCAL_ORIGIN) notifySoon();
  });
  current = {
    id,
    path,
    info,
    doc,
    provider,
    folders: new Set(),
    assets: new Map(),
    commentIds: new Set(),
    pdf: null,
    synctex: null,
  };
  return current;
}

/** The open project for a command's `projectDir`. */
function project(args: Args): OpenProject {
  const dir = String(args.projectDir ?? args.path ?? "");
  if (!current || current.path !== dir) throw "This project isn't open.";
  return current;
}

const READ_ONLY_DESKTOP =
  "This project is published from the desktop app. Change it there.";

function requireWritable(open: OpenProject) {
  if (open.info.writable) return;
  throw open.info.source === "desktop" && open.info.role === "owner"
    ? READ_ONLY_DESKTOP
    : "You can only read this project. Ask its owner to make you an editor.";
}

/** The open project leaves the tab (back to the project list). */
export function closeProject(): void {
  close();
}

/** The read-only notice for the open project, or null when it is writable. */
export function readOnlyReason(): string | null {
  if (!current || current.info.writable) return null;
  try {
    requireWritable(current);
  } catch (reason) {
    return String(reason);
  }
  return null;
}

// --- files ---------------------------------------------------------------

function cleanPath(path: unknown): string {
  const normal = normalizePath(String(path ?? ""));
  if (!normal) throw `Invalid path: ${String(path)}`;
  return normal;
}

const isHidden = (path: string) => path.split("/").some((part) => part.startsWith("."));
const encoder = new TextEncoder();

/** The file tree as list_files gives it: folders first, then by name; dot names hidden. */
function fileTree(open: OpenProject): FileEntry[] {
  const { texts, assets } = projectFiles(open.doc);
  const root: FileEntry[] = [];
  const dirs = new Map<string, FileEntry>();
  const dirOf = (path: string): FileEntry[] => {
    if (path === "") return root;
    const existing = dirs.get(path);
    if (existing) return existing.children;
    const slash = path.lastIndexOf("/");
    const entry: FileEntry = {
      name: path.slice(slash + 1),
      path,
      isDir: true,
      size: null,
      modified: null,
      children: [],
    };
    dirs.set(path, entry);
    dirOf(slash >= 0 ? path.slice(0, slash) : "").push(entry);
    return entry.children;
  };
  const add = (path: string, size: number) => {
    if (isHidden(path)) return;
    const slash = path.lastIndexOf("/");
    dirOf(slash >= 0 ? path.slice(0, slash) : "").push({
      name: path.slice(slash + 1),
      path,
      isDir: false,
      size,
      modified: null,
      children: [],
    });
  };
  for (const [path, id] of texts) {
    add(
      path,
      encoder.encode(open.doc.getMap<Y.Text>("texts").get(id)!.toString()).length,
    );
  }
  for (const [path, ref] of assets) add(path, ref.size);
  for (const folder of open.folders) if (!isHidden(folder)) dirOf(folder);
  const sort = (entries: FileEntry[]) => {
    entries.sort((a, b) =>
      a.isDir !== b.isDir
        ? a.isDir
          ? -1
          : 1
        : a.name < b.name
          ? -1
          : a.name > b.name
            ? 1
            : 0,
    );
    for (const entry of entries) sort(entry.children);
  };
  sort(root);
  return root;
}

function readText(open: OpenProject, path: string): string {
  const text = textAt(open.doc, path);
  if (text) return text.toString();
  if (projectFiles(open.doc).assets.has(path)) throw `${path} isn't a text file.`;
  throw `${path} doesn't exist.`;
}

function exists(open: OpenProject, path: string): boolean {
  const { texts, assets } = projectFiles(open.doc);
  const inside = (p: string) => p === path || p.startsWith(path + "/");
  return (
    [...texts.keys()].some(inside) ||
    [...assets.keys()].some(inside) ||
    [...open.folders].some(inside)
  );
}

/**
 * Writes a text file. With `base`, the text the edit started from, the
 * edit is merged with changes others made since; without it the file
 * becomes `content`. A merge that changes the result tells the editor
 * to load it.
 */
function writeText(
  open: OpenProject,
  path: string,
  content: string,
  base: string | null,
) {
  const text = textAt(open.doc, path);
  if (!text) {
    applyFileChange(open.doc, { path, kind: "text", text: content });
    return;
  }
  open.doc.transact(() => {
    if (base !== null) applyTextMerge(text, base, content);
    else applyTextDiff(text, content);
  }, LOCAL_ORIGIN);
  if (text.toString() !== content) notifySoon();
}

function readJson<T>(open: OpenProject, path: string, fallback: T): T {
  const text = textAt(open.doc, path)?.toString();
  if (text === undefined) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** JSON as the desktop app writes it (two-space indent, no final newline). */
function writeJson(open: OpenProject, path: string, value: unknown) {
  const json = JSON.stringify(value, null, 2);
  if (textAt(open.doc, path)?.toString() !== json) writeText(open, path, json, null);
}

// --- comments ------------------------------------------------------------

const COMMENTS = ".polemic/comments/";
const validCommentId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

/** A comment as comments.rs serializes it: its fields in order, optional ones only when set. */
function commentJson(comment: Comment): Record<string, unknown> {
  const json: Record<string, unknown> = {
    id: comment.id,
    file: comment.file,
    category: comment.category,
    text: comment.text,
    createdAt: comment.createdAt,
    resolved: comment.resolved,
    anchor: comment.anchor,
  };
  if (comment.suggestion != null) json.suggestion = comment.suggestion;
  if (comment.author) json.author = comment.author;
  if (comment.replyTo) json.replyTo = comment.replyTo;
  return json;
}

function listComments(open: OpenProject): Comment[] {
  const comments: Comment[] = [];
  for (const path of projectFiles(open.doc).texts.keys()) {
    if (!path.startsWith(COMMENTS) || !path.endsWith(".json")) continue;
    const comment = readJson<Comment | null>(open, path, null);
    if (comment && typeof comment.id === "string" && validCommentId(comment.id)) {
      comments.push(comment);
    }
  }
  comments.sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  for (const comment of comments) open.commentIds.add(comment.id);
  return comments;
}

function saveComments(open: OpenProject, comments: Comment[]) {
  const bad = comments.find((comment) => !validCommentId(comment.id));
  if (bad) throw `invalid comment id: ${bad.id}`;
  const kept = new Set(comments.map((comment) => comment.id));
  open.doc.transact(() => {
    for (const comment of comments)
      writeJson(open, `${COMMENTS}${comment.id}.json`, commentJson(comment));
    for (const id of open.commentIds) {
      if (!kept.has(id)) applyFileDelete(open.doc, `${COMMENTS}${id}.json`);
    }
  }, LOCAL_ORIGIN);
  open.commentIds = kept;
}

// --- compile -------------------------------------------------------------

interface CompileAnswer {
  status: "success" | "failure" | "timeout";
  engine: TexEngine;
  output: string;
  outputs: { kind: "pdf" | "synctex" | "log" | "blg"; url: string }[];
}

const DEFAULT_RETRY_AFTER = 10;

function compileError(
  kind: CompileError["kind"],
  message: string,
  retryAfter: number | null = null,
): CompileError {
  return { kind, message, retryAfter };
}

/** The error for a refused compile, as cloud_compile.rs maps the answers. */
function compileErrorFor(e: ServerError): CompileError {
  const seconds = Math.min(3600, Math.max(1, e.retryAfter ?? DEFAULT_RETRY_AFTER));
  const wait = (text: string) =>
    compileError("rateLimited", `${text} Try again in ${seconds} s.`, seconds);
  if (e.status === 402)
    return compileError("planRequired", "Compiling needs a paid plan on this server.");
  if (e.status === 404 && e.code === "compile_disabled") {
    return compileError("disabled", "This Polemic server has no cloud compile.");
  }
  if (e.status === 409 && e.code === "superseded") {
    return compileError(
      "superseded",
      "A newer compile from your account (another tab or computer) replaced this one.",
    );
  }
  if (e.status === 409 && e.code === "assets_missing") {
    const missing = Array.isArray(e.body.missing) ? (e.body.missing as string[]) : [];
    return compileError(
      "failed",
      `Some files of this project were never uploaded: ${missing.join(", ")}. Publish it again from the desktop app.`,
    );
  }
  if (e.status === 413) return compileError("tooLarge", e.message);
  if (e.status === 429 && e.code === "compile_limit") {
    return compileError("limitReached", e.message, seconds);
  }
  if (e.status === 429) return wait("Too many compiles.");
  if (e.status === 503) return wait("Every compile slot on the server is busy.");
  if (e.status >= 500) {
    return compileError(
      "unavailable",
      "Compiling is unavailable right now. Try again later.",
    );
  }
  if (e.status === 0) return compileError("unavailable", e.message);
  return compileError("failed", e.message);
}

/** Longest a compile runs on the server. */
const SERVER_COMPILE_MINUTES = 4;

/** Waits until the server has every edit, so the compile sees them. */
function edgesSynced(open: OpenProject): Promise<void> {
  if (open.provider.unsyncedChanges === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      open.provider.off("unsyncedChanges", check);
      reject(
        compileError(
          "unavailable",
          "Your latest edits haven't reached Polemic yet. Check your connection and compile again.",
        ),
      );
    }, 15_000);
    const check = () => {
      if (open.provider.unsyncedChanges > 0) return;
      clearTimeout(timer);
      open.provider.off("unsyncedChanges", check);
      resolve();
    };
    open.provider.on("unsyncedChanges", check);
  });
}

async function compile(open: OpenProject, main: string): Promise<CompileOutcome> {
  compileController?.abort();
  const controller = new AbortController();
  compileController = controller;
  const cancelled = () => compileError("cancelled", "The compile was stopped.");
  const read = (path: string) => textAt(open.doc, path)?.toString() ?? null;
  const config = readJson<ProjectConfig>(open, ".polemic/project.json", {
    engine: null,
  });
  const engine = resolveEngine(config, main, read(main) ?? "", read);
  try {
    await edgesSynced(open);
    if (controller.signal.aborted) throw cancelled();
    const answer = await request<CompileAnswer>(`/api/projects/${open.id}/compile`, {
      method: "POST",
      json: { main, engine },
      signal: controller.signal,
    });
    const fetched = new Map<string, Uint8Array>();
    await Promise.all(
      answer.outputs.map(async (output) => {
        try {
          fetched.set(output.kind, await fetchBytes(output.url, controller.signal));
        } catch (e) {
          if (e instanceof ServerError) {
            throw compileError(
              "failed",
              `Could not download the compile's ${output.kind} (${e.status}). Compile again.`,
            );
          }
          throw e;
        }
      }),
    );
    const decoder = new TextDecoder();
    const pdf = fetched.get("pdf");
    if (pdf) open.pdf = pdf;
    const synctex = fetched.get("synctex");
    if (synctex) {
      const stream = new Blob([synctex as Uint8Array<ArrayBuffer>])
        .stream()
        .pipeThrough(new DecompressionStream("gzip"));
      open.synctex = parseSyncTex(await new Response(stream).text());
    }
    const log = fetched.get("log");
    const blg = fetched.get("blg");
    let issues: CompileIssue[] = log ? parseIssues(decoder.decode(log)) : [];
    const failure = parseBibToolFailure(
      answer.output,
      blg ? decoder.decode(blg) : null,
    );
    if (failure)
      issues = [failure, ...issues.filter((issue) => !isRerunBibToolWarning(issue))];
    addFontHints(issues);
    if (answer.status === "timeout") {
      issues.unshift({
        severity: "error",
        file: null,
        line: null,
        message: `The compile was stopped after ${SERVER_COMPILE_MINUTES} minutes on the Polemic server.`,
        detail: [],
        hint: "The document may loop forever; check recent macro changes.",
      });
    }
    return {
      success: answer.status === "success",
      issues,
      log: answer.output,
      engine: answer.engine,
    };
  } catch (e) {
    if (controller.signal.aborted) throw cancelled();
    if (e instanceof ServerError) throw compileErrorFor(e);
    throw e;
  } finally {
    if (compileController === controller) compileController = null;
  }
}

function texFiles(open: OpenProject): string[] {
  return [...projectFiles(open.doc).texts.keys()];
}

// --- the project list ----------------------------------------------------

/** What the start screen shows under a project's name. */
function detailOf(project: ServerProject): string {
  const whose = project.role === "owner" ? "Yours" : `Shared by ${project.owner.name}`;
  if (project.writable) return whose;
  return project.source === "desktop" && project.role === "owner"
    ? `${whose}, read-only: published from the desktop app`
    : `${whose}, read-only`;
}

async function serverProjects(): Promise<RecentProject[]> {
  const { projects } = await request<{ projects: ServerProject[] }>("/api/projects");
  return projects.map((project) => ({
    name: project.name,
    path: projectPath(project.id),
    detail: detailOf(project),
  }));
}

async function settingsWithProjects(): Promise<Settings> {
  return { ...loadSettings(), recentProjects: await serverProjects() };
}

/** A new project's first file: the desktop app's Article template. */
const STARTER = `\\documentclass[11pt]{article}

\\usepackage[T1]{fontenc}
\\usepackage{amsmath}
\\usepackage{graphicx}
\\usepackage{hyperref}

\\title{Untitled Article}
\\author{}
\\date{}

\\begin{document}

\\maketitle

\\section{Introduction}

Write here.

\\section{Conclusion}

\\end{document}
`;

// --- commands ------------------------------------------------------------

type Args = Record<string, unknown>;

const info = (open: OpenProject): ProjectInfo => ({
  name: open.info.name,
  path: open.path,
  readOnly: readOnlyReason(),
});

export const projectCommands: Record<string, (args: Args) => unknown> = {
  get_settings: () => settingsWithProjects(),

  create_project: async (args) => {
    const created = await request<ServerProject>("/api/projects", {
      method: "POST",
      json: { name: String(args.name ?? "").trim(), source: "online" },
    });
    const opened = await open(projectPath(created.id));
    writeText(opened, "main.tex", STARTER, null);
    return info(opened);
  },

  open_project: async (args) => info(await open(String(args.path))),

  rename_project: async (args) => {
    const id = projectIdOf(String(args.path));
    if (!id) throw notFound();
    const renamed = await request<ServerProject>(`/api/projects/${id}`, {
      method: "PATCH",
      json: { name: String(args.newName ?? "").trim() },
    });
    if (current?.id === id) current.info = renamed;
    return { name: renamed.name, path: projectPath(id) };
  },

  delete_project: async (args) => {
    const id = projectIdOf(String(args.path));
    if (!id) throw notFound();
    if (current?.id === id) close();
    await request<void>(`/api/projects/${id}`, { method: "DELETE" });
    return settingsWithProjects();
  },

  list_files: (args) => fileTree(project(args)),

  read_project_file: (args) => readText(project(args), cleanPath(args.path)),

  write_project_file: (args) => {
    const open = project(args);
    requireWritable(open);
    const base = typeof args.base === "string" ? args.base : null;
    writeText(open, cleanPath(args.path), String(args.content ?? ""), base);
  },

  create_project_entry: (args) => {
    const open = project(args);
    requireWritable(open);
    const path = cleanPath(args.path);
    if (exists(open, path)) throw `${path} already exists.`;
    if (args.isDir) open.folders.add(path);
    else applyFileChange(open.doc, { path, kind: "text", text: "" });
  },

  rename_entry: (args) => {
    const open = project(args);
    requireWritable(open);
    const from = cleanPath(args.path);
    const to = cleanPath(args.newPath);
    if (from === to) return;
    if (exists(open, to)) throw `${to} already exists.`;
    applyRename(open.doc, from, to);
    for (const folder of [...open.folders]) {
      if (folder === from || folder.startsWith(from + "/")) {
        open.folders.delete(folder);
        open.folders.add(to + folder.slice(from.length));
      }
    }
  },

  delete_entry: (args) => {
    const open = project(args);
    requireWritable(open);
    const path = cleanPath(args.path);
    const { texts, assets } = projectFiles(open.doc);
    const inside = (p: string) => p === path || p.startsWith(path + "/");
    open.doc.transact(() => {
      for (const p of [...texts.keys(), ...assets.keys()].filter(inside)) {
        applyFileDelete(open.doc, p);
      }
    }, LOCAL_ORIGIN);
    for (const folder of [...open.folders])
      if (inside(folder)) open.folders.delete(folder);
  },

  read_asset: async (args) => {
    const open = project(args);
    const path = cleanPath(args.path);
    const text = textAt(open.doc, path);
    if (text) return encoder.encode(text.toString());
    const ref = projectFiles(open.doc).assets.get(path);
    if (!ref) throw `${path} doesn't exist.`;
    let bytes = open.assets.get(ref.hash);
    if (!bytes) {
      bytes = await fetchBytes(`/api/projects/${open.id}/assets/${ref.hash}`);
      open.assets.set(ref.hash, bytes);
    }
    return bytes;
  },

  get_project_config: (args) => ({
    engine: null,
    ignoredWords: [],
    ...readJson<Partial<ProjectConfig>>(project(args), ".polemic/project.json", {}),
  }),

  save_project_config: (args) => {
    const open = project(args);
    requireWritable(open);
    const config = args.config as ProjectConfig;
    if (config.engine && config.engine !== "auto" && !parseEngine(config.engine)) {
      throw `unknown TeX engine: ${config.engine}`;
    }
    writeJson(open, ".polemic/project.json", {
      engine: config.engine ?? null,
      ignoredWords: config.ignoredWords ?? [],
    });
  },

  list_comments: (args) => listComments(project(args)),

  save_comments: (args) => {
    const open = project(args);
    requireWritable(open);
    saveComments(open, args.comments as Comment[]);
  },

  list_asset_meta: (args) =>
    readJson<AssetTags>(project(args), ".polemic/assets.json", {}),

  save_asset_meta: (args) => {
    const open = project(args);
    requireWritable(open);
    writeJson(open, ".polemic/assets.json", args.tags);
  },

  set_main_file: (args) => {
    updateSettings((s) => {
      s.mainFiles[String(args.projectDir)] = String(args.mainFile);
    });
  },

  set_open_files: (args) => {
    updateSettings((s) => {
      s.openFiles[String(args.projectDir)] = (args.files as string[]) ?? [];
    });
  },

  compile_project: (args) => compile(project(args), cleanPath(args.mainTex)),

  cancel_compile: () => {
    compileController?.abort();
  },

  cloud_compile_status: () => "available",

  get_pdf: (args) => {
    const open = project(args);
    if (!open.pdf) throw "No PDF yet. Compile the project first.";
    return open.pdf;
  },

  synctex_forward: (args) => {
    const open = project(args);
    if (!open.synctex) throw "Compile the project first.";
    const file = cleanPath(args.input ?? args.mainTex);
    const hit = forward(open.synctex, texFiles(open), file, Number(args.line));
    if (!hit) throw "This line isn't in the PDF.";
    return hit;
  },

  synctex_backward: (args) => {
    const open = project(args);
    if (!open.synctex) throw "Compile the project first.";
    const hit = sourceAt(
      open.synctex,
      texFiles(open),
      Number(args.page),
      Number(args.x),
      Number(args.y),
    );
    if (!hit) throw "Nothing in the project matches this place in the PDF.";
    return hit;
  },
};
