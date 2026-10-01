import { describe, expect, it } from "vitest";
import { generateTable, tableLabel } from "./table-generate";

describe("tableLabel", () => {
  it("slugs the caption into a tab key", () => {
    expect(tableLabel("My Results!")).toBe("tab:my-results");
  });

  it("falls back to tab:table for empty captions", () => {
    expect(tableLabel("  ")).toBe("tab:table");
  });
});

describe("generateTable", () => {
  const base = {
    columns: 3,
    rows: 2,
    alignment: ["l", "c", "r"],
    placement: "htbp",
  };

  it("generates a booktabs table with header", () => {
    const tex = generateTable({
      ...base,
      header: true,
      booktabs: true,
      caption: "My Results",
      label: "tab:my-results",
    });
    expect(tex).toBe(
      [
        "\\begin{table}[htbp]",
        "  \\centering",
        "  \\begin{tabular}{lcr}",
        "    \\toprule",
        "    Header 1 & Header 2 & Header 3 \\\\",
        "    \\midrule",
        "     &  &  \\\\",
        "     &  &  \\\\",
        "    \\bottomrule",
        "  \\end{tabular}",
        "  \\caption{My Results}",
        "  \\label{tab:my-results}",
        "\\end{table}",
      ].join("\n"),
    );
  });

  it("uses \\hline without booktabs and omits empty caption/label", () => {
    const tex = generateTable({
      ...base,
      header: false,
      booktabs: false,
      caption: "",
      label: "",
    });
    expect(tex).toContain("\\begin{tabular}{lcr}");
    expect(tex).not.toContain("\\caption");
    expect(tex).not.toContain("\\label");
    expect(tex).toContain("    \\hline");
    expect(tex).not.toContain("\\toprule");
  });

  it("pads alignment to the column count", () => {
    const tex = generateTable({
      ...base,
      columns: 4,
      alignment: ["c"],
      header: false,
      booktabs: true,
      caption: "",
      label: "",
    });
    expect(tex).toContain("\\begin{tabular}{clll}");
  });
});
