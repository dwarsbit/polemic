/**
 * Deterministic "Fix this" rules for parsed compile issues. Pure:
 * each rule takes the issue (message + the log's context block) and a
 * document, and either plans a concrete edit (or a recompile) or
 * declines. Planning happens at click time against the live buffer,
 * so offsets are always in the file's current text. Issues no rule
 * covers fall through to the AI fix.
 */

import { COMMANDS } from "./completion";
import { extractCitePositions } from "./cite-refs";
import { extractLabelPositions, extractRefPositions } from "./label-refs";
import type { SourceEdit } from "./label-index";
import { loadedPackages } from "./packages";
import { MATH_SYMBOL_CATEGORIES } from "./math-symbols";
import type { CompileIssue } from "./tauri";

export type FixRule =
  | "undefined-control-sequence"
  | "missing-math"
  | "environment-package"
  | "mismatched-end"
  | "missing-file"
  | "undefined-reference"
  | "undefined-citation"
  | "rerun";

export interface TexFix {
  /** What the fix does; the button tooltip and the undo grouping. */
  title: string;
  /** Document edits; empty for action fixes. */
  edits: SourceEdit[];
  /** "recompile": the fix is a fresh compile, not an edit. */
  action?: "recompile";
}

export interface FixContext {
  /** The text of the file the issue points at. */
  doc: string;
  /** Project-relative asset paths, for missing-file fixes. */
  assets: string[];
  /** Cite keys available in the bibliography sources. */
  bibKeys: string[];
}

/** Levenshtein distance, bounded early when the words differ hugely. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 3) return 4;
  const prev = new Array<number>(b.length + 1);
  const row = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = row[j];
  }
  return prev[b.length];
}

/** Command vocabulary for typo suggestions: the completion list plus
 *  the math palette's inserts. */
const COMMAND_VOCABULARY: string[] = (() => {
  const names = new Set<string>();
  for (const cmd of COMMANDS) {
    const m = /^\\([a-zA-Z]+)$/.exec(cmd.label);
    if (m) names.add(m[1]);
  }
  for (const category of MATH_SYMBOL_CATEGORIES) {
    for (const symbol of category.symbols) {
      const m = /^\\([a-zA-Z]+)/.exec(symbol.insert);
      if (m) names.add(m[1]);
    }
  }
  return [...names];
})();

/** Offsets of a 1-based line: { from: line start, to: line end (no
 *  newline) }, or null when the line is outside the document. */
function lineRange(doc: string, line: number | null): { from: number; to: number } | null {
  if (line === null || line < 1) return null;
  let offset = 0;
  for (let i = 1; i < line; i++) {
    const nl = doc.indexOf("\n", offset);
    if (nl === -1) return null;
    offset = nl + 1;
  }
  const end = doc.indexOf("\n", offset);
  return { from: offset, to: end === -1 ? doc.length : end };
}

/** The source text the log's context block shows for the error:
 *  `l.12 \frrac` → `\frrac`. */
function contextSource(issue: CompileIssue): string | null {
  const first = issue.detail[0];
  if (first === undefined) return null;
  const m = /^l\.\d+\s?(.*)$/.exec(first);
  return m ? m[1] : null;
}

/** The last `\command` token in the given text: where TeX stopped,
 *  the offending command sits at the end of the printed source. */
function lastCommand(text: string): string | null {
  const matches = [...text.matchAll(/\\([a-zA-Z]+)\b/g)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1];
}

/** Closest vocabulary word within typo range, or null. */
function closestWord(word: string, vocabulary: string[]): string | null {
  let best: string | null = null;
  let bestDist = 3;
  for (const candidate of vocabulary) {
    const dist = editDistance(word, candidate);
    if (dist < bestDist || (dist === bestDist && best !== null && candidate.length < best.length)) {
      best = candidate;
      bestDist = dist;
    }
  }
  if (best === null || best === word || bestDist >= Math.min(3, word.length)) {
    return null;
  }
  return best;
}

function fixUndefinedControlSequence(issue: CompileIssue, ctx: FixContext): TexFix | null {
  const source = contextSource(issue);
  const cmd = source === null ? null : lastCommand(source);
  if (cmd === null || cmd === "begin" || cmd === "end") return null;
  const suggestion = closestWord(cmd, COMMAND_VOCABULARY);
  if (suggestion === null) return null;
  const line = lineRange(ctx.doc, issue.line);
  const scope = line === null ? ctx.doc : ctx.doc.slice(line.from, line.to);
  const at = scope.indexOf("\\" + cmd);
  if (at === -1) return null;
  const from = (line?.from ?? 0) + at;
  return {
    title: `\\${cmd} is not a command — did you mean \\${suggestion}?`,
    edits: [{ from, to: from + cmd.length + 1, insert: "\\" + suggestion }],
  };
}

