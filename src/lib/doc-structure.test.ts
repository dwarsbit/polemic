import { describe, expect, it } from "vitest";
import {
  buildDocumentOrder,
  extractIncludes,
  includeSpec,
  insertInclude,
  removeInclude,
  replaceIncludeSpec,
  replaceIncludeSpecPrefix,
  resolveIncludePath,
  sortTreeByDocumentOrder,
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

describe("include helpers", () => {
  it("builds the idiomatic spec (without .tex)", () => {
    expect(includeSpec("chapters/intro.tex")).toBe("chapters/intro");
    expect(includeSpec("data.bib")).toBe("data.bib");
  });

  it("inserts after the last include", () => {
    const content = "\\input{a}\ntext\n\\include{b}\ntext\n\\end{document}\n";
    const result = insertInclude(content, "c");
    expect(result).toBe(
      "\\input{a}\ntext\n\\include{b}\n\\input{c}\ntext\n\\end{document}\n",
    );
  });

  it("inserts before end{document} when there are no includes", () => {
    const content = "text\n\\end{document}\n";
    expect(insertInclude(content, "a")).toBe("text\n\\input{a}\n\\end{document}\n");
  });

  it("appends at the end as a last resort", () => {
    expect(insertInclude("fragment", "a")).toBe("fragment\n\\input{a}");
  });

  it("ignores commented includes when finding the anchor", () => {
    const content = "\\input{a}\n% \\input{b}\n\\end{document}\n";
    expect(insertInclude(content, "c")).toBe(
      "\\input{a}\n\\input{c}\n% \\input{b}\n\\end{document}\n",
    );
  });

  it("replaces specs in both extension styles on rename", () => {
    const content =
      "\\input{chapters/intro}\n\\include{chapters/intro.tex}\n\\input{other}\n";
    const result = replaceIncludeSpec(
      content,
      "chapters/intro.tex",
      "chapters/prelude.tex",
    );
    expect(result).toBe(
      "\\input{chapters/prelude}\n\\include{chapters/prelude.tex}\n\\input{other}\n",
    );
  });

  it("leaves other content untouched on rename", () => {
    const content = "The file chapters/intro is nice.\n\\input{other}\n";
    expect(replaceIncludeSpec(content, "chapters/intro.tex", "x.tex")).toBe(content);
  });

  it("removes include lines for the path in both styles", () => {
    const content =
      "\\input{a}\n\\input{intro}\ntext\n\\include{intro.tex}\n\\input{b}\n";
    const result = removeInclude(content, "intro.tex");
    expect(result).toBe("\\input{a}\ntext\n\\input{b}\n");
  });

  it("keeps commented include lines when removing", () => {
    const content = "% \\input{a}\ntext\n";
    expect(removeInclude(content, "a.tex")).toBe("% \\input{a}\ntext\n");
  });
});

describe("sortTreeByDocumentOrder", () => {
  const tree = [
    { path: "appendix.tex", isDir: false, children: [] },
    { path: "build", isDir: true, children: [] },
    {
      path: "chapters",
      isDir: true,
      children: [
        { path: "chapters/intro.tex", isDir: false, children: [] },
        { path: "chapters/zmethod.tex", isDir: false, children: [] },
      ],
    },
    { path: "main.tex", isDir: false, children: [] },
  ];
  const positions = new Map<string, number>([
    ["main.tex", 0],
    ["chapters/intro.tex", 1],
    ["chapters/zmethod.tex", 2],
    ["appendix.tex", 3],
  ]);

  it("sorts files into document order", () => {
    const sorted = sortTreeByDocumentOrder(tree, positions);
    expect(sorted.map((entry) => entry.path)).toEqual([
      "main.tex",
      "chapters",
      "appendix.tex",
      "build",
    ]);
    const chapters = sorted.find((entry) => entry.path === "chapters");
    expect(chapters!.children.map((entry) => entry.path)).toEqual([
      "chapters/intro.tex",
      "chapters/zmethod.tex",
    ]);
  });

  it("keeps the original order without positions", () => {
    const sorted = sortTreeByDocumentOrder(tree, new Map());
    expect(sorted.map((entry) => entry.path)).toEqual(tree.map((entry) => entry.path));
  });
});

describe("replaceIncludeSpecPrefix", () => {
  it("rewrites specs under the renamed directory", () => {
    const content =
      "\\input{chapters/intro}\n\\include{chapters/sub/a.tex}\n\\input{other/intro}\n";
    const result = replaceIncludeSpecPrefix(content, "chapters", "chap");
    expect(result).toBe(
      "\\input{chap/intro}\n\\include{chap/sub/a.tex}\n\\input{other/intro}\n",
    );
  });

  it("does not match sibling directories with a shared prefix", () => {
    const content = "\\input{chapters-old/x}\n";
    expect(replaceIncludeSpecPrefix(content, "chapters", "new")).toBe(content);
  });

  it("ignores commented includes", () => {
    const content = "% \\input{chapters/intro}\n";
    expect(replaceIncludeSpecPrefix(content, "chapters", "new")).toBe(content);
  });

  it("leaves specs outside the directory untouched", () => {
    const content = "see chapters/intro for details\n\\input{intro}\n";
    expect(replaceIncludeSpecPrefix(content, "chapters", "new")).toBe(content);
  });
});
