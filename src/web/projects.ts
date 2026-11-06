/**
 * Projects in the browser build: the server's project documents in
 * place of folders on disk. A project's path is `/projects/<id>`, the
 * address it opens at; the file, comment and compile commands of
 * src/lib/tauri.ts are answered from its live document (layout in
 * src/lib/project-doc.ts), kept in sync with the server and everyone
 * else who has it open.
 */

import { HocuspocusProvider } from "@hocuspocus/provider";
import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";
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
  MAX_FILE_BYTES,
  normalizePath,
  projectFiles,
  readSnapshot,
  textAt,
  type FolderEntry,
} from "@/lib/project-doc";
import { forward, parseSyncTex, sourceAt, type SyncTex } from "@/lib/synctex";
import { TEMPLATES, templateInfos } from "@/lib/templates";
import {
  fetchBytes,
  goSignIn,
  request,
  ServerError,
  type ServerProject,
} from "@/web/server";
import { loadSettings, updateSettings } from "@/web/settings";
import { pickedFile } from "@/web/uploads";

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

export interface OpenProject {
  id: string;
  path: string;
  info: ServerProject;
  /** The owner's storage was full when the project opened: the server
   *  takes no changes until there is room. */
  storageFull: boolean;
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
  /** The last compile's SyncTeX as the server sent it, for publishing. */
  synctexGz: Uint8Array | null;
}

let current: OpenProject | null = null;
let compileController: AbortController | null = null;

// --- remote changes ------------------------------------------------------

/** What a remote change touched, as far as the editor cares. */
export interface ProjectChange {
  /** Comments may have been added, changed or deleted. */
  comments: boolean;
}

type Listener = (change: ProjectChange) => void;
const listeners = new Set<Listener>();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
let pending: ProjectChange = { comments: false };

/** Called (debounced) when the open project changes other than through
 *  this tab's own writes: someone else's edit, a reviewer's comment, or
 *  a merge with one. */
export function onProjectChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifySoon(comments: boolean) {
  pending = { comments: pending.comments || comments };
  if (notifyTimer !== null) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    const change = pending;
    pending = { comments: false };
    for (const listener of listeners) listener(change);
  }, 250);
}

/** Whether a transaction may have touched a comment file. A file whose
 *  path is gone (deleted) counts: it may have been one. */
