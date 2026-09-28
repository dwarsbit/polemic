import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

/**
 * The full extent of the line at pos, including its trailing newline
 * when one follows, so cutting or deleting it joins neighbors cleanly.
 */
export function lineBounds(
  state: EditorState,
  pos: number,
): { from: number; to: number } {
  const line = state.doc.lineAt(pos);
  return line.to < state.doc.length
    ? { from: line.from, to: line.to + 1 }
    : { from: line.from, to: line.to };
}

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for environments without the async clipboard API.
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

/** Copy the line at the cursor when nothing is selected. */
export function copyLine(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const { from, to } = lineBounds(view.state, selection.head);
  void writeClipboard(view.state.sliceDoc(from, to));
  return true;
}

/** Cut the line at the cursor when nothing is selected. */
export function cutLine(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const { from, to } = lineBounds(view.state, selection.head);
  void writeClipboard(view.state.sliceDoc(from, to));
  view.dispatch({ changes: { from, to } });
  return true;
}

/** Delete the line(s) spanned by the selection. */
export function deleteLines(view: EditorView): boolean {
  const state = view.state;
  const changes = state.selection.ranges.map((range) => {
    const first = state.doc.lineAt(range.from);
    const last = state.doc.lineAt(range.to);
    return {
      from: first.from,
      to: last.to < state.doc.length ? last.to + 1 : last.to,
    };
  });
  view.dispatch({ changes });
  return true;
}

/**
 * Line-level shortcuts. Mod-x/Mod-c only act when nothing is selected
 * (otherwise they fall through to the native cut/copy); Mod-d always
 * deletes the line(s) spanned by the selection.
 */
export const lineOps = keymap.of([
  { key: "Mod-c", run: copyLine },
  { key: "Mod-x", run: cutLine },
  { key: "Mod-d", run: deleteLines },
]);
