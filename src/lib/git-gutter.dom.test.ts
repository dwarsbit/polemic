// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, gutterLineClass } from "@codemirror/view";
import { gitLineGutter, setGitLines } from "@/lib/git-gutter";

function mount(): EditorView {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return new EditorView({
    state: EditorState.create({ doc: "a\nb\nc", extensions: [gitLineGutter] }),
    parent: container,
  });
}

function markedLines(view: EditorView): number[] {
  const sets = view.state.facet(gutterLineClass);
  const lines: number[] = [];
  for (const set of sets) {
    const cursor = set.iter();
    while (cursor.value) {
      lines.push(view.state.doc.lineAt(cursor.from).number);
      cursor.next();
    }
  }
  return lines;
}

describe("gitLineGutter", () => {
  it("marks the given lines", () => {
    const view = mount();
    view.dispatch({ effects: setGitLines.of(new Map([[2, "added"]])) });
    expect(markedLines(view)).toEqual([2]);
    view.destroy();
  });

  it("follows the lines through edits between recomputes", () => {
    const view = mount();
    view.dispatch({ effects: setGitLines.of(new Map([[3, "modified"]])) });
    // Insert a new first line: the marked content moves to line 4.
    view.dispatch({ changes: { from: 0, insert: "x\n" } });
    expect(markedLines(view)).toEqual([4]);
    view.destroy();
  });

  it("clears with an empty map and ignores out-of-range lines", () => {
    const view = mount();
    view.dispatch({
      effects: setGitLines.of(
        new Map([
          [99, "added"],
          [1, "added"],
        ]),
      ),
    });
    expect(markedLines(view)).toEqual([1]);
    view.dispatch({ effects: setGitLines.of(new Map()) });
    expect(markedLines(view)).toEqual([]);
    view.destroy();
  });
});
