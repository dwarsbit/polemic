/**
 * Publish for review (phase 5a): the project goes to the account's
 * server one way, as a Yjs document of its files (project-doc.ts) plus
 * the assets, then a snapshot fixes that version, with the PDF of the
 * last compile, for review links.
 *
 * The editor keeps no copy of the document between publishes: each
 * publish reads the server's document, brings it in line with the
 * folder (files keep their ids by path, so history and comment anchors
 * survive) and sends only the difference. The local folder stays the
 * source of truth; the server's copy is only ever what a publish made
 * it, plus the comment files reviewers add on the review page.
 *
 * Those come back into the folder by a pull (step 5), on its own and
 * first in every publish. The link remembers every comment id the
 * folder has held, so a reviewer's comment is pulled once: deleted here
 * afterwards, it is not pulled again, and the next publish removes it
 * from the server.
 */

import * as Y from "yjs";
import { applyFolder, readProject, type FolderEntry } from "@/lib/project-doc";
import {
  shareCommentState,
  shareCreate,
  shareFolder,
  sharePublish,
  sharePush,
  shareSaveComments,
  shareSync,
  shareUploadAssets,
  type Comment,
} from "@/lib/tauri";

export interface PublishedSnapshot {
  id: string;
  main: string | null;
  /** Asset hashes of the PDF and its SyncTeX; null when not compiled. */
  pdf: string | null;
  synctex: string | null;
  size: number;
  createdAt: string;
}

/** What a pull needs from the Rust side (src-tauri/src/share.rs). */
export interface PullApi {
  /** What a copy with `stateVector` lacks, and the server's vector (base64). */
  sync(stateVector: string): Promise<{ update: string; stateVector: string }>;
  /** Comment ids in the folder, and those it has held while shared. */
  commentState(): Promise<{ seen: string[]; onDisk: string[] }>;
  /** Writes comments the folder lacks; marks them and `seen` as held. */
  saveComments(comments: Comment[], seen: string[]): Promise<string[]>;
}

/** What a publish needs from the Rust side (src-tauri/src/share.rs). */
export interface PublishApi extends PullApi {
  /** The folder's files, excludes applied, text or asset. */
  folder(): Promise<FolderEntry[]>;
  /** The folder's server project, created on the first publish. */
  create(name: string): Promise<unknown>;
  /** Uploads the assets with these hashes that the server lacks. */
  uploadAssets(hashes: string[]): Promise<void>;
  /** Applies a Yjs update (base64) to the server's document. */
  push(update: string): Promise<void>;
  /** Fixes the server's document as the published version. */
  publish(main: string | null): Promise<PublishedSnapshot>;
}

export type PublishStep = "reading" | "uploading" | "publishing";

/** Comment files: in 5a only reviewers add them on the server. */
export function isCommentFile(path: string): boolean {
  return /^\.polemic\/comments\/[^/]+\.json$/.test(path);
}

const COMMENT_ID = /^[A-Za-z0-9_-]{1,100}$/;

/** A comment file's text as a Comment, or null when it is not one (or not `id`'s). */
export function parseComment(text: string, id: string): Comment | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const c = value as Record<string, unknown>;
  const anchor = c?.anchor as Record<string, unknown> | null | undefined;
  const author = c?.author as Record<string, unknown> | undefined;
  const ok =
    typeof c === "object" &&
    c !== null &&
    c.id === id &&
    COMMENT_ID.test(id) &&
    typeof c.file === "string" &&
    typeof c.category === "string" &&
    typeof c.text === "string" &&
    Number.isSafeInteger(c.createdAt) &&
    (c.createdAt as number) >= 0 &&
    typeof c.resolved === "boolean" &&
    (anchor === null ||
      (typeof anchor === "object" &&
        typeof anchor.text === "string" &&
        Number.isSafeInteger(anchor.line) &&
        (anchor.line as number) >= 1)) &&
    (author === undefined ||
      (typeof author === "object" &&
        author !== null &&
        typeof author.name === "string" &&
        typeof author.verified === "boolean")) &&
    (c.replyTo === undefined ||
      (typeof c.replyTo === "string" && COMMENT_ID.test(c.replyTo))) &&
    (c.suggestion === undefined ||
      c.suggestion === null ||
      typeof c.suggestion === "string");
  return ok ? (value as Comment) : null;
}

