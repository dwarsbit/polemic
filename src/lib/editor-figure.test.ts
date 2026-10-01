import { describe, expect, it } from "vitest";
import {
  figureLabel,
  figureScaffold,
  findIncludeGraphics,
  insertPackages,
  missingPackages,
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
    const doc = "\\documentclass{article}\n\\usepackage{booktabs,tabularx}\n\\usepackage{tikz}";
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
