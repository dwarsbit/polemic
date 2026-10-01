import { describe, expect, it } from "vitest";
import {
  loadedPackages,
  parseUsepackage,
  planUsepackageRemoval,
} from "./packages";

const doc = [
  "\\documentclass{article}",
  "\\usepackage{graphicx}",
  "\\usepackage[final]{amsmath, mathtools}",
  "text \\usepackage{xcolor} more",
  "\\begin{document}",
].join("\n");

describe("parseUsepackage", () => {
  it("lists the lines with options and names", () => {
    const lines = parseUsepackage(doc);
    expect(lines.map((line) => line.names)).toEqual([
      ["graphicx"],
      ["amsmath", "mathtools"],
      ["xcolor"],
    ]);
    expect(lines[1].options).toBe("final");
    expect(lines[0].options).toBeNull();
  });
});

describe("loadedPackages", () => {
  it("deduplicates in order", () => {
    const doubled = "\\usepackage{amsmath}\n\\usepackage{amsmath, xcolor}";
    expect(loadedPackages(doubled)).toEqual(["amsmath", "xcolor"]);
  });
});

describe("planUsepackageRemoval", () => {
  it("deletes a line that loads only the package", () => {
    const plan = planUsepackageRemoval(doc, "graphicx");
    expect(plan).toEqual({
      from: doc.indexOf("\\usepackage{graphicx}"),
      to: doc.indexOf("\\usepackage{graphicx}") + 21 + 1,
      insert: "",
    });
  });

  it("rewrites a multi-package line, keeping options", () => {
    const plan = planUsepackageRemoval(doc, "mathtools");
    expect(plan).not.toBeNull();
    const edited =
      doc.slice(0, plan!.from) + plan!.insert + doc.slice(plan!.to);
    expect(edited).toContain("\\usepackage[final]{amsmath}");
    expect(edited).not.toContain("mathtools");
  });

  it("returns null for packages that are not loaded", () => {
    expect(planUsepackageRemoval(doc, "tikz")).toBeNull();
  });
});