/** The token a stray `_`/`^` belongs to: the run of word-ish
 *  characters around it, including sub/superscript braces. */
function mathTokenBounds(line: string, idx: number): { from: number; to: number } {
  let from = idx;
  while (from > 0 && /[A-Za-z0-9_-]/.test(line[from - 1])) from--;
  if (from > 1 && line[from - 1] === "\\") from--;
  let to = idx + 1;
  while (to < line.length && /[A-Za-z0-9_{}-]/.test(line[to])) to++;
  return { from, to };
}

function fixMissingMath(issue: CompileIssue, ctx: FixContext): TexFix | null {
  const line = lineRange(ctx.doc, issue.line);
  if (line === null) return null;
  const text = ctx.doc.slice(line.from, line.to);
  // The log context ends at the offending `_`/`^`; when present it
  // disambiguates, otherwise the first stray one on the line is it.
  let at = -1;
  const source = contextSource(issue);
  if (source !== null) {
    const offender = lastUnescapedSubsup(source);
    if (offender !== -1) {
      const head = source.slice(0, offender + 1).replace(/\.\.\./g, "");
      const tail = source.slice(offender + 1);
      at = text.indexOf(head + tail);
    }
  }
  if (at === -1) at = lastUnescapedSubsup(text);
  if (at === -1) return null;
  const token = mathTokenBounds(text, at);
  return {
    title: `Wrap ${text.slice(token.from, token.to)} in math mode ($…$)`,
    edits: [
      { from: line.from + token.from, to: line.from + token.from, insert: "$" },
      { from: line.from + token.to, to: line.from + token.to, insert: "$" },
    ],
  };
}

function lastUnescapedSubsup(text: string): number {
  for (let i = text.length - 1; i >= 0; i--) {
    if ((text[i] === "_" || text[i] === "^") && text[i - 1] !== "\\") return i;
  }
  return -1;
}

/** Environments from a package instead of the LaTeX kernel; the
 *  fix loads the package. */
const ENV_PACKAGES: Record<string, string> = {
  "align*": "amsmath",
  align: "amsmath",
  "gather*": "amsmath",
  gather: "amsmath",
  "multline*": "amsmath",
  multline: "amsmath",
  "flalign*": "amsmath",
  flalign: "amsmath",
  split: "amsmath",
  cases: "amsmath",
  aligned: "amsmath",
  "gathered": "amsmath",
  "equation*": "amsmath",
  bmatrix: "amsmath",
  pmatrix: "amsmath",
  vmatrix: "amsmath",
  Bmatrix: "amsmath",
  Vmatrix: "amsmath",
  smallmatrix: "amsmath",
  tikzpicture: "tikz",
  lstlisting: "listings",
  algorithm: "algorithm",
  algorithmic: "algorithmic",
};

function fixEnvironmentPackage(issue: CompileIssue, ctx: FixContext): TexFix | null {
  const m = /Environment (\S+) undefined\./.exec(issue.message);
  const env = m?.[1] ?? null;
  const pkg = env === null ? null : (ENV_PACKAGES[env] ?? null);
  if (pkg === null) return null;
  // The preamble lives in the file with \documentclass.
  if (!/\\documentclass/.test(ctx.doc)) return null;
  if (loadedPackages(ctx.doc).includes(pkg)) return null;
  // Insert after the last \usepackage line, or after \documentclass.
  const lines = ctx.doc.split("\n");
  let anchor = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\\usepackage/.test(lines[i])) anchor = i;
    if (/^\s*\\documentclass/.test(lines[i]) && anchor === -1) anchor = i;
  }
  if (anchor === -1) return null;
  let offset = 0;
  for (let i = 0; i <= anchor; i++) offset += lines[i].length + 1;
  const insert = `\n\\usepackage{${pkg}}`;
  return {
    title: `Load ${pkg} for the ${env} environment`,
    edits: [{ from: offset - 1, to: offset - 1, insert }],
  };
}

