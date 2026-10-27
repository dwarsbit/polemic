import { describe, expect, it } from "vitest";
import {
  columnSpec,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  parseColumnSpec,
  parseTable,
  pasteCells,
  serializeTable,
  setAlign,
  setCell,
  tableAt,
  type TableGrid,
} from "@/lib/table-grid";

const BOOKTABS = [
  "\\begin{table}[htbp]",
  "  \\centering",
  "  \\begin{tabular}{lcr}",
  "    \\toprule",
  "    Name & Value & Unit \\\\",
  "    \\midrule",
  "    Speed & 3.0 & m/s \\\\",
  "    Mass & 12 & kg \\\\",
  "    \\bottomrule",
  "  \\end{tabular}",
  "\\end{table}",
].join("\n");

function parseAt(
  source: string,
  needle: string,
): { grid: TableGrid; from: number; to: number } {
  const range = tableAt(source, source.indexOf(needle));
  if (range === null) throw new Error("no table");
  const grid = parseTable(source, range);
  if (grid === null) throw new Error("not parsed");
  return { grid, ...range };
}

describe("column specs", () => {
  it("reads columns and the separators between them", () => {
    const { columns, separators } = parseColumnSpec("|l|>{\\bfseries}c|p{3cm}@{}");
    expect(columns.map((c) => c.raw)).toEqual(["l", ">{\\bfseries}c", "p{3cm}"]);
    expect(columns.map((c) => c.align)).toEqual(["l", null, null]);
    expect(separators).toEqual(["|", "|", "|", "@{}"]);
    expect(columnSpec({ columns, separators })).toBe("|l|>{\\bfseries}c|p{3cm}@{}");
  });

  it("expands *{n}{…} repeats", () => {
    expect(parseColumnSpec("l*{3}{c}").columns.map((c) => c.raw)).toEqual([
      "l",
      "c",
      "c",
      "c",
    ]);
  });
});

describe("parseTable / serializeTable", () => {
  it("finds the table around a position and reads rows, cells and rules", () => {
    const { grid } = parseAt(BOOKTABS, "Speed");
    expect(grid.rows).toEqual([
      ["Name", "Value", "Unit"],
      ["Speed", "3.0", "m/s"],
      ["Mass", "12", "kg"],
    ]);
    expect(grid.rules).toEqual([["\\toprule"], ["\\midrule"], [], ["\\bottomrule"]]);
    expect(grid.indent).toBe("  ");
  });

  it("writes an unchanged table back with aligned columns", () => {
    const { grid, from, to } = parseAt(BOOKTABS, "Speed");
    const out = BOOKTABS.slice(0, from) + serializeTable(grid) + BOOKTABS.slice(to);
    expect(out).toBe(
      BOOKTABS.replace("Name & Value & Unit", "Name  & Value & Unit")
        .replace("Speed & 3.0 & m/s", "Speed & 3.0   & m/s")
        .replace("Mass & 12 & kg", "Mass  & 12    & kg"),
    );
  });

  it("keeps escaped ampersands, braces and row spacing", () => {
    const source =
      "\\begin{tabular}{ll}\nA \\& B & {x & y} \\\\[2pt]\n\\textbf{C} & D\n\\end{tabular}";
    const { grid } = parseAt(source, "A");
    expect(grid.rows).toEqual([
      ["A \\& B", "{x & y}"],
      ["\\textbf{C}", "D"],
    ]);
    expect(grid.rowEnds).toEqual(["\\\\[2pt]", ""]);
    expect(serializeTable(grid)).toBe(
      "\\begin{tabular}{ll}\n  A \\& B     & {x & y} \\\\[2pt]\n  \\textbf{C} & D\n\\end{tabular}",
    );
  });

  it("reads tabularx with its width", () => {
    const source = "\\begin{tabularx}{\\linewidth}{lX}\na & b \\\\\n\\end{tabularx}";
    const { grid } = parseAt(source, "a &");
    expect(grid.head).toBe("\\begin{tabularx}{\\linewidth}");
    expect(serializeTable(grid)).toBe(
      "\\begin{tabularx}{\\linewidth}{lX}\n  a & b \\\\\n\\end{tabularx}",
    );
  });

  it("flags spanning cells", () => {
    const source =
      "\\begin{tabular}{ll}\n\\multicolumn{2}{c}{Both} \\\\\na & b \\\\\n\\end{tabular}";
    const { grid } = parseAt(source, "a &");
    expect(grid.hasSpans).toBe(true);
    expect(insertColumn(grid, 1)).toBe(grid);
  });
});

describe("grid edits", () => {
  const { grid } = parseAt(BOOKTABS, "Speed");

  it("inserts rows inside the rules", () => {
    const top = insertRow(grid, 0);
    expect(top.rules[0]).toEqual(["\\toprule"]);
    expect(top.rows[0]).toEqual(["", "", ""]);
    const end = insertRow(grid, grid.rows.length);
    expect(end.rules[end.rows.length]).toEqual(["\\bottomrule"]);
    expect(end.rows[end.rows.length - 1]).toEqual(["", "", ""]);
  });

  it("deletes a row, keeping the rule above it", () => {
    const next = deleteRow(grid, 1);
    expect(next.rows.map((r) => r[0])).toEqual(["Name", "Mass"]);
    expect(next.rules[1]).toEqual(["\\midrule"]);
  });

  it("inserts and deletes columns, keeping vertical rules", () => {
    const ruled = parseAt(
      "\\begin{tabular}{|l|l|}\na & b \\\\\n\\end{tabular}",
      "a",
    ).grid;
    const wider = insertColumn(ruled, 1);
    expect(columnSpec(wider)).toBe("|l|l|l|");
    expect(wider.rows[0]).toEqual(["a", "", "b"]);
    expect(columnSpec(deleteColumn(wider, 0))).toBe("|l|l|");
    expect(deleteColumn(wider, 0).rows[0]).toEqual(["", "b"]);
  });

  it("sets alignment and cells", () => {
    const next = setCell(setAlign(grid, 1, "r"), 1, 1, "4.5");
    expect(columnSpec(next)).toBe("lrr");
    expect(next.rows[1][1]).toBe("4.5");
    expect(grid.rows[1][1]).toBe("3.0"); // the original is untouched
  });

  it("pastes spreadsheet cells, growing the grid and escaping LaTeX", () => {
    const next = pasteCells(grid, 2, 1, "1\t2\t3\n50%\t$4\tx_y\n");
    expect(next.columns).toHaveLength(4);
    expect(next.rows[2]).toEqual(["Mass", "1", "2", "3"]);
    expect(next.rows[3]).toEqual(["", "50\\%", "\\$4", "x\\_y"]);
    expect(next.rules[next.rows.length]).toEqual(["\\bottomrule"]);
  });
});
