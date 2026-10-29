import { describe, expect, it } from "vitest";
import {
  documentBodyRange,
  findDocumentBegin,
  findDocumentEnd,
  verbEnd,
} from "@/lib/document-markers";

const DOC = [
  "\\documentclass{article}",
  "% \\begin{document} moved below",
  "\\newcommand{\\x}{\\verb|\\begin{document}|}",
  "\\begin{document}",
  "Type \\verb+\\end{document}+. % not \\end{document}",
  "\\begin{verbatim}",
  "\\end{document}",
  "\\end{verbatim}",
  "\\end{document}",
  "",
].join("\n");

describe("document markers", () => {
  it("skips markers in comments, \\verb and verbatim", () => {
    const begin = findDocumentBegin(DOC);
    expect(begin).toBe(DOC.indexOf("\n\\begin{document}\n") + 1);
    expect(findDocumentEnd(DOC, begin)).toBe(DOC.lastIndexOf("\\end{document}"));
  });

  it("gives the body range, falling back to the whole file", () => {
    const [start, end] = documentBodyRange(DOC);
    expect(DOC.slice(start, end)).toMatch(/^\nType [\s\S]*\\end\{verbatim\}\n$/);
    expect(documentBodyRange("Just text.")).toEqual([0, 10]);
  });

  it("is -1 when the only mention is commented out or unclosed verbatim", () => {
    expect(findDocumentBegin("% \\begin{document}\n")).toBe(-1);
    expect(findDocumentEnd("\\begin{comment}\n\\end{document}\n")).toBe(-1);
  });

  it("ends a \\verb at its delimiter, on its line, before the limit", () => {
    const src = "\\verb|a}b| \\verb*+c+ \\verb|open\nx|";
    expect(verbEnd(src, 0)).toBe(10);
    expect(verbEnd(src, 11)).toBe(src.indexOf("+ ") + 1);
    expect(verbEnd(src, src.lastIndexOf("\\verb"))).toBe(-1);
    expect(verbEnd(src, 0, 9)).toBe(-1);
    expect(verbEnd(src, 0, 10)).toBe(10);
    expect(verbEnd("\\verbatim", 0)).toBe(-1);
  });
});
