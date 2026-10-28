// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  cursorCharLeft,
  cursorCharRight,
  deleteCharBackward,
  deleteCharForward,
  history,
  undo,
} from "@codemirror/commands";
import {
  authorStyles,
  changeAt,
  changesField,
  resolveChangeIn,
  setChangeAuthors,
  setSuggestListener,
  setSuggestMode,
  trackChanges,
} from "@/lib/changes-view";
import { parseAuthors } from "@/lib/changes";

let view: EditorView | null = null;

function mount(doc: string, cursor = 0): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [history(), trackChanges],
    }),
    parent,
  });
  return view;
}

afterEach(() => {
  view?.destroy();
  view = null;
});

const text = (v: EditorView) => v.contentDOM.textContent;

describe("track changes in the Code view", () => {
  it("hides the markup and shows the old text of a replacement first", () => {
    const v = mount(
      "The results \\replaced[id=LG]{confirm}{suggest} our \\added{new} model.",
    );
    expect(text(v)).toBe("The results suggestconfirm our new model.");
    const del = v.contentDOM.querySelector(".cm-change-del");
    expect(del?.textContent).toBe("suggest");
    expect(v.contentDOM.querySelector(".cm-change-ins")?.textContent).toBe("confirm");
  });

  it("moves the caret over the hidden markup in one step", () => {
    const doc = "a \\added[id=LG]{bc} d";
    const v = mount(doc, 2);
    // Past "\\added[id=LG]{": the caret never lands inside it. The
    // two sides are distinct stops (typing goes outside or inside).
    cursorCharRight(v);
    expect(v.state.selection.main.head).toBe(doc.indexOf("bc"));
    cursorCharRight(v);
    expect(v.state.selection.main.head).toBe(doc.indexOf("bc") + 1);
    cursorCharLeft(v);
    cursorCharLeft(v);
    expect(v.state.selection.main.head).toBe(2);
  });

  it("accepts and rejects as one undo step each", () => {
    const doc = "x \\deleted[id=LG]{old} y \\added[id=LG]{new} z";
    const v = mount(doc);
    expect(resolveChangeIn(v, doc.indexOf("old"), "accept")).toBe(true);
    expect(v.state.doc.toString()).toBe("x y \\added[id=LG]{new} z");
    const at = v.state.doc.toString().indexOf("new");
    expect(resolveChangeIn(v, at, "reject")).toBe(true);
    expect(v.state.doc.toString()).toBe("x y z");
    undo(v);
    expect(v.state.doc.toString()).toBe("x y \\added[id=LG]{new} z");
    undo(v);
    expect(v.state.doc.toString()).toBe(doc);
  });

  it("finds the innermost suggestion at a position", () => {
    const doc = "\\added{a \\deleted{b} c}";
    const v = mount(doc);
    expect(changeAt(v.state, doc.indexOf("b"))?.kind).toBe("deleted");
    expect(changeAt(v.state, doc.indexOf("c"))?.kind).toBe("added");
    expect(changeAt(mount("plain").state, 2)).toBeNull();
  });

  it("keeps backspace and delete from breaking the markup", () => {
    const doc = "ab\\added{cd}ef";
    // Caret at the start of "cd": backspace deletes "b", not "\added{".
    const v = mount(doc, doc.indexOf("cd"));
    deleteCharBackward(v);
    expect(v.state.doc.toString()).toBe("a\\added{cd}ef");
    // Caret after "cd": delete removes "e", not "}".
    v.dispatch({ selection: { anchor: v.state.doc.toString().indexOf("}") } });
    deleteCharForward(v);
    expect(v.state.doc.toString()).toBe("a\\added{cd}f");
  });

  it("deletes a suggestion whole when the selection covers it", () => {
    const doc = "a \\added{b} c";
    const v = mount(doc);
    v.dispatch({
      changes: { from: 1, to: doc.length - 1, insert: "" },
      userEvent: "delete.selection",
    });
    expect(v.state.doc.toString()).toBe("ac");
  });

  it("keeps the markup of a suggestion a selection only partly covers", () => {
    const doc = "ab \\added{cd} e";
    const v = mount(doc);
    // From "b" into the middle of "cd": "b " and "c" go, the markup stays.
    v.dispatch({
      changes: { from: 1, to: doc.indexOf("d}"), insert: "X" },
      userEvent: "input.type",
    });
    expect(v.state.doc.toString()).toBe("aX\\added{d} e");
  });

  it("colors authors from the preamble and from another file", () => {
    const v = mount("\\added[id=LG]{a} \\added[id=ZZ]{b} \\added{c}");
    v.dispatch({
      effects: setChangeAuthors.of(
        parseAuthors("\\definechangesauthor[name={Leon}, color=blue]{LG}"),
      ),
    });
    const { styles } = v.state.field(changesField);
    expect(styles.get("LG")).toEqual({ name: "Leon", color: "#2563eb" });
    expect(styles.get("ZZ")?.name).toBe("ZZ");
    expect(styles.get(null)?.name).toBe("Unknown author");
  });

  it("gives authors without a known color distinct fallbacks", () => {
    const styles = authorStyles([], ["A", "B"]);
    expect(styles.get("A")?.color).not.toBe(styles.get("B")?.color);
  });
});

