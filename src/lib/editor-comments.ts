import type { Comment } from "@/lib/tauri";
import { useProjectStore } from "@/store/project";

/** What the comment dialog should edit: a new draft or an existing comment. */
export type CommentTarget =
  | {
      kind: "new";
      file: string;
      anchor: Comment["anchor"];
      /** A reply to the suggestion note with this key. */
      suggestion?: string;
      /** A reply to the comment with this id. */
      replyTo?: string;
    }
  | { kind: "edit"; id: string }
  | {
      /** A suggestion's note (`comment=` in the markup): new or edited. */
      kind: "note";
      file: string;
      /** The suggestion's start in the file, when known (Code view). */
      at: number | null;
      /** The current note, null for none yet. */
      note: string | null;
      author: string | null;
      /** Writes the note itself (the Visual view); else the file is
       *  edited through setNote. */
      apply?: (note: string | null) => void;
    };

let dialogHandler: ((target: CommentTarget) => void) | null = null;
/** Set by the editor view, which hosts the dialog. */
export function setCommentDialogHandler(
  handler: ((target: CommentTarget) => void) | null,
) {
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
