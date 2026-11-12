// Mirrors the tests in src-tauri/src/logparse.rs.
import { describe, expect, it } from "vitest";
import {
  addFontHints,
  parseBibToolFailure,
  parseIssues,
  parseRunFailure,
} from "@/lib/logparse";

describe("parseIssues", () => {
  it("hints at fonts missing on the server", () => {
    const log =
      './main.tex:3: Package fontspec Error: The font "Comic Neue" cannot\n(fontspec)                be found.\n./main.tex:9: Undefined control sequence.\n';
    const issues = parseIssues(log);
    addFontHints(issues);
    expect(issues[0].hint).toContain("font file");
    expect(issues[1].hint).toBeNull();
  });

  it("reports errors raised inside packages", () => {
    const log =
      "(./main.tex\nLaTeX2e <2025-11-01>\n(/usr/local/texlive/2026/texmf-dist/tex/latex/fontspec/fontspec.sty\n/usr/local/texlive/2026/texmf-dist/tex/latex/fontspec/fontspec.sty:100: Fatal Package fontspec Error: The fontspec package requires either XeTeX or\n(fontspec)                      LuaTeX.\n\nType <return> to continue.\n ...                                              \n                                                  \nl.100 \\msg_fatal:nn {fontspec} {cannot-use-pdftex}\n\n/usr/local/texlive/2026/texmf-dist/tex/latex/fontspec/fontspec.sty:100:  ==> Fatal error occurred, no output PDF file produced!\n";
    const issues = parseIssues(log);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: "error",
      file: "main.tex",
      line: null,
    });
    expect(issues[0].message).toMatch(
      /^Fatal Package fontspec Error: The fontspec package requires either XeTeX or/,
    );
    expect(issues[0].message).toContain("LuaTeX.");
  });

  it("reports package errors on Windows paths", () => {
    const log =
      "C:/texlive/2026/texmf-dist/tex/latex/eolang/eolang.sty:162: I can't write on file `_eolang/paper-phi.pl'.\n";
    const issues = parseIssues(log);
    expect(issues).toHaveLength(1);
    expect(issues[0].file).toBeNull();
    expect(issues[0].message).toBe("I can't write on file `_eolang/paper-phi.pl'.");
  });

  it("parses file-line errors and warnings", () => {
    const log = `./main.tex:3: Undefined control sequence.
./chapters/intro.tex:12: LaTeX Error: File \`missing.png' not found.
LaTeX Warning: Float too large for page by 3.0pt on input line 4.
Package hyperref Warning: Token not allowed in a PDF string
Random log line
`;
    const issues = parseIssues(log);
    expect(issues).toHaveLength(4);
    expect(issues[0]).toMatchObject({
      severity: "error",
      file: "main.tex",
      line: 3,
      message: "Undefined control sequence.",
    });
    expect(issues[1].file).toBe("chapters/intro.tex");
    expect(issues[2]).toMatchObject({ severity: "warning", line: 4 });
    expect(issues[3]).toMatchObject({ severity: "warning", line: null });
  });

  it("attributes warnings to the file TeX is reading", () => {
    const log =
      "(./main.tex (./chapters/intro.tex\nLaTeX Warning: Reference `fig:1' on page 1 undefined on input line 4.\n) (/usr/share/texlive/caption.sty\nPackage caption Warning: Unknown document class (or package),\n(caption)                standard defaults will be used.\n)\nLaTeX Warning: There were undefined references.\n)\n";
    const issues = parseIssues(log);
    expect(issues).toHaveLength(3);
    expect(issues[0]).toMatchObject({ file: "chapters/intro.tex", line: 4 });
    expect(issues[1].file).toBeNull();
    expect(issues[1].message).toBe(
      "Package caption Warning: Unknown document class (or package), standard defaults will be used",
    );
    expect(issues[2].file).toBe("main.tex");
  });

  it("drops line numbers inside package files", () => {
    const log =
      "(./main.tex (/usr/share/texlive/fancyhdr.sty\nPackage fancyhdr Warning: \\headheight is too small on input line 12.\n))\n";
    const issues = parseIssues(log);
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBeNull();
  });

  it("joins continued messages and hints at shell escape", () => {
    const log =
      "(./main.tex\n./main.tex:6: Package minted Error: You must invoke LaTeX with the\n(minted)                -shell-escape flag.\nLaTeX Warning: Unused global option(s):\n    [margin=0mm].\n\n)\n";
    const issues = parseIssues(log);
    expect(issues).toHaveLength(2);
    expect(issues[0].message).toBe(
      "Package minted Error: You must invoke LaTeX with the -shell-escape flag.",
    );
    expect(issues[0].hint).toContain("shell escape");
    expect(issues[1].message).toBe(
      "LaTeX Warning: Unused global option(s): [margin=0mm]",
    );
  });

  it("reports a repeated issue once", () => {
    const log =
      '(./main.tex\n./main.tex:6: Font TU/Fira/m/n/10="Fira" not loadable.\n./main.tex:6: Font TU/Fira/m/n/10="Fira" not loadable.\n(./a.tex\nPackage fancyhdr Warning: \\headheight is too small.\n) (./b.tex\nPackage fancyhdr Warning: \\headheight is too small.\n))\n';
    const issues = parseIssues(log);
    expect(issues.map((issue) => issue.severity)).toEqual(["error", "warning"]);
  });

  it("captures error context blocks", () => {
    const log = `! Undefined control sequence.
l.12 \\frrac
     {a}{b}
! Missing $ inserted.
<inserted text>
l.5 ...x_1
LaTeX Warning: Float too large for page by 12.0pt on input line 9.
`;
    const issues = parseIssues(log);
    expect(issues).toHaveLength(3);
    expect(issues[0].line).toBe(12);
    expect(issues[0].detail).toEqual(["l.12 \\frrac", "     {a}{b}"]);
    expect(issues[1].line).toBe(5);
    expect(issues[1].detail[0]).toBe("l.5 ...x_1");
    expect(issues[2].detail).toEqual([]);
    expect(issues[2].line).toBe(9);
  });

  it("drops unresolved references when the run has errors", () => {
    const log = `LaTeX Warning: Citation 'otsu1979' on page 2 undefined on input line 8.
LaTeX Warning: Reference \`sec:methods' on page 2 undefined on input line 33.
Package biblatex Warning: 'babel/polyglossia' detected but 'csquotes' missing.

./main.tex:9: Undefined control sequence.
LaTeX Warning: There were undefined references.
LaTeX Warning: Empty bibliography on input line 83.
`;
    const issues = parseIssues(log);
    expect(issues).toHaveLength(2);
    expect(issues[0].severity).toBe("error");
    expect(issues[1].message).toContain("csquotes");
  });

  it("keeps unresolved references when the run has no errors", () => {
    const log =
      "LaTeX Warning: Citation 'otsu1979' on page 2 undefined on input line 8.\n";
    expect(parseIssues(log)).toHaveLength(1);
  });

  it("does not swallow a following error's context", () => {
    const log = `./main.tex:3: LaTeX Error: File \`x.png' not found.
./main.tex:5: Missing $ inserted.
l.5 y_1
`;
    const issues = parseIssues(log);
    expect(issues).toHaveLength(2);
    expect(issues[0].detail).toEqual([]);
    expect(issues[1].detail[0]).toBe("l.5 y_1");
  });

  it("reads errors in files named without ./", () => {
    const issues = parseIssues(
      "(./demo/trigon_demo.tex (demo/frames.tex\ndemo/frames.tex:45: Package pdftex.def Error: File `shots/layout.jpg' not found: using draft setting.\n\nSee the pdftex.def package documentation for explanation.\nType  H <return>  for immediate help.\n ...                                              \n                                                  \nl.45 ...width]{shots/layout.jpg}}\n                                 \nLaTeX Warning: Float too large for page by 3.0pt on input line 50.\n))\n",
    );
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({
      severity: "error",
      file: "demo/frames.tex",
      line: 45,
    });
    // The context is found past TeX's help text.
    expect(issues[0].detail[0]).toBe("l.45 ...width]{shots/layout.jpg}}");
    expect(issues[1]).toMatchObject({ file: "demo/frames.tex", line: 50 });
  });

  it("places a missing file where TeX stopped", () => {
    const issues = parseIssues(
      "(./doc/main.tex\n\n! LaTeX Error: File `dtklogos.sty' not found.\n\nType X to quit or <RETURN> to proceed,\nor enter new name. (Default extension: sty)\n\nEnter file name: \n./doc/main.tex:11: Emergency stop.\n<read *> \n         \nl.11 \\usepackage\n                [table]{xcolor}^^M\n*** (cannot \\read from terminal in nonstop modes)\n\n!  ==> Fatal error occurred, no output PDF file produced!\n",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      message: "LaTeX Error: File `dtklogos.sty' not found.",
      file: "doc/main.tex",
      line: 11,
    });
    expect(issues[0].detail[0]).toBe("l.11 \\usepackage");
  });

  it("says why TeX stopped when no error does", () => {
    const notice = parseIssues(
      "(./thesis.cls\n\n ********************************************\n * XeTeX is required to compile this document.\n * Sorry!\n ********************************************\n\n./thesis.cls:67: Emergency stop.\n<read *> \n         \nl.67 \\RequireXeTeX\n                  \n*** (cannot \\read from terminal in nonstop modes)\n",
    );
    expect(notice).toHaveLength(1);
    expect(notice[0]).toMatchObject({
      message: "XeTeX is required to compile this document.",
      file: "thesis.cls",
      line: 67,
    });
    const aborted = parseIssues(
      "(./main.tex)\n! Emergency stop.\n<*> main.tex\n            \n*** (job aborted, no legal \\end found)\n",
    );
    expect(aborted).toHaveLength(1);
    expect(aborted[0].message).toBe(
      "Emergency stop (job aborted, no legal \\end found).",
    );
  });

  it("drops an emergency stop that follows an error", () => {
    const issues = parseIssues(
      "./main.tex:5: Undefined control sequence.\nl.5 \\foo\n        \n! Emergency stop.\n<*> main.tex\n            \n*** (job aborted, no legal \\end found)\n",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      message: "Undefined control sequence.",
      line: 5,
    });
  });

  it("keeps a package's own source out of the context", () => {
    const issues = parseIssues(
      "(./main.tex\nLaTeX2e <2025-11-01>\n(/usr/local/texlive/2026/texmf-dist/tex/latex/fontspec/fontspec.sty\n/usr/local/texlive/2026/texmf-dist/tex/latex/fontspec/fontspec.sty:100: Fatal Package fontspec Error: The fontspec package requires either XeTeX or\n(fontspec)                      LuaTeX.\n\nType <return> to continue.\n ...                                              \n                                                  \nl.100 \\msg_fatal:nn {fontspec} {cannot-use-pdftex}\n\n/usr/local/texlive/2026/texmf-dist/tex/latex/fontspec/fontspec.sty:100:  ==> Fatal error occurred, no output PDF file produced!\n",
    );
    addFontHints(issues);
    expect(issues[0].detail).toEqual([]);
    // The hint is for a font that is missing, not for the wrong engine.
    expect(issues[0].hint).toBeNull();
  });

  it("does not take log prose for an error", () => {
    expect(
      parseIssues(
        "<recently read> x.y:3: z\nl.4 a.tex:12: b\nsee (table) 1.tex:3: x\n",
      ),
    ).toEqual([]);
  });
});

