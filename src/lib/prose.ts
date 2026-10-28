/**
 * The readable prose of a LaTeX source, for spelling and grammar
 * checks: commands, comments, math and the preamble are removed, the
 * text arguments of commands (\emph, \section, \caption, …) kept.
 * Math, citations and references become short placeholders so a
 * sentence still reads as one ("Let X be…", "see [1]"). The prose comes
 * in blocks (paragraphs, headings, captions, footnotes, list items),
 * and every character remembers the source range it came from.
 */

import { finalText } from "@/lib/changes";

export interface ProseBlock {
  /** The readable text. */
  text: string;
  /** Source offset where each character of `text` starts. */
  starts: number[];
  /** Source offset where each character of `text` ends (exclusive). */
  ends: number[];
  /** Ranges of `text` that stand in for math, citations or references:
   *  grammar reads them as words, spelling skips them. */
  placeholders: { from: number; to: number }[];
}

/** The source range of text[from, to) in a block. */
export function sourceRange(
  block: ProseBlock,
  from: number,
  to: number,
): { from: number; to: number } {
  const last = Math.max(from, to - 1);
  return { from: block.starts[from], to: block.ends[last] };
}

/** Commands whose arguments are identifiers or code, never prose. */
const SKIP_ARGS = new Set([
  "label",
  "usepackage",
  "documentclass",
  "includegraphics",
  "graphicspath",
  "input",
  "include",
  "subfile",
  "bibliography",
  "addbibresource",
  "bibliographystyle",
  "hypersetup",
  "setlength",
  "addtolength",
  "setcounter",
  "addtocounter",
  "newcommand",
  "renewcommand",
  "providecommand",
  "newenvironment",
  "renewenvironment",
  "newtheorem",
  "DeclareMathOperator",
  "vspace",
  "hspace",
  "color",
  "pagestyle",
  "thispagestyle",
  "author",
  "date",
  "affiliation",
  "email",
  "institute",
  "keywords",
  "nocite",
]);

/** Commands that stand in for a word in the sentence. */
const PLACEHOLDER_COMMANDS: Record<string, string> = {
  cite: "[1]",
  citep: "[1]",
  citet: "[1]",
  citealp: "[1]",
  citeauthor: "[1]",
  parencite: "[1]",
  textcite: "[1]",
  autocite: "[1]",
  footcite: "[1]",
  ref: "1",
  eqref: "1",
  pageref: "1",
  autoref: "1",
  cref: "1",
  Cref: "1",
  vref: "1",
  url: "X",
  LaTeX: "LaTeX",
  TeX: "TeX",
  LaTeXe: "LaTeX",
  today: "today",
};

/** Commands whose first argument is not prose but later ones are. */
const SKIP_FIRST_ARG = new Set(["href", "textcolor", "colorbox", "foreignlanguage"]);

/** Commands whose (first) argument is prose of its own: a block. */
const OWN_BLOCK = new Set([
  "part",
  "chapter",
  "section",
  "subsection",
  "subsubsection",
  "paragraph",
  "subparagraph",
  "caption",
  "footnote",
  "title",
  "thanks",
]);

/** Command-free symbols that produce text. */
const SYMBOL_COMMANDS: Record<string, string> = {
  ldots: "…",
  dots: "…",
  textendash: "–",
  textemdash: "—",
};

/** Environments read as math: a placeholder, body skipped. */
const MATH_ENVIRONMENTS = new Set([
  "equation",
  "equation*",
  "align",
  "align*",
  "alignat",
  "alignat*",
  "gather",
  "gather*",
  "flalign",
  "flalign*",
  "math",
  "displaymath",
  "eqnarray",
  "eqnarray*",
  "multline",
  "multline*",
]);

/** Environments whose body is not prose at all. */
const CODE_ENVIRONMENTS = new Set([
  "verbatim",
  "verbatim*",
  "lstlisting",
  "minted",
  "tikzpicture",
  "tabular",
  "tabular*",
  "tabularx",
  "longtable",
  "thebibliography",
  "comment",
]);

/** A brace group being read: what its content is. */
interface Frame {
  kind: "skip" | "inline" | "own";
  /** The command the group is an argument of, if any. */
  command: string | null;
  /** Which argument of that command (0-based). */
  arg: number;
}

