// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { serializeTex } from "./serialize";
import { HEADING_KINDS, setHeadingKind, visualTexExtensions } from "./extensions";

/**
 * Heading controls: the `#` markdown rules write consistent
 * cmd/level pairs, setHeadingKind converts blocks, and the level
 * chip renders with the caret class.
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

describe("heading markdown rules", () => {
  it("maps # to \\section with a matching level", () => {
    const editor = makeEditor();
    type(editor, "# ");
    const heading = editor.state.doc.firstChild;
    expect(heading?.type.name).toBe("heading");
    expect(heading?.attrs).toMatchObject({ cmd: "section", level: 3 });
    editor.destroy();
  });

  it("maps ## through ##### down the article ladder", () => {
    const cases: [string, string, number][] = [
      ["## ", "subsection", 4],
      ["### ", "subsubsection", 5],
      ["#### ", "paragraph", 6],
      ["##### ", "subparagraph", 6],
    ];
    for (const [typed, cmd, level] of cases) {
      const editor = makeEditor();
      type(editor, typed);
      const heading = editor.state.doc.firstChild;
      expect(heading?.attrs, `after typing ${JSON.stringify(typed)}`).toMatchObject({
        cmd,
        level,
      });
      editor.destroy();
    }
  });

  it("leaves six hashes as text", () => {
    const editor = makeEditor();
    type(editor, "###### ");
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
    editor.destroy();
  });

  it("only converts an empty paragraph", () => {
    const editor = makeEditor();
    type(editor, "words # ");
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
    editor.destroy();
  });
});

describe("setHeadingKind", () => {
  it("turns a paragraph into a section and back to body text", () => {
    const editor = makeEditor();
    editor.commands.setContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Words" }] }],
    });
    editor.commands.setTextSelection(2);
    setHeadingKind(editor, HEADING_KINDS[2]!);
    expect(serializeTex(editor.getJSON() as never)).toContain("\\section{Words}");
    setHeadingKind(editor, null);
    expect(serializeTex(editor.getJSON() as never)).not.toContain("\\section");
    editor.destroy();
  });

  it("promotes a section to a subsection", () => {
    const editor = makeEditor();
    type(editor, "# ");
    type(editor, "Intro");
    setHeadingKind(editor, HEADING_KINDS[3]!);
    expect(serializeTex(editor.getJSON() as never)).toContain("\\subsection{Intro}");
    editor.destroy();
  });
});

describe("heading level chip", () => {
  it("renders the cmd chip and marks the caret's heading", () => {
    const editor = makeEditor();
    type(editor, "# ");
    type(editor, "Intro");
    const chip = editor.view.dom.querySelector(".vis-heading-chip");
    expect(chip?.textContent).toBe("[section]");
    const heading = editor.view.dom.querySelector("h3.vis-heading");
    expect(heading).not.toBeNull();
    expect(heading!.className).toContain("vis-has-caret");
    editor.destroy();
  });

  it("updates the chip text when the kind changes", () => {
    const editor = makeEditor();
    type(editor, "# ");
    type(editor, "Intro");
    setHeadingKind(editor, HEADING_KINDS[3]!);
    const chip = editor.view.dom.querySelector(".vis-heading-chip");
    expect(chip?.textContent).toBe("[subsection]");
    editor.destroy();
  });
});
