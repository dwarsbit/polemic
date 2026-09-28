import { describe, expect, it } from "vitest";
import {
  buildDocumentOrder,
  extractIncludes,
  resolveIncludePath,
} from "./doc-structure";

describe("extractIncludes", () => {
  it("finds input and include in order", () => {
    const text = "\\input{chapters/intro}\nsome text\n\\include{chapters/method}";
    expect(extractIncludes(text)).toEqual(["chapters/intro", "chapters/method"]);
  });

  it("ignores commented-out includes", () => {
    const text = "\\input{a}\n% \\input{b}\nc % \\input{c}";
    expect(extractIncludes(text)).toEqual(["a"]);
  });

  it("allows whitespace inside the braces", () => {
    expect(extractIncludes("\\input{  spaced  }")).toEqual(["spaced"]);
  });

  it("ignores other commands", () => {
    expect(extractIncludes("\\usepackage{amsmath}\n\\label{x}")).toEqual([]);
  });
});

describe("resolveIncludePath", () => {
  const files = ["main.tex", "chapters/intro.tex", "chapters/method.tex", "data.csv"];

  it("appends .tex when needed", () => {
    expect(resolveIncludePath("chapters/intro", files)).toBe("chapters/intro.tex");
  });

  it("keeps an explicit .tex extension", () => {
    expect(resolveIncludePath("main.tex", files)).toBe("main.tex");
  });

  it("returns null for unresolvable specs", () => {
    expect(resolveIncludePath("missing", files)).toBeNull();
  });
});

describe("buildDocumentOrder", () => {
  const files = ["main.tex", "intro.tex", "methods.tex", "results.tex", "appendix.tex"];
  const disk: Record<string, string> = {
    "main.tex": "\\input{intro}\n\\input{methods}\n\\include{appendix}",
    "intro.tex": "% just intro\n\\input{results}",
    "methods.tex": "text",
    "results.tex": "text",
    "appendix.tex": "\\input{methods}",
  };
  const read = (path: string) =>
    Promise.resolve(disk[path] !== undefined ? disk[path] : null);

  it("walks includes depth-first in source order", async () => {
    // main, intro (then its include results), methods, appendix
    expect(await buildDocumentOrder("main.tex", read, files)).toEqual([
      "main.tex",
      "intro.tex",
      "results.tex",
      "methods.tex",
      "appendix.tex",
    ]);
  });

  it("skips cycles and unresolvable includes", async () => {
    const cyclic: Record<string, string> = {
      "main.tex": "\\input{a}\n\\input{missing}",
      "a.tex": "\\input{main}\n\\input{a}",
    };
    const read2 = (path: string) =>
      Promise.resolve(cyclic[path] !== undefined ? cyclic[path] : null);
    const order = await buildDocumentOrder("main.tex", read2, ["main.tex", "a.tex"]);
    expect(order).toEqual(["main.tex", "a.tex"]);
  });

  it("returns just the main file when it has no includes", async () => {
    const order = await buildDocumentOrder(
      "methods.tex",
      (p) => Promise.resolve(p === "methods.tex" ? "text" : null),
      files,
    );
    expect(order).toEqual(["methods.tex"]);
  });

  it("tolerates a main file that cannot be read", async () => {
    const order = await buildDocumentOrder("main.tex", () => Promise.resolve(null), [
      "main.tex",
    ]);
    expect(order).toEqual(["main.tex"]);
  });
});
