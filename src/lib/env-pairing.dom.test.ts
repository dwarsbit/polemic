// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorView, basicSetup } from "codemirror";
import { envPairing } from "@/lib/env-pairing";

/** A view with the pairing extension mounted in the document body. */
function viewOf(doc: string) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new EditorView({
    doc,
    extensions: [basicSetup, envPairing()],
    parent: host,
  });
}

function type(view: EditorView, pos: number, text: string) {
  view.dispatch({
    changes: { from: pos, to: pos, insert: text },
    selection: { anchor: pos + text.length },
    userEvent: "input.type",
  });
}

describe("envPairing", () => {
  it("does not insert an end for a hand-typed begin", () => {
    const view = viewOf("");
    type(view, 0, "\\begin{figure}");
    expect(view.state.doc.toString()).toBe("\\begin{figure}");
    view.destroy();
  });

  it("leaves brace auto-closing at the editor default", () => {
    const view = viewOf("");
    expect(view.state.languageDataAt("closeBrackets", 0)).toHaveLength(0);
    view.destroy();
  });

  it("does not add an end when editing the body of a pair", () => {
    const view = viewOf("\\begin{figure}x\\end{figure}");
    const doc = view.state.doc.toString();
    type(view, doc.indexOf("x"), "y");
    expect(view.state.doc.toString()).toBe("\\begin{figure}yx\\end{figure}");
    view.destroy();
  });

  it("syncs a begin rename to the end", () => {
    const view = viewOf("\\begin{figure}x\\end{figure}");
    const doc = view.state.doc.toString();
    // Type a character at the end of the begin name.
    type(view, doc.indexOf("figure") + "figure".length, "s");
    expect(view.state.doc.toString()).toBe(
      "\\begin{figures}x\\end{figures}",
    );
    view.destroy();
  });

  it("syncs an end rename back to the begin", () => {
    const view = viewOf("\\begin{figure}x\\end{figure}");
    const doc = view.state.doc.toString();
    // Delete a character from the end name.
    const endName = doc.lastIndexOf("figure");
    view.dispatch({
      changes: { from: endName + 5, to: endName + 6 },
      selection: { anchor: endName + 5 },
      userEvent: "delete.backward",
    });
    expect(view.state.doc.toString()).toBe(
      "\\begin{figur}x\\end{figur}",
    );
    view.destroy();
  });
});