function fixMismatchedEnd(issue: CompileIssue, ctx: FixContext): TexFix | null {
  const m = /\\begin\{(\S+?)\} on input line \d+ ended by \\end\{(\S+?)\}\.?$/.exec(
    issue.message,
  );
  const begin = m?.[1] ?? null;
  const end = m?.[2] ?? null;
  if (begin === null || end === null || begin === end) return null;
  const line = lineRange(ctx.doc, issue.line);
  const searchFrom = line === null ? 0 : line.from;
  const at = ctx.doc.indexOf(`\\end{${end}}`, searchFrom);
  if (at === -1) return null;
  const nameFrom = at + 5;
  return {
    title: `\\end{${end}} should be \\end{${begin}}`,
    edits: [{ from: nameFrom, to: nameFrom + end.length, insert: begin }],
  };
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function fixMissingFile(issue: CompileIssue, ctx: FixContext): TexFix | null {
  const m = /File [`']([^`']+)' not found\./.exec(issue.message);
  const missing = m?.[1] ?? null;
  if (missing === null || ctx.assets.length === 0) return null;
  let best: string | null = null;
  let bestDist = 3;
  for (const asset of ctx.assets) {
    const dist = editDistance(basename(asset), basename(missing));
    if (dist < bestDist) {
      best = asset;
      bestDist = dist;
    }
  }
  if (best === null || best === missing) return null;
  const line = lineRange(ctx.doc, issue.line);
  if (line === null) return null;
  const text = ctx.doc.slice(line.from, line.to);
  const at = text.indexOf(basename(missing));
  if (at === -1) return null;
  const open = text.lastIndexOf("{", at);
  const close = text.indexOf("}", at);
  if (open === -1 || close === -1 || close < at) return null;
  return {
    title: `Point the include at ${best}`,
    edits: [
      { from: line.from + open + 1, to: line.from + close, insert: best },
    ],
  };
}

function fixUndefinedReference(issue: CompileIssue, ctx: FixContext): TexFix | null {
  const m = /Reference [`']([^`']+)'/.exec(issue.message);
  const name = m?.[1] ?? null;
  if (name === null) return null;
  const labels = extractLabelPositions(ctx.doc).map((pos) => pos.name);
  if (labels.includes(name)) {
    return {
      title: `\\label{${name}} exists — recompile to settle cross-references`,
      edits: [],
      action: "recompile",
    };
  }
  const suggestion = closestWord(name, labels);
  if (suggestion === null) return null;
  const edits: SourceEdit[] = extractRefPositions(ctx.doc)
    .filter((ref) => ref.name === name)
    .map((ref) => ({ from: ref.to - 1 - name.length, to: ref.to - 1, insert: suggestion }));
  if (edits.length === 0) return null;
  return { title: `The label is ${suggestion} — fix the reference`, edits };
}

function fixUndefinedCitation(issue: CompileIssue, ctx: FixContext): TexFix | null {
  const m = /Citation [`']([^`']+)'/.exec(issue.message);
  const key = m?.[1] ?? null;
  if (key === null || ctx.bibKeys.length === 0) return null;
  if (ctx.bibKeys.includes(key)) {
    return {
      title: `${key} is in the bibliography — recompile to pick it up`,
      edits: [],
      action: "recompile",
    };
  }
  const suggestion = closestWord(key, ctx.bibKeys);
  if (suggestion === null) return null;
  const edits: SourceEdit[] = extractCitePositions(ctx.doc)
    .filter((cite) => cite.key === key)
    .map((cite) => ({ from: cite.from, to: cite.to, insert: suggestion }));
  if (edits.length === 0) return null;
  return { title: `The bibliography key is ${suggestion} — fix the citation`, edits };
}

function fixRerun(): TexFix {
  return {
    title: "Recompile to settle cross-references",
    edits: [],
    action: "recompile",
  };
}

/** The rule that covers the issue, from the message alone; the
 *  Issues panel shows the Fix button when this is non-null. */
export function detectFixRule(issue: CompileIssue): FixRule | null {
  const message = issue.message;
  if (message === "Undefined control sequence.") return "undefined-control-sequence";
  if (message === "Missing $ inserted.") return "missing-math";
  if (/Environment \S+ undefined\./.test(message)) return "environment-package";
  if (/\\begin\{\S+?\} on input line \d+ ended by \\end\{\S+?\}\.?$/.test(message)) {
    return "mismatched-end";
  }
  if (/File [`'][^`']+' not found\./.test(message)) return "missing-file";
  if (/^LaTeX Warning: Reference [`']/.test(message)) return "undefined-reference";
  if (/^LaTeX Warning: Citation [`']/.test(message)) return "undefined-citation";
  if (/^LaTeX Warning: Label\(s\) may have changed/.test(message)) return "rerun";
  return null;
}

/** Plan the fix for the issue against the document it points at.
 *  Returns null when the rule declines (the AI fix takes over). */
export function planFix(issue: CompileIssue, ctx: FixContext): TexFix | null {
  switch (detectFixRule(issue)) {
    case "undefined-control-sequence":
      return fixUndefinedControlSequence(issue, ctx);
    case "missing-math":
      return fixMissingMath(issue, ctx);
    case "environment-package":
      return fixEnvironmentPackage(issue, ctx);
    case "mismatched-end":
      return fixMismatchedEnd(issue, ctx);
    case "missing-file":
      return fixMissingFile(issue, ctx);
    case "undefined-reference":
      return fixUndefinedReference(issue, ctx);
    case "undefined-citation":
      return fixUndefinedCitation(issue, ctx);
    case "rerun":
      return fixRerun();
    default:
      return null;
  }
}
