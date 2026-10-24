import { describe, expect, it } from "vitest";
import { applyEdits } from "./label-index";
import { replaceEdits, searchText } from "./project-search";

const all = { caseSensitive: false, scope: "all" as const };

describe("searchText", () => {
  it("finds every match per line, case-insensitive by default", () => {
    const hits = searchText("Alpha alpha\nbeta\nALPHA", "alpha", all);
    expect(hits.map((h) => [h.line, h.matches.length])).toEqual([
      [1, 2],
      [3, 1],
    ]);
    expect(searchText("Alpha", "alpha", { ...all, caseSensitive: true })).toEqual([]);
  });

  it("keeps offsets exact when case folding changes length", () => {
    const text = "İx alpha";
    expect(searchText(text, "ALPHA", all)[0].matches).toEqual([[3, 8]]);
    expect(searchText("a.b axb", "a.b", all)[0].matches).toEqual([[0, 3]]);
  });

  it("filters by math scope", () => {
    const text = "x in text $x + 1$";
    expect(searchText(text, "x", { ...all, scope: "math" })[0].matches).toEqual([
      [11, 12],
    ]);
    expect(searchText(text, "x", { ...all, scope: "text" })[0].matches).toEqual([
      [0, 1],
      [7, 8],
    ]);
  });
});

describe("replaceEdits", () => {
  it("replaces every match literally", () => {
    const text = "a.b a.b\nc a.b";
    expect(applyEdits(text, replaceEdits(text, "a.b", "$1", all))).toBe("$1 $1\nc $1");
  });

  it("limits to one line", () => {
    const text = "foo\nfoo\nfoo";
    expect(applyEdits(text, replaceEdits(text, "foo", "bar", all, 2))).toBe(
      "foo\nbar\nfoo",
    );
  });

  it("respects the scope", () => {
    const text = "alpha $\\alpha$";
    const edits = replaceEdits(text, "alpha", "beta", { ...all, scope: "text" });
    expect(applyEdits(text, edits)).toBe("beta $\\alpha$");
  });
});
