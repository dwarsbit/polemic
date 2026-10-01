import { describe, expect, it } from "vitest";

import { applyEdits, type ScannedFile } from "./label-index";
import {
  detectCiteCommands,
  extractCitePositions,
  planCiteKeyRename,
} from "./cite-refs";

const source = [
  "\\cite{knuth84} says \\citep[p.~5]{lamport94,knuth84} and",
  "\\Textcite*[see][also]{doe99}.",
  "% \\cite{hidden}",
  "\\nocite{nocited99}",
  "\\\\cite{escaped}",
  "\\cite{ knuth84 ,doe99}",
].join("\n");

describe("extractCitePositions", () => {
  it("finds keys of the whole cite family with exact ranges", () => {
    const cites = extractCitePositions(source);
    expect(cites.map((cite) => cite.key)).toEqual([
      "knuth84",
      "lamport94",
      "knuth84",
      "doe99",
      "nocited99",
      "knuth84",
      "doe99",
    ]);
    for (const cite of cites) {
      expect(source.slice(cite.from, cite.to)).toBe(cite.key);
    }
  });

  it("is comment-aware and escape-aware", () => {
    const keys = extractCitePositions(source).map((cite) => cite.key);
    expect(keys).not.toContain("hidden");
    expect(keys).not.toContain("escaped");
  });

  it("ignores commands without cite in the name", () => {
    expect(extractCitePositions("\\ref{knuth84}")).toEqual([]);
  });

  it("accepts a still-being-typed command without brace", () => {
    expect(extractCitePositions("\\cite{knuth84")).toEqual([]);
  });
});

describe("detectCiteCommands", () => {
  it("offers plain cite without packages", () => {
    expect(detectCiteCommands(["\\documentclass{article}"])).toEqual(["cite"]);
  });

  it("adds natbib and biblatex commands per package", () => {
    expect(detectCiteCommands(["\\usepackage{natbib}"])).toEqual([
      "cite",
      "citep",
      "citet",
    ]);
    expect(
      detectCiteCommands(["\\usepackage[backend=biber]{biblatex}"]),
    ).toEqual(["cite", "parencite", "textcite", "autocite"]);
    expect(
      detectCiteCommands(["\\usepackage{natbib,biblatex}"]),
    ).toEqual(["cite", "citep", "citet", "parencite", "textcite", "autocite"]);
  });
});

describe("planCiteKeyRename", () => {
  const main: ScannedFile = {
    file: "main.tex",
    content: "\\cite{knuth84} text \\citep{knuth84,lamport94}",
  };
  const chapter: ScannedFile = {
    file: "chapter1.tex",
    content: "Nothing to see.",
  };

  it("plans edits for whole keys across files", () => {
    const plan = planCiteKeyRename([main, chapter], "knuth84", "knuth1984");
    expect([...plan.keys()]).toEqual(["main.tex"]);
    const renamed = applyEdits(main.content, plan.get("main.tex")!);
    expect(renamed).toBe("\\cite{knuth1984} text \\citep{knuth1984,lamport94}");
  });

  it("does not rename substrings of other keys", () => {
    const file: ScannedFile = {
      file: "a.tex",
      content: "\\cite{knuth84}\\cite{knuth84b}",
    };
    const plan = planCiteKeyRename([file], "knuth84", "x");
    const renamed = applyEdits(file.content, plan.get("a.tex")!);
    expect(renamed).toBe("\\cite{x}\\cite{knuth84b}");
  });
});
