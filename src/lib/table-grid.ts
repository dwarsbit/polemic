/**
 * A `tabular` environment as an editable grid: the column spec as
 * columns (with the separators between them), rows of raw LaTeX
 * cells, and the rules (\hline, \toprule, …) kept where they stood.
 * Parse a table, change cells, rows or columns, and write it back
 * with aligned `&`s; everything the grid does not model (options,
 * rules, row-end spacing like `\\[2pt]`) survives verbatim.
 */

/** Environments the grid edits; tabular* and tabularx take a width. */
const ENVS = ["tabular", "tabular*", "tabularx", "array"];

export type Align = "l" | "c" | "r";

export interface TableColumn {
  /** The column's spec text, e.g. "l", "p{3cm}", ">{\bfseries}c". */
  raw: string;
  /** The alignment when the column is plain l, c or r; null otherwise. */
  align: Align | null;
}

export interface TableGrid {
  /** `\begin{tabular}[t]` or `\begin{tabularx}{\linewidth}`: all of
   *  the opening before the column spec. */
  head: string;
  env: string;
  columns: TableColumn[];
  /** Spec text around the columns: before the first, between each
   *  pair, after the last (`|`, `@{}`, …); length columns + 1. */
  separators: string[];
  /** Cells as raw LaTeX, one array per row. */
  rows: string[][];
  /** The row end each row had (`\\`, `\\[2pt]`); "" for a last row
   *  without one. */
  rowEnds: string[];
  /** Rule lines before each row; the extra last entry holds those
   *  after the last row (length rows + 1). */
  rules: string[][];
  /** \multicolumn or \multirow present: cells span, so row and column
   *  changes are off (cell text stays editable). */
  hasSpans: boolean;
  /** Indentation of the \begin line, for writing the table back. */
  indent: string;
}

/** The index of the brace closing the one at `open`, or -1. */
function closeBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return -1;
}

/** The {…} group at `at` (after optional spaces): its text and end. */
function group(text: string, at: number): { inner: string; end: number } | null {
  let i = at;
  while (text[i] === " ") i++;
  if (text[i] !== "{") return null;
  const close = closeBrace(text, i);
  if (close === -1) return null;
  return { inner: text.slice(i + 1, close), end: close + 1 };
}

/** Parse a column spec into columns and the separators around them. */
export function parseColumnSpec(spec: string): {
  columns: TableColumn[];
  separators: string[];
} {
  // *{n}{cols} repeats: expand first.
  let expanded = spec;
  for (let guard = 0; guard < 20; guard++) {
    const star = /\*\s*\{(\d+)\}/.exec(expanded);
    if (star === null) break;
    const body = group(expanded, star.index + star[0].length);
    if (body === null) break;
    expanded =
      expanded.slice(0, star.index) +
      body.inner.repeat(Number(star[1])) +
      expanded.slice(body.end);
  }
  const columns: TableColumn[] = [];
  const separators: string[] = [""];
  let prefix = "";
  let i = 0;
  while (i < expanded.length) {
    const ch = expanded[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "|") {
      separators[separators.length - 1] += ch;
      i++;
      continue;
    }
    if (
      (ch === "@" || ch === "!" || ch === ">" || ch === "<") &&
      expanded[i + 1] !== undefined
    ) {
      const arg = group(expanded, i + 1);
      const text = arg === null ? ch : expanded.slice(i, arg.end);
      i = arg === null ? i + 1 : arg.end;
      if (ch === ">") prefix += text;
      else if (ch === "<" && columns.length > 0)
        columns[columns.length - 1].raw += text;
      else separators[separators.length - 1] += text;
      continue;
    }
    // A column: a letter, then its arguments.
    let end = i + 1;
    const args = "pmb".includes(ch) ? 1 : "wW".includes(ch) ? 2 : 0;
    if (expanded[end] === "[") {
      const close = expanded.indexOf("]", end);
      if (close !== -1) end = close + 1;
    }
    for (let k = 0; k < args; k++) {
      const arg = group(expanded, end);
      if (arg === null) break;
      end = arg.end;
    }
    const raw = prefix + expanded.slice(i, end);
    prefix = "";
    columns.push({ raw, align: /^[lcr]$/.test(raw) ? (raw as Align) : null });
    separators.push("");
    i = end;
  }
  return { columns, separators };
}

/** The column spec text for columns and separators. */
export function columnSpec(grid: Pick<TableGrid, "columns" | "separators">): string {
  return (
    grid.separators[0] +
    grid.columns.map((c, i) => c.raw + grid.separators[i + 1]).join("")
  );
}

/** Where a tabular-like environment starts and ends in a source. */
export interface TableRange {
  from: number;
  to: number;
}

const BEGIN_RE = /\\begin\{(tabular\*?|tabularx|array)\}/g;