describe("parseBibToolFailure", () => {
  it("reports a biber crash with a hint", () => {
    const out = `Running 'biber  "build/main.bcf"'
biber: extracting arm64 binary with lipo failed (wstatus=256)
Latexmk: Error return from 'biber build/main'
  biber build/main: Could not open biber log file for 'build/main'
`;
    const issue = parseBibToolFailure(out, null)!;
    expect(issue.severity).toBe("error");
    expect(issue.message).toBe(
      "biber failed: biber: extracting arm64 binary with lipo failed (wstatus=256)",
    );
    expect(issue.hint).toContain("crashed");
    expect(issue.hint).toContain("backend=bibtex");
  });

  it("reports a missing biber", () => {
    const out =
      "sh: biber: command not found\nLatexmk: Error return from 'biber build/main'\n";
    expect(parseBibToolFailure(out, null)!.hint).toContain("not installed");
  });

  it("takes biber errors from the blg", () => {
    const out = "Latexmk: Error return from 'biber build/main'\n";
    const blg = `[0] Config.pm:307> INFO - This is Biber 2.19
[52] Utils.pm:411> ERROR - Cannot find 'refs.bib'!
[53] Biber.pm:136> INFO - ERRORS: 1
`;
    const issue = parseBibToolFailure(out, blg)!;
    expect(issue.message).toBe("biber failed: Cannot find 'refs.bib'!");
    expect(issue.hint).toContain("\\addbibresource");
  });

  it("locates BibTeX errors in the bib file", () => {
    const out =
      "Latexmk: Summary of warnings:\n  Bibtex errors: See file 'build/main.blg'\n";
    const blg = `This is BibTeX, Version 0.99d
I was expecting a \`,' or a \`}'
---line 5 of file refs.bib
 :   title = {Superism
(There was 1 error message)
`;
    const issue = parseBibToolFailure(out, blg)!;
    expect(issue.message).toBe("BibTeX failed: I was expecting a `,' or a `}'");
    expect(issue).toMatchObject({ file: "refs.bib", line: 5 });
  });

  it("ignores runs where the bib tool succeeded", () => {
    const out =
      "Running 'biber  \"build/main.bcf\"'\nLatexmk: All targets are up-to-date\n";
    expect(parseBibToolFailure(out, null)).toBeNull();
  });

  it("finds the failed tool in latexmk's error summary", () => {
    const issue = parseBibToolFailure(
      "Latexmk: Errors, so I did not complete making targets\nCollected error summary (may duplicate other messages):\n  bibtex build/main: Bibtex errors: See file 'build/main.blg'\n\nLatexmk: Missing bbl file 'build/main.bbl' in following:\n No file main.bbl.\n",
      "This is BibTeX, Version 0.99d\nRepeated entry---line 1506 of file references.bib\n : @inproceedings{hutter2011sequential\n :                                    ,\nI'm skipping whatever remains of this entry\n",
    )!;
    expect(issue.message).toBe("BibTeX failed: Repeated entry");
    expect(issue).toMatchObject({ file: "references.bib", line: 1506 });
    expect(issue.hint).toContain("same key");
  });
});

describe("parseRunFailure", () => {
  it("reports a failed glossary run", () => {
    const issue = parseRunFailure(
      "Collected error summary (may duplicate other messages):\n  cusdep glo gls build/main: Command for 'cusdep glo gls build/main' gave return code 65280\n",
    )!;
    expect(issue.severity).toBe("error");
    expect(issue.message).toBe("makeglossaries failed, so the glossary was not built");
    expect(issue.hint).toContain("makeglossaries");
  });

  it("reports a document that never settles", () => {
    expect(
      parseRunFailure(
        "Latexmk: Maximum runs of pdflatex reached without getting stable files\n",
      )!.message,
    ).toMatch(/^The document kept changing/);
  });

  it("leaves TeX's own errors to the log", () => {
    expect(
      parseRunFailure(
        "Collected error summary (may duplicate other messages):\n  pdflatex: Command for 'pdflatex' gave return code 1\n      Refer to 'build/main.log' and/or above output for details\n",
      ),
    ).toBeNull();
  });
});
