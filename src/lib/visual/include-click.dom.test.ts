// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { parseTex } from "./parse";
import { visualTexExtensions } from "./extensions";
import { useProjectStore } from "@/store/project";
import type { FileEntry } from "@/lib/tauri";

/**
 * Cmd/Ctrl+click on an \input/\include/\subfile pill in the Visual
 * face opens the file it names, as in the Code face; a plain click
 * keeps ProseMirror's node selection.
 */

function makeEditor(tex: string): Editor {
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
    content: parseTex(tex) as never,
  });
}

function file(path: string): FileEntry {
  return { name: path, path, isDir: false, size: 0, modified: 0, children: [] };
}

const initial = useProjectStore.getState();
afterEach(() => useProjectStore.setState(initial, true));

function pillFor(editor: Editor, src: string): HTMLElement {
  const pill = [...editor.view.dom.querySelectorAll(".vis-raw-inline")].find(
    (el) => el.textContent === src,
  );
  expect(pill).toBeDefined();
  return pill as HTMLElement;
}

describe("include click-through in the Visual face", () => {
  it("opens the included file on Cmd/Ctrl+click", async () => {
    const openFile = vi.fn(async () => {});
    useProjectStore.setState({
      files: [file("main.tex"), file("chapters/intro.tex")],
      activeFile: "main.tex",
      openFile,
    });
    const editor = makeEditor(
      "\\begin{document}\nHi\n\n\\input{chapters/intro}\n\\end{document}\n",
    );
    const pill = pillFor(editor, "\\input{chapters/intro}");
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    pill.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(openFile).toHaveBeenCalledWith("chapters/intro.tex"));
    editor.destroy();
  });

  it("leaves plain clicks and other raw commands alone", () => {
    const openFile = vi.fn(async () => {});
    useProjectStore.setState({ files: [file("main.tex")], openFile });
    const editor = makeEditor(
      "\\begin{document}\n\\input{chap}\n\n\\newpage\n\\end{document}\n",
    );
    const plain = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    pillFor(editor, "\\input{chap}").dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    const other = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      metaKey: true,
    });
    pillFor(editor, "\\newpage").dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
    expect(openFile).not.toHaveBeenCalled();
    editor.destroy();
  });
});
