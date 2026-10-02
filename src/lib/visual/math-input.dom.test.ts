// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import { visualTexExtensions } from "./extensions";

/**
 * Simulated typing for the math input rules: characters go in through
 * plain transactions, the final character goes through the input-rules
 * plugin exactly as ProseMirror would on a real keypress.
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

/** Type text into the paragraph, the last char via the input-rule
 *  plugins — ProseMirror tries each extension's plugin in turn, and
 *  the character itself comes from the DOM when no rule takes it. */
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

describe("math input rules", () => {
  it("turns typed $x$ into an inline math node", () => {
    const editor = makeEditor();
    type(editor, "$x$");
    const json = editor.getJSON();
    const found = JSON.stringify(json);
    expect(found).toContain('"mathInline"');
    expect(found).toContain("$x$");
    // The node is selected so its raw source opens for editing.
    expect(editor.state.selection.toJSON().type).toBe("node");
    editor.destroy();
  });

  it("turns typed $$ into a display math node", () => {
    const editor = makeEditor();
    type(editor, "$$");
    const found = JSON.stringify(editor.getJSON());
    expect(found).toContain('"mathBlock"');
    editor.destroy();
  });

  it("leaves a lone $ as text", () => {
    const editor = makeEditor();
    type(editor, "$");
    const json = editor.getJSON();
    const found = JSON.stringify(json);
    expect(found).not.toContain('"mathInline"');
    expect(found).toContain('"$"');
    editor.destroy();
  });

  it("keeps converted math and continues with plain text after it", () => {
    const editor = makeEditor();
    type(editor, "$x$");
    // Click away: a cursor after the node ends the raw-edit selection.
    let nodePos = -1;
    let nodeSize = 1;
    editor.state.doc.descendants((node, pos) => {
      if (nodePos === -1 && node.type.name === "mathInline") {
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
    type(editor, " more");
    const found = JSON.stringify(editor.getJSON());
    expect(found).toContain('"mathInline"');
    expect(found).toContain("$x$");
    expect(found).toContain("more");
    editor.destroy();
  });
});
