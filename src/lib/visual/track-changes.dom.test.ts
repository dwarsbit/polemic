// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { StarterKit } from "@tiptap/starter-kit";
import { parseTex } from "./parse";
import { serializeTex } from "./serialize";
import { visualTexExtensions } from "./extensions";
import {
  changeAt,
  resolveVisualChange,
  setVisualSuggestAuthor,
  trackChangesExtensions,
} from "./track-changes";
import { setSuggestListener } from "@/lib/changes-view";
import type { DocNode } from "./doc-types";

let editor: Editor | null = null;

function makeEditor(tex: string): Editor {
  editor = new Editor({
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
      ...trackChangesExtensions,
    ],
    content: parseTex(tex),
  });
  return editor;
}

const tex = (e: Editor) => serializeTex(e.getJSON() as unknown as DocNode);

/** The document position of the first occurrence of `text`. */
function posOf(e: Editor, text: string): number {
  let found = -1;
  e.state.doc.descendants((node, pos) => {
    if (found !== -1 || !node.isText) return found === -1;
    const at = node.text!.indexOf(text);
    if (at !== -1) found = pos + at;
    return false;
  });
  if (found === -1) throw new Error(`no "${text}"`);
  return found;
}

const author = { id: "LG", name: "Leon", initials: "LG", hasPreamble: true };

afterEach(() => {
  setVisualSuggestAuthor(null);
  editor?.destroy();
  editor = null;
});

describe("suggestions in the Visual view", () => {
  it("keeps every suggestion through the editor byte for byte", () => {
    const source =
      "The \\replaced[id=LG, comment={Too strong?}]{confirm}{suggest} model, " +
      "\\added[id=AN]{new $x$ text} and \\deleted{gone}.\n";
    expect(tex(makeEditor(source))).toBe(source);
  });

  it("finds a replacement's two halves and its note", () => {
    const e = makeEditor(
      "The \\replaced[id=LG, comment={Why?}]{confirm}{suggest} it.\n",
    );
    const change = changeAt(e.state, posOf(e, "confirm") + 1)!;
    expect(change.kind).toBe("replaced");
    expect(change.note).toBe("Why?");
    expect(change.runs).toHaveLength(2);
  });

  it("accepts and rejects in one undo step each", () => {
    const e = makeEditor("A \\added[id=AN]{new} and \\deleted[id=AN]{old} word.\n");
    resolveVisualChange(e.view, changeAt(e.state, posOf(e, "new"))!, "accept");
    expect(tex(e)).toBe("A new and \\deleted[id=AN]{old} word.\n");
    resolveVisualChange(e.view, changeAt(e.state, posOf(e, "old"))!, "reject");
    expect(tex(e)).toBe("A new and old word.\n");
    e.commands.undo();
    expect(tex(e)).toBe("A new and \\deleted[id=AN]{old} word.\n");
    e.commands.undo();
    expect(tex(e)).toBe("A \\added[id=AN]{new} and \\deleted[id=AN]{old} word.\n");
  });
});

describe("suggest mode in the Visual view", () => {
  function type(e: Editor, text: string) {
    for (const ch of text) {
      const { from, to } = e.state.selection;
      e.view.dispatch(e.state.tr.insertText(ch, from, to));
    }
  }

  function backspace(e: Editor) {
    const { from } = e.state.selection;
    e.view.dispatch(e.state.tr.delete(from - 1, from));
  }

  it("marks typing as one insertion and sets the preamble up", () => {
    const e = makeEditor(
      "\\documentclass{article}\n\\begin{document}\nThe model.\n\\end{document}\n",
    );
    setVisualSuggestAuthor(author);
    e.commands.setTextSelection(posOf(e, "model"));
    type(e, "new ");
    expect(tex(e)).toContain("The \\added[id=LG]{new }model.");
    expect(tex(e)).toContain(
      "\\usepackage{changes}\n\\definechangesauthor[name={Leon}, color=orange]{LG}",
    );
  });

  it("strikes deleted text out, merging backspaces, the caret before it", () => {
    const e = makeEditor("The model.\n");
    setVisualSuggestAuthor({ ...author, hasPreamble: false });
    setSuggestListener({ message: () => {}, needsSetup: () => {} });
    e.commands.setTextSelection(posOf(e, "."));
    backspace(e);
    backspace(e);
    expect(tex(e)).toBe("The mod\\deleted[id=LG]{el}.\n");
    expect(e.state.selection.from).toBe(posOf(e, "el"));
    // Own new text goes directly.
    type(e, "X");
    backspace(e);
    expect(tex(e)).toBe("The mod\\deleted[id=LG]{el}.\n");
    setSuggestListener(null);
  });

  it("turns typing over a selection into one \\replaced", () => {
    const e = makeEditor("The results suggest it.\n");
    setVisualSuggestAuthor({ ...author, hasPreamble: false });
    setSuggestListener({ message: () => {}, needsSetup: () => {} });
    const from = posOf(e, "suggest");
    e.view.dispatch(
      e.state.tr.setSelection(TextSelection.create(e.state.doc, from, from + 7)),
    );
    type(e, "confirm");
    expect(tex(e)).toBe("The results \\replaced[id=LG]{confirm}{suggest} it.\n");
    // One undo step takes the whole typing burst back.
    e.commands.undo();
    expect(tex(e)).toBe("The results suggest it.\n");
    setSuggestListener(null);
  });

  it("refuses joining paragraphs with a message", async () => {
    const message = vi.fn();
    setSuggestListener({ message, needsSetup: () => {} });
    const e = makeEditor("One.\n\nTwo.\n");
    setVisualSuggestAuthor({ ...author, hasPreamble: false });
    const two = posOf(e, "Two");
    e.view.dispatch(e.state.tr.delete(two - 2, two));
    expect(tex(e)).toBe("One.\n\nTwo.\n");
    await Promise.resolve();
    expect(message).toHaveBeenCalledWith(expect.stringMatching(/joining paragraphs/));
    setSuggestListener(null);
  });
});
