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
    expect(detectFixRule(issue({ message: "Missing $ inserted." }))).toBe(
      "missing-math",
    );
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
      {
        from: DOC.indexOf("\\frrac"),
        to: DOC.indexOf("\\frrac") + 6,
        insert: "\\frac",
      },
    ]);
  });

  it("declines an undefined command that is not a typo", () => {
    const result = planFix(
      issue({
        line: 6,
        message: "Undefined control sequence.",
        detail: ["l.6 \\qqqzz"],
      }),
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
        message:
          "LaTeX Error: \\begin{itemize} on input line 5 ended by \\end{itemze}.",
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

  it("finds a missing image or include by a close name", () => {
    const include = (name: string) =>
      DOC.replace("x_1", `\\includegraphics[width=3cm]{${name}}`);
    const fix = (message: string, name: string, extra: Partial<FixContext>) => {
      const doc = include(name);
      const plan = planFix(issue({ line: 4, message }), ctx(doc, extra));
      return plan === null ? null : apply(doc, plan.edits).split("\n")[3];
    };
    const assets = ["figures/Plot.png", "figures/logo.pdf"];
    // No extension in the source, capitals that differ.
    expect(
      fix(
        "Package pdftex.def Error: File `figures/plot' not found: using draft setting.",
        "figures/plot",
        { assets },
      ),
    ).toContain("{figures/Plot}");
    // A typo, in XeLaTeX's words.
    expect(
      fix("Unable to load picture or PDF file 'figures/lgo.pdf'.", "figures/lgo.pdf", {
        assets,
      }),
    ).toContain("{figures/logo.pdf}");
    // Another kind of file is not a match.
    expect(
      fix("LaTeX Error: File `figures/logo.png' not found.", "figures/logo.png", {
        assets: ["figures/logo.pdf"],
      }),
    ).toBeNull();
    // Paths start at the main file's folder.
    expect(
      fix("LaTeX Error: File `fig/plot.png' not found.", "fig/plot.png", {
        assets: ["paper/figures/plot.png", "old/plot.png"],
        baseDir: "paper",
      }),
    ).toContain("{figures/plot.png}");
    // A package is not a project file.
    expect(
      fix("LaTeX Error: File `plot.sty' not found.", "plot", { assets: ["plot.png"] }),
    ).toBeNull();
  });

  it("finds a missing \\input among the .tex files", () => {
    const doc = DOC.replace("The value x_1 is nice.", "\\input{chapters/intro}");
    const plan = planFix(
      issue({ line: 4, message: "LaTeX Error: File `chapters/intro.tex' not found." }),
      ctx(doc, {
        texFiles: ["main.tex", "chapters/introduction.tex", "chapters/Intro.tex"],
      }),
    );
    expect(apply(doc, plan!.edits)).toContain("\\input{chapters/Intro}");
  });

  it("closes an environment that an outer \\end found open", () => {
    const doc = [
      "\\begin{document}",
      "\\begin{figure}",
      "  \\begin{center}",
      "    A",
      "\\end{figure}",
      "\\begin{itemize}",
      "  \\item B",
      "  \\end{document}",
      "",
    ].join("\n");
    const inner = planFix(
      issue({
        line: 5,
        message: "LaTeX Error: \\begin{center} on input line 3 ended by \\end{figure}.",
      }),
      ctx(doc),
    )!;
    expect(inner.title).toBe("Add \\end{center} before \\end{figure}");
    expect(apply(doc, inner.edits)).toContain("    A\n\\end{center}\n\\end{figure}");
    const last = planFix(
      issue({
        line: 8,
        message:
          "LaTeX Error: \\begin{itemize} on input line 6 ended by \\end{document}.",
      }),
      ctx(doc),
    )!;
    expect(apply(doc, last.edits)).toContain(
      "  \\item B\n  \\end{itemize}\n  \\end{document}",
    );
    // Not an outer environment: the name of the \end is what's wrong.
    const renamed = planFix(
      issue({
        line: 5,
        message: "LaTeX Error: \\begin{center} on input line 3 ended by \\end{centre}.",
      }),
      ctx(doc.replace("\\end{figure}", "\\end{centre}")),
    )!;
    expect(renamed.title).toBe("Change \\end{centre} to \\end{center}");
  });

  it("swaps \\newcommand and \\renewcommand", () => {
    const doc = [
      "\\newcommand{\\vec}[1]{\\mathbf{#1}}",
      "\\renewcommand*\\tens[1]{\\mathsf{#1}}",
      "\\newenvironment{proof}{}{}",
      "\\newcommand{\\vector}{v}",
      "",
    ].join("\n");
    const fix = (line: number, message: string) => {
      const plan = planFix(issue({ line, message }), ctx(doc));
      return plan === null ? null : apply(doc, plan.edits).split("\n")[line - 1];
    };
    expect(fix(1, "LaTeX Error: Command \\vec already defined.")).toBe(
      "\\renewcommand{\\vec}[1]{\\mathbf{#1}}",
    );
    expect(fix(2, "LaTeX Error: Command \\tens undefined.")).toBe(
      "\\newcommand*\\tens[1]{\\mathsf{#1}}",
    );
    expect(fix(3, "LaTeX Error: Command \\proof already defined.")).toBe(
      "\\renewenvironment{proof}{}{}",
    );
    // The line defines another command: nothing to swap.
    expect(fix(4, "LaTeX Error: Command \\vec already defined.")).toBeNull();
    // A counter is not made with \newcommand.
    expect(
      detectFixRule(
        issue({ message: "LaTeX Error: Command \\c@lemma already defined." }),
      ),
    ).toBeNull();
  });

  it("closes an argument on the line that leaves it open", () => {
    const doc = [
      "\\section{Results  % the main part",
      "Streets with \\textbf{more} canopy were cooler.",
      "",
      "\\textbf{This runs",
      "over two lines.",
      "",
      "Done.",
      "",
    ].join("\n");
    const heading = planFix(
      issue({ line: 3, message: "Paragraph ended before \\section was complete." }),
      ctx(doc),
    )!;
    expect(heading.title).toBe("Add the missing } at the end of line 1");
    expect(apply(doc, heading.edits).split("\n")[0]).toBe(
      "\\section{Results}  % the main part",
    );
    const bold = planFix(
      issue({ line: 6, message: "Paragraph ended before \\textbf was complete." }),
      ctx(doc),
    )!;
    expect(apply(doc, bold.edits).split("\n")[3]).toBe("\\textbf{This runs}");
    // Every use closes: the cause is somewhere else.
    expect(
      planFix(
        issue({ line: 3, message: "Paragraph ended before \\textbf was complete." }),
        ctx(doc),
      ),
    ).toBeNull();
    expect(
      planFix(
        issue({ line: 8, message: "File ended while scanning use of \\textbf." }),
        ctx(doc.replace("over two lines.", "over {two lines.")),
      ),
    ).toBeNull();
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
function apply(
  doc: string,
  edits: { from: number; to: number; insert: string }[],
): string {
  let out = doc;
  for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, edit.from) + edit.insert + out.slice(edit.to);
  }
  return out;
}
