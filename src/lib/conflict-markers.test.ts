import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import {
  findConflictHunks,
  hasConflictMarkers,
  resolutionText,
} from "@/lib/conflict-markers";

const CONFLICT = [
  "before",
  "<<<<<<< HEAD",
  "mine 1",
  "mine 2",
  "=======",
  "theirs 1",
  ">>>>>>> origin/main",
  "after",
  "",
].join("\n");

describe("findConflictHunks", () => {
  it("finds a hunk with its sides and labels", () => {
    const doc = Text.of(CONFLICT.split("\n"));
    const hunks = findConflictHunks(doc);
    expect(hunks).toHaveLength(1);
    const [hunk] = hunks;
    expect(doc.sliceString(hunk!.oursFrom, hunk!.oursTo)).toBe("mine 1\nmine 2\n");
    expect(doc.sliceString(hunk!.theirsFrom, hunk!.theirsTo)).toBe("theirs 1\n");
    expect(hunk!.oursLabel).toBe("HEAD");
    expect(hunk!.theirsLabel).toBe("origin/main");
    expect(hunk!.markerLines).toEqual([2, 5, 7]);
    expect(doc.sliceString(hunk!.from, hunk!.to)).toMatch(
      /^<<<<<<< HEAD[\s\S]*>>>>>>> origin\/main$/,
    );
  });

  it("reads diff3 hunks, skipping the ancestor", () => {
    const doc = Text.of([
      "<<<<<<< HEAD",
      "mine",
      "||||||| merged common ancestors",
      "base",
      "=======",
      "theirs",
      ">>>>>>> origin/main",
    ]);
    const [hunk] = findConflictHunks(doc);
    expect(doc.sliceString(hunk!.oursFrom, hunk!.oursTo)).toBe("mine\n");
    expect(doc.sliceString(hunk!.theirsFrom, hunk!.theirsTo)).toBe("theirs\n");
    expect(hunk!.markerLines).toEqual([1, 3, 5, 7]);
  });

  it("ignores stray or unfinished markers", () => {
    expect(findConflictHunks(Text.of(["a", "=======", "b"]))).toEqual([]);
    expect(findConflictHunks(Text.of(["<<<<<<< HEAD", "a", "=======", "b"]))).toEqual(
      [],
    );
    expect(findConflictHunks(Text.of(["a", ">>>>>>> x"]))).toEqual([]);
  });

  it("finds several hunks and empty sides", () => {
    const doc = Text.of([
      "<<<<<<< HEAD",
      "=======",
      "added",
      ">>>>>>> origin/main",
      "middle",
      "<<<<<<< HEAD",
      "x",
      "=======",
      ">>>>>>> origin/main",
    ]);
    const hunks = findConflictHunks(doc);
    expect(hunks).toHaveLength(2);
    expect(doc.sliceString(hunks[0]!.oursFrom, hunks[0]!.oursTo)).toBe("");
    expect(doc.sliceString(hunks[1]!.theirsFrom, hunks[1]!.theirsTo)).toBe("");
  });
});

describe("resolutionText", () => {
  it("keeps one side or both", () => {
    const doc = Text.of(CONFLICT.split("\n"));
    const [hunk] = findConflictHunks(doc);
    expect(resolutionText(doc, hunk!, "ours")).toBe("mine 1\nmine 2\n");
    expect(resolutionText(doc, hunk!, "theirs")).toBe("theirs 1\n");
    expect(resolutionText(doc, hunk!, "both")).toBe("mine 1\nmine 2\ntheirs 1\n");
  });

  it("drops the trailing newline when the hunk ends the document", () => {
    const doc = Text.of([
      "<<<<<<< HEAD",
      "mine",
      "=======",
      "theirs",
      ">>>>>>> origin/main",
    ]);
    const [hunk] = findConflictHunks(doc);
    expect(resolutionText(doc, hunk!, "theirs")).toBe("theirs");
  });
});

describe("hasConflictMarkers", () => {
  it("spots a hunk start anywhere", () => {
    expect(hasConflictMarkers(CONFLICT)).toBe(true);
    expect(hasConflictMarkers("<<<<<<< HEAD\nx")).toBe(true);
    expect(hasConflictMarkers("plain\n")).toBe(false);
    expect(hasConflictMarkers("a <<<<<<< b")).toBe(false);
  });
});
