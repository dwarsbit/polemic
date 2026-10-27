// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { editTableAt, hasTableAt } from "@/lib/editor-table";
import { serializeTable, setCell } from "@/lib/table-grid";
import { parseTex } from "@/lib/visual/parse";
import { visualTexExtensions } from "@/lib/visual/extensions";
import { useDialogsStore } from "@/store/dialogs";

/** The grid editor's two doors: the Code face and the Visual table block. */

const TABLE = [
  "\\begin{table}[h]",
  "  \\centering",
  "  \\begin{tabular}{ll}",
  "    a & b \\\\",
  "  \\end{tabular}",
  "  \\caption{Results}",
  "\\end{table}",
].join("\n");

describe("Code face", () => {
  it("opens the table at the cursor and saves it in one change", () => {
    const view = new EditorView({
      state: EditorState.create({ doc: `Intro.\n\n${TABLE}\n` }),
      parent: document.body,
    });
    const pos = view.state.doc.toString().indexOf("a & b");
    expect(hasTableAt(view, 0)).toBe(false);
    expect(editTableAt(view, pos)).toBe(true);
    const request = useDialogsStore.getState().tableGrid!;
    expect(request.grid.rows).toEqual([["a", "b"]]);
    const edited = setCell(request.grid, 0, 1, "c");
    // What the dialog's Save does.
    request.onSave(serializeTable(edited));
    expect(view.state.doc.toString()).toContain("    a & c \\\\");
    expect(view.state.doc.toString()).toContain("\\caption{Results}");
    useDialogsStore.getState().setTableGrid(null);
    view.destroy();
  });
});

describe("Visual face", () => {
  it("previews the cells and saves edits into the block", () => {
    const editor = new Editor({
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
      content: parseTex(`\\begin{document}\n${TABLE}\n\\end{document}\n`) as never,
    });
    const cells = [...editor.view.dom.querySelectorAll(".vis-table-preview td")];
    expect(cells.map((td) => td.textContent)).toEqual(["a", "b"]);
    const button = editor.view.dom.querySelector(
      ".vis-table-edit",
    ) as HTMLButtonElement;
    button.click();
    const request = useDialogsStore.getState().tableGrid!;
    request.onSave(serializeTable(setCell(request.grid, 0, 0, "x")));
    let src = "";
    editor.state.doc.descendants((node) => {
      if (node.type.name === "figureBlock") src = node.attrs.src;
    });
    expect(src).toContain("    x & b \\\\");
    expect(src).toContain("\\caption{Results}");
    expect(
      [...editor.view.dom.querySelectorAll(".vis-table-preview td")].map(
        (td) => td.textContent,
      ),
    ).toEqual(["x", "b"]);
    useDialogsStore.getState().setTableGrid(null);
    editor.destroy();
  });
});
