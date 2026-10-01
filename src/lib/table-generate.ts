/**
 * Table skeleton generation for the table assistant: a spec (rows,
 * columns, alignment, booktabs, caption, label, placement) becomes a
 * ready-to-fill `table`/`tabular` environment.
 */

export interface TableSpec {
  /** Total number of columns. */
  columns: number;
  /** Body rows, excluding the optional header row. */
  rows: number;
  /** Whether a header row is included. */
  header: boolean;
  /** Per-column alignment: "l", "c", or "r". */
  alignment: string[];
  /** Booktabs rules (\toprule etc.) instead of \hline. */
  booktabs: boolean;
  /** Caption text; empty omits the \caption line. */
  caption: string;
  /** Label; empty omits the \label line. */
  label: string;
  /** Float placement specifier. */
  placement: string;
}

/** A label key derived from a caption: "My Results" -> "tab:my-results". */
export function tableLabel(caption: string): string {
  const slug = caption
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `tab:${slug || "table"}`;
}

function row(cells: string[]): string {
  return `    ${cells.join(" & ")} \\\\`;
}

function emptyBodyRow(columns: number): string {
  return row(Array.from({ length: columns }, () => ""));
}

/** The generated LaTeX table skeleton. */
export function generateTable(spec: TableSpec): string {
  const columns = Math.max(1, Math.round(spec.columns));
  const rows = Math.max(1, Math.round(spec.rows));
  const alignment = spec.alignment.slice(0, columns);
  while (alignment.length < columns) {
    alignment.push("l");
  }
  const colSpec = alignment.join("");
  const top = spec.booktabs ? "    \\toprule" : "    \\hline";
  const mid = spec.booktabs ? "    \\midrule" : "    \\hline";
  const bottom = spec.booktabs ? "    \\bottomrule" : "    \\hline";

  const lines: string[] = [
    `\\begin{table}[${spec.placement}]`,
    "  \\centering",
    `  \\begin{tabular}{${colSpec}}`,
  ];
  if (spec.header) {
    lines.push(top);
    lines.push(
      row(
        Array.from({ length: columns }, (_, i) => `Header ${i + 1}`),
      ),
    );
    lines.push(mid);
  } else {
    lines.push(top);
  }
  for (let i = 0; i < rows; i++) {
    lines.push(emptyBodyRow(columns));
  }
  lines.push(bottom);
  lines.push("  \\end{tabular}");
  if (spec.caption) {
    lines.push(`  \\caption{${spec.caption}}`);
  }
  if (spec.label) {
    lines.push(`  \\label{${spec.label}}`);
  }
  lines.push("\\end{table}");
  return lines.join("\n");
}
