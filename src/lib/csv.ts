import { escapeLatex, serializeTable, type TableGrid } from "@/lib/table-grid";

/**
 * CSV data for the import assistant: parsing (quoted fields, comma,
 * semicolon or tab separated), number detection, and the LaTeX it
 * becomes: a booktabs table with the values inline, or a pgfplots plot
 * that reads the file itself at compile time (so it must live in the
 * project).
 */

export type Delimiter = "," | ";" | "\t";

export interface CsvData {
  delimiter: Delimiter;
  /** Rows of fields, quotes removed; ragged rows padded with "". */
  rows: string[][];
}

/** Parse one delimiter's worth of CSV (RFC 4180 quoting). */
function parseWith(text: string, delimiter: Delimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field.length === 0) {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Blank lines are not rows.
  return rows.filter((r) => r.some((f) => f.trim().length > 0));
}

/** The delimiter that splits the first lines most consistently. On a
 *  tie semicolons and tabs win: a semicolon file with decimal commas
 *  (1,5) also splits evenly on commas. */
export function detectDelimiter(text: string): Delimiter {
  const sample = text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .slice(0, 20)
    .join("\n");
  let best: Delimiter = ",";
  let bestScore = -1;
  for (const delimiter of [";", "\t", ","] as Delimiter[]) {
    const counts = parseWith(sample, delimiter).map((r) => r.length);
    if (counts.length === 0 || counts[0] < 2) continue;
    // Many columns, the same on every line.
    const consistent = counts.filter((c) => c === counts[0]).length / counts.length;
    const score = consistent * 100 + counts[0];
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

/** Parse CSV text, detecting the delimiter unless given. */
export function parseCsv(text: string, delimiter?: Delimiter): CsvData {
  const used = delimiter ?? detectDelimiter(text);
  const rows = parseWith(text.replace(/^\uFEFF/, ""), used).map((r) =>
    r.map((f) => f.trim()),
  );
  const width = Math.max(0, ...rows.map((r) => r.length));
  for (const row of rows) while (row.length < width) row.push("");
  return { delimiter: used, rows };
}

/** A number as a spreadsheet writes it: 3, -1.5, 2e-3, or 1,5 with a
 *  decimal comma (common in semicolon-separated files). */
export function isNumber(value: string): boolean {
  return /^[-+]?(\d+([.,]\d*)?|[.,]\d+)([eE][-+]?\d+)?$/.test(value.trim());
}

/** Per column: whether every non-empty value below the header is a number. */
export function numericColumns(data: CsvData, header: boolean): boolean[] {
  const body = header ? data.rows.slice(1) : data.rows;
  const width = data.rows[0]?.length ?? 0;
  return Array.from({ length: width }, (_, c) => {
    const values = body.map((r) => r[c] ?? "").filter((v) => v.length > 0);
    return values.length > 0 && values.every(isNumber);
  });
}

/** Column names: the header row, or "Column 1", "Column 2", … */
export function columnNames(data: CsvData, header: boolean): string[] {
  const width = data.rows[0]?.length ?? 0;
  return Array.from({ length: width }, (_, c) =>
    header && (data.rows[0][c] ?? "").length > 0 ? data.rows[0][c] : `Column ${c + 1}`,
  );
}

/** A label key from a caption: "My Results" -> "tab:my-results". */
export function labelFor(prefix: string, caption: string): string {
  const slug = caption
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${prefix}:${slug || (prefix === "fig" ? "plot" : "data")}`;
}

export interface TableOptions {
  header: boolean;
  caption: string;
  label: string;
}

/** The data as a booktabs table float: numbers right-aligned, text
 *  left, values escaped as plain text. Needs the booktabs package. */
export function csvTable(data: CsvData, options: TableOptions): string {
  const numeric = numericColumns(data, options.header);
  const rows = data.rows.map((r) => r.map(escapeLatex));
  const grid: TableGrid = {
    head: "\\begin{tabular}",
    env: "tabular",
    columns: numeric.map((n) =>
      n ? { raw: "r", align: "r" } : { raw: "l", align: "l" },
    ),
    separators: Array.from({ length: numeric.length + 1 }, () => ""),
    rows,
    rowEnds: rows.map(() => "\\\\"),
    rules:
      options.header && rows.length > 1
        ? [
            ["\\toprule"],
            ["\\midrule"],
            ...rows.slice(2).map(() => []),
            ["\\bottomrule"],
          ]
        : [["\\toprule"], ...rows.slice(1).map(() => []), ["\\bottomrule"]],
    hasSpans: false,
    indent: "  ",
  };
  const lines = ["\\begin{table}[htbp]", "  \\centering", `  ${serializeTable(grid)}`];
  if (options.caption) lines.push(`  \\caption{${escapeLatex(options.caption)}}`);
  if (options.label) lines.push(`  \\label{${options.label}}`);
  lines.push("\\end{table}");
  return lines.join("\n");
}

export type PlotKind = "line" | "scatter" | "bar";

export interface PlotOptions {
  header: boolean;
  /** The x column's index. */
  x: number;
  /** The y columns' indices, one plot line each. */
  ys: number[];
  kind: PlotKind;
  xlabel: string;
  ylabel: string;
  caption: string;
  label: string;
}

const COL_SEP: Record<Delimiter, string> = {
  ",": "comma",
  ";": "semicolon",
  "\t": "tab",
};

/**
 * A pgfplots figure reading `path` (project-relative) at compile time.
 * Columns go by index, so header names with spaces or LaTeX specials
 * cannot break the options; the legend shows the escaped names. Needs
 * the pgfplots package.
 */
export function csvPlot(path: string, data: CsvData, options: PlotOptions): string {
  const names = columnNames(data, options.header);
  const body = options.header ? data.rows.slice(1) : data.rows;
  const decimalComma = body.some((r) =>
    [options.x, ...options.ys].some((c) => /^\s*[-+]?\d*,\d/.test(r[c] ?? "")),
  );
  const tableOptions = [
    `col sep=${COL_SEP[data.delimiter]}`,
    ...(options.header ? [] : ["header=false"]),
    ...(decimalComma ? ["/pgf/number format/read comma as period"] : []),
  ];
  const axisOptions = [
    ...(options.kind === "bar" ? ["ybar"] : []),
    ...(options.xlabel ? [`xlabel={${escapeLatex(options.xlabel)}}`] : []),
    ...(options.ylabel ? [`ylabel={${escapeLatex(options.ylabel)}}`] : []),
    ...(options.ys.length > 1 ? ["legend pos=north west"] : []),
  ];
  const style = options.kind === "scatter" ? "+[only marks]" : "";
  const lines = [
    "\\begin{figure}[htbp]",
    "  \\centering",
    "  \\begin{tikzpicture}",
    `    \\begin{axis}[${axisOptions.join(", ")}]`,
  ];
  for (const y of options.ys) {
    lines.push(
      `      \\addplot${style} table[x index=${options.x}, y index=${y}, ${tableOptions.join(", ")}] {${path}};`,
    );
  }
  if (options.ys.length > 1) {
    lines.push(
      `      \\legend{${options.ys.map((y) => `{${escapeLatex(names[y])}}`).join(", ")}}`,
    );
  }
  lines.push("    \\end{axis}", "  \\end{tikzpicture}");
  if (options.caption) lines.push(`  \\caption{${escapeLatex(options.caption)}}`);
  if (options.label) lines.push(`  \\label{${options.label}}`);
  lines.push("\\end{figure}");
  return lines.join("\n");
}
