import { describe, expect, it } from "vitest";
import {
  applyDocumentSettings,
  readDocumentSettings,
  type DocumentSettings,
} from "./document-settings";

const MAIN = `\\documentclass[11pt,a4paper,twoside]{article}
\\usepackage{amsmath}
\\usepackage{graphicx}
% custom setup
\\newcommand{\\foo}{bar}
\\title{Original}
\\author{A.~Author}

\\begin{document}
\\maketitle
Body.
\\end{document}
`;

describe("readDocumentSettings", () => {
  it("reads class, options, metadata, and package count", () => {
    const s = readDocumentSettings(MAIN);
    expect(s).not.toBeNull();
    expect(s!.className).toBe("article");
    expect(s!.fontSize).toBe("11pt");
    expect(s!.paper).toBe("a4paper");
    expect(s!.twoColumn).toBe(false);
    expect(s!.draft).toBe(false);
    // Unmanaged options surface verbatim.
    expect(s!.customOptions).toBe("twoside");
    expect(s!.title).toBe("Original");
    expect(s!.author).toBe("A.~Author");
    expect(s!.date).toBe("");
    expect(s!.packageCount).toBe(2);
  });

  it("returns null without a documentclass or document env", () => {
    expect(readDocumentSettings("no preamble here\n")).toBeNull();
    expect(readDocumentSettings("% \\documentclass{article}\n")).toBeNull();
  });
});

describe("applyDocumentSettings", () => {
  const base: Omit<DocumentSettings, "packageCount"> = {
    className: "article",
    fontSize: "11pt",
    paper: "a4paper",
    twoColumn: true,
    draft: true,
    customOptions: "twoside",
    title: "New Title",
    author: "B.~Writer",
    date: "2026-10-02",
  };

  it("rebuilds the documentclass line and metadata, keeping the rest", () => {
    const next = applyDocumentSettings(MAIN, base);
    expect(next).not.toBeNull();
    expect(next).toContain("\\documentclass[11pt, a4paper, twocolumn, draft, twoside]{article}");
    expect(next).toContain("\\usepackage{amsmath}");
    expect(next).toContain("% custom setup");
    expect(next).toContain("\\newcommand{\\foo}{bar}");
    expect(next).toContain("\\title{New Title}");
    expect(next).toContain("\\author{B.~Writer}");
    expect(next).toContain("\\date{2026-10-02}");
    expect(next).toContain("\\maketitle");
    expect(next).not.toContain("\\title{Original}");
  });

  it("round-trips through readDocumentSettings", () => {
    const next = applyDocumentSettings(MAIN, base);
    const s = readDocumentSettings(next!);
    expect(s).toEqual({ ...base, packageCount: 2 });
  });

  it("removes metadata and options when emptied", () => {
    const next = applyDocumentSettings(MAIN, {
      ...base,
      fontSize: "",
      paper: "",
      twoColumn: false,
      draft: false,
      customOptions: "",
      title: "",
      author: "",
      date: "",
    });
    expect(next).toContain("\\documentclass{article}");
    expect(next).not.toContain("\\title");
    expect(next).not.toContain("\\author");
    expect(next).not.toContain("twoside");
  });

  it("is idempotent", () => {
    const once = applyDocumentSettings(MAIN, base);
    const twice = applyDocumentSettings(once!, base);
    expect(twice).toBe(once);
  });
});
