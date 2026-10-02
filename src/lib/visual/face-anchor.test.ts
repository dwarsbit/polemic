import { describe, expect, it } from "vitest";
import {
  headingLines,
  lineForAnchor,
  lineText,
  posForAnchor,
} from "./face-anchor";

const DOC = `\\documentclass{article}
\\begin{document}
\\section{First}
Alpha text here.
More alpha.

\\section{Second}
Beta text here.
\\end{document}
`;

describe("headingLines", () => {
  it("finds sectioning command lines", () => {
    expect(headingLines(DOC)).toEqual([3, 7]);
  });

  it("is empty without commands", () => {
    expect(headingLines("no headings\n")).toEqual([]);
  });
});

describe("lineText", () => {
  it("trims, strips comments, and caps", () => {
    expect(lineText("  hi there  \n", 1)).toBe("hi there");
    expect(lineText("x % a comment\n", 1)).toBe("x");
    expect(lineText(DOC, 3)).toBe("\\section{First}");
  });
});

describe("anchors across the faces", () => {
  it("resolves an anchor written by the visual face to a code line", () => {
    // Cursor was in the second section's paragraph ("Beta text here.").
    const line = lineForAnchor(DOC, { headingIndex: 1, text: "Beta text here." });
    expect(line).toBe(8);
  });

  it("falls back to the heading when the text is gone", () => {
    expect(
      lineForAnchor("\\section{Only}\nrewritten entirely\n", {
        headingIndex: 0,
        text: "Beta text here.",
      }),
    ).toBe(1);
  });

  it("resolves an anchor written by the code face in a visual doc", async () => {
    // The visual doc built from DOC (via a real Tiptap editor for the
    // ProseMirror node).
    const { Editor } = await import("@tiptap/core");
    const { StarterKit } = await import("@tiptap/starter-kit");
    const { parseTex } = await import("./parse");
    const { visualTexExtensions } = await import("./extensions");
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
      content: parseTex(DOC) as never,
    });

    // Cursor was on the "More alpha." line of the first section.
    const pos = posForAnchor(editor.state.doc, {
      headingIndex: 0,
      text: "More alpha.",
    });
    expect(pos).not.toBeNull();
    const parent = editor.state.doc.resolve(pos!).parent;
    expect(parent.textContent).toContain("More alpha");

    editor.destroy();
  });
});
