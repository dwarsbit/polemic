import { describe, expect, it } from "vitest";
import {
  describeProseChange,
  planReplacements,
  proseChange,
  proseViolation,
} from "./edits";

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

describe("proseViolation", () => {
  const text = [
    "\\section{Results}",
    "",
    "Streets with more canopy were not much cooler at night \\parencite{oke1982}.",
    "Each ten percent lowered the temperature by $0.38$ K in 3 cities (Table~\\ref{tab:a}).",
    "",
    "The effect depends \\emph{strongly} on the weather.",
  ].join("\n");

  function check(find: string, replace: string, path = "results.tex") {
    const planned = planReplacements(text, [{ find, replace }]);
    if ("error" in planned) throw new Error(planned.error);
    return proseViolation(path, text, planned.after, planned.edits);
  }

  it("lets rewording through", () => {
    expect(check("Each ten percent lowered", "Every ten percent reduced")).toBeNull();
    expect(check("depends \\emph{strongly}", "hinges \\emph{strongly}")).toBeNull();
  });

  it("turns down changes beyond the wording", () => {
    expect(check("\\parencite{oke1982}", "\\parencite{bowler2010}")).toBe(
      "changes a citation, reference or label",
    );
    expect(check("(Table~\\ref{tab:a})", "")).toBe(
      "changes a citation, reference or label",
    );
    expect(check("$0.38$", "$0.4$")).toBe("changes math");
    expect(check("in 3 cities", "in three cities")).toBe("changes a number");
    expect(check("were not much cooler", "were much cooler")).toBe(
      "adds or drops a negation",
    );
    expect(check("depends \\emph{strongly}", "depends strongly")).toBe(
      "changes a command",
    );
  });

  it("keeps a change to one paragraph and to text files", () => {
    const planned = planReplacements(text, [
      { find: "Streets with", replace: "Roads with" },
      { find: "The effect", replace: "This effect" },
    ]);
    if ("error" in planned) throw new Error(planned.error);
    expect(proseViolation("results.tex", text, planned.after, planned.edits)).toBe(
      "spans more than one paragraph",
    );
    expect(check("weather.", "weather.\n\nMore.")).toBe(
      "spans more than one paragraph",
    );
    expect(check("Streets", "Roads", "references.bib")).toBe(
      "edits a file other than your text",
    );
  });
});
