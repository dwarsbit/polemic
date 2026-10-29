import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState, SelectionRange } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { deleteLines, lineBounds } from "./line-ops";

describe("lineBounds", () => {
  const state = EditorState.create({ doc: "alpha\nbeta\ngamma" });

  it("includes the trailing newline for all but the last line", () => {
    expect(lineBounds(state, 0)).toEqual({ from: 0, to: 6 });
    expect(lineBounds(state, 7)).toEqual({ from: 6, to: 11 });
  });

  it("excludes the newline at the end of the document", () => {
    expect(lineBounds(state, 12)).toEqual({ from: 11, to: 16 });
  });

  it("handles a document that is a single line", () => {
    expect(lineBounds(EditorState.create({ doc: "only" }), 2)).toEqual({
      from: 0,
      to: 4,
    });
  });

  it("handles an empty document", () => {
    expect(lineBounds(EditorState.create({ doc: "" }), 0)).toEqual({
      from: 0,
      to: 0,
    });
  });
});

describe("deleteLines with multiple selection ranges", () => {
  function run(doc: string, ranges: SelectionRange[]): string {
    let state = EditorState.create({
      doc,
      selection: EditorSelection.create(ranges),
      extensions: EditorState.allowMultipleSelections.of(true),
    });
    const view = {
      get state() {
        return state;
      },
      dispatch: (spec: Parameters<EditorState["update"]>[0]) => {
        state = state.update(spec).state;
      },
    } as unknown as EditorView;
    deleteLines(view);
    return state.doc.toString();
  }

  it("deletes a shared line once for two cursors on it", () => {
    expect(
      run("abc\ndef\nghi\njkl", [EditorSelection.cursor(1), EditorSelection.cursor(2)]),
    ).toBe("def\nghi\njkl");
  });

  it("does not over-delete when a range and a cursor share a line", () => {
    expect(
      run("abc\ndef\nghi\njkl", [
        EditorSelection.range(1, 5),
        EditorSelection.cursor(6),
      ]),
    ).toBe("ghi\njkl");
  });

  it("deletes each line under cursors on distinct lines", () => {
    expect(
      run("abc\ndef\nghi\njkl", [
        EditorSelection.cursor(1),
        EditorSelection.cursor(9),
        EditorSelection.cursor(14),
      ]),
    ).toBe("def\n");
  });
});
