// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { StarterKit } from "@tiptap/starter-kit";
import { serializeTex } from "./serialize";
import { visualTexExtensions } from "./extensions";

/**
 * Typing \cite{...}, \ref{...}, and \label{...} converts into pills on
 * the closing brace — the typed text becomes the node's verbatim src.
 */

function makeEditor(): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({
        document: false,
        heading: false,
        listItem: false,
        hardBreak: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        link: false,
        strike: false,
      }),
      ...visualTexExtensions,
    ],
  });
}

function type(editor: Editor, text: string) {
  const rest = text.slice(0, -1);
  const last = text.slice(-1);
  if (rest.length > 0) {
    const pos = editor.state.selection.from;
    editor.view.dispatch(editor.view.state.tr.insertText(rest, pos, pos));
  }
  const pos = editor.state.selection.from;
  let handled = false;
  for (const plugin of editor.view.state.plugins) {
    if (plugin.spec.isInputRules !== true) continue;
    const handler = plugin.spec.props?.handleTextInput as
      | ((view: unknown, from: number, to: number, insert: string) => boolean)
      | undefined;
    if (handler?.(editor.view, pos, pos, last) === true) {
      handled = true;
      break;
    }
  }
  if (!handled) {
    editor.view.dispatch(editor.view.state.tr.insertText(last, pos, pos));
  }
}

describe("pill input rules", () => {
  it("turns typed \\cite{keys} into a cite pill with the verbatim src", () => {
    const editor = makeEditor();
    type(editor, "See \\cite{knuth1984}");
    const found = JSON.stringify(editor.getJSON());
    expect(found).toContain('"cite"');
    expect(found).toContain("\\cite{knuth1984}");
    expect(found).toContain("See");
    expect(serializeTex(editor.getJSON() as never)).toContain("\\cite{knuth1984}");
    editor.destroy();
  });

  it("keeps text after a converted pill", () => {
    const editor = makeEditor();
    type(editor, "See \\cite{knuth1984}");
    // Click away: the converted pill is node-selected; typing replaces it.
    let nodePos = -1;
    let nodeSize = 1;
    editor.state.doc.descendants((node, pos) => {
      if (nodePos === -1 && node.type.name === "cite") {
        nodePos = pos;
        nodeSize = node.nodeSize;
      }
      return true;
    });
    expect(nodePos).toBeGreaterThanOrEqual(0);
    editor.view.dispatch(
      editor.view.state.tr.setSelection(
        TextSelection.create(editor.state.doc, nodePos + nodeSize),
      ),
    );
    type(editor, " here");
    const found = JSON.stringify(editor.getJSON());
    expect(found).toContain('"cite"');
    expect(found).toContain("here");
    editor.destroy();
  });

  it("keeps optional arguments in the src", () => {
    const editor = makeEditor();
    type(editor, "\\cite[p.~3]{knuth1984}");
    const found = JSON.stringify(editor.getJSON());
    expect(found).toContain('"cite"');
    expect(found).toContain("\\cite[p.~3]{knuth1984}");
    editor.destroy();
  });

  it("covers the natbib and biblatex families", () => {
    for (const cmd of ["citep", "citet", "textcite", "parencite"]) {
      const editor = makeEditor();
      type(editor, `\\${cmd}{key}`);
      const found = JSON.stringify(editor.getJSON());
      expect(found, cmd).toContain('"cite"');
      expect(found, cmd).toContain(`\\${cmd}{key}`);
      editor.destroy();
    }
  });

  it("turns typed \\ref{...} and the reference family into ref pills", () => {
    for (const cmd of ["ref", "eqref", "autoref", "cref"]) {
      const editor = makeEditor();
      type(editor, `\\${cmd}{eq:euler}`);
      const found = JSON.stringify(editor.getJSON());
      expect(found, cmd).toContain('"ref"');
      expect(found, cmd).toContain(`\\${cmd}{eq:euler}`);
      editor.destroy();
    }
  });

  it("turns typed \\label{...} into a label pill", () => {
    const editor = makeEditor();
    type(editor, "\\label{fig:plot}");
    const found = JSON.stringify(editor.getJSON());
    expect(found).toContain('"label"');
    expect(found).toContain("\\label{fig:plot}");
    editor.destroy();
  });

  it("leaves a command without braces as text", () => {
    const editor = makeEditor();
    type(editor, "\\cite");
    const found = JSON.stringify(editor.getJSON());
    expect(found).not.toContain('"cite"');
    editor.destroy();
  });
});
