/**
 * Folder-to-Yjs mapping for linked projects (phase 5). Pure: no disk,
 * no network. The caller reads the folder and the watcher's events,
 * this module turns them into Yjs edits, and turns remote updates back
 * into file writes and deletes.
 *
 * Layout of the project's Y.Doc (layout 1):
 * - `texts`: Y.Map<Y.Text>, file id → the file's text.
 * - `paths`: Y.Map<string>, file id → its project-relative path.
 * - `assets`: Y.Map<AssetRef>, project-relative path → { hash, size, type };
 *   the bytes live on the server, addressed by SHA-256.
 * - `meta`: Y.Map, `layout` = 1.
 *
 * Text files are keyed by a random id rather than by path, because a
 * Yjs type cannot move between map keys: a rename changes `paths` and
 * keeps the Y.Text, its history and the comment anchors in it. Two ids
 * that claim the same path (two devices creating the same file offline)
 * are resolved the same way everywhere: the smallest id keeps the path,
 * the others land next to it as conflict copies.
 */

import * as Y from "yjs";
import { lineDiff } from "@/lib/diff";

export const LAYOUT_VERSION = 1;

/** Largest file that is synced; the server's asset limit is the same. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Origin of every transaction this module makes for local changes. */
export const LOCAL_ORIGIN = Symbol("polemic-local");

export interface AssetRef {
  /** SHA-256 of the bytes, lowercase hex. */
  hash: string;
  size: number;
  /** Media type, e.g. image/png. */
  type: string;
}

/** One file of a folder snapshot, after classification. */
export type FolderEntry =
  | { path: string; kind: "text"; text: string }
  | ({ path: string; kind: "asset" } & AssetRef);

/** What a remote update asks of the disk, in order. */
export type DiskChange =
  | { kind: "move"; from: string; to: string }
  | { kind: "write"; path: string; text: string }
  | { kind: "write-asset"; path: string; asset: AssetRef }
  | { kind: "delete"; path: string };

/** The project as files: what the disk should hold. */
export interface ProjectView {
  texts: Map<string, { id: string; text: string }>;
  assets: Map<string, AssetRef>;
}

// --- paths -------------------------------------------------------------

/**
 * A project-relative path with `/` separators, no `.` segments, no
 * leading or trailing slash; null for anything that leaves the project
 * (absolute, a drive letter, `..`) or is empty.
 */
export function normalizePath(path: string): string | null {
  const slashed = path.replace(/\\/g, "/");
  if (slashed.startsWith("/") || /^[a-zA-Z]:/.test(slashed)) return null;
  const parts = slashed.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.length === 0 || parts.includes("..")) return null;
  if (parts.some((part) => part.includes("\0"))) return null;
  return parts.join("/");
}

/** `path` relative to `root` (both absolute), or null outside it. */
export function relativePath(root: string, path: string): string | null {
  const base = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const full = path.replace(/\\/g, "/");
  if (!full.startsWith(base + "/")) return null;
  return normalizePath(full.slice(base.length + 1));
}

// --- excludes ----------------------------------------------------------

/** Folders never synced, at any depth. `build` is latexmk's -outdir. */
const EXCLUDED_DIRS = new Set([".git", "build", ".snapshots", "node_modules"]);

const EXCLUDED_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

/** LaTeX build output next to the sources. */
const BUILD_OUTPUT =
  /\.(aux|log|synctex|synctex\.gz|synctex\(busy\)|fls|fdb_latexmk|out|toc|lof|lot|bbl|blg|bcf|run\.xml|nav|snm|vrb|xdv|dvi|idx|ilg|ind|glo|gls|glg|acn|acr|alg|loa|thm)$/i;

/** Excluded whatever .gitignore says: version control, build output, OS clutter. */
export function isAlwaysExcluded(path: string): boolean {
  const parts = path.split("/");
  const name = parts[parts.length - 1];
  return (
    parts.slice(0, -1).some((dir) => EXCLUDED_DIRS.has(dir)) ||
    EXCLUDED_DIRS.has(name) ||
    EXCLUDED_NAMES.has(name) ||
    BUILD_OUTPUT.test(name)
  );
}

