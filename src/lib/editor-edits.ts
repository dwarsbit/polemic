/**
 * Project-wide edit application for the active document (the same
 * handler pattern as editor-insert/editor-preamble). Planning lives
 * in label-index.ts; the handler applies the edits to the live
 * view as one undoable transaction.
 */

import type { SourceEdit } from "./label-index";

type ApplyEditsHandler = (edits: SourceEdit[]) => boolean;

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
export function applyEditsInView(edits: SourceEdit[]): boolean {
  return handler?.(edits) ?? false;
}
