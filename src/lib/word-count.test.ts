import { describe, expect, it } from "vitest";
import { countWords, countWordsBySection, totalWords } from "@/lib/word-count";

describe("countWords", () => {
  it("counts the body only, by kind", () => {
    const src = [
      "\\documentclass{article}",
      "\\usepackage{graphicx}",
      "\\title{Not counted}",
      "\\begin{document}",
      "\\section[Short]{The Results}",
      "We don't use state-of-the-art NLP in 2024. % a comment here",
      "\\begin{figure}[ht]",
      "  \\includegraphics[width=0.5\\textwidth]{figs/plot}",
      "  \\caption{A plot.}\\label{fig:plot}",
      "\\end{figure}",
      "See \\cref{fig:plot} and \\cite{knuth}\\footnote{Two words.}.",
      "\\end{document}",
      "after the end",
    ].join("\n");
    expect(countWords(src)).toEqual({
      // We don't use state-of-the-art NLP in 2024 | See and
      text: 9,
      // The Results
      header: 2,
      // A plot | Two words
      other: 4,
      inlineMath: 0,
      displayMath: 0,
    });
  });

  it("counts math items, not their contents", () => {
    const src =
      "Let $x=1$ and \\(y\\) hold:\n\\[ a+b \\]\n$$c$$\n\\begin{align}d &= e\\end{align}\nDone, costs \\$5.";
    const stats = countWords(src);
    expect(stats.inlineMath).toBe(2);
    expect(stats.displayMath).toBe(3);
    // Let and hold Done costs 5
    expect(stats.text).toBe(6);
  });

  it("skips environment arguments, verbatim, and the bibliography", () => {
    const src = [
      "\\begin{tabular}{ll} cell one & two \\end{tabular}",
      "\\begin{verbatim}code words\\end{verbatim}",
      "\\textbf{bold words} \\emph{matter}",
      "\\begin{thebibliography}{9}\\bibitem{a} Some ref\\end{thebibliography}",
    ].join("\n");
    expect(totalWords(countWords(src))).toBe(6);
  });
});

describe("countWordsBySection", () => {
  it("splits counts at the heading lines", () => {
    const src = "Intro words\n\\section{One}\na b c\n\\subsection{Two}\nd";
    const parts = countWordsBySection(src, [2, 4]);
    expect(parts.map(totalWords)).toEqual([2, 4, 2]);
  });
});

describe("countWords with track changes", () => {
  it("counts the final text", () => {
    const text =
      "\\begin{document}\nOne \\added[id=LG]{two three} \\deleted[id=LG]{four five six} " +
      "\\replaced{seven}{eight nine}.\n\\end{document}\n";
    expect(totalWords(countWords(text))).toBe(4);
  });
});
