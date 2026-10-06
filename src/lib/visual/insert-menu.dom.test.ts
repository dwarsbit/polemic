// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { StarterKit } from "@tiptap/starter-kit";
import { parseTex } from "./parse";
import { serializeTex } from "./serialize";
import {
  addNewtheorem,
  ensurePackage,
  insertEnvBlock,
  insertTheoremEnvEntries,
  visualTexExtensions,
} from "./extensions";

/**
 * The Insert menu's engine: context-dependent environment inserts,
 * package bookkeeping, and \newtheorem declarations that make a new
 * env parse as a theorem block from then on.
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

const SIMPLE = "\\documentclass{article}\n\\begin{document}\nParagraph one.\n\\end{document}\n";

/** A preamble-declared theorem env, parsed from source. */
const DECLARED =
  "\\documentclass{article}\n\\newtheorem{exercise}{Exercise}\n\\begin{document}\n\\begin{exercise}\nSolve it.\n\\end{exercise}\n\\end{document}\n";

/** The caret position at the end of the last text block's text
 *  (doc.content.size arithmetic lands in doc-level gap positions). */
function endOfText(editor: Editor): number {
  return TextSelection.near(
    editor.state.doc.resolve(editor.state.doc.content.size),
    -1,
  ).from;
}

describe("insertEnvBlock", () => {
  it("replaces an empty paragraph and lands the caret inside", () => {
    const editor = makeEditor(SIMPLE);
    // End of the text, Enter: the caret sits in a fresh empty paragraph.
    // (Separate dispatches: a chained Enter reads the stale selection.)
    editor.commands.setTextSelection(endOfText(editor));
    editor.commands.enter();
    insertEnvBlock(editor, "theorem");
    const out = serializeTex(editor.getJSON() as never);
    expect(out).toContain("Paragraph one.");
    expect(out).toContain("\\begin{theorem}\n\\end{theorem}");
    // The caret is inside the environment's paragraph.
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(editor.state.selection.$from.node(1).type.name).toBe("envBlock");
    editor.destroy();
  });

  it("appends at the document end on a doc-level selection", () => {
    // A fresh mount node-selects the preamble atom: the env must not
    // wrap the preamble.
    const editor = makeEditor(SIMPLE);
    expect(editor.state.selection.toJSON().type).toBe("node");
    insertEnvBlock(editor, "theorem");
    const out = serializeTex(editor.getJSON() as never);
    expect(out.indexOf("\\documentclass")).toBeLessThan(out.indexOf("\\begin{document}"));
    expect(out).toContain("\\begin{theorem}\n\\end{theorem}");
    expect(out).not.toContain("theorem}\n  \\documentclass");
    editor.destroy();
  });

  it("wraps a non-empty block", () => {
    const editor = makeEditor(SIMPLE);
    editor.chain().setTextSelection(endOfText(editor)).run();
    insertEnvBlock(editor, "quote");
    const out = serializeTex(editor.getJSON() as never);
    expect(out).toContain("\\begin{quote}\n  Paragraph one.\n\\end{quote}");
    editor.destroy();
  });
});

describe("ensurePackage", () => {
  it("adds the package once and never duplicates it", () => {
    const editor = makeEditor(SIMPLE);
    expect(ensurePackage(editor, "amsthm")).toBe(true);
    let out = serializeTex(editor.getJSON() as never);
    expect(out).toContain("\\usepackage{amsthm}");
    expect(ensurePackage(editor, "amsthm")).toBe(false);
    out = serializeTex(editor.getJSON() as never);
    expect(out.match(/\\usepackage\{amsthm\}/g)?.length).toBe(1);
    // One undo step removes it.
    editor.commands.undo();
    expect(serializeTex(editor.getJSON() as never)).not.toContain("amsthm");
    editor.destroy();
  });

  it("leaves an already-loaded package alone, options included", () => {
    const editor = makeEditor(
      "\\documentclass{article}\n\\usepackage[inline]{amsthm}\n\\begin{document}\nx\n\\end{document}\n",
    );
    expect(ensurePackage(editor, "amsthm")).toBe(false);
    editor.destroy();
  });
});

describe("addNewtheorem", () => {

  it("declares the env with amsthm, and the env parses as a theorem block", () => {
    const editor = makeEditor(SIMPLE);
    expect(addNewtheorem(editor, "exercise", "Exercise")).toBe(true);
    editor.chain().setTextSelection(endOfText(editor)).run();
    insertEnvBlock(editor, "exercise");
    const out = serializeTex(editor.getJSON() as never);
    expect(out).toContain("\\usepackage{amsthm}");
    expect(out).toContain("\\newtheorem{exercise}{Exercise}");
    expect(out).toContain("\\begin{exercise}");
    // Round trip: the declared env is modeled as a theorem envBlock.
    const reparsed = parseTex(out);
    expect(JSON.stringify(reparsed)).toContain('"envBlock"');
    const env = reparsed.content.find((b) => b.type === "envBlock");
    expect(env).toMatchObject({ attrs: { env: "exercise" } });
    editor.destroy();
  });

  it("defaults the display name to the capitalized env name", () => {
    const editor = makeEditor(SIMPLE);
    addNewtheorem(editor, "conjecture", "");
    expect(serializeTex(editor.getJSON() as never)).toContain(
      "\\newtheorem{conjecture}{Conjecture}",
    );
    editor.destroy();
  });

  it("rejects invalid names and files without a preamble", () => {
    const editor = makeEditor(SIMPLE);
    expect(addNewtheorem(editor, "not a name", "X")).toBe(false);
    expect(addNewtheorem(editor, "eq:1", "X")).toBe(false);
    editor.destroy();
    const bare = new Editor({
      extensions: [StarterKit.configure({ document: false }), ...visualTexExtensions],
      content: "No preamble here.\n" as never,
    });
    expect(addNewtheorem(bare, "exercise", "Exercise")).toBe(false);
    bare.destroy();
  });

  it("is one undo step together with the package and the instance", () => {
    const editor = makeEditor(SIMPLE);
    addNewtheorem(editor, "exercise", "Exercise");
    editor.chain().setTextSelection(endOfText(editor)).run();
    insertEnvBlock(editor, "exercise");
    // The history groups the adjacent dispatches: a single undo
    // removes the instance, the declaration, and the package.
    editor.commands.undo();
    expect(serializeTex(editor.getJSON() as never)).toBe(serializeTex(parseTex(SIMPLE)));
    editor.destroy();
  });
});

describe("insertTheoremEnvEntries", () => {
  it("lists the standard family plus \\newtheorem-declared envs", () => {
    const editor = makeEditor(DECLARED);
    const entries = insertTheoremEnvEntries(editor);
    expect(entries.some((e) => e.env === "theorem" && !e.declared)).toBe(true);
    const exercise = entries.find((e) => e.env === "exercise");
    expect(exercise).toMatchObject({ env: "exercise", label: "Exercise", declared: true });
    editor.destroy();
  });

  it("reflects declarations made in this editing session", () => {
    const editor = makeEditor(SIMPLE);
    expect(insertTheoremEnvEntries(editor).some((e) => e.env === "exercise")).toBe(false);
    addNewtheorem(editor, "exercise", "Exercise");
    expect(insertTheoremEnvEntries(editor).some((e) => e.env === "exercise")).toBe(true);
    editor.destroy();
  });
});