function touchesComments(doc: Y.Doc, transaction: Y.Transaction): boolean {
  const paths = doc.getMap<string>("paths");
  const texts = doc.getMap("texts");
  const isComment = (id: string) => {
    const path = paths.get(id);
    return path === undefined || path.startsWith(COMMENTS);
  };
  for (const [type, keys] of transaction.changed) {
    if ((type as unknown) === paths || (type as unknown) === texts) {
      for (const key of keys) if (key !== null && isComment(key)) return true;
    } else if (type.parent === texts) {
      const id = type._item?.parentSub;
      if (id && isComment(id)) return true;
    }
  }
  return false;
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

type ConnectListener = (open: OpenProject | null) => void;
const connectListeners = new Set<ConnectListener>();

/** Called with the project once it is open, and with null once it closes. */
export function onProjectConnect(listener: ConnectListener): () => void {
  connectListeners.add(listener);
  return () => connectListeners.delete(listener);
}

function close() {
  compileController?.abort();
  compileController = null;
  if (current) for (const listener of connectListeners) listener(null);
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
  doc.on(
    "update",
    (_update: Uint8Array, origin: unknown, _doc: Y.Doc, transaction: Y.Transaction) => {
      if (origin !== LOCAL_ORIGIN) notifySoon(touchesComments(doc, transaction));
    },
  );
  current = {
    id,
    path,
    info,
    // The server connects a writable project read-only when its owner's storage is full.
    storageFull: info.writable && provider.authorizedScope === "readonly",
    doc,
    provider,
    folders: new Set(),
    assets: new Map(),
    commentIds: new Set(),
    pdf: null,
    synctex: null,
    synctexGz: null,
  };
  for (const listener of connectListeners) listener(current);
  return current;
}

/** The open project for a command's `projectDir`. */
export function project(args: Args): OpenProject {
  const dir = String(args.projectDir ?? args.path ?? "");
  if (!current || current.path !== dir) throw "This project isn't open.";
  return current;
}

const READ_ONLY_DESKTOP =
  "This project is published from the desktop app. Change it there.";

function storageFull(info: ServerProject): string {
  return info.role === "owner"
    ? "Your storage is full, so this project can't be changed. Delete files or other projects to make room, or change your plan on your account page."
    : `${info.owner.name}'s storage is full, so this project can't be changed for now.`;
}

function requireWritable(open: OpenProject) {
  if (open.info.writable && !open.storageFull) return;
  if (open.info.writable) throw storageFull(open.info);
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
  if (!current) return null;
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
  if (text.toString() !== content) notifySoon(path.startsWith(COMMENTS));
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

// --- adding files --------------------------------------------------------

const MAX_FILE_MB = MAX_FILE_BYTES / 1024 / 1024;

/** The message for a refused upload. */
function uploadError(open: OpenProject, e: unknown, path: string): unknown {
  if (!(e instanceof ServerError)) return e;
  if (e.code === "quota_exceeded") {
    return open.info.role === "owner"
      ? `${path} doesn't fit in your storage. Delete files or other projects to make room, or change your plan on your account page.`
      : `${path} doesn't fit in ${open.info.owner.name}'s storage.`;
  }
  if (e.code === "asset_too_large") return `${path} is larger than ${MAX_FILE_MB} MB.`;
  return e.message;
}

/**
 * Adds files to the open project, as a folder snapshot would: the
 * excludes apply, text files go into the document, and other files are
 * uploaded first, so nobody meets a missing one. Returns what was added.
 */
async function addFiles(
  open: OpenProject,
  files: { path: string; bytes: Uint8Array }[],
): Promise<FolderEntry[]> {
  const big = files.find((file) => file.bytes.length > MAX_FILE_BYTES);
  if (big) throw `${big.path} is larger than ${MAX_FILE_MB} MB.`;
  const entries = await readSnapshot(files);
  const bytes = new Map(files.map((file) => [normalizePath(file.path), file.bytes]));
  for (const entry of entries) {
    if (entry.kind !== "asset" || open.assets.has(entry.hash)) continue;
    const body = bytes.get(entry.path)!;
    try {
      await request(`/api/projects/${open.id}/assets/${entry.hash}`, {
        method: "PUT",
        headers: { "content-type": entry.type },
        body: body as Uint8Array<ArrayBuffer>,
      });
    } catch (e) {
      throw uploadError(open, e, entry.path);
    }
    open.assets.set(entry.hash, body);
  }
  open.doc.transact(() => {
    for (const entry of entries) applyFileChange(open.doc, entry);
  }, LOCAL_ORIGIN);
  return entries;
}

/** `path`, or with -1, -2 and so on before the extension while it is taken. */
function freePath(open: OpenProject, path: string, taken: Set<string>): string {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const [stem, ext] =
    dot > slash + 1 ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
  let free = path;
  for (let n = 1; exists(open, free) || taken.has(free); n++)
    free = `${stem}-${n}${ext}`;
  taken.add(free);
  return free;
}

/** Copies picked files into assets/, as the desktop app's import does. */
async function importAssets(open: OpenProject, sources: string[]): Promise<string[]> {
  const files: { path: string; bytes: Uint8Array }[] = [];
  const result: string[] = [];
  const taken = new Set<string>();
  for (const source of sources) {
    const file = pickedFile(source);
    if (!file) {
      // A file already in the project passes through.
      const inside = normalizePath(source);
      if (inside && exists(open, inside)) {
        result.push(inside);
        continue;
      }
      throw `Can't read ${source}.`;
    }
    const path = freePath(open, `assets/${file.name}`, taken);
    files.push({ path, bytes: new Uint8Array(await file.arrayBuffer()) });
    result.push(path);
  }
  const added = new Set((await addFiles(open, files)).map((entry) => entry.path));
  return result.filter((path) => added.has(path) || exists(open, path));
}

// --- zip files -----------------------------------------------------------

/** The files of a zip, without folder entries and macOS extras, and
 *  without the one folder that holds everything, when there is one. */
export function unzipProject(zip: Uint8Array): { path: string; bytes: Uint8Array }[] {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip);
  } catch {
    throw "This file isn't a zip file, or it is damaged.";
  }
  const files = Object.entries(entries)
    .filter(([path]) => !path.endsWith("/") && !path.split("/").includes("__MACOSX"))
    .map(([path, bytes]) => ({ path: path.replace(/\\/g, "/"), bytes }));
  const top = files[0]?.path.split("/")[0];
  if (top && files.every((file) => file.path.startsWith(`${top}/`))) {
    for (const file of files) file.path = file.path.slice(top.length + 1);
  }
  return files;
}

