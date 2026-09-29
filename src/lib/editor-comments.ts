import type { Comment } from "@/lib/tauri";
import { useProjectStore } from "@/store/project";

/** What the comment dialog should edit: a new draft or an existing comment. */
export type CommentTarget =
  | { kind: "new"; file: string; anchor: Comment["anchor"] }
  | { kind: "edit"; id: string };

let dialogHandler: ((target: CommentTarget) => void) | null = null;
/** Set by the editor view, which hosts the dialog. */
export function setCommentDialogHandler(handler: ((target: CommentTarget) => void) | null) {
  dialogHandler = handler;
}
export function openCommentDialog(target: CommentTarget) {
  dialogHandler?.(target);
}

let addAtCursorHandler: (() => void) | null = null;
/** Set by the editor, which owns the selection/line to anchor to. */
export function setAddCommentAtCursorHandler(handler: (() => void) | null) {
  addAtCursorHandler = handler;
}

/** Add a comment anchored to the selection (or the cursor's line). */
export function addCommentAtCursor() {
  addAtCursorHandler?.();
}

/** Add a comment to the active file as a whole. */
export function addFileComment() {
  const activeFile = useProjectStore.getState().activeFile;
  if (activeFile !== null) {
    openCommentDialog({ kind: "new", file: activeFile, anchor: null });
  }
}
