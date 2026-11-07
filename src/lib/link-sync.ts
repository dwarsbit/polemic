/**
 * Linked projects (phase 5b): a shared folder and its server copy sync
 * both ways, so the same project opens in the desktop app and in the
 * browser. The server's Yjs document is the merge point; the folder
 * stays the place the user works.
 *
 * The editor keeps its own copy of the document between runs (in the
 * app data folder, never in the project). After every successful sync
 * the folder holds what that copy says, so a difference between the
 * two is a change made here: a save, a file made or deleted, a git
 * pull. A run of the sync:
 *
 * 1. Writes again the files an interrupted run left unwritten.
 * 2. When something changed here, reads the folder and folds the
 *    difference into the copy, as edits (files keep their ids by path,
 *    so a rename made in the app keeps its history and comments).
 * 3. Fetches what the server has that the copy lacks, merges it, and
 *    writes the files that changed into the folder. A file saved here
 *    while that happened is never overwritten: the two are merged.
 * 4. Sends the server what it lacks, assets first.
 *
 * Saved files only: unsaved edits in the editor stay there, and merge
 * with what arrives (the caller does that with `mergeText`).
 */

import * as Y from "yjs";
import {
  LOCAL_ORIGIN,
  applyFolder,
  applyRename,
  applyTextMerge,
  createExcluder,
  diskChanges,
  projectFiles,
  readProject,
  textAt,
  type DiskChange,
  type FolderEntry,
  type ProjectView,
} from "@/lib/project-doc";
import { fromBase64, isEmptyUpdate, toBase64 } from "@/lib/share";

/** Origin of the transactions that bring in the server's changes. */
export const REMOTE_ORIGIN = Symbol("polemic-remote");

/** What the sync needs from the Rust side (src-tauri/src/link.rs, share.rs). */
export interface LinkApi {
  /** The copy of the document (base64 update, null before the first sync) and unwritten paths. */
  load(): Promise<{ state: string | null; pending: string[] }>;
  save(state: string, pending: string[]): Promise<void>;
  /** The folder's files, excludes applied. */
  folder(): Promise<FolderEntry[]>;
  /** What a copy with `stateVector` lacks, and the server's vector (base64). */
  sync(stateVector: string): Promise<{ update: string; stateVector: string }>;
  /** Applies an update (base64) to the server's document. */
  push(update: string): Promise<void>;
  /** Uploads the assets with these hashes that the server lacks, from the folder. */
  uploadAssets(hashes: string[]): Promise<void>;
  /** A text file's content, null when there is none. */
  readText(path: string): Promise<string | null>;
  /** Writes unless the file holds something other than `expected` (null: no file); false then. */
  writeText(path: string, text: string, expected: string | null): Promise<boolean>;
  /** Fetches an asset from the server into the folder. */
  writeAsset(path: string, hash: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  /** To the trash; nothing when the file is gone. */
  remove(path: string): Promise<void>;
}

/** A change made here that the sync should pick up. */
export type LocalChange =
  { kind: "scan" } | { kind: "rename"; from: string; to: string };

/** What a sync did to the folder, for the editor's open files. */
export type FolderChange =
  | { kind: "write"; path: string; before: string | null; after: string }
  | { kind: "asset"; path: string }
  | { kind: "move"; from: string; to: string }
  | { kind: "delete"; path: string };

export interface SyncResult {
  /** Changes written into the folder. */
  changed: FolderChange[];
  /** True when this run sent changes to the server. */
  pushed: boolean;
}

/**
 * `ours`, edited from `base`, merged with `theirs`, edited from the
 * same base: both sets of edits survive; where they touch the same
 * text, ours wins.
 */
export function mergeText(base: string, ours: string, theirs: string): string {
  if (ours === base) return theirs;
  if (theirs === base || theirs === ours) return ours;
  const text = new Y.Doc().getText("t");
  text.insert(0, theirs);
  applyTextMerge(text, base, ours);
  return text.toString();
}

/** The folder's .gitignore filter, as the folder read applied it. */
function folderExcluder(entries: FolderEntry[]) {
  return createExcluder(
    entries
      .filter(
        (e): e is Extract<FolderEntry, { kind: "text" }> =>
          e.kind === "text" &&
          (e.path === ".gitignore" || e.path.endsWith("/.gitignore")),
      )
      .map((e) => ({
        dir: e.path.slice(0, Math.max(0, e.path.lastIndexOf("/"))),
        text: e.text,
      })),
  );
}

export class LinkSync {
  private doc: Y.Doc | null = null;
  private renames: { from: string; to: string }[] = [];
  private scan = true;
  /** Asset hashes the server is known to have. */
  private uploaded = new Set<string>();
  private running: Promise<SyncResult> | null = null;
  private again = false;

