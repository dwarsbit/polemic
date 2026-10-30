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
 * it, plus the comment files reviewers add (step 4), which a publish
 * leaves alone until the editor pulls them into the folder (step 5).
 */

import * as Y from "yjs";
import { applyFolder, readProject, type FolderEntry } from "@/lib/project-doc";
import {
  shareCreate,
  shareFolder,
  sharePublish,
  sharePush,
  shareSync,
  shareUploadAssets,
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

/** What a publish needs from the Rust side (src-tauri/src/share.rs). */
export interface PublishApi {
  /** The folder's files, excludes applied, text or asset. */
  folder(): Promise<FolderEntry[]>;
  /** The folder's server project, created on the first publish. */
  create(name: string): Promise<unknown>;
  /** What a copy with `stateVector` lacks, and the server's vector (base64). */
  sync(stateVector: string): Promise<{ update: string; stateVector: string }>;
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
  const entries = await api.folder();
  onStep("uploading");
  await api.create(name);

  const remote = await api.sync(toBase64(Y.encodeStateVector(new Y.Doc())));
  const doc = new Y.Doc();
  Y.applyUpdate(doc, fromBase64(remote.update));
  applyFolder(doc, entries, isCommentFile);

  const hashes = new Set([...readProject(doc).assets.values()].map((ref) => ref.hash));
  await api.uploadAssets([...hashes]);
  const delta = Y.encodeStateAsUpdate(doc, fromBase64(remote.stateVector));
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
    uploadAssets: (hashes) => shareUploadAssets(projectDir, hashes),
    push: (update) => sharePush(projectDir, update),
    publish: (main) => sharePublish(projectDir, main),
  };
}