class Builder {
  text = "";
  starts: number[] = [];
  ends: number[] = [];
  placeholders: { from: number; to: number }[] = [];

  push(ch: string, from: number, to: number) {
    this.text += ch;
    for (let k = 0; k < ch.length; k++) {
      this.starts.push(from);
      this.ends.push(to);
    }
  }

  space(at: number) {
    if (this.text.length > 0 && !this.text.endsWith(" ")) this.push(" ", at, at + 1);
  }

  placeholder(text: string, from: number, to: number) {
    const start = this.text.length;
    this.push(text, from, to);
    this.placeholders.push({ from: start, to: this.text.length });
  }

  /** The block, trailing space dropped; null when it holds no letters. */
  finish(): ProseBlock | null {
    let length = this.text.length;
    while (length > 0 && this.text[length - 1] === " ") length--;
    const text = this.text.slice(0, length);
    if (!/\p{L}/u.test(text)) return null;
    return {
      text,
      starts: this.starts.slice(0, length),
      ends: this.ends.slice(0, length),
      placeholders: this.placeholders.filter((p) => p.from < length),
    };
  }
}

/** The end of a math group starting at `i` (exclusive), or the text end. */
function mathEnd(text: string, i: number, close: string, limit: number): number {
  let j = i;
  while (j < limit) {
    if (text[j] === "\\") {
      if (text.startsWith(close, j)) return j + close.length;
      j += 2;
      continue;
    }
    if (close === "$" && text[j] === "$") return j + 1;
    if (close === "$$" && text.startsWith("$$", j)) return j + 2;
    j++;
  }
  return limit;
}

/** Whether argument `arg` of `command` is skipped (not prose). */
function skipsArg(command: string, arg: number): boolean {
  if (SKIP_ARGS.has(command) || command === "begin" || command === "end") return true;
  return SKIP_FIRST_ARG.has(command) && arg === 0;
}

/**
 * Split a LaTeX source into prose blocks (see the module comment). With
 * track changes, the final text is read: suggested deletions are not
 * prose, suggested insertions are; ranges point into the source.
 */
export function extractProse(source: string): ProseBlock[] {
  if (!MARKUP_RE.test(source)) return extractRawProse(source);
  const { text, map } = finalText(source);
  return extractRawProse(text).map((block) => ({
    ...block,
    starts: block.starts.map((at) => map.toSource(at)),
    ends: block.ends.map((at) => map.toSource(at - 1) + 1),
  }));
}

const MARKUP_RE = /\\(?:added|deleted|replaced|highlight)(?![a-zA-Z])/;

