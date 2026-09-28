import { describe, expect, it } from "vitest";
import { lineStatus } from "./git-line-status";

describe("lineStatus", () => {
  it("returns nothing for identical texts", () => {
    expect(lineStatus("a\nb\n", "a\nb\n")).toEqual(new Map());
  });

  it("leaves untracked files (null HEAD) unmarked", () => {
    expect(lineStatus(null, "a\nb\n")).toEqual(new Map());
  });

  it("marks a rewritten line as modified", () => {
    const head = "one\ntwo\nthree";
    const current = "one\nTWO\nthree";
    expect(lineStatus(head, current)).toEqual(new Map([[2, "modified"]]));
  });

  it("marks inserted lines as added", () => {
    const head = "one\nthree";
    const current = "one\ntwo\nthree";
    expect(lineStatus(head, current)).toEqual(new Map([[2, "added"]]));
  });

  it("marks nothing for deleted lines", () => {
    const head = "one\ntwo\nthree";
    const current = "one\nthree";
    expect(lineStatus(head, current)).toEqual(new Map());
  });

  it("pairs removes and adds in a block, leftover adds are added", () => {
    // Two HEAD lines replaced by three lines: 2 modified, 1 added.
    const head = "a\nb\nc";
    const current = "x\ny\nz\nc";
    expect(lineStatus(head, current)).toEqual(
      new Map([
        [1, "modified"],
        [2, "modified"],
        [3, "added"],
      ]),
    );
  });

  it("marks all lines as added for an empty HEAD file", () => {
    expect(lineStatus("", "a\nb\n")).toEqual(
      new Map([
        [1, "added"],
        [2, "added"],
      ]),
    );
  });
});