interface IgnoreRule {
  /** Folder of the .gitignore, "" for the project root. */
  base: string;
  regex: RegExp;
  negate: boolean;
  dirOnly: boolean;
}

function globToRegex(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const atStart = i === 0 || glob[i - 1] === "/";
        const atEnd = i + 2 === glob.length || glob[i + 2] === "/";
        if (atStart && atEnd) {
          // `**/` = any folders (or none); a trailing `**` = everything inside.
          if (i + 2 === glob.length) out += ".*";
          else out += "(?:.*/)?";
          i += 2;
          continue;
        }
      }
      out += "[^/]*";
    } else if (c === "?") {
      out += "[^/]";
    } else if (c === "[") {
      const close = glob.indexOf("]", i + 2);
      if (close === -1) {
        out += "\\[";
        continue;
      }
      let body = glob.slice(i + 1, close).replace(/\\/g, "\\\\");
      if (body.startsWith("!")) body = "^" + body.slice(1);
      out += `[${body}]`;
      i = close;
    } else if (c === "\\" && i + 1 < glob.length) {
      out += glob[++i].replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    } else {
      out += c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    }
  }
  return out;
}

/** The rules of one .gitignore in folder `base` ("" = project root). */
export function parseGitignore(text: string, base = ""): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/(?<!\\)\s+$/, "");
    if (!line || line.startsWith("#")) continue;
    let negate = false;
    if (line.startsWith("!")) {
      negate = true;
      line = line.slice(1);
    } else if (line.startsWith("\\!") || line.startsWith("\\#")) {
      line = line.slice(1);
    }
    let dirOnly = false;
    if (line.endsWith("/")) {
      dirOnly = true;
      line = line.replace(/\/+$/, "");
    }
    if (!line) continue;
    const anchored = line.includes("/");
    const glob = line.replace(/^\//, "");
    const prefix = anchored ? "^" : "^(?:.*/)?";
    rules.push({
      base,
      regex: new RegExp(prefix + globToRegex(glob) + "$"),
      negate,
      dirOnly,
    });
  }
  return rules;
}

/**
 * The project's exclude filter: true for a path that is not synced.
 * `gitignores` are the .gitignore files by folder ("" = root); rules in
 * deeper folders come later and win, as in git, and nothing inside an
 * ignored folder can be re-included.
 */
export function createExcluder(
  gitignores: { dir: string; text: string }[] = [],
): (path: string, options?: { isDir?: boolean; size?: number }) => boolean {
  const rules = [...gitignores]
    .sort(
      (a, b) =>
        a.dir.split("/").length - b.dir.split("/").length || a.dir.localeCompare(b.dir),
    )
    .flatMap((file) => parseGitignore(file.text, file.dir));

  const ignored = (path: string, isDir: boolean) => {
    let result = false;
    for (const rule of rules) {
      if (rule.dirOnly && !isDir) continue;
      if (rule.base && !path.startsWith(rule.base + "/")) continue;
      const local = rule.base ? path.slice(rule.base.length + 1) : path;
      if (rule.regex.test(local)) result = !rule.negate;
    }
    return result;
  };

  return (path, options = {}) => {
    if (isAlwaysExcluded(path)) return true;
    if ((options.size ?? 0) > MAX_FILE_BYTES) return true;
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      if (ignored(parts.slice(0, i).join("/"), true)) return true;
    }
    return ignored(path, options.isDir ?? false);
  };
}

// --- text or binary ----------------------------------------------------

/** Always assets, even when the bytes happen to decode. */
const BINARY_EXTENSIONS =
  /\.(png|jpe?g|gif|webp|bmp|tiff?|ico|heic|pdf|zip|gz|tgz|bz2|xz|7z|docx?|xlsx?|pptx?|odt|ods|odp|otf|ttf|woff2?|mp3|mp4|mov|wav|ogg|webm|xcf|psd|ai)$/i;

