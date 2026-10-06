import { describe, expect, it } from "vitest";
import { detectFixRule, planFix, type FixContext } from "./latex-fixes";
import type { CompileIssue } from "./tauri";

function issue(partial: Partial<CompileIssue>): CompileIssue {
  return {
    severity: "error",
    file: "main.tex",
    line: null,
    message: "",
    detail: [],
    ...partial,
  };
}

function ctx(doc: string, extra: Partial<FixContext> = {}): FixContext {
  return { doc, assets: [], bibKeys: [], ...extra };
}

const DOC = [
  "\\documentclass{article}",
  "\\usepackage{amsmath}",
  "\\begin{document}",
  "The value x_1 is nice.",
  "\\begin{itemize}",
  "  \\item \\frrac{a}{b}",
  "\\end{itemze}",
  "See \\ref{fig:overview} and \\cite{smith2020}.",
  "\\label{fig:overview}",
  "\\end{document}",
  "",
].join("\n");

describe("detectFixRule", () => {
  it("classifies the recognized messages", () => {
    expect(detectFixRule(issue({ message: "Undefined control sequence." }))).toBe(
      "undefined-control-sequence",
    );
    expect(detectFixRule(issue({ message: "Missing $ inserted." }))).toBe("missing-math");
    expect(
      detectFixRule(issue({ message: "LaTeX Error: Environment align undefined." })),
    ).toBe("environment-package");
    expect(
      detectFixRule(
        issue({
          message:
            "LaTeX Error: \\begin{itemize} on input line 3 ended by \\end{itemze}.",
        }),
      ),
    ).toBe("mismatched-end");
    expect(
      detectFixRule(issue({ message: "LaTeX Error: File `plot.png' not found." })),
    ).toBe("missing-file");
    expect(
      detectFixRule(
        issue({
          severity: "warning",
          message: "LaTeX Warning: Reference `fig:overveiw' undefined on input line 4.",
        }),
      ),
    ).toBe("undefined-reference");
    expect(
      detectFixRule(
        issue({
          severity: "warning",
          message: "LaTeX Warning: Citation `smiht2020' undefined on input line 7.",
        }),
      ),
    ).toBe("undefined-citation");
    expect(
      detectFixRule(
        issue({
          severity: "warning",
          message:
            "LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right",
        }),
      ),
    ).toBe("rerun");
  });

  it("declines unrecognized messages", () => {
    expect(detectFixRule(issue({ message: "! Emergency stop." }))).toBeNull();
    expect(detectFixRule(issue({ message: "LaTeX Error: Something odd." }))).toBeNull();
  });
});

describe("planFix rules", () => {
  it("suggests the closest known command for a typo", () => {
    const result = planFix(
      issue({
        line: 6,
        message: "Undefined control sequence.",
        detail: ["l.6 \\frrac"],
      }),
      ctx(DOC),
    );
    expect(result).not.toBeNull();
    expect(result!.title).toContain("\\frac");
    expect(result!.edits).toEqual([
      { from: DOC.indexOf("\\frrac"), to: DOC.indexOf("\\frrac") + 6, insert: "\\frac" },
    ]);
  });

  it("declines an undefined command that is not a typo", () => {
    const result = planFix(
      issue({ line: 6, message: "Undefined control sequence.", detail: ["l.6 \\qqqzz"] }),
      ctx(DOC),
    );
    expect(result).toBeNull();
  });

  it("wraps the stray subscript token in math mode", () => {
    const line = 4;
    const result = planFix(issue({ line, message: "Missing $ inserted." }), ctx(DOC));
    expect(result).not.toBeNull();
    const applied = apply(DOC, result!.edits);
    expect(applied).toContain("The value $x_1$ is nice.");
  });

  it("loads amsmath-style packages for unknown environments", () => {
    const doc = DOC.replace("\\usepackage{amsmath}", "");
    const result = planFix(
      issue({ message: "LaTeX Error: Environment align undefined." }),
      ctx(doc),
    );
    expect(result).not.toBeNull();
    const applied = apply(doc, result!.edits);
    expect(applied).toContain("\\usepackage{amsmath}");
  });

  it("does not load a package that is already there", () => {
    const result = planFix(
      issue({ message: "LaTeX Error: Environment align undefined." }),
      ctx(DOC),
    );
    expect(result).toBeNull();
  });

  it("repairs a mismatched \\end", () => {
    const result = planFix(
      issue({
        line: 7,
        message: "LaTeX Error: \\begin{itemize} on input line 5 ended by \\end{itemze}.",
      }),
      ctx(DOC),
    );
    expect(result).not.toBeNull();
    const applied = apply(DOC, result!.edits);
    expect(applied).toContain("\\end{itemize}");
    expect(applied).not.toContain("\\end{itemze}");
  });

  it("points a missing include at the closest asset", () => {
    const doc = DOC.replace("x_1", "\\includegraphics{assets/plot.png}");
    const result = planFix(
      issue({
        line: 4,
        message: "LaTeX Error: File `assets/plot.png' not found.",
      }),
      ctx(doc, { assets: ["assets/logo.png"] }),
    );
    // No asset within typo range of plot.png → declined.
    expect(result).toBeNull();
    const fixed = planFix(
      issue({ line: 4, message: "LaTeX Error: File `assets/plot.png' not found." }),
      ctx(doc, { assets: ["figures/plot.png", "assets/logo.png"] }),
    );
    expect(fixed).not.toBeNull();
    expect(apply(doc, fixed!.edits)).toContain("\\includegraphics{figures/plot.png}");
  });

  it("recompiles when the referenced label exists, else renames the ref", () => {
    const existing = planFix(
      issue({
        severity: "warning",
        line: 8,
        message: "LaTeX Warning: Reference `fig:overview' undefined on input line 8.",
      }),
      ctx(DOC),
    );
    expect(existing?.action).toBe("recompile");

    const typo = planFix(
      issue({
        severity: "warning",
        line: 8,
        message: "LaTeX Warning: Reference `fig:overveiw' undefined on input line 8.",
      }),
      ctx(DOC.replace("\\ref{fig:overview}", "\\ref{fig:overveiw}")),
    );
    expect(typo).not.toBeNull();
    const fixedDoc = apply(
      DOC.replace("\\ref{fig:overview}", "\\ref{fig:overveiw}"),
      typo!.edits,
    );
    expect(fixedDoc).toContain("\\ref{fig:overview}");
    expect(fixedDoc).not.toContain("\\ref{fig:overveiw}");
  });

  it("fixes a citation with a typo'd key against the bib keys", () => {
    const typoDoc = DOC.replace("\\cite{smith2020}", "\\cite{smiht2020}");
    const typo = planFix(
      issue({
        severity: "warning",
        line: 8,
        message: "LaTeX Warning: Citation `smiht2020' undefined on input line 8.",
      }),
      ctx(typoDoc, { bibKeys: ["smith2020", "jones2021"] }),
    );
    expect(typo).not.toBeNull();
    expect(apply(typoDoc, typo!.edits)).toContain("\\cite{smith2020}");

    const present = planFix(
      issue({
        severity: "warning",
        line: 8,
        message: "LaTeX Warning: Citation `smith2020' undefined on input line 8.",
      }),
      ctx(DOC, { bibKeys: ["smith2020"] }),
    );
    expect(present?.action).toBe("recompile");
  });
});

/** Apply SourceEdits (from/to/insert) like the editor does. */
function apply(doc: string, edits: { from: number; to: number; insert: string }[]): string {
  let out = doc;
  for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, edit.from) + edit.insert + out.slice(edit.to);
  }
  return out;
}
