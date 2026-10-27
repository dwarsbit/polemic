// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  checkWords: vi.fn(async (words: string[]) => words.map((w) => w !== "wrld")),
  checkGrammar: vi.fn(async (blocks: string[]) =>
    blocks.map((text) => {
      const at = text.indexOf("an test");
      return at === -1
        ? []
        : [
            {
              from: at,
              to: at + 2,
              message: "Use a",
              rule: "AnA",
              category: "Grammar",
              replacements: ["a"],
            },
          ];
    }),
  ),
}));

import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { parseTex } from "./parse";
import { visualTexExtensions } from "./extensions";
import { WritingChecks, proseBlocksOfDoc, runVisualChecks } from "./writing";

/** Spelling and grammar read straight from the Visual editor's document. */

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
      WritingChecks,
    ],
    content: parseTex(tex) as never,
  });
}

const TEX = [
  "\\begin{document}",
  "Hello wrld, this is an test with $x$ and \\cite{knuth}.",
  "\\end{document}",
  "",
].join("\n");

describe("Visual editor writing checks", () => {
  it("reads text blocks with placeholders for inline atoms", () => {
    const editor = makeEditor(TEX);
    const [block] = proseBlocksOfDoc(editor.state.doc);
    expect(block.text).toBe("Hello wrld, this is an test with X and [1].");
    // Each character maps back to its document position.
    const at = block.text.indexOf("wrld");
    expect(editor.state.doc.textBetween(block.starts[at], block.ends[at + 3])).toBe(
      "wrld",
    );
    editor.destroy();
  });

  it("underlines misspellings and grammar issues", async () => {
    const editor = makeEditor(TEX);
    await runVisualChecks(editor.view);
    const marks = [
      ...editor.view.dom.querySelectorAll(".writing-misspelled, .writing-grammar"),
    ];
    expect(marks.map((el) => [el.className, el.textContent])).toEqual([
      ["writing-misspelled", "wrld"],
      ["writing-grammar", "an"],
    ]);
    editor.destroy();
  });
});