const MEDIA_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  pdf: "application/pdf",
  eps: "application/postscript",
  ps: "application/postscript",
  zip: "application/zip",
  otf: "font/otf",
  ttf: "font/ttf",
  woff: "font/woff",
  woff2: "font/woff2",
};

/** The media type for an asset path, application/octet-stream when unknown. */
export function mediaType(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return MEDIA_TYPES[ext] ?? "application/octet-stream";
}

/**
 * The file's text, or null when it is binary: a known binary
 * extension, a NUL byte in the first 8000 bytes (git's test), or bytes
 * that are not UTF-8. A byte-order mark is kept so the file writes back
 * unchanged.
 */
export function decodeText(path: string, bytes: Uint8Array): string | null {
  if (BINARY_EXTENSIONS.test(path)) return null;
  if (bytes.subarray(0, 8000).includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * A folder snapshot ready for the document: paths normalised, excludes
 * applied (the .gitignore files are taken from the snapshot itself),
 * each file classified as text or an asset with its hash.
 */
export async function readSnapshot(
  files: { path: string; bytes: Uint8Array }[],
): Promise<FolderEntry[]> {
  const normal = files.flatMap((file) => {
    const path = normalizePath(file.path);
    return path ? [{ path, bytes: file.bytes }] : [];
  });
  const gitignores = normal
    .filter((file) => file.path === ".gitignore" || file.path.endsWith("/.gitignore"))
    .map((file) => ({
      dir: file.path.slice(0, Math.max(0, file.path.length - "/.gitignore".length)),
      text: new TextDecoder().decode(file.bytes),
    }));
  const excluded = createExcluder(gitignores);
  const entries: FolderEntry[] = [];
  for (const file of normal) {
    if (excluded(file.path, { size: file.bytes.length })) continue;
    const text = decodeText(file.path, file.bytes);
    if (text !== null) {
      entries.push({ path: file.path, kind: "text", text });
    } else {
      entries.push({
        path: file.path,
        kind: "asset",
        hash: await sha256Hex(file.bytes),
        size: file.bytes.length,
        type: mediaType(file.path),
      });
    }
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

// --- text diffs --------------------------------------------------------

/** Replace [from, to) of the old text with `insert`. */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

/**
 * The edits that turn `oldText` into `newText`, ascending and in old
 * text offsets. Common ends are trimmed first; the middle is diffed by
 * line (lib/diff), and each changed run is trimmed again, so a changed
 * word is one small edit, not a rewritten line.
 */
export function textEdits(oldText: string, newText: string): TextEdit[] {
  if (oldText === newText) return [];
  let start = 0;
  const max = Math.min(oldText.length, newText.length);
  while (start < max && oldText[start] === newText[start]) start++;
  let end = 0;
  while (
    end < max - start &&
    oldText[oldText.length - 1 - end] === newText[newText.length - 1 - end]
  ) {
    end++;
  }
  const a = oldText.slice(start, oldText.length - end);
  const b = newText.slice(start, newText.length - end);
  if (!a || !b) return [{ from: start, to: start + a.length, insert: b }];

  // Lines with their terminators, as tokens: lineDiff compares the
  // token ids, so line endings and a missing last newline stay exact.
  const ids = new Map<string, string>();
  const tokenize = (text: string) => {
    const lines = text.split(/(?<=\n)/);
    const tokens = lines.map((line) => {
      let id = ids.get(line);
      if (id === undefined) ids.set(line, (id = String(ids.size)));
      return id;
    });
    return { lines, joined: tokens.join("\n") };
  };
  const oldLines = tokenize(a);
  const newLines = tokenize(b);

  const edits: TextEdit[] = [];
  let offset = start;
  let run: TextEdit | null = null;
  const flush = () => {
    if (run) edits.push(trimEdit(run, oldText));
    run = null;
  };
  for (const line of lineDiff(oldLines.joined, newLines.joined)) {
    if (line.type === "context") {
      flush();
      offset += oldLines.lines[line.oldLine! - 1].length;
    } else if (line.type === "remove") {
      const length = oldLines.lines[line.oldLine! - 1].length;
      run ??= { from: offset, to: offset, insert: "" };
      run.to += length;
      offset += length;
    } else {
      run ??= { from: offset, to: offset, insert: "" };
      run.insert += newLines.lines[line.newLine! - 1];
    }
  }
  flush();
  return edits;
}

function trimEdit(edit: TextEdit, oldText: string): TextEdit {
  const removed = oldText.slice(edit.from, edit.to);
  let head = 0;
  const max = Math.min(removed.length, edit.insert.length);
  while (head < max && removed[head] === edit.insert[head]) head++;
  let tail = 0;
  while (
    tail < max - head &&
    removed[removed.length - 1 - tail] === edit.insert[edit.insert.length - 1 - tail]
  ) {
    tail++;
  }
  return {
    from: edit.from + head,
    to: edit.to - tail,
    insert: edit.insert.slice(head, edit.insert.length - tail),
  };
}

/** Apply the diff from the Y.Text's content to `text` as edits (last first). */
export function applyTextDiff(target: Y.Text, text: string): void {
  const edits = textEdits(target.toString(), text);
  for (let i = edits.length - 1; i >= 0; i--) {
    const { from, to, insert } = edits[i];
    if (to > from) target.delete(from, to - from);
    if (insert) target.insert(from, insert);
  }
}

// --- the document ------------------------------------------------------

const texts = (doc: Y.Doc) => doc.getMap<Y.Text>("texts");
const paths = (doc: Y.Doc) => doc.getMap<string>("paths");
const assets = (doc: Y.Doc) => doc.getMap<AssetRef>("assets");

const newFileId = () => crypto.randomUUID();

/** Where a losing claimant of `path` is written: `main (conflict 1a2b3c4d).tex`. */
export function conflictPath(path: string, id: string): string {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const tag = ` (conflict ${id.slice(0, 8)})`;
  return dot > slash + 1 ? path.slice(0, dot) + tag + path.slice(dot) : path + tag;
}

function isAssetRef(value: unknown): value is AssetRef {
  const ref = value as AssetRef;
  return (
    typeof ref === "object" &&
    ref !== null &&
    typeof ref.hash === "string" &&
    /^[0-9a-f]{64}$/.test(ref.hash) &&
    Number.isSafeInteger(ref.size) &&
    ref.size >= 0 &&
    typeof ref.type === "string"
  );
}

/**
 * Path → file id for the text files, and the asset paths, as the disk
 * should show them. Paths that are not valid or are always excluded
 * (a remote `.git/hooks/…`) are dropped, never written.
 */
function resolvePaths(doc: Y.Doc): {
  texts: Map<string, string>;
  assets: Map<string, AssetRef>;
} {
  const claims = new Map<string, string[]>();
  for (const [id, raw] of paths(doc)) {
    const path = normalizePath(raw);
    if (!path || path !== raw || isAlwaysExcluded(path) || !texts(doc).has(id))
      continue;
    const ids = claims.get(path) ?? [];
    ids.push(id);
    claims.set(path, ids);
  }
  const textPaths = new Map<string, string>();
  const losers: [string, string][] = [];
  for (const [path, ids] of claims) {
    ids.sort();
    textPaths.set(path, ids[0]);
    for (const id of ids.slice(1)) losers.push([conflictPath(path, id), id]);
  }
  for (const [path, id] of losers) if (!textPaths.has(path)) textPaths.set(path, id);

  const assetPaths = new Map<string, AssetRef>();
  for (const [raw, ref] of assets(doc)) {
    const path = normalizePath(raw);
    if (!path || path !== raw || isAlwaysExcluded(path) || !isAssetRef(ref)) continue;
    // A text file and an asset on one path: the text keeps it.
    const target = textPaths.has(path) ? conflictPath(path, ref.hash) : path;
    if (!textPaths.has(target)) assetPaths.set(target, ref);
  }
  return { texts: textPaths, assets: assetPaths };
}

/** The project as the disk should hold it. */
export function readProject(doc: Y.Doc): ProjectView {
  const resolved = resolvePaths(doc);
  const view: ProjectView = { texts: new Map(), assets: resolved.assets };
  for (const [path, id] of resolved.texts) {
    view.texts.set(path, { id, text: texts(doc).get(id)!.toString() });
  }
  return view;
}

/** A new document for the project, from a folder snapshot. */
export function buildProjectDoc(entries: FolderEntry[], doc = new Y.Doc()): Y.Doc {
  doc.transact(() => {
    doc.getMap("meta").set("layout", LAYOUT_VERSION);
    for (const entry of entries) setFile(doc, entry);
  }, LOCAL_ORIGIN);
  return doc;
}

function setFile(doc: Y.Doc, entry: FolderEntry) {
  const resolved = resolvePaths(doc);
  const id = resolved.texts.get(entry.path);
  if (entry.kind === "text") {
    if (id) {
      applyTextDiff(texts(doc).get(id)!, entry.text);
      return;
    }
    assets(doc).delete(entry.path);
    const newId = newFileId();
    texts(doc).set(newId, new Y.Text(entry.text));
    paths(doc).set(newId, entry.path);
    return;
  }
  if (id) removeText(doc, id);
  const ref: AssetRef = { hash: entry.hash, size: entry.size, type: entry.type };
  const current = assets(doc).get(entry.path);
  if (
    current?.hash !== ref.hash ||
    current.size !== ref.size ||
    current.type !== ref.type
  ) {
    assets(doc).set(entry.path, ref);
  }
}

function removeText(doc: Y.Doc, id: string) {
  texts(doc).delete(id);
  paths(doc).delete(id);
}

/**
 * Makes the document hold the folder's files: changed files get their
 * diffs, new ones appear, and files gone from the folder are removed,
 * except those `keep` names (a one-way publish keeps the comment files
 * reviewers added on the server). A file keeps its id, found by path,
 * so a document read back from the server is updated, not duplicated.
 */
export function applyFolder(
  doc: Y.Doc,
  entries: FolderEntry[],
  keep: (path: string) => boolean = () => false,
): void {
  doc.transact(() => {
    const meta = doc.getMap("meta");
    if (meta.get("layout") !== LAYOUT_VERSION) meta.set("layout", LAYOUT_VERSION);
    const present = new Set(entries.map((entry) => entry.path));
    for (const entry of entries) setFile(doc, entry);
    for (const [path, id] of resolvePaths(doc).texts) {
      if (!present.has(path) && !keep(path)) removeText(doc, id);
    }
    for (const path of [...assets(doc).keys()]) {
      if (!present.has(path) && !keep(path)) assets(doc).delete(path);
    }
  }, LOCAL_ORIGIN);
}

/**
 * A file changed or appeared on disk. A text file gets the minimal
 * diff into its Y.Text; no other file is touched. A file that turned
 * from text into an asset (or back) swaps kinds.
 */
export function applyFileChange(doc: Y.Doc, entry: FolderEntry): void {
  doc.transact(() => setFile(doc, entry), LOCAL_ORIGIN);
}

/** A file was deleted on disk. */
export function applyFileDelete(doc: Y.Doc, path: string): void {
  doc.transact(() => {
    const id = resolvePaths(doc).texts.get(path);
    if (id) removeText(doc, id);
    else if (assets(doc).has(path)) assets(doc).delete(path);
  }, LOCAL_ORIGIN);
}

/**
 * A file or folder moved on disk from `from` to `to`. Text files keep
 * their Y.Text (only `paths` changes); assets move their entry. Whatever
 * stood at the target is replaced, as on disk. Returns the files moved.
 */
export function applyRename(doc: Y.Doc, from: string, to: string): number {
  let moved = 0;
  doc.transact(() => {
    const resolved = resolvePaths(doc);
    const target = (path: string) =>
      path === from
        ? to
        : path.startsWith(from + "/")
          ? to + path.slice(from.length)
          : null;
    const textMoves: [string, string][] = [];
    for (const [path, id] of resolved.texts) {
      const next = target(path);
      if (next) textMoves.push([id, next]);
    }
    const assetMoves: [string, string, AssetRef][] = [];
    for (const [path, ref] of resolved.assets) {
      const next = target(path);
      if (next) assetMoves.push([path, next, ref]);
    }
    const sources = new Set(textMoves.map(([id]) => id));
    for (const next of [
      ...textMoves.map(([, n]) => n),
      ...assetMoves.map(([, n]) => n),
    ]) {
      const occupant = resolved.texts.get(next);
      if (occupant && !sources.has(occupant)) removeText(doc, occupant);
    }
    for (const [path] of assetMoves) assets(doc).delete(path);
    for (const [id, next] of textMoves) {
      assets(doc).delete(next);
      paths(doc).set(id, next);
    }
    for (const [, next, ref] of assetMoves) assets(doc).set(next, ref);
    moved = textMoves.length + assetMoves.length;
  }, LOCAL_ORIGIN);
  return moved;
}

/**
 * The disk changes that take the folder from `before` to `after`:
 * moves first (a text file whose id changed path), then writes, then
 * deletes, each group by path. Applying them in order leaves the
 * folder equal to `after`.
 */
export function diskChanges(before: ProjectView, after: ProjectView): DiskChange[] {
  const moves: DiskChange[] = [];
  const writes: DiskChange[] = [];
  const deletes: DiskChange[] = [];
  const beforeById = new Map(
    [...before.texts].map(([path, file]) => [file.id, { path, text: file.text }]),
  );
  // Paths that hold their final content after the moves and writes.
  const settled = new Set<string>();

  for (const [path, file] of after.texts) {
    const old = beforeById.get(file.id);
    const free = !before.texts.has(path) && !before.assets.has(path);
    if (
      old &&
      old.path !== path &&
      !after.texts.has(old.path) &&
      !after.assets.has(old.path) &&
      free
    ) {
      moves.push({ kind: "move", from: old.path, to: path });
      settled.add(path);
      if (old.text !== file.text) writes.push({ kind: "write", path, text: file.text });
      continue;
    }
    if (before.texts.get(path)?.text !== file.text || before.assets.has(path)) {
      writes.push({ kind: "write", path, text: file.text });
    }
    settled.add(path);
  }
  for (const [path, ref] of after.assets) {
    const old = before.assets.get(path);
    if (!old || old.hash !== ref.hash || before.texts.has(path)) {
      writes.push({ kind: "write-asset", path, asset: ref });
    }
    settled.add(path);
  }
  const moved = new Set(
    moves.flatMap((move) => (move.kind === "move" ? [move.from] : [])),
  );
  for (const path of [...before.texts.keys(), ...before.assets.keys()]) {
    if (!settled.has(path) && !moved.has(path)) deletes.push({ kind: "delete", path });
  }
  const byPath = (a: DiskChange, b: DiskChange) =>
    (a.kind === "move" ? a.to : a.path).localeCompare(
      b.kind === "move" ? b.to : b.path,
    );
  return [...moves.sort(byPath), ...writes.sort(byPath), ...deletes.sort(byPath)];
}

/**
 * Calls `onChanges` with the disk changes of every remote transaction.
 * Local transactions (LOCAL_ORIGIN) only move the baseline, since the
 * disk already has them. Returns the function that stops listening.
 */
export function watchRemoteChanges(
  doc: Y.Doc,
  onChanges: (changes: DiskChange[]) => void,
): () => void {
  let last = readProject(doc);
  const listener = (transaction: Y.Transaction) => {
    if (transaction.changed.size === 0) return;
    const next = readProject(doc);
    const changes = transaction.origin === LOCAL_ORIGIN ? [] : diskChanges(last, next);
    last = next;
    if (changes.length > 0) onChanges(changes);
  };
  doc.on("afterTransaction", listener);
  return () => doc.off("afterTransaction", listener);
}
