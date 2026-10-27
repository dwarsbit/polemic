import type { Text } from "@codemirror/state";
import { applyEditsInView } from "@/lib/editor-edits";
import { applyEdits, type SourceEdit } from "@/lib/label-index";
import { invalidateGitState } from "@/lib/query-client";
import { readProjectFile, writeProjectFile } from "@/lib/tauri";
import { flushPendingSerialize } from "@/lib/visual/pending-serialize";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";

/**
 * Applying outline edits to project files, and undo for a section
 * moved into another file. Such a move spans two files, which no
 * single editor history can take back, so it stays out of the
 * editor's history and is recorded here instead: Ctrl+Z (or Undo in
 * the outline) restores both files while they are as the move left
 * them.
 */

/** The freshest text of a file: live editor, unsaved buffer, or disk. */
export async function currentText(
  projectPath: string,
  file: string,
): Promise<string | null> {
  const { activeFile, buffers } = useProjectStore.getState();
  if (file === activeFile) {
    // The Visual face serializes on a debounce; plan against its latest text.
    flushPendingSerialize();
    return useEditorStore.getState().content;
  }
  if (buffers[file] !== undefined) return buffers[file];
  return readProjectFile(projectPath, file).catch(() => null);
}

/**
 * Apply edits planned against `source`: in the live editor for the
 * active file (one undo step, unless kept out of history), else in its
 * buffer or on disk. False when the active file's editor is not there.
 */
export async function applyFileEdits(
  projectPath: string,
  file: string,
  source: string,
  edits: SourceEdit[],
  options: { addToHistory?: boolean } = {},
): Promise<boolean> {
  const store = useProjectStore.getState();
  if (file === store.activeFile) {
    return applyEditsInView(edits, "input.structure", options);
  }
  if (store.buffers[file] !== undefined) {
    store.markDirty(file, applyEdits(source, edits));
  } else {
    await writeProjectFile(projectPath, file, applyEdits(source, edits));
    void invalidateGitState();
  }
  return true;
}

/** One file's text before and after a cross-file move. */
export interface FileChange {
  file: string;
  before: string;
  after: string;
}

let lastMove: { projectPath: string; changes: FileChange[] } | null = null;

/** Remember a cross-file move for undo; replaces any earlier one. */
export function recordCrossFileMove(projectPath: string, changes: FileChange[]): void {
  lastMove = { projectPath, changes };
}

/** Forget the recorded move (e.g. after another structure edit). */
export function clearCrossFileMove(): void {
  lastMove = null;
}

/** Whether a move is recorded (not yet undone or replaced). */
export function hasCrossFileMove(): boolean {
  return lastMove !== null;
}

/** Whether Ctrl+Z in `file` should undo the recorded move: the file
 *  takes part in it and is exactly as the move left it. */
export function canUndoCrossFileMove(file: string, doc: Text): boolean {
  const change = lastMove?.changes.find((c) => c.file === file);
  return (
    change !== undefined &&
    doc.length === change.after.length &&
    doc.toString() === change.after
  );
}

/** The single edit turning `from` into `to` (common ends kept). */
function diffEdit(from: string, to: string): SourceEdit {
  let start = 0;
  while (start < from.length && start < to.length && from[start] === to[start]) start++;
  let end = 0;
  while (
    end < from.length - start &&
    end < to.length - start &&
    from[from.length - 1 - end] === to[to.length - 1 - end]
  ) {
    end++;
  }
  return {
    from: start,
    to: from.length - end,
    insert: to.slice(start, to.length - end),
  };
}

/**
 * Undo the recorded move in both files. Nothing happens (false) when
 * either file changed since, so a half undo never loses the section.
 */
export async function undoCrossFileMove(): Promise<boolean> {
  const move = lastMove;
  const project = useProjectStore.getState().project;
  if (move === null || project?.path !== move.projectPath) return false;
  const texts = await Promise.all(
    move.changes.map((change) => currentText(move.projectPath, change.file)),
  );
  if (move.changes.some((change, i) => texts[i] !== change.after)) return false;
  if (lastMove !== move) return false;
  lastMove = null;
  // The active file first: if its editor is gone, leave both alone.
  const { activeFile } = useProjectStore.getState();
  const ordered = [...move.changes].sort(
    (a, b) => Number(b.file === activeFile) - Number(a.file === activeFile),
  );
  for (const change of ordered) {
    const ok = await applyFileEdits(
      move.projectPath,
      change.file,
      change.after,
      [diffEdit(change.after, change.before)],
      { addToHistory: false },
    );
    if (!ok) return false;
  }
  return true;
}

/**
 * Move a section into another file, both files at once: the source
 * and target edits are planned against their current texts. The
 * active file changes first (out of its history); the move is then
 * recorded for undo.
 */
export async function applyCrossFileMove(
  projectPath: string,
  sourceFile: string,
  source: string,
  sourceEdits: SourceEdit[],
  targetFile: string,
  target: string,
  targetEdits: SourceEdit[],
): Promise<boolean> {
  const { activeFile } = useProjectStore.getState();
  const sides = [
    { file: sourceFile, text: source, edits: sourceEdits },
    { file: targetFile, text: target, edits: targetEdits },
  ].sort((a, b) => Number(b.file === activeFile) - Number(a.file === activeFile));
  for (const side of sides) {
    const ok = await applyFileEdits(projectPath, side.file, side.text, side.edits, {
      addToHistory: false,
    });
    // Only the first (active) side can fail, before anything changed.
    if (!ok) return false;
  }
  recordCrossFileMove(
    projectPath,
    sides.map((side) => ({
      file: side.file,
      before: side.text,
      after: applyEdits(side.text, side.edits),
    })),
  );
  return true;
}
