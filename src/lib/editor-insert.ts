export interface InsertOptions {
  /** The snippet is a math-mode symbol: the visual face wraps it in
   *  inline math ($…$) instead of inserting raw TeX. */
  asMath?: boolean;
}

type InsertHandler = (text: string, cursorOffset?: number, opts?: InsertOptions) => void;

let handler: InsertHandler | null = null;

/**
 * Called by the active editor face to serve insert requests. Returns
 * the previous handler so a temporary face (the visual editor) can
 * restore the code editor's handler when it unmounts.
 */
export function setInsertHandler(h: InsertHandler | null): InsertHandler | null {
  const prev = handler;
  handler = h;
  return prev;
}

/** Insert text at the editor cursor, optionally placing the caret inside. */
export function insertAtCursor(text: string, cursorOffset?: number, opts?: InsertOptions) {
  handler?.(text, cursorOffset, opts);
}

/**
 * A multi-line snippet (a list, an environment) reads as a block: it
 * lands on fresh lines instead of mid-line. `before` is the line text
 * preceding the cursor, `after` the line text following the selection
 * end; single-line snippets pass through untouched.
 */
export function freshLineInsert(text: string, before: string, after: string): string {
  if (!text.includes("\n")) return text;
  let out = text;
  if (before.trim().length > 0) out = "\n" + out;
  if (after.trim().length > 0) out += "\n";
  return out;
}
