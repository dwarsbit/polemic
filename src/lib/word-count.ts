/**
 * texcount-style word counts: words in running text, in headings, and
 * in captions/footnotes, plus inline and display math, counted from
 * the document body only. Commands, their identifier arguments and
 * options, comments, math, verbatim-like environments, and the
 * bibliography are skipped. Section ranges come from heading
 * positions, so counts can be grouped per section.
 */

import { finalText } from "@/lib/changes";

export type WordKind = "text" | "header" | "other";

export interface WordStats {
  text: number;
  header: number;
  /** Captions and footnotes. */
  other: number;
  inlineMath: number;
  displayMath: number;
}

export function emptyStats(): WordStats {
  return { text: 0, header: 0, other: 0, inlineMath: 0, displayMath: 0 };
}

export function addStats(a: WordStats, b: WordStats): WordStats {
  return {
    text: a.text + b.text,
    header: a.header + b.header,
    other: a.other + b.other,
    inlineMath: a.inlineMath + b.inlineMath,
    displayMath: a.displayMath + b.displayMath,
  };
}

/** All counted words (text, headings, captions/footnotes). */
export function totalWords(stats: WordStats): number {
  return stats.text + stats.header + stats.other;
}

/** One counted item with its source offset. */
interface Hit {
  pos: number;
  kind: keyof WordStats;
}

const HEADER_COMMANDS = new Set([
  "part",
  "chapter",
  "section",
  "subsection",
  "subsubsection",
  "paragraph",
  "subparagraph",
]);
const OTHER_COMMANDS = new Set(["caption", "footnote", "footnotetext", "marginpar"]);
/** Commands whose brace arguments are identifiers or code, not prose. */
const SKIP_ARG_COMMANDS = new Set([
  "label",
  "ref",
  "eqref",
  "pageref",
  "autoref",
  "cref",
  "Cref",
  "vref",
  "cite",
  "citep",
  "citet",
  "citeauthor",
  "citeyear",
  "parencite",
  "textcite",
  "autocite",
  "nocite",
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
  "url",
  "href",
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
  "textcolor",
  "pagestyle",
  "thispagestyle",
  "pagenumbering",
  "begin",
  "end",
]);
const DISPLAY_MATH_ENVS = new Set([
  "equation",
  "equation*",
  "align",
  "align*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "eqnarray",
  "eqnarray*",
  "flalign",
  "flalign*",
  "alignat",
  "alignat*",
  "displaymath",
  "math",
]);
/** Environments whose body is not prose at all. */
const SKIP_ENVS = new Set([
  "verbatim",
  "verbatim*",
  "Verbatim",
  "lstlisting",
  "minted",
  "comment",
  "tikzpicture",
  "thebibliography",
]);

const WORD_RE = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/uy;

/** Skip a balanced group opened at `i` ("{" or "["); returns the
 *  index after its close. */
