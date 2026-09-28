import { describe, expect, it } from "vitest";
import { extractWordRanges } from "@/lib/spellcheck";

const DOC = `\\documentclass{article}
\\usepackage{amsmath}
\\newcommand{\\foo}{bar}
% this comment should not be checked xzqk
\\begin{document}
Hello wrld, this is a test.
\\begin{itemize}
  \\item Valid prose here.
\\end{itemize}
The value is $x$ plus \\(y\\) and math like \\alpha{}.
\\begin{equation}
  E = mc^2 moremath
\\end{equation}
\\label{important-label}
See \\ref{important-label} and \\cite{knuth1984}.
NASA and HTML are acronyms.
Don't stop.
\\textbf{Bold words} stay.
\\end{document}
After the end there is preamble stuff zzqq.
`;

function words(text: string): string[] {
  return extractWordRanges(text).map((range) => range.word);
}

describe("extractWordRanges", () => {
  it("checks prose but skips the preamble", () => {
    const all = words(DOC);
    expect(all).toContain("Hello");
    expect(all).toContain("wrld");
    expect(all).not.toContain("documentclass");
    expect(all).not.toContain("article");
    expect(all).not.toContain("amsmath");
  });

  it("skips environment names and command arguments that are identifiers", () => {
    const all = words(DOC);
    expect(all).not.toContain("itemize");
    expect(all).not.toContain("important");
    expect(all).not.toContain("knuth1984");
    expect(all).toContain("Valid");
    expect(all).toContain("prose");
  });

  it("skips math, comments, and acronyms", () => {
    const all = words(DOC);
    expect(all).not.toContain("alpha");
    expect(all).not.toContain("moremath");
    expect(all).not.toContain("xzqk");
    expect(all).not.toContain("NASA");
    expect(all).not.toContain("HTML");
    expect(all).not.toContain("zzqq");
  });

  it("handles contractions and prose inside style commands", () => {
    const all = words(DOC);
    expect(all).toContain("Don");
    expect(all).not.toContain("t"); // contraction suffix
    expect(all).toContain("Bold");
    expect(all).toContain("stay");
  });

  it("skips command names entirely, not just their first letter", () => {
    const all = words(
      "\\documentclass{article}\n\\begin{document}\n\\maketitle\n\\usepackage{amsmath}\n\\tableofcontents\n\\end{document}\n",
    );
    expect(all).not.toContain("ocumentclass");
    expect(all).not.toContain("aketitle");
    expect(all).not.toContain("sepackage");
    expect(all).not.toContain("ableofcontents");
    expect(all).toEqual([]);
  });

  it("produces positions that slice back to the word", () => {
    const ranges = extractWordRanges("Hello wrld");
    expect(ranges.map((r) => "Hello wrld".slice(r.from, r.to))).toEqual([
      "Hello",
      "wrld",
    ]);
  });
});
