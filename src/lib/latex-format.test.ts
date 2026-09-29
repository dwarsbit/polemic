import { describe, expect, it } from "vitest";
import { formatLatex } from "./latex-format";

/** Formatting must be a fixed point: format(format(x)) === format(x). */
function expectIdempotent(input: string) {
  const once = formatLatex(input);
  expect(formatLatex(once)).toBe(once);
  return once;
}

describe("formatLatex", () => {
  it("indents nested environments and dedents closing lines", () => {
    const input = [
      "\\begin{document}",
      "\\begin{itemize}",
      "\\item one",
      "\\item two",
      "\\end{itemize}",
      "\\end{document}",
      "",
    ].join("\n");
    expect(expectIdempotent(input)).toBe(
      [
        "\\begin{document}",
        "  \\begin{itemize}",
        "    \\item one",
        "    \\item two",
        "  \\end{itemize}",
        "\\end{document}",
        "",
      ].join("\n"),
    );
  });

  it("indents display math blocks", () => {
    const input = "\\begin{document}\n\\[ x = 1\n\\]\n\\end{document}\n";
    expect(expectIdempotent(input)).toBe(
      "\\begin{document}\n  \\[ x = 1\n  \\]\n\\end{document}\n",
    );
  });

  it("collapses space runs and strips trailing whitespace", () => {
    const input = "hello    world  \nfoo\t\tbar\n";
    expect(expectIdempotent(input)).toBe("hello world\nfoo bar\n");
  });

  it("normalizes existing indentation", () => {
    const input = "\\begin{itemize}\n        \\item deep\n\\end{itemize}\n";
    expect(expectIdempotent(input)).toBe(
      "\\begin{itemize}\n  \\item deep\n\\end{itemize}\n",
    );
  });

  it("preserves comments and does not count commented-out environments", () => {
    const input = [
      "% \\begin{itemize} stays a comment",
      "\\begin{itemize} % opens the list",
      "\\item x",
      "\\end{itemize}",
      "",
    ].join("\n");
    expect(expectIdempotent(input)).toBe(
      [
        "% \\begin{itemize} stays a comment",
        "\\begin{itemize} % opens the list",
        "  \\item x",
        "\\end{itemize}",
        "",
      ].join("\n"),
    );
  });

  it("keeps the gap before comments: 'foo%' and 'foo %' differ in TeX", () => {
    expect(formatLatex("foo% no space\n")).toBe("foo% no space\n");
    expect(formatLatex("foo  % space\n")).toBe("foo % space\n");
    expect(formatLatex("\\item x\t% tab\n")).toBe("\\item x % tab\n");
  });

  it("keeps escaped percent signs out of comments", () => {
    const input = "50\\% of 100\\%  is 50\n";
    expect(expectIdempotent(input)).toBe("50\\% of 100\\% is 50\n");
  });

  it("preserves blank lines exactly", () => {
    const input = "a\n\n\n\nb\n";
    expect(expectIdempotent(input)).toBe("a\n\n\n\nb\n");
  });

  it("adds a single trailing newline when missing, keeping trailing blanks", () => {
    expect(formatLatex("a")).toBe("a\n");
    expect(formatLatex("a\n\n")).toBe("a\n\n");
  });

  it("copies verbatim environments byte-for-byte", () => {
    const input = [
      "\\begin{document}",
      "\\begin{verbatim}",
      "  weird   spacing   stays",
      "\tand tabs",
      "\\end{verbatim}",
      "\\end{document}",
      "",
    ].join("\n");
    const once = formatLatex(input);
    expect(once).toContain("  weird   spacing   stays");
    expect(once).toContain("\tand tabs");
    expect(formatLatex(once)).toBe(once);
  });

  it("keeps alignment column spacing in align environments", () => {
    const input = [
      "\\begin{align}",
      "x  &=  y  \\\\",
      "zz &=  w",
      "\\end{align}",
      "",
    ].join("\n");
    const once = expectIdempotent(input);
    expect(once).toContain("x  &=  y  \\\\");
    expect(once).toContain("zz &=  w");
  });

  it("does not treat \\\\[2pt] as display math", () => {
    const input = "\\begin{align}\na \\\\[2pt]\nb\n\\end{align}\n";
    expect(expectIdempotent(input)).toBe(
      "\\begin{align}\n  a \\\\[2pt]\n  b\n\\end{align}\n",
    );
  });

  it("returns unbalanced input unchanged", () => {
    const unclosed = "\\begin{itemize}\n\\item x\n";
    expect(formatLatex(unclosed)).toBe(unclosed);
    const stray = "\\end{itemize}\n";
    expect(formatLatex(stray)).toBe(stray);
    const mismatched = "\\begin{itemize}\n\\end{document}\n";
    expect(formatLatex(mismatched)).toBe(mismatched);
    const unclosedDisplay = "\\[ x = 1\n";
    expect(formatLatex(unclosedDisplay)).toBe(unclosedDisplay);
  });

  it("indents a realistic preamble and body", () => {
    const input = [
      "\\documentclass{article}",
      "\\begin{document}",
      "\\section{Intro}",
      "Some text.",
      "\\begin{equation}",
      "E = mc^2",
      "\\end{equation}",
      "\\end{document}",
      "",
    ].join("\n");
    expect(expectIdempotent(input)).toBe(
      [
        "\\documentclass{article}",
        "\\begin{document}",
        "  \\section{Intro}",
        "  Some text.",
        "  \\begin{equation}",
        "    E = mc^2",
        "  \\end{equation}",
        "\\end{document}",
        "",
      ].join("\n"),
    );
  });

  it("keeps \\begin and \\end on one line balanced", () => {
    const input = "text \\begin{x} inline \\end{x} more\n";
    expect(expectIdempotent(input)).toBe(input);
  });
});