/** The innermost table environment containing `pos`, if any. */
export function tableAt(source: string, pos: number): TableRange | null {
  let best: TableRange | null = null;
  for (const m of source.matchAll(BEGIN_RE)) {
    const from = m.index;
    if (from > pos) break;
    const env = m[1];
    // Matching \end, counting nested same-name environments.
    const tagRe = new RegExp(`\\\\(begin|end)\\{${env.replace("*", "\\*")}\\}`, "g");
    tagRe.lastIndex = from;
    let depth = 0;
    let to = -1;
    for (let t = tagRe.exec(source); t !== null; t = tagRe.exec(source)) {
      depth += t[1] === "begin" ? 1 : -1;
      if (depth === 0) {
        to = t.index + t[0].length;
        break;
      }
    }
    if (to !== -1 && pos <= to && (best === null || from >= best.from)) {
      best = { from, to };
    }
  }
  return best;
}

/** Rule commands that sit between rows. */
const RULE_RE =
  /^(?:\\(?:hline|toprule|midrule|bottomrule|endhead|endfirsthead|endfoot|endlastfoot)\b|\\(?:cline|cmidrule|addlinespace|specialrule)\b(?:\([^)]*\))?(?:\[[^\]]*\])?(?:\{[^}]*\})*|%[^\n]*)/;

/** Split text on `sep` at brace depth 0, skipping escaped characters. */
function splitTop(text: string, isSep: (at: number) => number): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "%") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (depth === 0) {
      const len = isSep(i);
      if (len > 0) {
        parts.push(text.slice(start, i));
        start = i + len;
        i += len - 1;
        continue;
      }
    }
    if (ch === "\\") i++;
  }
  parts.push(text.slice(start));
  return parts;
}

/** Parse the table environment at `range` of `source`; null when it is
 *  not one the grid understands. */
export function parseTable(source: string, range: TableRange): TableGrid | null {
  const text = source.slice(range.from, range.to);
  const begin = /^\\begin\{(tabular\*?|tabularx|array)\}/.exec(text);
  if (begin === null || !ENVS.includes(begin[1])) return null;
  const env = begin[1];
  let at = begin[0].length;
  // [pos] option, then the width for tabular* / tabularx.
  const option = /^\s*\[[^\]]*\]/.exec(text.slice(at));
  if (option !== null) at += option[0].length;
  if (env === "tabular*" || env === "tabularx") {
    const width = group(text, at);
    if (width === null) return null;
    at = width.end;
  }
  const head = text.slice(0, at);
  const spec = group(text, at);
  if (spec === null) return null;
  const endTag = `\\end{${env}}`;
  if (!text.endsWith(endTag)) return null;
  const body = text.slice(spec.end, text.length - endTag.length);

  const { columns, separators } = parseColumnSpec(spec.inner);
  // Rows end at \\ (with an optional [skip]) or \tabularnewline.
  const ends: string[] = [];
  const segments = splitTop(body, (i) => {
    const m = /^(\\\\(?:\s*\[[^\]]*\])?|\\tabularnewline\b)/.exec(
      body.slice(i, i + 40),
    );
    if (m === null) return 0;
    ends.push(m[0]);
    return m[0].length;
  });
  const rows: string[][] = [];
  const rowEnds: string[] = [];
  const rules: string[][] = [];
  let pending: string[] = [];
  segments.forEach((segment, index) => {
    let rest = segment;
    for (;;) {
      rest = rest.replace(/^\s+/, "");
      const rule = RULE_RE.exec(rest);
      if (rule === null) break;
      pending.push(rule[0].trim());
      rest = rest.slice(rule[0].length);
    }
    const content = rest.trim();
    const isLast = index === segments.length - 1;
    if (content.length === 0 && (isLast || index >= ends.length)) return;
    rows.push(
      splitTop(content, (i) => (content[i] === "&" ? 1 : 0)).map((c) => c.trim()),
    );
    rowEnds.push(index < ends.length ? ends[index] : "");
    rules.push(pending);
    pending = [];
  });
  rules.push(pending);

  const lineStart = source.lastIndexOf("\n", range.from - 1) + 1;
  const indent = /^[ \t]*/.exec(source.slice(lineStart, range.from))?.[0] ?? "";
  const grid: TableGrid = {
    head,
    env,
    columns,
    separators,
    rows,
    rowEnds,
    rules,
    hasSpans: /\\multi(?:column|row)\b/.test(body),
    indent,
  };
  // Rows shorter than the spec get empty cells, so the grid is square.
  if (!grid.hasSpans) {
    for (const row of grid.rows) while (row.length < columns.length) row.push("");
  }
  return grid;
}

