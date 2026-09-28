type InsertHandler = (text: string, cursorOffset?: number) => void;

let handler: InsertHandler | null = null;

/** Called by the editor component to serve insert requests. */
export function setInsertHandler(h: InsertHandler | null) {
  handler = h;
}

/** Insert text at the editor cursor, optionally placing the caret inside. */
export function insertAtCursor(text: string, cursorOffset?: number) {
  handler?.(text, cursorOffset);
}
