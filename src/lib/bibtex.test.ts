import { describe, expect, it } from "vitest";
import { extractCiteKeys } from "@/lib/bibtex";

describe("extractCiteKeys", () => {
  it("collects entry keys from a bib file", () => {
    const bib = [
      "@article{knuth1984,",
      "  title = {The TeXbook},",
      "  author = {Knuth, Donald}",
      "}",
      "",
      "@inproceedings{ lamport94 ,",
      "  title = {TeX: A Document Preparation System},",
      "}",
      "@book{goossens1994,",
      "  title = {The LaTeX Companion},",
      "}",
    ].join("\n");
    expect(extractCiteKeys(bib)).toEqual(["knuth1984", "lamport94", "goossens1994"]);
  });

  it("ignores @comment, @string, and @preamble conventions", () => {
    expect(
      extractCiteKeys(
        '@string{x = "y"}\n@comment{note}\n@preamble{"stuff"}\n@article{real,',
      ),
    ).toEqual(["real"]);
  });

  it("returns empty for content without entries", () => {
    expect(extractCiteKeys("no bib here")).toEqual([]);
  });
});
