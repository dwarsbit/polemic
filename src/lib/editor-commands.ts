import { insertAtCursor } from "@/lib/editor-insert";

/**
 * Commands the native menu sends to the code editor: open its find
 * panel, open autocomplete at the cursor, or toggle a `%` comment on
 * the selected lines. The code face registers
 * the handler while it is mounted; with no handler (the visual face,
 * the projects view) the commands are no-ops.
 */
export type EditorCommand = "find" | "complete" | "toggle-comment";

let handler: ((command: EditorCommand) => boolean) | null = null;

export function setEditorCommandHandler(
  h: ((command: EditorCommand) => boolean) | null,
): void {
  handler = h;
}

/** Run a command in the code editor; false when nothing handled it. */
export function runEditorCommand(command: EditorCommand): boolean {
  return handler?.(command) ?? false;
}

/** Insert a \cite{} or \ref{} and open the completion list inside it. */
export function insertWithCompletion(text: string, cursorOffset: number): void {
  insertAtCursor(text, cursorOffset);
  setTimeout(() => runEditorCommand("complete"), 0);
}