describe("suggest mode", () => {
  const author = { id: "LG", name: "Leon", initials: "LG", hasPreamble: true };

  function suggesting(doc: string, cursor: number): EditorView {
    const v = mount(doc, cursor);
    v.dispatch({ effects: setSuggestMode.of(author) });
    return v;
  }

  function typeText(v: EditorView, text: string) {
    for (const ch of text) {
      const { from, to } = v.state.selection.main;
      v.dispatch({
        changes: { from, to, insert: ch },
        selection: { anchor: from + 1 },
        userEvent: "input.type",
      });
    }
  }

  it("types a suggestion and sets the preamble up once", () => {
    const doc =
      "\\documentclass{article}\n\\begin{document}\nThe model.\n\\end{document}\n";
    const v = suggesting(doc, doc.indexOf("model"));
    typeText(v, "new ");
    expect(v.state.doc.toString()).toBe(
      "\\documentclass{article}\n\\usepackage{changes}\n" +
        "\\definechangesauthor[name={Leon}, color=orange]{LG}\n" +
        "\\begin{document}\nThe \\added[id=LG]{new }model.\n\\end{document}\n",
    );
    // The caret stays inside, so the typing merged into one suggestion.
    expect(text(v)).toContain("The new model.");
  });

  it("backspaces into one deletion and undoes per typing burst", () => {
    const v = suggesting("The model.", "The model".length);
    deleteCharBackward(v);
    deleteCharBackward(v);
    expect(v.state.doc.toString()).toBe("The mod\\deleted[id=LG]{el}.");
    undo(v);
    expect(v.state.doc.toString()).toBe("The model.");
  });

  it("replaces a selection with one \\replaced", () => {
    const v = suggesting("The results suggest it.", 0);
    const from = "The results ".length;
    v.dispatch({ selection: { anchor: from, head: from + "suggest".length } });
    typeText(v, "confirm");
    expect(v.state.doc.toString()).toBe(
      "The results \\replaced[id=LG]{confirm}{suggest} it.",
    );
  });

  it("refuses an edit inside math with a message", async () => {
    const message = vi.fn();
    setSuggestListener({ message, needsSetup: () => {} });
    const v = suggesting("Let $x+y$ be.", "Let $x".length);
    typeText(v, "z");
    expect(v.state.doc.toString()).toBe("Let $x+y$ be.");
    await Promise.resolve();
    expect(message).toHaveBeenCalledWith(expect.stringMatching(/math/));
    setSuggestListener(null);
  });

  it("asks the host to set the main file up from a chapter", async () => {
    const needsSetup = vi.fn();
    setSuggestListener({ message: () => {}, needsSetup });
    const v = mount("A chapter.", 2);
    v.dispatch({ effects: setSuggestMode.of({ ...author, hasPreamble: false }) });
    typeText(v, "new ");
    expect(v.state.doc.toString()).toBe("A \\added[id=LG]{new }chapter.");
    await Promise.resolve();
    expect(needsSetup).toHaveBeenCalled();
    setSuggestListener(null);
  });

  it("leaves edits alone when suggest mode is off", () => {
    const v = mount("ab", 1);
    v.dispatch({ effects: setSuggestMode.of(author) });
    v.dispatch({ effects: setSuggestMode.of(null) });
    typeText(v, "x");
    expect(v.state.doc.toString()).toBe("axb");
  });
});
