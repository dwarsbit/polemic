import { describe, expect, it } from "vitest";
import { describeProseChange, planReplacements, proseChange } from "./edits";

const doc = [
  "\\documentclass{article}",
  "\\begin{document}",
  "Results are in Table~\\ref{tab:main}.",
  "\\begin{tabular}{ll}",
  "a & b \\\\",
  "\\end{tabular}",
  "\\end{document}",
].join("\n");

describe("planReplacements", () => {
  it("applies replacements that each occur once", () => {
    const planned = planReplacements(doc, [
      { find: "\\begin{tabular}{ll}", replace: "\\begin{tabular}{lr}" },
      { find: "a & b", replace: "a & c" },
    ]);
    expect("error" in planned).toBe(false);
    if ("after" in planned) {
      expect(planned.after).toContain("\\begin{tabular}{lr}");
      expect(planned.after).toContain("a & c");
      expect(planned.edits).toHaveLength(2);
    }
  });

  it("rejects a find that is missing, repeated or overlapping", () => {
    expect(planReplacements(doc, [{ find: "nope", replace: "x" }])).toHaveProperty(
      "error",
    );
    expect(planReplacements(doc, [{ find: "tabular", replace: "x" }])).toHaveProperty(
      "error",
    );
    expect(
      planReplacements(doc, [
        { find: "a & b", replace: "x" },
        { find: "& b \\\\", replace: "y" },
      ]),
    ).toHaveProperty("error");
    expect(planReplacements(doc, [])).toHaveProperty("error");
    expect(planReplacements(doc, [{ find: "", replace: "x" }])).toHaveProperty("error");
  });

  it("writes a new file from one empty find", () => {
    const planned = planReplacements("", [
      { find: "", replace: "\\ProvidesPackage{x}" },
    ]);
    expect(planned).toEqual({
      edits: [{ from: 0, to: 0, insert: "\\ProvidesPackage{x}" }],
      after: "\\ProvidesPackage{x}",
    });
  });
});

describe("proseChange", () => {
  it("ignores changes to markup only", () => {
    const after = doc
      .replace("{ll}", "{lr}")
      .replace("\\ref{tab:main}", "\\ref{tab:other}");
    expect(proseChange(doc, after)).toBeNull();
  });

  it("names the words a change removes and adds", () => {
    const after = doc.replace("Results are in", "The results appear in");
    const change = proseChange(doc, after);
    expect(change).not.toBeNull();
    expect(change!.removed).toEqual(["Results", "are"]);
    expect(change!.added).toEqual(["The", "results", "appear"]);
    expect(describeProseChange(change!)).toBe(
      "This change edits your text: it removes “Results”, “are” and adds “The”, “results”, “appear”.",
    );
  });
});
