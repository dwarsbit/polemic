import { describe, expect, it } from "vitest";
import {
  columnNames,
  csvPlot,
  csvTable,
  detectDelimiter,
  isNumber,
  labelFor,
  numericColumns,
  parseCsv,
} from "@/lib/csv";

describe("parseCsv", () => {
  it("handles quotes, embedded delimiters and blank lines", () => {
    const data = parseCsv('name,note\r\n"Smith, J.","said ""hi"""\n\nLee,ok\n');
    expect(data.delimiter).toBe(",");
    expect(data.rows).toEqual([
      ["name", "note"],
      ["Smith, J.", 'said "hi"'],
      ["Lee", "ok"],
    ]);
  });

  it("detects semicolons and tabs, and pads ragged rows", () => {
    expect(detectDelimiter("a;b;c\n1,5;2;3\n")).toBe(";");
    expect(detectDelimiter("0;1,5\n1;2,5\n")).toBe(";");
    expect(detectDelimiter("a,b\n1,2\n")).toBe(",");
    expect(parseCsv("a\tb\n1\n").rows).toEqual([
      ["a", "b"],
      ["1", ""],
    ]);
  });

  it("drops a byte-order mark", () => {
    expect(parseCsv("\uFEFFa,b\n1,2\n").rows[0]).toEqual(["a", "b"]);
  });

  it("recognizes numbers, including decimal commas", () => {
    expect(["3", "-1.5", "2e-3", "1,5", ".5"].every(isNumber)).toBe(true);
    expect(["n/a", "1.2.3", ""].some(isNumber)).toBe(false);
  });
});

const DATA = parseCsv("Time (s),Speed,Load_%\n0,1.5,10\n1,2.5,20\n");

describe("csvTable", () => {
  it("builds a booktabs table, numbers right-aligned and text escaped", () => {
    expect(numericColumns(DATA, true)).toEqual([true, true, true]);
    const latex = csvTable(parseCsv("Name,Value\nA&B,3\n"), {
      header: true,
      caption: "Results",
      label: labelFor("tab", "Results"),
    });
    expect(latex).toBe(
      [
        "\\begin{table}[htbp]",
        "  \\centering",
        "  \\begin{tabular}{lr}",
        "    \\toprule",
        "    Name & Value \\\\",
        "    \\midrule",
        "    A\\&B & 3 \\\\",
        "    \\bottomrule",
        "  \\end{tabular}",
        "  \\caption{Results}",
        "  \\label{tab:results}",
        "\\end{table}",
      ].join("\n"),
    );
  });
});

describe("csvPlot", () => {
  it("plots columns by index with escaped legend names", () => {
    const latex = csvPlot("assets/run.csv", DATA, {
      header: true,
      x: 0,
      ys: [1, 2],
      kind: "line",
      xlabel: columnNames(DATA, true)[0],
      ylabel: "",
      caption: "",
      label: "",
    });
    expect(latex).toContain(
      "\\addplot table[x index=0, y index=1, col sep=comma] {assets/run.csv};",
    );
    expect(latex).toContain("xlabel={Time (s)}");
    expect(latex).toContain("\\legend{{Speed}, {Load\\_\\%}}");
  });

  it("reads decimal commas and files without a header", () => {
    const data = parseCsv("0;1,5\n1;2,5\n");
    const latex = csvPlot("d.csv", data, {
      header: false,
      x: 0,
      ys: [1],
      kind: "scatter",
      xlabel: "",
      ylabel: "",
      caption: "",
      label: "",
    });
    expect(latex).toContain(
      "\\addplot+[only marks] table[x index=0, y index=1, col sep=semicolon, header=false, /pgf/number format/read comma as period] {d.csv};",
    );
  });
});