  constructor(
    private readonly api: LinkApi,
    private readonly options: { writable: boolean } = { writable: true },
  ) {}

  /** Something changed here: the next run reads the folder. */
  local(change: LocalChange): Promise<SyncResult> {
    if (change.kind === "rename")
      this.renames.push({ from: change.from, to: change.to });
    this.scan = true;
    return this.run();
  }

  /**
   * Runs the sync; a call while one runs gets a second run after it,
   * which covers whatever asked for it.
   */
  run(): Promise<SyncResult> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    const loop = async (): Promise<SyncResult> => {
      const total: SyncResult = { changed: [], pushed: false };
      try {
        do {
          this.again = false;
          const result = await this.once();
          total.changed.push(...result.changed);
          total.pushed ||= result.pushed;
        } while (this.again);
        return total;
      } finally {
        this.running = null;
      }
    };
    this.running = loop();
    return this.running;
  }

  /** Reads the folder in another round of this run. */
  private rescan() {
    this.scan = true;
    this.again = true;
  }

  /** The copy as it stands, for tests. */
  view(): ProjectView | null {
    return this.doc ? readProject(this.doc) : null;
  }

  private async save(pending: string[] = []) {
    await this.api.save(toBase64(Y.encodeStateAsUpdate(this.doc!)), pending);
  }

  /**
   * The copy: as saved, or on a folder's first two-way sync the
   * server's document, which the folder then overrides (its files are
   * what the user last had).
   */
  private async load(): Promise<{ doc: Y.Doc; pending: string[] }> {
    if (this.doc) return { doc: this.doc, pending: [] };
    const stored = await this.api.load();
    const doc = new Y.Doc();
    if (stored.state) {
      Y.applyUpdate(doc, fromBase64(stored.state), REMOTE_ORIGIN);
    } else {
      const remote = await this.api.sync(toBase64(Y.encodeStateVector(doc)));
      Y.applyUpdate(doc, fromBase64(remote.update), REMOTE_ORIGIN);
      this.scan = true;
    }
    this.doc = doc;
    return { doc, pending: stored.pending };
  }

  private async once(): Promise<SyncResult> {
    const { doc, pending } = await this.load();
    const changed: FolderChange[] = [];

    // 1. A run that stopped while writing: the copy wins for those files.
    if (pending.length > 0) {
      const view = readProject(doc);
      const failed: string[] = [];
      for (const path of pending) {
        try {
          const text = view.texts.get(path);
          const asset = view.assets.get(path);
          if (text) {
            const before = await this.api.readText(path);
            if (before !== text.text) {
              await this.api.writeText(path, text.text, before);
              changed.push({ kind: "write", path, before, after: text.text });
            }
          } else if (asset) {
            await this.api.writeAsset(path, asset.hash);
            changed.push({ kind: "asset", path });
          } else {
            await this.api.remove(path);
            changed.push({ kind: "delete", path });
          }
        } catch {
          failed.push(path);
        }
      }
      await this.save(failed);
      if (failed.length > 0) throw new Error(`Could not write ${failed.join(", ")}.`);
    }

    // 2. Changes made here.
    if (this.scan) {
      this.scan = false;
      const renames = this.renames.splice(0);
      try {
        for (const { from, to } of renames) applyRename(doc, from, to);
        const entries = await this.api.folder();
        const excluded = folderExcluder(entries);
        const sizes = new Map(
          [...projectFiles(doc).assets].map(([p, ref]) => [p, ref.size]),
        );
        // A file the folder leaves out (its .gitignore, its size) is not deleted from the project.
        applyFolder(doc, entries, (path) => excluded(path, { size: sizes.get(path) }));
        await this.save();
      } catch (e) {
        this.scan = true;
        this.renames.unshift(...renames);
        throw e;
      }
    }

    // 3. Changes from the server.
    const remote = await this.api.sync(toBase64(Y.encodeStateVector(doc)));
    const update = fromBase64(remote.update);
    if (!isEmptyUpdate(update)) changed.push(...(await this.applyRemote(doc, update)));

    // 4. Changes for the server.
    let pushed = false;
    if (this.options.writable) {
      const delta = Y.encodeStateAsUpdate(doc, fromBase64(remote.stateVector));
      if (!isEmptyUpdate(delta)) {
        const hashes = [
          ...new Set([...readProject(doc).assets.values()].map((a) => a.hash)),
        ];
        const missing = hashes.filter((hash) => !this.uploaded.has(hash));
        if (missing.length > 0) {
          await this.api.uploadAssets(missing);
          for (const hash of missing) this.uploaded.add(hash);
        }
        await this.api.push(toBase64(delta));
        pushed = true;
      }
    }
    return { changed, pushed };
  }