function skipGroup(text: string, i: number, end: number): number {
  const open = text[i];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let j = i; j < end; j++) {
    const ch = text[j];
    if (ch === "\\") {
      j++;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  return end;
}

function skipSpaces(text: string, i: number, end: number): number {
  while (i < end && (text[i] === " " || text[i] === "\t")) i++;
  return i;
}

/** The body range: inside \begin{document}…\end{document} when present. */
function bodyRange(text: string): [number, number] {
  const begin = text.indexOf("\\begin{document}");
  const start = begin === -1 ? 0 : begin + "\\begin{document}".length;
  const endDoc = text.indexOf("\\end{document}", start);
  return [start, endDoc === -1 ? text.length : endDoc];
}

/** Every counted word and math item in the source, in order. */
function scan(text: string): Hit[] {
  const [start, end] = bodyRange(text);
  const hits: Hit[] = [];
  // Brace contexts: what words inside the current group count as.
  const stack: (WordKind | "skip")[] = [];
  const context = () => stack[stack.length - 1] ?? "text";
  // The kind the next "{" opens (set by the command just read).
  let pending: WordKind | "skip" | null = null;

  let i = start;
  while (i < end) {
    const ch = text[i];
    if (ch === "%") {
      const nl = text.indexOf("\n", i);
      i = nl === -1 ? end : nl + 1;
      continue;
    }
    if (ch === "\\") {
      const next = text[i + 1] ?? "";
      // Inline math \( … \) and display math \[ … \].
      if (next === "(" || next === "[") {
        const closer = next === "(" ? "\\)" : "\\]";
        const close = text.indexOf(closer, i + 2);
        if (context() !== "skip") {
          hits.push({ pos: i, kind: next === "(" ? "inlineMath" : "displayMath" });
        }
        i = close === -1 ? end : close + 2;
        continue;
      }
      if (!/[A-Za-z@]/.test(next)) {
        i += 2; // escaped character: \%, \$, \\, \&, …
        continue;
      }
      let j = i + 1;
      while (j < end && /[A-Za-z@]/.test(text[j])) j++;
      const name = text.slice(i + 1, j);
      if (text[j] === "*") j++;
      if (name === "begin") {
        const m = /^\{([^}]*)\}/.exec(text.slice(j, j + 64));
        const env = m?.[1] ?? "";
        const afterName = j + (m?.[0].length ?? 0);
        const endTag = `\\end{${env}}`;
        if (DISPLAY_MATH_ENVS.has(env) || SKIP_ENVS.has(env)) {
          const close = text.indexOf(endTag, afterName);
          if (DISPLAY_MATH_ENVS.has(env) && context() !== "skip") {
            hits.push({ pos: i, kind: "displayMath" });
          }
          i = close === -1 ? end : close + endTag.length;
          continue;
        }
        // Environment options and arguments (placement, column specs,
        // widths) are not prose.
        let k = skipSpaces(text, afterName, end);
        while (k < end && (text[k] === "[" || text[k] === "{")) {
          k = skipSpaces(text, skipGroup(text, k, end), end);
        }
        i = k;
        continue;
      }
      // Options are never prose; the first brace argument depends on
      // the command.
      let k = skipSpaces(text, j, end);
      while (k < end && text[k] === "[")
        k = skipSpaces(text, skipGroup(text, k, end), end);
      if (SKIP_ARG_COMMANDS.has(name)) {
        while (k < end && text[k] === "{")
          k = skipSpaces(text, skipGroup(text, k, end), end);
        i = k;
        continue;
      }
      pending = HEADER_COMMANDS.has(name)
        ? "header"
        : OTHER_COMMANDS.has(name)
          ? "other"
          : null;
      i = k;
      continue;
    }
    if (ch === "$") {
      const display = text[i + 1] === "$";
      const closer = display ? "$$" : "$";
      let close = text.indexOf(closer, i + closer.length);
      while (close !== -1 && text[close - 1] === "\\") {
        close = text.indexOf(closer, close + 1);
      }
      if (context() !== "skip")
        hits.push({ pos: i, kind: display ? "displayMath" : "inlineMath" });
      i = close === -1 ? end : close + closer.length;
      continue;
    }
    if (ch === "{") {
      stack.push(pending ?? context());
      pending = null;
      i++;
      continue;
    }
    if (ch === "}") {
      stack.pop();
      i++;
      continue;
    }
    pending = null;
    WORD_RE.lastIndex = i;
    const word = WORD_RE.exec(text);
    if (word !== null && word.index === i && word.index < end) {
      const kind = context();
      if (kind !== "skip") hits.push({ pos: i, kind });
      i += word[0].length;
      continue;
    }
    i++;
  }
  return hits;
}

/** Word statistics of a whole source, read as its final text (every
 *  suggestion accepted). */
export function countWords(text: string): WordStats {
  const stats = emptyStats();
  for (const hit of scan(finalText(text).text)) stats[hit.kind]++;
  return stats;
}

/**
 * Word statistics split at the given 1-based heading lines: element 0
 * covers the text before the first heading, element n the section that
 * starts at headingLines[n - 1] (up to the next heading of any level).
 */
export function countWordsBySection(text: string, headingLines: number[]): WordStats[] {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const bounds = headingLines.map((line) => lineStarts[line - 1] ?? text.length);
  const out = Array.from({ length: headingLines.length + 1 }, emptyStats);
  let section = 0;
  const final = finalText(text);
  for (const hit of scan(final.text)) {
    const pos = final.map.toSource(hit.pos);
    while (section < bounds.length && pos >= bounds[section]) section++;
    out[section][hit.kind]++;
  }
  return out;
}
