import { describe, expect, it } from "vitest";
import { applyEdits } from "@/lib/label-index";
import { canMove, planLevelChange, planMove, planMoveTo } from "@/lib/outline-edit";

const doc = [
  "\\documentclass{article}",
  "\\begin{document}",
  "\\section{A}",
  "a text",
  "\\subsection{A1}",
  "a1 text",
  "\\section{B}",
  "b text",
  "\\section{C}",
  "c text",
  "\\end{document}",
].join("\n");

const run = (source: string, edits: ReturnType<typeof planMove>) => applyEdits(source, edits);

describe("planMove", () => {
  it("swaps a section, with its subsections, and its sibling", () => {
    // Entries: 0 A, 1 A1, 2 B, 3 C.
    const down = run(doc, planMove(doc, 0, 1));
    expect(down.split("\n").slice(2, 8)).toEqual([
      "\\section{B}",
      "b text",
      "\\section{A}",
      "a text",
      "\\subsection{A1}",
      "a1 text",
    ]);
    expect(run(down, planMove(down, 1, -1))).toBe(doc);
  });

  it("keeps the document tail in place", () => {
    const up = run(doc, planMove(doc, 3, -1));
    expect(up.split("\n").slice(6)).toEqual([
      "\\section{C}",
      "c text",
      "\\section{B}",
      "b text",
      "\\end{document}",
    ]);
    expect(canMove(doc, 3, 1)).toBe(false);
  });

  it("does not move past the parent", () => {
    expect(canMove(doc, 1, -1)).toBe(false);
    expect(canMove(doc, 1, 1)).toBe(false);
    expect(canMove(doc, 0, -1)).toBe(false);
  });

  it("handles a last section without a trailing newline", () => {
    const src = "\\section{X}\nx\n\\section{Y}\ny";
    expect(run(src, planMove(src, 1, -1))).toBe("\\section{Y}\ny\n\\section{X}\nx");
    expect(run(src, planMove(src, 0, 1))).toBe("\\section{Y}\ny\n\\section{X}\nx");
  });
});

describe("planMoveTo", () => {
  it("drops a section before or after another one", () => {
    const before = run(doc, planMoveTo(doc, 3, 0, "before"));
    expect(before.split("\n").slice(2, 5)).toEqual(["\\section{C}", "c text", "\\section{A}"]);
    const after = run(doc, planMoveTo(doc, 0, 2, "after"));
    expect(after.split("\n").slice(2, 5)).toEqual(["\\section{B}", "b text", "\\section{A}"]);
  });

  it("refuses to drop a section into its own subtree", () => {
    expect(planMoveTo(doc, 0, 1, "after")).toEqual([]);
  });
});

describe("planLevelChange", () => {
  it("demotes and promotes a section with its subsections", () => {
    const demoted = run(doc, planLevelChange(doc, 0, 1, 0));
    expect(demoted).toContain("\\subsection{A}");
    expect(demoted).toContain("\\subsubsection{A1}");
    expect(run(demoted, planLevelChange(demoted, 0, -1, 0))).toBe(doc);
  });

  it("stays within the levels the document uses", () => {
    // No \chapter in an article: a section cannot be promoted.
    expect(planLevelChange(doc, 0, -1, 0)).toEqual([]);
    // \subsubsection is the deepest level.
    const deep = "\\subsection{S}\n\\subsubsection{T}";
    expect(planLevelChange(deep, 0, 1, 0)).toEqual([]);
    expect(run(deep, planLevelChange(deep, 1, -1, 0))).toBe("\\subsection{S}\n\\subsection{T}");
  });
});

describe("structural includes", () => {
  const src = "\\section{A}\na\n\\input{table}\n\\section{B}\nb\n\\input{chapters/c}\n\\end{document}";
  const options = { isStructuralInclude: (spec: string) => spec.startsWith("chapters/") };

  it("moves content includes with the section and leaves section includes", () => {
    const moved = run(src, planMoveTo(src, 1, 0, "before", options));
    expect(moved).toBe(
      "\\section{B}\nb\n\\section{A}\na\n\\input{table}\n\\input{chapters/c}\n\\end{document}",
    );
  });
});
