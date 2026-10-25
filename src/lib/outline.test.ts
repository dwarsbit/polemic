import { describe, expect, it } from "vitest";
import { extractLabels, parseOutline } from "@/lib/outline";

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
      { level: 0, title: "Intro", line: 2, command: "section" },
      { level: 1, title: "Details", line: 4, command: "subsection" },
      { level: 2, title: "Fine print", line: 5, command: "subsubsection" },
      { level: 0, title: "Starred", line: 6, command: "section" },
      { level: 0, title: "Braces {in} title", line: 7, command: "section" },
    ]);
  });

  it("finds parts and chapters, and skips short titles", () => {
    const source = ["\\part{One}", "\\chapter[Short]{Long title}", "\\section{S}"].join(
      "\n",
    );
    expect(parseOutline(source).map((e) => [e.level, e.title, e.command])).toEqual([
      [-2, "One", "part"],
      [-1, "Long title", "chapter"],
      [0, "S", "section"],
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

describe("extractLabels", () => {
  it("collects all labels in order", () => {
    const source =
      "Some \\label{intro} text \\label{eq:main} more \\label{fig:chart} end";
    expect(extractLabels(source)).toEqual(["intro", "eq:main", "fig:chart"]);
  });

  it("returns empty when there are no labels", () => {
    expect(extractLabels("no labels here")).toEqual([]);
  });
});
