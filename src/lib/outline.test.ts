import { describe, expect, it } from "vitest";
import { parseOutline } from "@/lib/outline";

describe("parseOutline", () => {
  it("finds sections, subsections and subsubsections with line numbers", () => {
    const source = [
      "\\documentclass{article}",
      "\\section{Intro}",
      "text",
      "\\subsection{Details}",
      "\\subsubsection{Fine print}",
      "\\section*{Starred}",
      "\\section{Braces {in} title}",
    ].join("\n");
    expect(parseOutline(source)).toEqual([
      { level: 0, title: "Intro", line: 2 },
      { level: 1, title: "Details", line: 4 },
      { level: 2, title: "Fine print", line: 5 },
      { level: 0, title: "Starred", line: 6 },
      { level: 0, title: "Braces {in} title", line: 7 },
    ]);
  });

  it("ignores commented-out and inline sections", () => {
    const source = ["text % \\section{Commented}", "some \\section{Inline} text"].join(
      "\n",
    );
    expect(parseOutline(source)).toEqual([]);
  });

  it("returns empty for a source without sections", () => {
    expect(parseOutline("hello world")).toEqual([]);
  });
});
