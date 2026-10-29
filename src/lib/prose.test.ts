import { describe, expect, it } from "vitest";
import { extractProse, sourceRange } from "@/lib/prose";
import { extractWordRanges } from "@/lib/spellcheck";

const texts = (source: string) => extractProse(source).map((block) => block.text);

describe("extractProse past commented document markers", () => {
  it("checks the real body only", () => {
    const source = [
      "% \\begin{document} later",
      "\\begin{document}",
      "Body text. % \\end{document}",
      "More body.",
      "\\end{document}",
    ].join("\n");
    expect(extractProse(source).map((b) => b.text)).toEqual(["Body text. More body."]);
  });
});

describe("extractProse", () => {
  it("keeps sentences readable around math, citations and references", () => {
    expect(
      texts(
        "Let $x$ be as in \\cite[p.~5]{knuth} and Figure~\\ref{fig:a}, see \\eqref{e}.",
      ),
    ).toEqual(["Let X be as in [1] and Figure 1, see 1."]);
  });

  it("splits paragraphs, headings, list items and footnotes into blocks", () => {
    const source = [
      "\\section{Intro}",
      "First para\\footnote{A note.} goes on.",
      "",
      "Second para.",
      "\\begin{itemize}",
      "  \\item One.",
      "  \\item[b] Two.",
      "\\end{itemize}",
    ].join("\n");
    expect(texts(source)).toEqual([
      "Intro",
      "A note.",
      "First para goes on.",
      "Second para.",
      "One.",
      "Two.",
    ]);
  });

  it("skips the preamble, comments, code and identifier arguments", () => {
    const source = [
      "\\documentclass{article}",
      "\\usepackage{xzqk}",
      "\\begin{document}",
      "Text % hidden zzqq",
      "\\setlength{\\parindent}{0pt}",
      "\\includegraphics[width=3cm]{figs/plot}",
      "\\begin{verbatim}code here\\end{verbatim}",
      "\\href{https://x.org}{the site}",
      "\\end{document}",
      "after",
    ].join("\n");
    // A code block ends the paragraph.
    expect(texts(source)).toEqual(["Text", "the site"]);
  });

  it("keeps style command text and maps characters back to the source", () => {
    const source = "Some \\emph{bold} words";
    const [block] = extractProse(source);
    expect(block.text).toBe("Some bold words");
    const at = block.text.indexOf("bold");
    const range = sourceRange(block, at, at + 4);
    expect(source.slice(range.from, range.to)).toBe("bold");
  });

  it("maps a placeholder to the whole construct", () => {
    const source = "See \\cite{a,b} now";
    const [block] = extractProse(source);
    expect(block.placeholders).toEqual([{ from: 4, to: 7 }]);
    const range = sourceRange(block, 4, 7);
    expect(source.slice(range.from, range.to)).toBe("\\cite{a,b}");
  });

  it("reads display math inside a sentence as one word", () => {
    expect(
      texts("We get\n\\begin{equation}\nE = mc^2\n\\end{equation}\nwhich holds."),
    ).toEqual(["We get X which holds."]);
  });
});

describe("extractWordRanges", () => {
  it("checks words with accents and other scripts whole", () => {
    const source = "Das Mädchen trinkt café, naïve Ελληνικά.";
    const words = extractWordRanges(source).map((r) => source.slice(r.from, r.to));
    expect(words).toEqual(["Das", "Mädchen", "trinkt", "café", "naïve", "Ελληνικά"]);
  });

  it("does not check placeholders", () => {
    expect(extractWordRanges("Let $x$ be \\LaTeX{} here").map((r) => r.word)).toEqual([
      "Let",
      "be",
      "here",
    ]);
  });
});

describe("track changes", () => {
  it("reads the final text: insertions in, deletions and markup out", () => {
    const source =
      "The \\replaced[id=LG]{results}{reslts} \\added[id=AN]{clearly} show \\deleted{teh} it.";
    expect(texts(source)).toEqual(["The results clearly show it."]);
  });

  it("maps every character back to the source", () => {
    const source = "A \\added[id=LG]{nwe} word.";
    const words = extractWordRanges(source).map((w) => source.slice(w.from, w.to));
    expect(words).toEqual(["A", "nwe", "word"]);
  });
});
