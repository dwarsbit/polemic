/**
 * Text wrappers for the toolbar and the B/I/U shortcuts: toggle a
 * selection into \textbf{…} / \emph{…} / \underline{…}. The pure core
 * is unit-tested; the editor serves the apply handler.
 */

export type TextWrapper = "bold" | "emph" | "underline";

export const TEXT_WRAPPERS: Record<TextWrapper, { before: string; after: string }> = {
  bold: { before: "\\textbf{", after: "}" },
  emph: { before: "\\emph{", after: "}" },
  underline: { before: "\\underline{", after: "}" },
};

export interface WrapperResult {
  /** The replacement text for the selection. */
  text: string;
  /** Cursor offset within `text`, or the end when undefined. */
  cursor?: number;
}

/**
 * Wrap the selected text, or unwrap it when it is exactly one wrapper
 * already (toggle). An empty selection yields the empty wrapper with
 * the cursor inside.
 */
export function wrapOrUnwrap(
  selected: string,
  wrapper: { before: string; after: string },
): WrapperResult {
  const { before, after } = wrapper;
  if (
    selected.length > before.length + after.length &&
    selected.startsWith(before) &&
    selected.endsWith(after)
  ) {
    return { text: selected.slice(before.length, selected.length - after.length) };
  }
  if (selected.length === 0) {
    return { text: before + after, cursor: before.length };
  }
  return { text: before + selected + after };
}

// --- Editor-served handler --------------------------------------------------

type ApplyWrapperHandler = (wrapper: TextWrapper) => void;

let handler: ApplyWrapperHandler | null = null;

/** Called by the editor component to serve wrapper requests. */
export function setTextWrapperHandler(h: ApplyWrapperHandler | null) {
  handler = h;
}

/**
 * Toggle bold / emphasis / underline on the current selection. No-op
 * when the editor is not mounted.
 */
export function applyTextWrapper(wrapper: TextWrapper): void {
  handler?.(wrapper);
}
