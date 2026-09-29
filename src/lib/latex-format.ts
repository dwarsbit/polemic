/**
 * A conservative LaTeX formatter, in the spirit of Prettier but strictly
 * within what TeX allows: indentation of environment nesting plus
 * whitespace normalization.
 *
 * Never adds or removes lines and never re-wraps text (blank lines are
 * \par, a trailing % joins lines, so line structure is semantics).
 * Verbatim-like environments are copied byte-for-byte, comments are
 * preserved, and alignment environments keep their column spacing.
 * Returns the input unchanged when \begin/\end or \[ \] are unbalanced.
 */

export interface LatexFormatOptions {
  /** Spaces per indentation level. */
  indentWidth?: number;
}

const DEFAULT_INDENT_WIDTH = 2;

/** Environments whose body is kept byte-for-byte. */
const VERBATIM_ENVIRONMENTS = new Set([
  "verbatim",
  "verbatim*",
  "Verbatim",
  "Verbatim*",
  "lstlisting",
  "minted",
]);

/**
 * Environments where authors align columns with spaces: runs of spaces
 * are kept intact (indentation still applies).
 */
const ALIGNMENT_ENVIRONMENTS = new Set([
  "align",
  "align*",
  "aligned",
  "alignat",
  "alignat*",
  "flalign",
  "flalign*",
  "split",
  "cases",
  "array",
  "tabular",
  "tabular*",
  "tabularx",
  "longtable",
  "matrix",
  "pmatrix",
  "bmatrix",
  "Bmatrix",
  "vmatrix",
  "Vmatrix",
  "smallmatrix",
  "gathered",
  "multline",
  "multline*",
]);

/** Stack entry for \[ ... \] display-math blocks. */
const DISPLAY_MATH = " [[display]]";

interface Token {
  kind: "begin" | "end" | "open" | "close";
  /** Position just past the token in the code part. */
  end: number;
  env: string;
}

/** Split a line at the first unescaped %. */
function splitComment(line: string): [string, string] {
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== "%") continue;
    if (!isEscaped(line, i)) return [line.slice(0, i), line.slice(i)];
  }
  return [line, ""];
}

/** Is the \-sequence at position i escaped (preceded by \\)? */
function isEscaped(text: string, i: number): boolean {
  let backslashes = 0;
  for (let j = i - 1; j >= 0 && text[j] === "\\"; j--) backslashes++;
  return backslashes % 2 === 1;
}

/** Find environment and display-math tokens, in document order. */
function scanTokens(code: string): Token[] {
  const tokens: Token[] = [];
  const re = /\\(begin|end)\{([^{}]*)\}|\\([[\]])/g;
  for (const match of code.matchAll(re)) {
    const at = match.index ?? 0;
    if (isEscaped(code, at)) continue;
    if (match[1] !== undefined) {
      tokens.push({
        kind: match[1] === "begin" ? "begin" : "end",
        end: at + match[0].length,
        env: match[2],
      });
    } else {
      tokens.push({
        kind: match[3] === "[" ? "open" : "close",
        end: at + match[0].length,
        env: DISPLAY_MATH,
      });
    }
  }
  return tokens;
}

/**
 * Normalize the code part of a line: tabs to spaces, runs of spaces to
 * one, no trailing whitespace. Alignment environments keep space runs.
 */
function normalizeCode(code: string, alignment: boolean): string {
  const spaced = code.replace(/\t/g, " ");
  return (alignment ? spaced : spaced.replace(/ {2,}/g, " ")).trimEnd();
}

/** Format a LaTeX document; returns the input unchanged on any doubt. */
export function formatLatex(source: string, options?: LatexFormatOptions): string {
  const indentWidth = options?.indentWidth ?? DEFAULT_INDENT_WIDTH;
  const lines = source.split("\n");
  const out: string[] = [];
  const stack: string[] = [];
  let balanced = true;

  /** Verbatim environment currently being copied byte-for-byte. */
  let verbatim: string | null = null;

  for (const line of lines) {
    if (verbatim !== null) {
      out.push(line);
      const endRe = new RegExp(
        `\\\\end\\{${verbatim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}`,
      );
      if (endRe.test(line)) verbatim = null;
      continue;
    }

    const [code, comment] = splitComment(line);
    const trimmedCode = code.trim();
    if (trimmedCode === "" && comment === "") {
      out.push("");
      continue;
    }

    const tokens = scanTokens(code);
    // A line that starts by closing a block dedents itself.
    const startsWithClose =
      trimmedCode.startsWith("\\end{") || trimmedCode.startsWith("\\]");
    const lineDepth = startsWithClose ? stack.length - 1 : stack.length;

    let rawTail: string | null = null;
    for (const token of tokens) {
      if (token.kind === "begin") {
        stack.push(token.env);
        if (VERBATIM_ENVIRONMENTS.has(token.env)) {
          // The rest of this line belongs to the verbatim body.
          rawTail = code.slice(token.end);
          verbatim = token.env;
        }
      } else if (token.kind === "open") {
        stack.push(DISPLAY_MATH);
      } else {
        const top = stack.pop();
        if (top === undefined || top !== token.env) balanced = false;
      }
    }
    if (!balanced) return source;

    const aligning = stack.some((env) => ALIGNMENT_ENVIRONMENTS.has(env));
    const indent = " ".repeat(Math.max(lineDepth, 0) * indentWidth);

    if (rawTail !== null) {
      // Keep the verbatim body untouched; normalize only what precedes.
      const headEnd = code.length - rawTail.length;
      const head = normalizeCode(code.slice(0, headEnd), false).trimStart();
      out.push(indent + head + rawTail);
      continue;
    }
    if (trimmedCode === "") {
      // Comment-only line, re-indented to the current depth.
      out.push(indent + comment.trimEnd());
      continue;
    }
    // TeX keeps one space before a comment when the source had one:
    // "foo %" and "foo%" produce different output, so preserve the gap.
    const hadGap = /[ \t]$/.test(code);
    const normalized = normalizeCode(code, aligning).trimStart();
    out.push(
      comment === "" || !hadGap
        ? indent + normalized + comment
        : indent + normalized + " " + comment,
    );
  }

  if (stack.length > 0 || verbatim !== null) return source;

  // Exactly one trailing newline; trailing blank lines are kept (they
  // are \par, like any other blank line).
  const formatted = out.join("\n");
  return formatted.endsWith("\n") ? formatted : formatted + "\n";
}
