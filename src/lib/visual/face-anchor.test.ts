import { describe, expect, it } from "vitest";
import {
  anchorForLine,
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

  it("anchors a source line for the visual face to consume a jump", async () => {
    // DOC layout: line 3 = first heading, line 4-5 first section's
    // paragraphs, line 7 = second heading, line 8 its paragraph.
    expect(anchorForLine(DOC, 3)).toEqual({ headingIndex: 0, text: "" });
    expect(anchorForLine(DOC, 5)).toEqual({ headingIndex: 0, text: "More alpha." });
    expect(anchorForLine(DOC, 8)).toEqual({ headingIndex: 1, text: "Beta text here." });
    // Before the first heading: headingIndex -1, from the doc top.
    expect(anchorForLine(DOC, 1)).toEqual({ headingIndex: -1, text: "\\documentclass{article}" });
  });

  it("resolves a jump-line anchor to a doc position", async () => {
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

    // A jump to the "Beta text here." line lands inside that paragraph.
    const pos = posForAnchor(editor.state.doc, anchorForLine(DOC, 8));
    expect(pos).not.toBeNull();
    expect(editor.state.doc.resolve(pos!).parent.textContent).toContain("Beta text here");

    // A jump to the second heading line lands right after the heading.
    const headingPos = posForAnchor(editor.state.doc, anchorForLine(DOC, 7));
    expect(headingPos).not.toBeNull();
    const after = editor.state.doc.resolve(headingPos!);
    expect(after.parent.type.name).not.toBe("heading");

    // A jump before any heading lands at the doc start.
    expect(posForAnchor(editor.state.doc, anchorForLine(DOC, 1))).toBe(1);

    editor.destroy();
  });
});
