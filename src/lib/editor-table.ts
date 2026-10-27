import type { EditorView } from "@codemirror/view";
import { parseTable, tableAt } from "@/lib/table-grid";
import { useDialogsStore } from "@/store/dialogs";

/**
 * Open the grid editor on the table around `pos` in the Code face.
 * Saving replaces the environment in one transaction (one undo step),
 * as long as its text is still what was opened. False when there is
 * no table the grid understands at `pos`.
 */
export function editTableAt(view: EditorView, pos: number): boolean {
  const source = view.state.doc.toString();
  const range = tableAt(source, pos);
  if (range === null) return false;
  const grid = parseTable(source, range);
  if (grid === null) return false;
  const original = source.slice(range.from, range.to);
  useDialogsStore.getState().setTableGrid({
    grid,
    onSave: (latex) => {
      // The document may have changed meanwhile (an external reload).
      if (view.state.sliceDoc(range.from, range.to) !== original) return;
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: latex },
        userEvent: "input.table",
      });
      view.focus();
    },
  });
  return true;
}

/** Whether `pos` sits in a table the grid editor can open. */
export function hasTableAt(view: EditorView, pos: number): boolean {
  const source = view.state.doc.toString();
  const range = tableAt(source, pos);
  return range !== null && parseTable(source, range) !== null;
}

/** Opens the grid on the table at the cursor (set by the Code face). */
let cursorHandler: (() => boolean) | null = null;

export function setTableAtCursorHandler(handler: (() => boolean) | null) {
  cursorHandler = handler;
}

/**
 * The table command: edit the table at the cursor in the grid, or,
 * when the cursor is not in one, open the insert-table dialog.
 */
export function insertOrEditTable() {
  if (cursorHandler?.() === true) return;
  useDialogsStore.getState().setTableDialogOpen(true);
}
