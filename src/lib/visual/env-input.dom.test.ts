// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { visualTexExtensions } from "./extensions";

/**
 * Simulated typing for the environment input rules, mirroring the
 * math-input harness: text goes in through transactions, the final
 * character through the input-rules plugin as on a real keypress.
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

describe("environment input rules", () => {
  it("turns a typed > into a quote block with the cursor inside", () => {
    const editor = makeEditor();
    type(editor, "> ");
    const json = JSON.stringify(editor.getJSON());
    expect(json).toContain('"envBlock"');
    expect(json).toContain('"quote"');
    // The caret sits inside the quote's paragraph, ready to type on.
    const sel = editor.state.selection;
    expect(sel.$from.parent.type.name).toBe("paragraph");
    let insideEnv = false;
    for (let d = sel.$from.depth; d > 0; d--) {
      if (sel.$from.node(d).type.name === "envBlock") insideEnv = true;
    }
    expect(insideEnv).toBe(true);
    editor.destroy();
  });

  it("leaves a > after text alone", () => {
    const editor = makeEditor();
    type(editor, "words > ");
    const json = JSON.stringify(editor.getJSON());
    expect(json).not.toContain('"envBlock"');
    expect(json).toContain("words > ");
    editor.destroy();
  });

  it("wraps the current block in a quote and lifts it back out", () => {
    const editor = makeEditor();
    editor.commands.setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "quoted words" }] },
      ],
    });
    editor.commands.setTextSelection(2);
    editor.commands.wrapIn("envBlock", { env: "quote", opt: null });
    expect(editor.isActive("envBlock", { env: "quote" })).toBe(true);
    const wrapped = JSON.stringify(editor.getJSON());
    expect(wrapped).toContain('"envBlock"');
    expect(wrapped).toContain("quoted words");
    editor.commands.lift("envBlock");
    const lifted = JSON.stringify(editor.getJSON());
    expect(lifted).not.toContain('"envBlock"');
    expect(lifted).toContain("quoted words");
    editor.destroy();
  });
});
