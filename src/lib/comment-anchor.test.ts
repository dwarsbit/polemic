import { describe, expect, it } from "vitest";
import { lineAnchor, resolveAnchor } from "./comment-anchor";

const doc = ["a", "b", "c", "target line", "d", "e"].join("\n");

describe("resolveAnchor", () => {
  it("finds the anchor at its stored line", () => {
    expect(resolveAnchor(doc, { text: "target line", line: 4 })).toBe(4);
  });

  it("follows the anchor when lines shift nearby", () => {
    const edited = ["x", "new", "a", "b", "c", "target line", "d"];
    expect(resolveAnchor(edited.join("\n"), { text: "target line", line: 4 })).toBe(6);
  });

  it("falls back to a whole-document search when far away", () => {
    const edited = ["new", ...doc.split("\n")];
    expect(resolveAnchor(edited.join("\n"), { text: "target line", line: 4 })).toBe(7);
  });

  it("orphans when the text is gone", () => {
    const edited = doc.replace("target line", "renamed line");
    expect(resolveAnchor(edited, { text: "target line", line: 4 })).toBeNull();
  });

  it("never matches the empty anchor", () => {
    expect(resolveAnchor(doc, { text: "", line: 1 })).toBeNull();
  });

  it("locates multi-line selection anchors", () => {
    const anchor = { text: "b\nc\ntarget line", line: 2 };
    expect(resolveAnchor(doc, anchor)).toBe(2);
    const edited = ["x", "a", "b", "c", "target line", "d"];
    expect(resolveAnchor(edited.join("\n"), anchor)).toBe(3);
  });
});

describe("lineAnchor", () => {
  it("captures the line text and number", () => {
    expect(lineAnchor(doc, 4)).toEqual({ text: "target line", line: 4 });
  });
});
