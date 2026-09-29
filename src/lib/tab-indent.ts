import { type ChangeSpec, type EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

/** Spaces per indent level (matches the formatter's indent width). */
export const INDENT_WIDTH = 2;

/** The lines touched by the selection, each once, in order. */
function selectedLines(state: EditorState) {
  const seen = new Set<number>();
  const lines: { from: number; to: number }[] = [];
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let number = first; number <= last; number++) {
      if (!seen.has(number)) {
        seen.add(number);
        lines.push(state.doc.line(number));
      }
    }
  }
  return lines;
}

/**
 * Changes for one Tab press: an indent unit of spaces at the cursor,
 * or in front of every line covered by the selection.
 */
export function tabIndentChanges(state: EditorState): ChangeSpec {
  const unit = " ".repeat(INDENT_WIDTH);
  if (!state.selection.ranges.some((range) => !range.empty)) {
    return { from: state.selection.main.head, insert: unit };
  }
  return selectedLines(state).map((line) => ({ from: line.from, insert: unit }));
}

/**
 * Changes for one Shift-Tab press: remove one indent unit of leading
 * spaces from every affected line (a leading tab counts as one unit).
 */
export function tabDedentChanges(
  state: EditorState,
): { from: number; to: number }[] {
  const changes: { from: number; to: number }[] = [];
  for (const line of selectedLines(state)) {
    const text = state.sliceDoc(line.from, line.to);
    if (text.startsWith("\t")) {
      changes.push({ from: line.from, to: line.from + 1 });
      continue;
    }
    const spaces = /^ */.exec(text)?.[0].length ?? 0;
    if (spaces === 0) continue;
    changes.push({ from: line.from, to: line.from + Math.min(spaces, INDENT_WIDTH) });
  }
  return changes;
}

/** Tab: indent one level (single change, so one undo step). */
export function indentTab(view: EditorView): boolean {
  view.dispatch({
    changes: tabIndentChanges(view.state),
    userEvent: "input.indent",
  });
  return true;
}

/**
 * Shift-Tab: dedent one level. Always consumed, like Tab, so focus
 * stays in the editor even at column zero.
 */
export function dedentShiftTab(view: EditorView): boolean {
  const changes = tabDedentChanges(view.state);
  if (changes.length > 0) {
    view.dispatch({ changes, userEvent: "delete.dedent" });
  }
  return true;
}

/**
 * Tab / Shift-Tab indentation. Plain precedence: the autocomplete
 * keymap (highest) still accepts completions on Tab when its popup is
 * open; this binding takes over otherwise.
 */
export const tabIndent = keymap.of([
  { key: "Tab", run: indentTab },
  { key: "Shift-Tab", run: dedentShiftTab },
]);
