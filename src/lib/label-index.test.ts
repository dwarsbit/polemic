import { describe, expect, it } from "vitest";

import {
  applyEdits,
  buildLabelIndex,
  isValidLabelName,
  labelGroup,
  planLabelRename,
  type ScannedFile,
} from "./label-index";

const main: ScannedFile = {
  file: "main.tex",
  content: [
    "\\section{Intro}\\label{sec:intro}",
    "See \\ref{sec:intro} and Figure~\\ref{fig:overview}.",
    "\\begin{figure}\\includegraphics{x}\\caption{Cap}\\label{fig:overview}\\end{figure}",
    "% \\label{fig:hidden} \\ref{sec:hidden}",
    "\\ref{sec:missing}",
  ].join("\n"),
};

const chapter: ScannedFile = {
  file: "chapter1.tex",
  content: "\\label{sec:intro}\\label{intro}\\label{fig:overview}",
};

describe("buildLabelIndex", () => {
  it("collects labels and refs with file and 1-based line", () => {
    const { labels, refs } = buildLabelIndex([main]);
    expect(labels).toEqual([
      { name: "sec:intro", file: "main.tex", line: 1 },
      { name: "fig:overview", file: "main.tex", line: 3 },
    ]);
    expect(refs).toEqual([
      { name: "sec:intro", file: "main.tex", line: 2 },
      { name: "fig:overview", file: "main.tex", line: 2 },
      { name: "sec:missing", file: "main.tex", line: 5 },
    ]);
  });

  it("indexes every file separately", () => {
    const { labels } = buildLabelIndex([main, chapter]);
    expect(labels.filter((l) => l.file === "chapter1.tex")).toHaveLength(3);
    expect(labels.filter((l) => l.name === "sec:intro")).toHaveLength(2);
  });

  it("is comment-aware", () => {
    const { labels, refs } = buildLabelIndex([main]);
    expect(labels.some((l) => l.name === "fig:hidden")).toBe(false);
    expect(refs.some((r) => r.name === "sec:hidden")).toBe(false);
  });
});

describe("labelGroup", () => {
  it("uses the prefix before the first colon", () => {
    expect(labelGroup("fig:overview")).toBe("fig");
    expect(labelGroup("sec:intro:extra")).toBe("sec");
  });

  it("keeps unprefixed labels as their own group", () => {
    expect(labelGroup("intro")).toBe("intro");
  });
});

describe("isValidLabelName", () => {
  it("accepts conventional names", () => {
    expect(isValidLabelName("fig:overview")).toBe(true);
    expect(isValidLabelName("eq2.1-a")).toBe(true);
    expect(isValidLabelName("intro")).toBe(true);
  });

  it("rejects empty, leading punctuation, and spaces", () => {
    expect(isValidLabelName("")).toBe(false);
    expect(isValidLabelName(":fig")).toBe(false);
    expect(isValidLabelName("my label")).toBe(false);
  });
});

describe("planLabelRename", () => {
  it("plans edits for labels and refs across files, in current coordinates", () => {
    const plan = planLabelRename([main, chapter], "sec:intro", "sec:opening");
    expect([...plan.keys()].sort()).toEqual(["chapter1.tex", "main.tex"]);

    const renamed = applyEdits(main.content, plan.get("main.tex")!);
    expect(renamed).toContain("\\label{sec:opening}");
    expect(renamed).toContain("\\ref{sec:opening}");
    expect(renamed).not.toContain("sec:intro");
    expect(renamed).toContain("\\label{fig:overview}");

    const renamedChapter = applyEdits(chapter.content, plan.get("chapter1.tex")!);
    expect(renamedChapter).toBe("\\label{sec:opening}\\label{intro}\\label{fig:overview}");
  });

  it("leaves files that do not mention the label out of the plan", () => {
    const other: ScannedFile = { file: "other.tex", content: "\\label{other}" };
    const plan = planLabelRename([main, other], "sec:intro", "sec:opening");
    expect(plan.has("other.tex")).toBe(false);
  });

  it("only replaces whole names, not substrings", () => {
    const file: ScannedFile = { file: "a.tex", content: "\\label{fig:a}\\label{fig:ab}" };
    const plan = planLabelRename([file], "fig:a", "fig:x");
    const renamed = applyEdits(file.content, plan.get("a.tex")!);
    expect(renamed).toBe("\\label{fig:x}\\label{fig:ab}");
  });
});

describe("applyEdits", () => {
  it("applies multiple edits in one pass", () => {
    const text = "one two three";
    const edits = [
      { from: 0, to: 3, insert: "ONE" },
      { from: 8, to: 13, insert: "THREE" },
    ];
    expect(applyEdits(text, edits)).toBe("ONE two THREE");
  });
});
