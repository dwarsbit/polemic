/**
 * Re-locating a comment's anchor in the current content of its file.
 * The anchor stores the anchored text and the line at creation time;
 * edits shift lines, so the text is searched for: at the stored line
 * first, then in a window around it, then anywhere in the document.
 * Comments whose text no longer exists are orphaned.
 */

export interface CommentAnchor {
  text: string;
  /** 1-based line number at creation time. */
  line: number;
}

/** The 1-based line the anchor currently sits on, or null (orphaned). */
export function resolveAnchor(content: string, anchor: CommentAnchor): number | null {
  if (anchor.text === "") return null;
  const lines = content.split("\n");

  // Exact match at the stored line.
  if (lines[anchor.line - 1] === anchor.text) return anchor.line;

  // A window around the stored line.
  const window = 30;
  for (let offset = 1; offset <= window; offset++) {
    for (const line of [anchor.line - offset, anchor.line + offset]) {
      if (line >= 1 && line <= lines.length && lines[line - 1] === anchor.text) {
        return line;
      }
    }
  }

  // First exact line anywhere in the document.
  const index = lines.indexOf(anchor.text);
  if (index !== -1) return index + 1;

  // Multi-line selections: locate the text in the document as a whole.
  const at = content.indexOf(anchor.text);
  if (at !== -1) return content.slice(0, at).split("\n").length;

  return null;
}

/** The anchor for a whole line (line numbers are 1-based). */
export function lineAnchor(content: string, line: number): CommentAnchor {
  return { text: content.split("\n")[line - 1] ?? "", line };
}
