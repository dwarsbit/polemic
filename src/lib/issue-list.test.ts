import { describe, expect, it } from "vitest";
import { arrangeIssues, errorSource, firstError, sourceSpot } from "@/lib/issue-list";
import { parseBibToolFailure, parseIssues, parseRunFailure } from "@/lib/logparse";
import type { CompileIssue } from "@/lib/tauri";

function issue(
  severity: CompileIssue["severity"],
  message: string,
  line: number | null = null,
  extra: Partial<CompileIssue> = {},
): CompileIssue {
  return { severity, file: "main.tex", line, message, detail: [], ...extra };
}

const arrange = (issues: CompileIssue[]) => arrangeIssues(issues, { cloud: false });

const UNKNOWN = "Undefined control sequence.";
const unknown = (line: number, command: string) =>
  issue("error", UNKNOWN, line, { detail: [`l.${line} ${command}`] });

describe("arrangeIssues", () => {
  it("puts the first error on top and folds the ones after it", () => {
    const list = arrange([
      issue("warning", "LaTeX Warning: Marginpar on page 2 moved"),
      unknown(3, "\\frrac"),
      issue("error", "Missing $ inserted.", 3),
      issue("error", "Missing $ inserted.", 4),
      unknown(9, "\\alhpa"),
    ]);
    expect(list.first.map((row) => row.title)).toEqual(["Unknown command \\frrac"]);
    expect(list.followOnCount).toBe(3);
    expect(list.followOn.map((row) => [row.title, row.repeats])).toEqual([
      ["Math used outside math mode", 2],
      ["Unknown command \\alhpa", null],
    ]);
    expect(list.followOn[0].entries.map((entry) => entry.issue.line)).toEqual([3, 4]);
    expect(firstError(list)?.title).toBe("Unknown command \\frrac");
  });

  it("gives the first error its advice", () => {
    const [row] = arrange([unknown(3, "\\frrac")]).first;
    expect(row.advice).toContain("spelling");
    expect(
      arrange([issue("error", "Odd.", 1, { hint: "Do this." })]).first[0].advice,
    ).toBe("Do this.");
  });

  it("keeps a failed tool apart from TeX's errors", () => {
    const bibtex = parseBibToolFailure(
      "Collected error summary (may duplicate other messages):\n  bibtex build/main: Bibtex errors: See file 'build/main.blg'\n",
      "Repeated entry---line 12 of file refs.bib\n",
    )!;
    const glossary = parseRunFailure(
      "Collected error summary (may duplicate other messages):\n  cusdep glo gls build/main: Command for 'cusdep glo gls build/main' gave return code 65280\n",
    )!;
    const unsettled = parseRunFailure(
      "Latexmk: Maximum runs of pdflatex reached without getting stable files\n",
    )!;
    for (const failure of [bibtex, glossary, unsettled]) {
      expect(errorSource(failure)).toBe("tool");
    }
    const list = arrange([
      glossary,
      bibtex,
      unknown(3, "\\frrac"),
      unknown(5, "\\frrac"),
    ]);
    expect(list.first.map((row) => row.title)).toEqual(["Unknown command \\frrac"]);
    expect(list.followOnCount).toBe(1);
    expect(list.tools.map((row) => row.title)).toEqual([
      glossary.message,
      bibtex.message,
    ]);
    // With no error from TeX, the failed tool is what to read first.
    expect(firstError(arrange([bibtex]))?.title).toBe(bibtex.message);
  });

  it("puts the limit that stopped the compile above TeX's errors", () => {
    const stopped = issue(
      "error",
      "The compile was stopped after 5 minutes on the Polemic server.",
    );
    const list = arrange([stopped, unknown(3, "\\frrac"), unknown(4, "\\frrac")]);
    expect(list.first.map((row) => row.title)).toEqual([
      stopped.message,
      "Unknown command \\frrac",
    ]);
    expect(list.followOnCount).toBe(1);
  });

  it("lists warnings of one kind as one row", () => {
    const list = arrange([
      issue(
        "warning",
        "LaTeX Warning: Citation `a' on page 1 undefined on input line 4",
        4,
      ),
      issue(
        "warning",
        "LaTeX Warning: Reference `fig:x' on page 1 undefined on input line 5",
        5,
      ),
      issue(
        "warning",
        "Package natbib Warning: Citation `b' undefined on input line 9",
        9,
      ),
      issue(
        "warning",
        "LaTeX Warning: Float too large for page by 3.2pt on input line 12",
        12,
      ),
    ]);
    expect(list.warnings.map((row) => [row.title, row.repeats])).toEqual([
      ["2 citations without a bibliography entry", null],
      ["No label fig:x for this reference", null],
      ["A figure or table is 3 pt too tall for the page", null],
    ]);
    expect(list.warnings[0].entries.map((entry) => entry.title)).toEqual([
      "No bibliography entry a for this citation",
      "No bibliography entry b for this citation",
    ]);
    expect(firstError(list)).toBeNull();
  });

  it("counts warnings the catalog doesn't know by what they say", () => {
    const list = arrange([
      issue("warning", "Package foo Warning: Thing `a' is odd on input line 4", 4),
      issue("warning", "Package foo Warning: Thing `b' is odd on input line 80", 80),
      issue("warning", "Package foo Warning: Something else"),
    ]);
    expect(list.warnings.map((row) => [row.title, row.repeats])).toEqual([
      ["Package foo Warning: Thing `a' is odd on input line 4", 2],
      ["Package foo Warning: Something else", null],
    ]);
  });

  it("names a row the same from one compile to the next", () => {
    const before = arrange([unknown(3, "\\frrac"), unknown(9, "\\alhpa")]);
    const after = arrange([unknown(4, "\\frrac"), unknown(10, "\\alhpa")]);
    expect(after.first[0].key).toBe(before.first[0].key);
    expect(after.followOn[0].key).toBe(before.followOn[0].key);
    expect(new Set([before.first[0].key, before.followOn[0].key]).size).toBe(2);
    // The same error as first and as follow-on is two rows.
    const twice = arrange([unknown(3, "\\frrac"), unknown(9, "\\frrac")]);
    expect(twice.followOn[0].key).not.toBe(twice.first[0].key);
  });
});

