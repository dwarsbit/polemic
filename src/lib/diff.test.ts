import { describe, expect, it } from "vitest";
import { collapseContext, lineDiff } from "./diff";

function summary(lines: { type: string }[]) {
  return lines
    .map((l) => (l.type === "context" ? "=" : l.type === "add" ? "+" : "-"))
    .join("");
}

describe("lineDiff", () => {
  it("returns only context lines for identical texts", () => {
    expect(summary(lineDiff("a\nb\nc\n", "a\nb\nc\n"))).toBe("===");
  });

  it("handles empty inputs", () => {
    expect(summary(lineDiff("", "x\ny\n"))).toBe("++");
    expect(summary(lineDiff("x\n", ""))).toBe("-");
  });

  it("treats trailing newline differences as no change", () => {
    expect(summary(lineDiff("a\nb", "a\nb\n"))).toBe("==");
  });

  it("marks a single modified line as remove then add", () => {
    const lines = lineDiff("one\ntwo\nthree\n", "one\nTWO\nthree\n");
    expect(summary(lines)).toBe("=-+=");
    expect(lines[1]).toMatchObject({ text: "two", oldLine: 2, newLine: null });
    expect(lines[2]).toMatchObject({ text: "TWO", oldLine: null, newLine: 2 });
  });

  it("detects inserted and deleted lines", () => {
    const insert = lineDiff("a\nc\n", "a\nb\nc\n");
    expect(summary(insert)).toBe("=+=");
    const remove = lineDiff("a\nb\nc\n", "a\nc\n");
    expect(summary(remove)).toBe("=-=");
  });

  it("tracks line numbers across changes", () => {
    const lines = lineDiff("a\nb\nc\nd\n", "b\nc\nd\ne\n");
    // a removed at old 1, bcd context at old 2-4 / new 1-3, e added at new 4
    expect(lines[0]).toMatchObject({ type: "remove", oldLine: 1 });
    expect(lines[4]).toMatchObject({ type: "add", newLine: 4 });
  });
});

describe("collapseContext", () => {
  const ctx = (n: number, start = 0) =>
    Array.from({ length: n }, (_, k) => ({
      type: "context" as const,
      text: `line ${start + k}`,
      oldLine: start + k + 1,
      newLine: start + k + 1,
    }));

  it("keeps short context runs intact", () => {
    const rows = collapseContext([
      ...ctx(4),
      { type: "add", text: "x", oldLine: null, newLine: 5 },
    ]);
    expect(rows).toHaveLength(5);
    expect(rows[4]).toMatchObject({ kind: "line" });
  });

  it("collapses long context runs with a gap marker", () => {
    // 23 consecutive context lines, then an added line.
    const rows = collapseContext([
      ...ctx(3),
      ...ctx(20, 3),
      { type: "add", text: "x", oldLine: null, newLine: 24 },
    ]);
    const gaps = rows.filter((r) => r.kind === "gap");
    expect(gaps).toEqual([{ kind: "gap", count: 23 - 6 }]);
    expect(rows).toHaveLength(3 + 1 + 3 + 1);
  });

  it("collapses runs at the start and end", () => {
    const rows = collapseContext([
      ...ctx(10),
      { type: "remove", text: "x", oldLine: 11, newLine: null },
      ...ctx(10, 10),
    ]);
    expect(rows.filter((r) => r.kind === "gap")).toEqual([
      { kind: "gap", count: 4 },
      { kind: "gap", count: 4 },
    ]);
  });
});