const commentId = (path: string) =>
  path.slice(".polemic/comments/".length, -".json".length);

/** Comment files on the server written on a review page (they name an author), by path. */
function reviewerComments(doc: Y.Doc): Map<string, Comment> {
  const out = new Map<string, Comment>();
  for (const [path, file] of readProject(doc).texts) {
    if (!isCommentFile(path)) continue;
    const comment = parseComment(file.text, commentId(path));
    if (comment?.author) out.set(path, comment);
  }
  return out;
}

export interface Pulled {
  /** The server's document as read for the pull. */
  doc: Y.Doc;
  /** Its state vector, base64. */
  stateVector: string;
  /** Reviewers' comments written into the folder. */
  added: Comment[];
  /** Comment ids the folder has held, these included. */
  seen: Set<string>;
}

/**
 * Brings reviewers' comments into the folder: those the folder neither
 * holds nor has held. Comments already in the folder are never
 * overwritten; the folder's copy wins.
 */
export async function pullReviewComments(api: PullApi): Promise<Pulled> {
  const remote = await api.sync(toBase64(Y.encodeStateVector(new Y.Doc())));
  const doc = new Y.Doc();
  Y.applyUpdate(doc, fromBase64(remote.update));
  const state = await api.commentState();
  const seen = new Set([...state.seen, ...state.onDisk]);
  const fresh = [...reviewerComments(doc).values()].filter((c) => !seen.has(c.id));
  const written = await api.saveComments(
    fresh,
    state.onDisk.filter((id) => !state.seen.includes(id)),
  );
  for (const id of written) seen.add(id);
  return {
    doc,
    stateVector: remote.stateVector,
    added: fresh.filter((c) => written.includes(c.id)),
    seen,
  };
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** An update that changes nothing: no structs, no deletions. */
const isEmptyUpdate = (update: Uint8Array) =>
  update.length === 2 && update[0] === 0 && update[1] === 0;

/**
 * Publishes the folder: the server's document is brought in line with
 * it, the assets it names go up first (so readers never meet a missing
 * one), then the difference, then the snapshot.
 */
export async function publishForReview(
  api: PublishApi,
  { name, main }: { name: string; main: string | null },
  onStep: (step: PublishStep) => void = () => {},
): Promise<PublishedSnapshot> {
  onStep("reading");
  await api.create(name);
  const { doc, stateVector, seen } = await pullReviewComments(api);
  const entries = await api.folder();
  onStep("uploading");

  // A reviewer's comment not pulled yet stays; one the folder has held
  // and no longer does was deleted here, and goes.
  const keep = new Set(
    [...reviewerComments(doc)].filter(([, c]) => !seen.has(c.id)).map(([path]) => path),
  );
  applyFolder(doc, entries, (path) => keep.has(path));

  const hashes = new Set([...readProject(doc).assets.values()].map((ref) => ref.hash));
  await api.uploadAssets([...hashes]);
  const delta = Y.encodeStateAsUpdate(doc, fromBase64(stateVector));
  if (!isEmptyUpdate(delta)) await api.push(toBase64(delta));

  onStep("publishing");
  return api.publish(main);
}

/** The PublishApi of the project in `projectDir`, through the Rust side. */
export function publishApi(projectDir: string): PublishApi {
  return {
    folder: () => shareFolder(projectDir),
    create: (name) => shareCreate(projectDir, name),
    sync: (stateVector) => shareSync(projectDir, stateVector),
    commentState: () => shareCommentState(projectDir),
    saveComments: (comments, seen) => shareSaveComments(projectDir, comments, seen),
    uploadAssets: (hashes) => shareUploadAssets(projectDir, hashes),
    push: (update) => sharePush(projectDir, update),
    publish: (main) => sharePublish(projectDir, main),
  };
}