describe("sourceSpot", () => {
  it("splits the source line where TeX stopped", () => {
    const [found] = parseIssues(
      "./main.tex:12: Undefined control sequence.\nl.12 The value \\frrac\n                     {a}{b} is small\n",
    );
    expect(sourceSpot(found)).toEqual({
      line: 12,
      before: "The value ",
      at: "\\frrac",
      after: "{a}{b} is small",
    });
  });

  it("marks a single character too", () => {
    expect(
      sourceSpot(
        issue("error", "Missing $ inserted.", 4, {
          detail: ["l.4 the value x_", "   1 is"],
        }),
      ),
    ).toEqual({ line: 4, before: "the value x", at: "_", after: "1 is" });
  });

  it("copes with a line that ends at the error", () => {
    expect(sourceSpot(unknown(7, "\\foo"))).toEqual({
      line: 7,
      before: "",
      at: "\\foo",
      after: "",
    });
    expect(
      sourceSpot(issue("error", "Missing $ inserted.", 22, { detail: ["l.22"] })),
    ).toEqual({ line: 22, before: "", at: "", after: "" });
  });

  it("marks nothing for an error LaTeX raises after reading on", () => {
    expect(
      sourceSpot(
        issue("error", "LaTeX Error: Command \\vec already defined.", 5, {
          detail: ["l.5 \\newcommand{\\vec}", "                    [1]{\\mathbf{#1}}"],
        }),
      ),
    ).toEqual({
      line: 5,
      before: "\\newcommand{\\vec}[1]{\\mathbf{#1}}",
      at: "",
      after: "",
    });
    const missing = (detail: string[]) =>
      sourceSpot(
        issue("error", "LaTeX Error: File `siuntx.sty' not found.", 6, { detail }),
      );
    // LaTeX had read on to the next \usepackage: not the line to show.
    expect(missing(["l.6 \\usepackage", "               {booktabs}^^M"])).toBeNull();
    expect(missing(["l.5 \\usepackage{siuntx}", ""])?.before).toBe(
      "\\usepackage{siuntx}",
    );
  });

  it("is nothing for an issue without a source line", () => {
    expect(
      sourceSpot(issue("error", "LaTeX Error: File `a.sty' not found.")),
    ).toBeNull();
    expect(
      sourceSpot(
        issue("error", "BibTeX failed: Repeated entry", 3, {
          detail: ["I was expecting"],
        }),
      ),
    ).toBeNull();
  });
});
