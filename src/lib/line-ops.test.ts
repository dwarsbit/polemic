import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { lineBounds } from "./line-ops";

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
