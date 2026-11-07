/**
 * Online snapshots of a shared project (phase 5b): what changed between
 * a snapshot on the server and the project as it is now. Pure; the
 * panel reads both sides. Comments are left out: restoring a snapshot
 * keeps them as they are.
 */

import { lineDiff } from "@/lib/diff";
import type { FolderEntry } from "@/lib/project-doc";
import type { HistoryFiles, HistoryKind } from "@/lib/tauri";

export interface OnlineChange {
  path: string;
  /** From the snapshot's side: "added" is new since the snapshot. */
  status: "added" | "removed" | "modified";
  /** The text in the snapshot and now; null for other files, and for the side that lacks it. */
  before: string | null;
  after: string | null;
  addedLines: number;
  removedLines: number;
}

const COMMENTS = ".polemic/";

function counts(before: string, after: string) {
  let addedLines = 0;
  let removedLines = 0;
  for (const line of lineDiff(before, after)) {
    if (line.type === "add") addedLines++;
    else if (line.type === "remove") removedLines++;
  }
  return { addedLines, removedLines };
}

/** The files that differ between `snapshot` and `current`, by path. */
export function onlineChanges(
  snapshot: Pick<HistoryFiles, "files" | "assets">,
  current: FolderEntry[],
): OnlineChange[] {
  type Side = { text: string } | { hash: string };
  const side = (entries: Iterable<[string, Side]>) =>
    new Map([...entries].filter(([path]) => !path.startsWith(COMMENTS)));
  const then = side([
    ...snapshot.files.map((f): [string, Side] => [f.path, { text: f.text }]),
    ...snapshot.assets.map((a): [string, Side] => [a.path, { hash: a.hash }]),
  ]);
  const now = side(
    current.map((e): [string, Side] =>
      e.kind === "text" ? [e.path, { text: e.text }] : [e.path, { hash: e.hash }],
    ),
  );
  const textOf = (s: Side | undefined) => (s && "text" in s ? s.text : null);

  const changes: OnlineChange[] = [];
  for (const path of new Set([...then.keys(), ...now.keys()])) {
    const a = then.get(path);
    const b = now.get(path);
    const before = textOf(a);
    const after = textOf(b);
    if (a && b) {
      const same =
        before !== null && after !== null
          ? before === after
          : "hash" in a && "hash" in b && a.hash === b.hash;
      if (same) continue;
    }
    changes.push({
      path,
      status: !a ? "added" : !b ? "removed" : "modified",
      before,
      after,
      ...counts(before ?? "", after ?? ""),
    });
  }
  return changes.sort((x, y) => x.path.localeCompare(y.path));
}

/** What the list says about a snapshot besides its time. */
export function kindLabel(kind: HistoryKind): string | null {
  switch (kind) {
    case "restore":
      return "Before a restore";
    case "published":
      return "Published";
    default:
      return null;
  }
}

/** A snapshot's time, short enough for the panel: "Nov 7, 1:39 PM". */
export function snapshotTime(createdAt: string, now = new Date()): string {
  const at = new Date(createdAt);
  return at.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    ...(at.getFullYear() !== now.getFullYear() && { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}
