/**
 * Project-wide edit application for the active document (the same
 * handler pattern as editor-insert/editor-preamble). Planning lives
 * in label-index.ts; the handler applies the edits to the live
 * view as one undoable transaction.
 */

import type { SourceEdit } from "./label-index";

export interface ApplyEditsOptions {
  /** False keeps the change out of the editor's undo history (an edit
   *  spanning several files undoes through its own record instead). */
  addToHistory?: boolean;
}

type ApplyEditsHandler = (
  edits: SourceEdit[],
  userEvent?: string,
  options?: ApplyEditsOptions,
) => boolean;

let handler: ApplyEditsHandler | null = null;

/** Called by the editor component to serve edit requests. */
export function setApplyEditsHandler(h: ApplyEditsHandler | null) {
  handler = h;
}

/**
 * Apply multiple edits to the open document in one transaction
 * (one undo step). Returns true when the document changed. No-op
 * when the editor is not mounted or an edit falls outside the doc.
 */
export function applyEditsInView(
  edits: SourceEdit[],
  userEvent?: string,
  options?: ApplyEditsOptions,
): boolean {
  return handler?.(edits, userEvent, options) ?? false;
}

/** Edits that could not be applied yet — no view was mounted. The
 *  editor flushes them when it mounts or reloads the document. */
let queued: SourceEdit[] | null = null;

/** Park edits for the editor to apply once it is ready. */
export function queueEditsForView(edits: SourceEdit[]): void {
  queued = edits;
}

/** Apply queued edits, if any; the editor calls this after it has
 *  mounted or resynchronized its document. */
export function flushQueuedEditsForView(): void {
  const edits = queued;
  queued = null;
  if (edits !== null && edits.length > 0) {
    applyEditsInView(edits, "input.fixLatex");
  }
}

type HistoryHandler = (direction: "undo" | "redo") => boolean;

let historyHandler: HistoryHandler | null = null;

/** Called by the editor component to serve undo/redo requests. */
export function setHistoryHandler(h: HistoryHandler | null) {
  historyHandler = h;
}

/**
 * Undo or redo in the source editor's history from outside the editor
 * (e.g. Ctrl+Z right after an outline panel edit, focus still in the
 * panel). True when something changed; false when the editor is not
 * mounted or has nothing to take back.
 */
export function runEditorHistory(direction: "undo" | "redo"): boolean {
  return historyHandler?.(direction) ?? false;
}
