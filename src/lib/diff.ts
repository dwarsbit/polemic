/**
 * Line diff for the snapshot diff view. LCS-based; files above the
 * size cap fall back to a whole-file replace (rare for .tex sources).
 */

export interface DiffLine {
  type: "context" | "add" | "remove";
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

/** Max lines per side for the O(n*m) LCS table (~9 MB). */
const MAX_LCS_LINES = 1500;

function toLines(text: string): string[] {
  if (!text) return [];
  return (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
}

function lcsDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + j + 1] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "context", text: a[i], oldLine: i + 1, newLine: j + 1 });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      out.push({ type: "remove", text: a[i], oldLine: i + 1, newLine: null });
      i++;
    } else {
      out.push({ type: "add", text: b[j], oldLine: null, newLine: j + 1 });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: "remove", text: a[i], oldLine: i + 1, newLine: null });
    i++;
  }
  while (j < m) {
    out.push({ type: "add", text: b[j], oldLine: null, newLine: j + 1 });
    j++;
  }
  return out;
}

function replaceDiff(a: string[], b: string[]): DiffLine[] {
  return [
    ...a.map((text, index) => ({
      type: "remove" as const,
      text,
      oldLine: index + 1,
      newLine: null,
    })),
    ...b.map((text, index) => ({
      type: "add" as const,
      text,
      oldLine: null,
      newLine: index + 1,
    })),
  ];
}

export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = toLines(oldText);
  const b = toLines(newText);
  if (a.length > MAX_LCS_LINES || b.length > MAX_LCS_LINES) {
    return replaceDiff(a, b);
  }
  return lcsDiff(a, b);
}

/** A display row: either a diff line or a collapsed gap of context lines. */
export type DiffRow = { kind: "line"; line: DiffLine } | { kind: "gap"; count: number };

/**
 * Collapse runs of unchanged lines longer than 2*context + 1 into
 * `context` lines, a gap marker, and the last `context` lines.
 */
export function collapseContext(lines: DiffLine[], context = 3): DiffRow[] {
  const rows: DiffRow[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index].type !== "context") {
      rows.push({ kind: "line", line: lines[index] });
      index++;
      continue;
    }
    let end = index;
    while (end < lines.length && lines[end].type === "context") end++;
    const runLength = end - index;
    if (runLength > context * 2 + 1) {
      for (let k = index; k < index + context; k++) {
        rows.push({ kind: "line", line: lines[k] });
      }
      rows.push({ kind: "gap", count: runLength - context * 2 });
      for (let k = end - context; k < end; k++) {
        rows.push({ kind: "line", line: lines[k] });
      }
    } else {
      for (let k = index; k < end; k++) {
        rows.push({ kind: "line", line: lines[k] });
      }
    }
    index = end;
  }
  return rows;
}
