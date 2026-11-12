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
  | "already-defined"
  | "not-yet-defined"
  | "unclosed-argument"
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
  /** Project-relative .tex paths, for a missing \input or \include. */
  texFiles?: string[];
  /** The folder of the main file, which paths in the source start from
   *  ("" when it is the project folder). */
  baseDir?: string;
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
function lineRange(
  doc: string,
  line: number | null,
): { from: number; to: number } | null {
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
    if (
      dist < bestDist ||
      (dist === bestDist && best !== null && candidate.length < best.length)
    ) {
      best = candidate;
      bestDist = dist;
    }
  }
  if (best === null || best === word || bestDist >= Math.min(3, word.length)) {
    return null;
  }
  return best;
}

function fixUndefinedControlSequence(
  issue: CompileIssue,
  ctx: FixContext,
): TexFix | null {
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
    title: `Change \\${cmd} to \\${suggestion}`,
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
  gathered: "amsmath",
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

/** The environments open at `offset`, outermost first. Comments are
 *  skipped; verbatim text is not, so a rule that relies on this checks
 *  what it finds. */
function openEnvironments(doc: string, offset: number): string[] {
  const open: string[] = [];
  const token = /(?<!\\)%.*$|\\(begin|end)\{([^{}]+)\}/gm;
  for (const match of doc.slice(0, offset).matchAll(token)) {
    if (match[1] === "begin") {
      open.push(match[2]);
    } else if (match[1] === "end") {
      const at = open.lastIndexOf(match[2]);
      if (at !== -1) open.length = at;
    }
  }
  return open;
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
  // An \end that closes an environment further out is right itself:
  // the inner one was never closed.
  const outer = openEnvironments(ctx.doc, at).slice(0, -1);
  if (end === "document" || outer.includes(end)) {
    const lineStart = ctx.doc.lastIndexOf("\n", at - 1) + 1;
    const lead = ctx.doc.slice(lineStart, at);
    const ownLine = lead.trim() === "";
    return {
      title: `Add \\end{${begin}} before \\end{${end}}`,
      edits: [
        ownLine
          ? { from: lineStart, to: lineStart, insert: `${lead}\\end{${begin}}\n` }
          : { from: at, to: at, insert: `\\end{${begin}}` },
      ],
    };
  }
  const nameFrom = at + 5;
  return {
    title: `Change \\end{${end}} to \\end{${begin}}`,
    edits: [{ from: nameFrom, to: nameFrom + end.length, insert: begin }],
  };
}

/** `\newcommand` for a name that exists, or `\renewcommand` for one
 *  that doesn't: swap the one for the other on the line of the error. */
function fixDefinition(
  issue: CompileIssue,
  ctx: FixContext,
  exists: boolean,
): TexFix | null {
  const m = /Command (\\[A-Za-z]+) (?:already defined|undefined)\./.exec(issue.message);
  const line = lineRange(ctx.doc, issue.line);
  if (!m || line === null) return null;
  const name = m[1].slice(1);
  const text = ctx.doc.slice(line.from, line.to);
  const [wrong, right] = exists ? ["new", "renew"] : ["renew", "new"];
  for (const [kind, target] of [
    ["command", `\\\\${name}`],
    ["environment", name],
  ]) {
    const found = new RegExp(
      `\\\\${wrong}${kind}\\*?\\s*\\{?\\s*${target}(?![A-Za-z])`,
    ).exec(text);
    if (found) {
      const from = line.from + found.index + 1;
      return {
        title: `Change \\${wrong}${kind} to \\${right}${kind}`,
        edits: [{ from, to: from + wrong.length, insert: right }],
      };
    }
  }
  return null;
}

/** Brace depth at the end of `text`, which starts at a command:
 *  0 when its arguments close. Escaped braces and comments don't count. */
function openBraces(text: string): number {
  let depth = 0;
  for (const match of text.matchAll(/\\.|(?<!\\)%.*$|[{}]/gm)) {
    if (match[0] === "{") depth++;
    else if (match[0] === "}") depth = Math.max(0, depth - 1);
  }
  return depth;
}

/**
 * An argument that never closes: `\section{Results` with the `}`
 * forgotten. TeX notices at the end of the paragraph (or of the file),
 * so the command is looked up from there back, and the brace goes at
 * the end of its line.
 */
function fixUnclosedArgument(issue: CompileIssue, ctx: FixContext): TexFix | null {
  const m =
    /^(?:Paragraph ended before|File ended while scanning use of) (\\[A-Za-z]+)(?: was complete)?\.$/.exec(
      issue.message,
    );
  if (!m) return null;
  const stop = lineRange(ctx.doc, issue.line)?.to ?? ctx.doc.length;
  const before = ctx.doc.slice(0, stop);
  const command = new RegExp(`\\${m[1]}(?![A-Za-z])`, "g");
  const uses = [...before.matchAll(command)].map((use) => use.index);
  for (const at of uses.reverse()) {
    const rest = ctx.doc.slice(at);
    const paragraphEnd = rest.search(/\n[ \t]*\n/);
    const paragraph = paragraphEnd === -1 ? rest : rest.slice(0, paragraphEnd);
    if (openBraces(paragraph) !== 1) continue;
    const lineEnd = ctx.doc.indexOf("\n", at);
    const text = ctx.doc.slice(at, lineEnd === -1 ? ctx.doc.length : lineEnd);
    // Before a comment and trailing spaces, so the brace counts.
    const comment = /(?<!\\)%/.exec(text);
    const kept = (comment ? text.slice(0, comment.index) : text).trimEnd();
    // Only when the line itself leaves the brace open: an argument
    // that runs over several lines could end anywhere.
    if (openBraces(kept) !== 1) return null;
    const lineNo = ctx.doc.slice(0, at).split("\n").length;
    return {
      title: `Add the missing } at the end of line ${lineNo}`,
      edits: [{ from: at + kept.length, to: at + kept.length, insert: "}" }],
    };
  }
  return null;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** The file a "not found" message names, in any of TeX's wordings. */
const MISSING_FILE = [
  /File [`']([^`']+)' not found/,
  /Unable to load picture or PDF file '([^']+)'/,
  /I can't find file [`']([^`']+)'/,
];

function missingFileName(message: string): string | null {
  for (const pattern of MISSING_FILE) {
    const match = pattern.exec(message);
    if (match) return match[1];
  }
  return null;
}

const EXTENSION = /\.[A-Za-z0-9]+$/;

function fixMissingFile(issue: CompileIssue, ctx: FixContext): TexFix | null {
  const missing = missingFileName(issue.message);
  // Packages and classes are not project files.
  if (missing === null || /\.(sty|cls)$/i.test(missing)) return null;
  const base = ctx.baseDir ? `${ctx.baseDir}/` : "";
  const candidates = [...ctx.assets, ...(ctx.texFiles ?? [])]
    .filter((path) => path.startsWith(base))
    .map((path) => path.slice(base.length));
  // Names are compared without extension (LaTeX adds it) and without
  // regard to capitals, which only some computers tell apart.
  const stem = (path: string) => basename(path).replace(EXTENSION, "").toLowerCase();
  const wanted = stem(missing);
  const extension = EXTENSION.exec(missing)?.[0].toLowerCase() ?? null;
  let best: string | null = null;
  let bestDist = Math.min(3, wanted.length);
  for (const candidate of candidates) {
    if (
      extension !== null &&
      EXTENSION.exec(candidate)?.[0].toLowerCase() !== extension
    ) {
      continue;
    }
    const dist = editDistance(stem(candidate), wanted);
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  if (best === null) return null;
  const line = lineRange(ctx.doc, issue.line);
  if (line === null) return null;
  const text = ctx.doc.slice(line.from, line.to);
  // Written as the source wrote it: with or without the extension,
  // which LaTeX may have added in its message.
  const named = basename(missing);
  const bare = text.includes(named) ? extension === null : true;
  const at = text.indexOf(bare ? named.replace(EXTENSION, "") : named);
  if (at === -1) return null;
  const target = bare ? best.replace(EXTENSION, "") : best;
  const open = text.lastIndexOf("{", at);
  const close = text.indexOf("}", at);
  if (open === -1 || close === -1 || close < at) return null;
  if (text.slice(open + 1, close).trim() === target) return null;
  return {
    title: `Change the path to ${target}`,
    edits: [{ from: line.from + open + 1, to: line.from + close, insert: target }],
  };
}

function fixUndefinedReference(issue: CompileIssue, ctx: FixContext): TexFix | null {
  const m = /Reference [`']([^`']+)'/.exec(issue.message);
  const name = m?.[1] ?? null;
  if (name === null) return null;
  const labels = extractLabelPositions(ctx.doc).map((pos) => pos.name);
  if (labels.includes(name)) {
    return {
      title: `Recompile to settle cross-references (\\label{${name}} exists)`,
      edits: [],
      action: "recompile",
    };
  }
  const suggestion = closestWord(name, labels);
  if (suggestion === null) return null;
  const edits: SourceEdit[] = extractRefPositions(ctx.doc)
    .filter((ref) => ref.name === name)
    .map((ref) => ({
      from: ref.to - 1 - name.length,
      to: ref.to - 1,
      insert: suggestion,
    }));
  if (edits.length === 0) return null;
  return { title: `Change the reference to ${suggestion}`, edits };
}

function fixUndefinedCitation(issue: CompileIssue, ctx: FixContext): TexFix | null {
  const m = /Citation [`']([^`']+)'/.exec(issue.message);
  const key = m?.[1] ?? null;
  if (key === null || ctx.bibKeys.length === 0) return null;
  if (ctx.bibKeys.includes(key)) {
    return {
      title: `Recompile to pick up ${key} from the bibliography`,
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
  return { title: `Change the citation key to ${suggestion}`, edits };
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
  if (/^LaTeX Error: Command \\[A-Za-z]+ already defined\./.test(message)) {
    return "already-defined";
  }
  if (/^LaTeX Error: Command \\[A-Za-z]+ undefined\./.test(message)) {
    return "not-yet-defined";
  }
  if (
    /^(Paragraph ended before|File ended while scanning use of) \\[A-Za-z]+/.test(
      message,
    )
  ) {
    return "unclosed-argument";
  }
  if (issue.severity === "error" && missingFileName(message) !== null) {
    return "missing-file";
  }
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
    case "already-defined":
      return fixDefinition(issue, ctx, true);
    case "not-yet-defined":
      return fixDefinition(issue, ctx, false);
    case "unclosed-argument":
      return fixUnclosedArgument(issue, ctx);
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