/** Creates a project from a zip's files; nothing is left behind when it fails. */
export async function importProjectZip(name: string, zip: File): Promise<ProjectInfo> {
  const files = unzipProject(new Uint8Array(await zip.arrayBuffer()));
  if (files.length === 0) throw "This zip file is empty.";
  const created = await request<ServerProject>("/api/projects", {
    method: "POST",
    json: { name, source: "online" },
  });
  try {
    const opened = await open(projectPath(created.id));
    await addFiles(opened, files);
    return info(opened);
  } catch (e) {
    close();
    await request<void>(`/api/projects/${created.id}`, { method: "DELETE" }).catch(
      () => undefined,
    );
    throw e;
  }
}

/** The open project as a zip: every file, the hidden ones included. */
export async function projectZip(): Promise<{ name: string; bytes: Uint8Array }> {
  if (!current) throw "This project isn't open.";
  const open = current;
  const { texts, assets } = projectFiles(open.doc);
  const files: Zippable = {};
  for (const [path] of texts) files[path] = strToU8(readText(open, path));
  for (const [path, ref] of assets) {
    let bytes = open.assets.get(ref.hash);
    if (!bytes) {
      bytes = await fetchBytes(`/api/projects/${open.id}/assets/${ref.hash}`);
      open.assets.set(ref.hash, bytes);
    }
    // Images and PDFs are compressed already.
    files[path] = [bytes, { level: 0 }];
  }
  return { name: open.info.name, bytes: zipSync(files, { level: 6 }) };
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

/** Waits until the server has every edit, so what it reads has them;
 *  rejects with `timeout` when they don't get there. */
export function edgesSynced(open: OpenProject, timeout: unknown): Promise<void> {
  if (open.provider.unsyncedChanges === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      open.provider.off("unsyncedChanges", check);
      reject(timeout);
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
    await edgesSynced(
      open,
      compileError(
        "unavailable",
        "Your latest edits haven't reached Polemic yet. Check your connection and compile again.",
      ),
    );
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
      open.synctexGz = synctex;
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

type Account = { id: string; name: string | null };

let account: Promise<Account | null> | null = null;

async function askAccount(): Promise<Account | null> {
  const session = await request<{ user?: { id?: unknown; name?: unknown } } | null>(
    "/api/auth/get-session",
  );
  const { id, name } = session?.user ?? {};
  if (typeof id !== "string") return null;
  return {
    id,
    name: typeof name === "string" && name.trim() !== "" ? name.trim() : null,
  };
}

/** The signed-in account, asked once per page load. */
export function signedInAccount(): Promise<Account | null> {
  account ??= askAccount().catch(() => null);
  return account;
}

/** Before the app shows: signed out goes to the sign-in page. Throws the
 *  message to show when Polemic can't say who is signed in. */
export async function requireAccount(): Promise<void> {
  let found: Account | null;
  try {
    found = await askAccount();
  } catch (e) {
    if (e instanceof ServerError && e.status >= 500) {
      throw "Polemic is unavailable right now. Reload the page to try again.";
    }
    throw e instanceof Error ? e.message : String(e);
  }
  if (!found) return goSignIn();
  account = Promise.resolve(found);
}

const signedInName = async () => (await signedInAccount())?.name ?? null;

async function settingsWithProjects(): Promise<Settings> {
  const [recentProjects, name] = await Promise.all([serverProjects(), signedInName()]);
  const settings = loadSettings();
  // Suggestions carry the account's name unless another one is set.
  return { ...settings, authorName: settings.authorName ?? name, recentProjects };
}

// --- commands ------------------------------------------------------------

type Args = Record<string, unknown>;

const info = (open: OpenProject): ProjectInfo => ({
  name: open.info.name,
  path: open.path,
  readOnly: readOnlyReason(),
});

export const projectCommands: Record<string, (args: Args) => unknown> = {
  get_settings: () => settingsWithProjects(),

  list_templates: () => templateInfos(),

  create_project: async (args) => {
    const id = String(args.templateId ?? "article");
    const template = TEMPLATES.find((t) => t.id === id);
    if (!template) throw `Unknown template: ${id}`;
    const created = await request<ServerProject>("/api/projects", {
      method: "POST",
      json: { name: String(args.name ?? "").trim(), source: "online" },
    });
    const opened = await open(projectPath(created.id));
    for (const file of template.files) writeText(opened, file.path, file.text, null);
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

  import_assets: (args) => {
    const open = project(args);
    requireWritable(open);
    return importAssets(open, (args.sources as string[]) ?? []);
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
