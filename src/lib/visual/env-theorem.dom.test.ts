// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { parseTex } from "./parse";
import { serializeTex } from "./serialize";
import { visualTexExtensions } from "./extensions";

/**
 * The theorem chrome: name lines (from \newtheorem when declared),
 * the editable title pill, and serialization of title edits.
 */

function makeEditor(tex: string): Editor {
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
    content: parseTex(tex) as never,
  });
  return editor;
}

describe("theorem environment views", () => {
  it("shows a name line with the declared display name and title", () => {
    const editor = makeEditor(
      "\\newtheorem{lemma}{Lemma}\n\\begin{document}\n\\begin{lemma}[First]\nStatement.\n\\end{lemma}\n\\end{document}\n",
    );
    const html = editor.view.dom.innerHTML;
    expect(html).toContain("vis-env-theorem-name");
    expect(html).toContain("Lemma");
    expect(html).toContain("(First)");
    expect(html).toContain("Statement.");
    editor.destroy();
  });

  it("falls back to the capitalized env name without a declaration", () => {
    const editor = makeEditor(
      "\\begin{document}\n\\begin{proof}[of Lemma 1]\nDone.\n\\end{proof}\n\\end{document}\n",
    );
    const html = editor.view.dom.innerHTML;
    expect(html).toContain("Proof");
    expect(html).toContain("(of Lemma 1)");
    editor.destroy();
  });

  it("gives quote family blocks no name line", () => {
    const editor = makeEditor("\\begin{document}\n\\begin{quote}\nWords.\n\\end{quote}\n\\end{document}\n");
    const html = editor.view.dom.innerHTML;
    expect(html).not.toContain("vis-env-theorem-name");
    editor.destroy();
  });

  it("edits the title in place and serializes the edit", async () => {
    const editor = makeEditor(
      "\\begin{document}\n\\begin{theorem}[Euler]\nBody.\n\\end{theorem}\n\\end{document}\n",
    );
    const pill = editor.view.dom.querySelector(".vis-env-theorem-opt") as HTMLElement | null;
    expect(pill).not.toBeNull();
    pill!.click();
    await Promise.resolve(); // let the focus microtask run
    const input = editor.view.dom.querySelector(
      ".vis-env-theorem-input",
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    input!.value = "Euler 2";
    input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const out = serializeTex(editor.getJSON() as never);
    expect(out).toContain("\\begin{theorem}[Euler 2]");
    expect(out).toContain("Body.");
    editor.destroy();
  });

  it("clears the title through the same input", async () => {
    const editor = makeEditor(
      "\\begin{document}\n\\begin{theorem}[Euler]\nBody.\n\\end{theorem}\n\\end{document}\n",
    );
    const pill = editor.view.dom.querySelector(".vis-env-theorem-opt") as HTMLElement | null;
    pill!.click();
    await Promise.resolve(); // let the focus microtask run
    const input = editor.view.dom.querySelector(
      ".vis-env-theorem-input",
    ) as HTMLInputElement | null;
    input!.value = "";
    input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const out = serializeTex(editor.getJSON() as never);
    expect(out).toContain("\\begin{theorem}");
    expect(out).not.toContain("[Euler]");
    editor.destroy();
  });
});
