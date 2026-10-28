import { describe, expect, it } from "vitest";
import {
  figureLabel,
  figureScaffold,
  findIncludeGraphics,
  insertPackages,
  missingPackages,
  planWrapFigure,
  wrapIncludeFigure,
} from "./editor-figure";

describe("findIncludeGraphics", () => {
  const doc = "text \\includegraphics[width=\\textwidth]{figures/plot.pdf} more";

  it("finds the command containing the position", () => {
    const hit = findIncludeGraphics(doc, 30);
    expect(hit?.path).toBe("figures/plot.pdf");
    expect(hit?.from).toBe(doc.indexOf("\\includegraphics"));
  });

  it("accepts a command on the cursor's line", () => {
    const hit = findIncludeGraphics(`${doc}\nnext line`, doc.length - 2);
    expect(hit?.path).toBe("figures/plot.pdf");
  });

  it("returns null when nothing is nearby", () => {
    expect(findIncludeGraphics("a\n\n\\includegraphics{x}\n\nb", 1)).toBeNull();
  });
});

describe("figureLabel", () => {
  it("derives a slug from the file name", () => {
    expect(figureLabel("figures/my-plot_v2.pdf")).toBe("fig:my-plot-v2");
  });

  it("falls back to fig:figure", () => {
    expect(figureLabel("")).toBe("fig:figure");
  });
});

describe("wrapIncludeFigure", () => {
  it("wraps the command with caption and label", () => {
    const tex = wrapIncludeFigure(
      "\\includegraphics{figures/plot.pdf}",
      "figures/plot.pdf",
    );
    expect(tex).toContain("\\begin{figure}[htbp]");
    expect(tex).toContain("  \\includegraphics{figures/plot.pdf}");
    expect(tex).toContain("\\caption{Caption}");
    expect(tex).toContain("\\label{fig:plot}");
  });

  it("scaffold uses a placeholder include", () => {
    expect(figureScaffold()).toContain("\\includegraphics[width=\\textwidth]{file}");
  });
});

describe("insertPackages", () => {
  it("adds missing packages after \\documentclass", () => {
    const doc = "\\documentclass{article}\n\\begin{document}\n\\end{document}";
    const out = insertPackages(doc, ["tikz", "booktabs"]);
    expect(out).toBe(
      "\\documentclass{article}\n\\usepackage{tikz}\n\\usepackage{booktabs}\n\\begin{document}\n\\end{document}",
    );
  });

  it("keeps already-loaded packages, including multi-argument lists", () => {
    const doc =
      "\\documentclass{article}\n\\usepackage{booktabs,tabularx}\n\\usepackage{tikz}";
    expect(insertPackages(doc, ["tikz", "booktabs"])).toBe(doc);
  });

  it("appends at the end when there is no \\documentclass", () => {
    const doc = "no preamble here";
    expect(insertPackages(doc, ["tikz"])).toBe("no preamble here\n\\usepackage{tikz}");
  });
});

describe("missingPackages", () => {
  it("detects only the missing ones", () => {
    const doc = "\\usepackage{tikz}";
    expect(missingPackages(doc, ["tikz", "pgfplots"])).toEqual(["pgfplots"]);
  });
});

describe("insertPackages setup lines", () => {
  it("sets the pgfplots compatibility level with the package", () => {
    const doc = "\\documentclass{article}\n\\begin{document}\n\\end{document}\n";
    expect(insertPackages(doc, ["pgfplots"])).toBe(
      "\\documentclass{article}\n\\usepackage{pgfplots}\n\\pgfplotsset{compat=1.16}\n\\begin{document}\n\\end{document}\n",
    );
    // Already loaded: the author's own setup stays as it is.
    const loaded = "\\documentclass{article}\n\\usepackage{pgfplots}\n";
    expect(insertPackages(loaded, ["pgfplots"])).toBe(loaded);
  });
});

describe("planWrapFigure", () => {
  it("wraps an include sharing its line on fresh lines", () => {
    const doc = "See \\includegraphics{a.png} here.\n";
    const plan = planWrapFigure(doc, doc.indexOf("a.png"));
    expect(plan.from).toBe(doc.indexOf("\\includegraphics"));
    expect(plan.to).toBe(doc.indexOf(" here"));
    expect(plan.insert.startsWith("\n\\begin{figure}")).toBe(true);
    expect(plan.insert.endsWith("\\end{figure}\n")).toBe(true);
  });

  it("leaves an include alone on its line as is", () => {
    const doc = "a\n  \\includegraphics{a.png}\nb";
    const plan = planWrapFigure(doc, doc.indexOf("a.png"));
    expect(plan.insert).toBe(wrapIncludeFigure("\\includegraphics{a.png}", "a.png"));
  });

  it("puts the scaffold on a fresh line when the cursor is mid-line", () => {
    const doc = "Some text here";
    const plan = planWrapFigure(doc, 4);
    expect(plan).toEqual({ from: 4, to: 4, insert: `\n${figureScaffold()}\n` });
    const atEnd = planWrapFigure(doc, doc.length);
    expect(atEnd.insert).toBe(`\n${figureScaffold()}`);
    expect(planWrapFigure("", 0).insert).toBe(figureScaffold());
  });
});