/** Write the table back: one row per line, `&`s aligned. */
export function serializeTable(grid: TableGrid): string {
  const inner = `${grid.indent}  `;
  const widths: number[] = [];
  if (!grid.rows.some((row) => row.some((cell) => cell.includes("\n")))) {
    for (const row of grid.rows) {
      row.forEach((cell, c) => {
        // Width per column, but the last cell of a row is never padded.
        if (c < row.length - 1) widths[c] = Math.max(widths[c] ?? 0, cell.length);
      });
    }
  }
  const lines = [`${grid.head}{${columnSpec(grid)}}`];
  grid.rows.forEach((row, r) => {
    for (const rule of grid.rules[r] ?? []) lines.push(inner + rule);
    const cells = row.map((cell, c) =>
      c < row.length - 1 ? cell.padEnd(widths[c] ?? 0) : cell,
    );
    const end = grid.rowEnds[r] ?? "\\\\";
    lines.push(`${inner}${cells.join(" & ")}${end === "" ? "" : ` ${end}`}`.trimEnd());
  });
  for (const rule of grid.rules[grid.rows.length] ?? []) lines.push(inner + rule);
  lines.push(`${grid.indent}\\end{${grid.env}}`);
  return lines.join("\n");
}

// --- Edits (each returns a new grid) -------------------------------------

function clone(grid: TableGrid): TableGrid {
  return {
    ...grid,
    columns: grid.columns.map((c) => ({ ...c })),
    separators: [...grid.separators],
    rows: grid.rows.map((row) => [...row]),
    rowEnds: [...grid.rowEnds],
    rules: grid.rules.map((r) => [...r]),
  };
}

/** Insert an empty row before index `at` (rows.length appends). Rules
 *  stay where they are relative to the table: the new row takes the
 *  rules that stood above row `at` (\toprule stays on top), and an
 *  appended row goes above the closing rules (\bottomrule). */
export function insertRow(grid: TableGrid, at: number): TableGrid {
  const next = clone(grid);
  const width = Math.max(next.columns.length, 1);
  next.rows.splice(
    at,
    0,
    Array.from({ length: width }, () => ""),
  );
  next.rowEnds.splice(at, 0, "\\\\");
  if (at < grid.rows.length) next.rules.splice(at + 1, 0, []);
  else next.rules.splice(at, 0, []);
  // The table's last row may have had no \\: it needs one now.
  next.rowEnds = next.rowEnds.map((end, i) =>
    end === "" && i < next.rows.length - 1 ? "\\\\" : end,
  );
  return next;
}

/** Delete row `at`; rules above it stay above the row that follows. */
export function deleteRow(grid: TableGrid, at: number): TableGrid {
  if (grid.rows.length <= 1) return grid;
  const next = clone(grid);
  const [above] = next.rules.splice(at, 1);
  next.rules[at] = [...above, ...next.rules[at]];
  next.rows.splice(at, 1);
  next.rowEnds.splice(at, 1);
  return next;
}

/** Insert an empty, left-aligned column before index `at`. */
export function insertColumn(grid: TableGrid, at: number): TableGrid {
  if (grid.hasSpans) return grid;
  const next = clone(grid);
  // Vertical rules between all columns (|l|l|): the new one gets one too.
  const inner = grid.separators.slice(1, -1);
  const sep = inner.length > 0 && inner.every((s) => s.includes("|")) ? "|" : "";
  next.columns.splice(at, 0, { raw: "l", align: "l" });
  next.separators.splice(at + 1, 0, sep);
  for (const row of next.rows) row.splice(at, 0, "");
  return next;
}

/** Delete column `at` (never the last one). */
export function deleteColumn(grid: TableGrid, at: number): TableGrid {
  if (grid.hasSpans || grid.columns.length <= 1) return grid;
  const next = clone(grid);
  next.columns.splice(at, 1);
  // Drop an inner separator next to the column; the outer ones stay.
  next.separators.splice(at === 0 ? 1 : at, 1);
  for (const row of next.rows) row.splice(at, 1);
  return next;
}

/** Set a column's alignment (plain l/c/r columns become that letter). */
export function setAlign(grid: TableGrid, at: number, align: Align): TableGrid {
  const next = clone(grid);
  next.columns[at] = { raw: align, align };
  return next;
}

/** Set one cell's LaTeX. */
export function setCell(
  grid: TableGrid,
  row: number,
  col: number,
  text: string,
): TableGrid {
  const next = clone(grid);
  next.rows[row][col] = text;
  return next;
}

/** Plain text as LaTeX: the characters LaTeX treats specially escaped. */
export function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

/**
 * Paste spreadsheet text (tab-separated rows, as Excel, Numbers or
 * Sheets copy them) starting at a cell; the grid grows to fit unless
 * cells span. Cells arrive as plain text, so LaTeX specials are escaped.
 */
export function pasteCells(
  grid: TableGrid,
  row: number,
  col: number,
  text: string,
): TableGrid {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  const cells = lines.map((line) => line.split("\t"));
  let next = clone(grid);
  const needCols = col + Math.max(...cells.map((c) => c.length));
  while (!next.hasSpans && next.columns.length < needCols) {
    next = insertColumn(next, next.columns.length);
  }
  while (next.rows.length < row + cells.length)
    next = insertRow(next, next.rows.length);
  cells.forEach((values, r) => {
    values.forEach((value, c) => {
      if (col + c < next.rows[row + r].length) {
        next.rows[row + r][col + c] = escapeLatex(value.trim());
      }
    });
  });
  return next;
}