function extractRawProse(source: string): ProseBlock[] {
  const beginDoc = source.indexOf("\\begin{document}");
  const start = beginDoc === -1 ? 0 : beginDoc + "\\begin{document}".length;
  // LaTeX ignores everything after \end{document}; so does the check.
  const endDoc = source.indexOf("\\end{document}", start);
  const end = endDoc === -1 ? source.length : endDoc;

  const blocks: ProseBlock[] = [];
  const builders: Builder[] = [new Builder()];
  const frames: Frame[] = [];
  const current = () => builders[builders.length - 1];
  const flush = () => {
    const block = current().finish();
    if (block !== null) blocks.push(block);
    builders[builders.length - 1] = new Builder();
  };
  const skipping = () => frames.some((f) => f.kind === "skip");
  // The command whose next brace (or [option]) argument comes up.
  let pending: { command: string; arg: number } | null = null;

  let i = start;
  while (i < end) {
    const ch = source[i];

    // Comments run to the end of the line.
    if (ch === "%") {
      while (i < end && source[i] !== "\n") i++;
      continue;
    }

    // Options of the pending command: never prose.
    if (ch === "[" && pending !== null) {
      const close = source.indexOf("]", i);
      i = close === -1 || close > end ? end : close + 1;
      continue;
    }

    if (ch === "{") {
      const command = pending?.command ?? null;
      const arg = pending?.arg ?? 0;
      if (skipping() || (command !== null && skipsArg(command, arg))) {
        frames.push({ kind: "skip", command, arg });
      } else if (command !== null && OWN_BLOCK.has(command) && arg === 0) {
        if (command !== "footnote" && command !== "thanks") flush();
        builders.push(new Builder());
        frames.push({ kind: "own", command, arg });
      } else {
        frames.push({ kind: "inline", command, arg });
      }
      pending = null;
      i++;
      continue;
    }

    if (ch === "}") {
      const frame = frames.pop();
      if (frame?.kind === "own") {
        flush();
        builders.pop();
      }
      // The command's next argument may follow: \href{url}{text}.
      pending =
        frame?.command != null ? { command: frame.command, arg: frame.arg + 1 } : null;
      i++;
      continue;
    }

    if (skipping()) {
      i++;
      continue;
    }

    // Math: a placeholder for the whole group.
    if (ch === "$" || source.startsWith("\\(", i) || source.startsWith("\\[", i)) {
      let to: number;
      if (source.startsWith("$$", i)) to = mathEnd(source, i + 2, "$$", end);
      else if (ch === "$") to = mathEnd(source, i + 1, "$", end);
      else to = mathEnd(source, i + 2, source[i + 1] === "(" ? "\\)" : "\\]", end);
      current().placeholder("X", i, to);
      pending = null;
      i = to;
      continue;
    }

    if (ch === "\\") {
      const name = /^[A-Za-z@]+\*?/.exec(source.slice(i + 1, i + 40))?.[0] ?? "";
      if (name.length === 0) {
        // Control symbols: escaped characters, spacing, line breaks.
        const next = source[i + 1] ?? "";
        if ("%&$#_{}".includes(next) && next !== "") {
          current().push(next, i, i + 2);
        } else if (next === "\\" || next === "," || next === " " || next === ";") {
          current().space(i);
        }
        pending = null;
        i += 2;
        continue;
      }
      const after = i + 1 + name.length;
      const bare = name.replace(/\*$/, "");
      pending = null;

      if (bare === "begin" || bare === "end") {
        const env = /^\{([^}]*)\}/.exec(source.slice(after))?.[1] ?? "";
        const envEnd = after + env.length + 2;
        if (
          bare === "begin" &&
          (MATH_ENVIRONMENTS.has(env) || CODE_ENVIRONMENTS.has(env))
        ) {
          const close = source.indexOf(`\\end{${env}}`, envEnd);
          const to = close === -1 ? end : close + `\\end{${env}}`.length;
          if (MATH_ENVIRONMENTS.has(env)) current().placeholder("X", i, to);
          else flush();
          i = to;
          continue;
        }
        // Lists, figures, quotes, theorems: their own paragraphs.
        flush();
        i = env.length > 0 ? envEnd : after;
        // \begin{figure}[htbp]: the placement option is not prose.
        if (bare === "begin") pending = { command: "begin", arg: 1 };
        continue;
      }
      if (bare === "item" || bare === "par") {
        flush();
        i = after;
        if (bare === "item") pending = { command: "item", arg: 0 };
        continue;
      }
      if (PLACEHOLDER_COMMANDS[bare] !== undefined) {
        // The command and its arguments read as one word: \cite[p.~5]{key},
        // \ref{fig}, \LaTeX{}.
        let to = after;
        const args = /^(?:\s*\[[^\]]*\])*\s*(?:\{[^}]*\})+/.exec(source.slice(to, end));
        if (args !== null) to += args[0].length;
        current().placeholder(PLACEHOLDER_COMMANDS[bare], i, to);
        i = to;
        continue;
      }
      if (SYMBOL_COMMANDS[bare] !== undefined) {
        current().push(SYMBOL_COMMANDS[bare], i, after);
        i = after;
        continue;
      }
      pending = { command: bare, arg: 0 };
      i = after;
      continue;
    }

    // A blank line ends the paragraph.
    if (ch === "\n") {
      let j = i + 1;
      while (j < end && (source[j] === " " || source[j] === "\t" || source[j] === "\r"))
        j++;
      if (source[j] === "\n") {
        flush();
        i = j + 1;
        continue;
      }
    }

    if (/\s/.test(ch) || ch === "~") {
      // Whitespace between a command and its argument keeps it pending.
      current().space(i);
      i++;
      continue;
    }

    pending = null;
    if (source.startsWith("``", i) || source.startsWith("''", i)) {
      current().push('"', i, i + 2);
      i += 2;
      continue;
    }
    if (ch === "`") {
      current().push("'", i, i + 1);
      i++;
      continue;
    }
    current().push(ch, i, i + 1);
    i++;
  }
  while (builders.length > 1) {
    flush();
    builders.pop();
  }
  flush();
  return blocks;
}
