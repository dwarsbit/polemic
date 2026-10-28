// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
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
