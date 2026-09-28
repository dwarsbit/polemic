// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { mathPairing } from "@/lib/math-pairing";
import { lineOps } from "@/lib/line-ops";
import { latexAutocompletion } from "@/lib/completion";

function mount(doc: string, pos: number): EditorView {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        StreamLanguage.define(stex),
        mathPairing,
        lineOps,
        latexAutocompletion,
      ],
    }),
    parent: container,
  });
  view.dispatch({ selection: { anchor: pos } });
  view.focus();
  return view;
}

/** Note: "Mod" expands to Ctrl on non-mac platforms, so tests press
 * Ctrl; the macOS Meta mapping is exercised by normalizeKeyMap. */
function pressModD(view: EditorView) {
  const event = new KeyboardEvent("keydown", {
    key: "d",
    code: "KeyD",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  view.contentDOM.dispatchEvent(event);
}

describe("Mod-d deletes lines", () => {
  it("deletes a plain line", () => {
    const view = mount("alpha\nbeta\ngamma", 7);
    pressModD(view);
    expect(view.state.doc.toString()).toBe("alpha\ngamma");
    view.destroy();
  });

  it("deletes a line with the cursor inside \\[ \\]", () => {
    const view = mount("\\[ x^2 \\]\nbeta", 3);
    pressModD(view);
    expect(view.state.doc.toString()).toBe("beta");
    view.destroy();
  });

  it("deletes a line with the cursor inside \\begin{...}", () => {
    const view = mount("\\begin{itemize}\nbeta", 5);
    pressModD(view);
    expect(view.state.doc.toString()).toBe("beta");
    view.destroy();
  });

  it("deletes a line inside a math region", () => {
    const view = mount("\\[\n  x^2\n\\]\n", 7);
    pressModD(view);
    expect(view.state.doc.toString()).toBe("\\[\n\\]\n");
    view.destroy();
  });
});
