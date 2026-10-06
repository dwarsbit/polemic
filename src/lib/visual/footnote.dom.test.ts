// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { StarterKit } from "@tiptap/starter-kit";
import { parseTex } from "./parse";
import { serializeTex } from "./serialize";
import { visualTexExtensions } from "./extensions";

/**
 * Footnotes: parsed `\footnote{...}` renders as a superscript chip
 * carrying the note; selecting it opens the raw editor in place (the
 * math pattern); typing `\footnote{...}` converts on the closing brace.
 */

function baseExtensions() {
  return [
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
  ];
}

function makeEditor(tex?: string): Editor {
  return new Editor({
    extensions: baseExtensions(),
    ...(tex !== undefined ? { content: parseTex(tex) as never } : {}),
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

/** The position and size of the first node of `type`, or null. */
function findNode(editor: Editor, type: string): { pos: number; size: number } | null {
  let found: { pos: number; size: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found === null && node.type.name === type) {
      found = { pos, size: node.nodeSize };
      return false;
    }
    return true;
  });
  return found;
}

describe("footnote views", () => {
  it("renders a parsed footnote as a superscript chip with the note", () => {
    const editor = makeEditor(
      "\\begin{document}\nA claim\\footnote{See \\emph{this}.} here.\n\\end{document}\n",
    );
    const chip = editor.view.dom.querySelector(".vis-footnote .vis-footnote-note");
    expect(chip?.textContent).toContain("See \\emph{this}.");
    expect(serializeTex(editor.getJSON() as never)).toContain(
      "\\footnote{See \\emph{this}.}",
    );
    editor.destroy();
  });

  it("opens the raw editor on selection and commits edits in place", () => {
    const editor = makeEditor("Text\\footnote{the note} more.\n");
    const at = findNode(editor, "footnote");
    expect(at).not.toBeNull();
    editor.view.dispatch(editor.view.state.tr.setSelection(NodeSelection.create(editor.state.doc, at!.pos)));
    const raw = editor.view.dom.querySelector(".vis-footnote .vis-raw-edit");
    expect(raw?.textContent).toBe("\\footnote{the note}");
    // Edit and commit: the src attr changes, one undo step.
    raw!.textContent = "\\footnote{an edited note}";
    raw!.dispatchEvent(new FocusEvent("blur"));
    const out = serializeTex(editor.getJSON() as never);
    expect(out).toContain("\\footnote{an edited note}");
    editor.commands.undo();
    expect(serializeTex(editor.getJSON() as never)).toContain("\\footnote{the note}");
    editor.destroy();
  });
});

describe("footnote input rule", () => {
  it("turns typed \\footnote{...} into a chip, node-selected", () => {
    const editor = makeEditor();
    type(editor, "Claim\\footnote{a note}");
    const found = JSON.stringify(editor.getJSON());
    expect(found).toContain('"footnote"');
    expect(found).toContain("\\footnote{a note}");
    expect(serializeTex(editor.getJSON() as never)).toContain("\\footnote{a note}");
    // Node-selected so the raw editor opens right away.
    expect(editor.state.selection.toJSON().type).toBe("node");
    editor.destroy();
  });

  it("keeps text after a converted footnote", () => {
    const editor = makeEditor();
    type(editor, "Claim\\footnote{a note}");
    const at = findNode(editor, "footnote");
    expect(at).not.toBeNull();
    editor.view.dispatch(
      editor.view.state.tr.setSelection(TextSelection.create(editor.state.doc, at!.pos + at!.size)),
    );
    type(editor, " after");
    const found = JSON.stringify(editor.getJSON());
    expect(found).toContain('"footnote"');
    expect(found).toContain("after");
    editor.destroy();
  });

  it("leaves a lone \\footnote without braces as text", () => {
    const editor = makeEditor();
    type(editor, "\\footnote");
    const found = JSON.stringify(editor.getJSON());
    expect(found).not.toContain('"footnote"');
    expect(found).toContain("footnote");
    editor.destroy();
  });

  it("leaves nested-brace typing as text until the braces close plainly", () => {
    const editor = makeEditor();
    type(editor, "\\footnote{a \\emph{b}}");
    // The input rule only matches brace-free bodies; nested braces
    // stay text (still valid LaTeX, converted on the next parse).
    const found = JSON.stringify(editor.getJSON());
    expect(found).not.toContain('"footnote"');
    editor.destroy();
  });
});
