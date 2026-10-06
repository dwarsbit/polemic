/**
 * Project-wide edit application for the active document (the same
 * handler pattern as editor-insert/editor-preamble). Planning lives
 * in label-index.ts; the handler applies the edits to the live
 * view as one undoable transaction.
 */

import type { SourceEdit } from "./label-index";

type ApplyEditsHandler = (edits: SourceEdit[], userEvent?: string) => boolean;

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
): boolean {
  return handler?.(edits, userEvent) ?? false;
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