  /** Merges the server's update and writes what it changed into the folder. */
  private async applyRemote(doc: Y.Doc, update: Uint8Array): Promise<FolderChange[]> {
    const before = readProject(doc);
    Y.applyUpdate(doc, update, REMOTE_ORIGIN);
    // The server already has these assets.
    for (const ref of readProject(doc).assets.values()) this.uploaded.add(ref.hash);
    const changes = diskChanges(before, readProject(doc));
    if (changes.length === 0) {
      await this.save();
      return [];
    }
    const touched = (c: DiskChange) => (c.kind === "move" ? [c.from, c.to] : [c.path]);
    await this.save(changes.flatMap(touched));

    // What each path held before, following moves.
    const was = new Map<string, string | null>();
    for (const [path, file] of before.texts) was.set(path, file.text);
    const done: FolderChange[] = [];
    const failed = new Set<string>();
    for (const change of changes) {
      try {
        const result = await this.write(doc, change, was);
        if (result) done.push(result);
      } catch {
        for (const path of touched(change)) failed.add(path);
      }
    }
    await this.save([...failed]);
    if (failed.size > 0) throw new Error(`Could not write ${[...failed].join(", ")}.`);
    return done;
  }

  private async write(
    doc: Y.Doc,
    change: DiskChange,
    was: Map<string, string | null>,
  ): Promise<FolderChange | null> {
    switch (change.kind) {
      case "move":
        await this.api.move(change.from, change.to);
        was.set(change.to, was.get(change.from) ?? null);
        was.delete(change.from);
        return { kind: "move", from: change.from, to: change.to };
      case "write-asset":
        await this.api.writeAsset(change.path, change.asset.hash);
        return { kind: "asset", path: change.path };
      case "delete": {
        const base = was.get(change.path);
        if (base !== undefined && base !== null) {
          // Edited here since the last sync: the edit keeps the file.
          const now = await this.api.readText(change.path);
          if (now !== null && now !== base) {
            this.rescan();
            return null;
          }
        }
        await this.api.remove(change.path);
        return { kind: "delete", path: change.path };
      }
      case "write": {
        const base = was.get(change.path) ?? null;
        if (await this.api.writeText(change.path, change.text, base)) {
          return { kind: "write", path: change.path, before: base, after: change.text };
        }
        // Saved here while the server's version came in: merge the two.
        const now = await this.api.readText(change.path);
        const target = textAt(doc, change.path);
        if (now === null || !target) {
          // Deleted here: the server's edit brings the file back.
          await this.api.writeText(change.path, change.text, null);
          return { kind: "write", path: change.path, before: null, after: change.text };
        }
        doc.transact(() => applyTextMerge(target, base ?? "", now), LOCAL_ORIGIN);
        const merged = target.toString();
        if (!(await this.api.writeText(change.path, merged, now))) {
          // Changed yet again: read it in the next round.
          this.rescan();
          return null;
        }
        return { kind: "write", path: change.path, before: now, after: merged };
      }
    }
  }
}
