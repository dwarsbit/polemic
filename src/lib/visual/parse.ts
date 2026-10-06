/**
 * LaTeX source → visual document JSON.
 *
 * A cursor-based, comment-aware parser. Blocks it can model become
 * headings, paragraphs, lists, math, and pill nodes; everything else
 * falls back to `rawTexBlock` / `rawTexInline` carrying the exact
 * source, so no content is lost or mangled on the way back.
 */

import {
  type Block,
  type DocNode,
  type Inline,
  type ListItemNode,
  type Mark,
  type MarkType,
  type PreambleAttrs,
} from "./doc-types";

/** Sectioning commands and their display level. */
const SECTION_LEVELS: Record<string, number> = {
  part: 1,
  chapter: 2,
  section: 3,
  subsection: 4,
  subsubsection: 5,
  paragraph: 6,
  subparagraph: 6,
};

const LIST_ENVS = new Set(["itemize", "enumerate"]);

/** Environments parsed as structured blocks: their body is parsed content. */
const QUOTE_ENVS = new Set(["quote", "quotation", "center", "abstract"]);

/**
 * The theorem family (amsthm and common conventions). The optional
 * argument after `\begin{env}[...]` is kept as the block's `opt`.
 * `\newtheorem`-defined names join these via `newtheoremEnvs`.
 */
export const THEOREM_ENVS = new Set([
  "theorem",
  "lemma",
  "corollary",
  "proposition",
  "definition",
  "remark",
  "example",
  "proof",
  "fact",
]);

/** All environment names parsed as `envBlock` blocks. */
function modeledEnvs(extra?: Set<string>): Set<string> {
  return new Set([...QUOTE_ENVS, ...THEOREM_ENVS, ...(extra ?? [])]);
}

/**
 * The `\newtheorem` declarations in a preamble, comment-aware:
 * environment name and its display name (`\newtheorem{env}{Name}`).
 */
export function newtheoremDeclarations(preamble: string): { env: string; name: string }[] {
  const declarations: { env: string; name: string }[] = [];
  const re = /\\newtheorem\*?\s*\{([^}]*)\}(?:\s*\[[^\]]*\])?\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(preamble)) !== null) {
    if (!inCommentAt(preamble, m.index)) declarations.push({ env: m[1]!, name: m[2]! });
  }
  return declarations;
}

/** Is the position inside a `%` comment line? */
function inCommentAt(src: string, pos: number): boolean {
  const lineStart = src.lastIndexOf("\n", pos - 1) + 1;
  return src.slice(lineStart, pos).includes("%");
}

/** Environment names declared by `\newtheorem*?{env}` in a preamble. */
function newtheoremEnvs(preamble: string): Set<string> {
  const names = new Set<string>();
  let i = 0;
  let inComment = false;
  while (i < preamble.length) {
    const ch = preamble[i];
    if (inComment) {
      if (ch === "\n") inComment = false;
      i++;
      continue;
    }
    if (ch === "%") {
      inComment = true;
      i++;
      continue;
    }
    if (ch === "\\") {
      const m = /^\\newtheorem\*?\s*\{([^}]*)\}/.exec(preamble.slice(i, i + 80));
      if (m !== null) {
        names.add(m[1]);
        i += m[0].length;
        continue;
      }
      i += 2;
      continue;
    }
    i++;
  }
  return names;
}

/** Environments parsed as display math (mirrors math-region.ts). */
const MATH_ENVS = new Set([
  "equation",
  "equation*",
  "align",
  "align*",
  "alignat",
  "alignat*",
  "flalign",
  "flalign*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "eqnarray",
  "eqnarray*",
  "displaymath",
  "math",
  "cases",
  "aligned",
  "gathered",
  "split",
  "subarray",
]);

/** Environments copied byte-for-byte (their body is not LaTeX tokens). */
const VERBATIM_ENVS = new Set([
  "verbatim",
  "verbatim*",
  "Verbatim",
  "Verbatim*",
  "lstlisting",
  "minted",
]);

/** Float environments: raw source plus a thumbnail when they contain graphics. */
const FLOAT_ENVS = new Set([
  "figure",
  "figure*",
  "table",
  "table*",
  "wrapfigure",
  "wraptable",
  "subfigure",
  "subfigure*",
  "sidewaysfigure",
]);

/** Formatting commands → marks. */
const FORMAT_MARKS: Record<string, MarkType> = {
  textbf: "bold",
  textit: "italic",
  emph: "italic",
  texttt: "code",
  underline: "underline",
  uline: "underline",
};

export const REF_CMDS = new Set([
  "ref",
  "eqref",
  "pageref",
  "autoref",
  "cref",
  "Cref",
  "vref",
  "nameref",
]);

/** cite-family commands: bibtex, natbib, and biblatex names all start or end with "cite". */
function isCiteCmd(cmd: string): boolean {
  return cmd.startsWith("cite") || cmd.endsWith("cite");
}

interface Cursor {
  src: string;
  pos: number;
}

interface RunOpts {
  /** Inside a balanced group (title, \textbf{...}): never break the run. */
  inGroup?: boolean;
}

// ---------------------------------------------------------------------------
// Small scanners (all comment- and escape-aware)

/** The environment name of a `\begin{env}` at `i`, or null. */
function matchBegin(src: string, i: number): { env: string; after: number } | null {
  if (!src.startsWith("\\begin{", i)) return null;
  const end = src.indexOf("}", i + 7);
  if (end === -1) return null;
  return { env: src.slice(i + 7, end), after: end + 1 };
}

/** Is there a blank line (paragraph break) at or after `i` before any text? */
function blankAhead(src: string, i: number): boolean {
  let j = i;
  while (src[j] === " " || src[j] === "\t") j++;
  if (src[j] !== "\n") return false;
  j++;
  while (src[j] === " " || src[j] === "\t") j++;
  return src[j] === "\n";
}

/** Body of the environment opening at `beginStart`, through its matching `\end`. */
function envBody(
  src: string,
  beginStart: number,
  env: string,
): { inner: string; end: number } {
  const nameStart = beginStart + "\\begin{".length;
  const afterName = src.indexOf("}", nameStart);
  const afterOpen = afterName === -1 ? src.length : afterName + 1;
  if (VERBATIM_ENVS.has(env)) {
    const endMarker = `\\end{${env}}`;
    const close = src.indexOf(endMarker, afterOpen);
    if (close === -1) return { inner: src.slice(afterOpen), end: src.length };
    return { inner: src.slice(afterOpen, close), end: close + endMarker.length };
  }
  const beginToken = `\\begin{${env}}`;
  const endToken = `\\end{${env}}`;
  let depth = 1;
  let i = afterOpen;
  let inComment = false;
  while (i < src.length) {
    const ch = src[i];
    if (inComment) {
      if (ch === "\n") inComment = false;
      i++;
      continue;
    }
    if (ch === "%") {
      inComment = true;
      i++;
      continue;
    }
    if (ch === "\\") {
      if (src.startsWith(beginToken, i)) {
        depth++;
        i += beginToken.length;
        continue;
      }
      if (src.startsWith(endToken, i)) {
        depth--;
        if (depth === 0) return { inner: src.slice(afterOpen, i), end: i + endToken.length };
        i += endToken.length;
        continue;
      }
      i++;
      continue;
    }
    i++;
  }
  // Unbalanced: take the rest so nothing is dropped.
  return { inner: src.slice(afterOpen), end: src.length };
}

/** The closing `$` of inline math opened at `from` (after the `$`), or -1. */
function findDollar(src: string, from: number): number {
  let i = from;
  let inComment = false;
  while (i < src.length) {
    const ch = src[i];
    if (inComment) {
      if (ch === "\n") inComment = false;
      i++;
      continue;
    }
    if (ch === "%") {
      inComment = true;
      i++;
      continue;
    }
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "$") {
      if (src[i + 1] === "$") i += 2;
      else return i;
      continue;
    }
    i++;
  }
  return -1;
}

/** The literal `marker` (comment-aware), or -1. The marker check must
 *  precede the escape skip: the markers start with a backslash
 *  (`\]`, `\)`), which the skip would otherwise consume. */
function findLiteral(src: string, from: number, marker: string): number {
  let i = from;
  let inComment = false;
  while (i < src.length) {
    const ch = src[i];
    if (inComment) {
      if (ch === "\n") inComment = false;
      i++;
      continue;
    }
    if (ch === "%") {
      inComment = true;
      i++;
      continue;
    }
    if (src.startsWith(marker, i)) return i;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    i++;
  }
  return -1;
}

/** The balanced `{...}` group opening at `pos`, or null when unbalanced. */
function readBalancedGroup(src: string, pos: number): { inner: string; end: number } | null {
  let depth = 0;
  let i = pos;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "{") {
      depth++;
      i++;
      continue;
    }
    if (ch === "}") {
      depth--;
      i++;
      if (depth === 0) return { inner: src.slice(pos + 1, i - 1), end: i };
      continue;
    }
    i++;
  }
  return null;
}

/** A command token with its attached `{...}` / `[...]` arguments, verbatim. */
function readCommandToken(src: string, i: number): { text: string; end: number } {
  let j = i + 1;
  while (j < src.length && /[a-zA-Z]/.test(src[j])) j++;
  if (src[j] === "*") j++;
  for (;;) {
    const ch = src[j];
    if (ch === "{") {
      const g = readBalancedGroup(src, j);
      if (g === null) break;
      j = g.end;
      continue;
    }
    if (ch === "[") {
      const k = findBracketEnd(src, j);
      if (k === -1) break;
      j = k;
      continue;
    }
    break;
  }
  return { text: src.slice(i, j), end: j };
}

/** End (exclusive) of a `[...]` argument opened at `pos`. */
function findBracketEnd(src: string, pos: number): number {
  let i = pos + 1;
  let inComment = false;
  while (i < src.length) {
    const ch = src[i];
    if (inComment) {
      if (ch === "\n") inComment = false;
      i++;
      continue;
    }
    if (ch === "%") {
      inComment = true;
      i++;
      continue;
    }
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "]") return i + 1;
    i++;
  }
  return -1;
}

/** A sectioning command at `i`, with optional `[short]` and the `{` of its title. */
function matchSection(src: string, i: number): { cmd: string; opt?: string; brace: number } | null {
  if (src[i] !== "\\") return null;
  const m = /^\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*)?(?:\s*\[([^\]]*)\])?\s*\{/.exec(
    src.slice(i, i + 200),
  );
  if (m === null) return null;
  return {
    cmd: m[1] + (m[2] ?? ""),
    opt: m[3],
    brace: i + m[0].length - 1,
  };
}

// ---------------------------------------------------------------------------
// Inline parsing

function parseInlineString(s: string, marks: Mark[], opts?: RunOpts): Inline[] {
  const c: Cursor = { src: s, pos: 0 };
  return parseInlineRun(c, marks, opts);
}

/**
 * Inline content from the cursor until a paragraph break (blank line)
 * or a block construct (`\begin{...}`, `\[`, `$$`, a sectioning
 * command) — unless inside a group, where nothing may end the run.
 */
function parseInlineRun(c: Cursor, marks: Mark[], opts?: RunOpts): Inline[] {
  const nodes: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text.length === 0) return;
    nodes.push({ type: "text", text, ...(marks.length > 0 ? { marks } : {}) });
    text = "";
  };

  while (c.pos < c.src.length) {
    const i = c.pos;
    const ch = c.src[i];

    // Paragraph break: leave the whitespace to the block loop.
    if (blankAhead(c.src, i)) {
      flush();
      return nodes;
    }

    // Whitespace runs (incl. single newlines) are one space in LaTeX;
    // a blank line ends the paragraph, trailing whitespace at EOF is
    // nothing at all.
    if (ch === " " || ch === "\t" || ch === "\n") {
      let j = i;
      for (;;) {
        if (blankAhead(c.src, j)) {
          c.pos = j;
          flush();
          return nodes;
        }
        const w = c.src[j];
        if (w !== " " && w !== "\t" && w !== "\n") break;
        j++;
      }
      if (j >= c.src.length) {
        c.pos = j;
        continue;
      }
      text += " ";
      c.pos = j;
      continue;
    }

    if (ch === "$") {
      // Display math opens a block — unless we are inside a group.
      if (c.src.startsWith("$$", i)) {
        if (opts?.inGroup) {
          const close = c.src.indexOf("$$", i + 2);
          const end = close === -1 ? c.src.length : close + 2;
          flush();
          nodes.push({ type: "mathInline", attrs: { src: c.src.slice(i, end) } });
          c.pos = end;
          continue;
        }
        flush();
        return nodes;
      }
      const close = findDollar(c.src, i + 1);
      if (close === -1) {
        text += "$"; // a lone $ is literal
        c.pos = i + 1;
        continue;
      }
      flush();
      nodes.push({ type: "mathInline", attrs: { src: c.src.slice(i, close + 1) } });
      c.pos = close + 1;
      continue;
    }

    if (ch === "%") {
      // Comment: verbatim to end of line; the newline is consumed by it.
      const nl = c.src.indexOf("\n", i);
      const end = nl === -1 ? c.src.length : nl;
      flush();
      nodes.push({
        type: "text",
        text: c.src.slice(i, end),
        marks: [...marks, { type: "comment" }],
      });
      c.pos = nl === -1 ? c.src.length : nl + 1;
      continue;
    }

    if (ch === "~") {
      text += "\u00A0";
      c.pos++;
      continue;
    }

    if (ch !== "\\") {
      text += ch;
      c.pos++;
      continue;
    }

    // --- backslash constructs ---

    if (c.src.startsWith("\\[", i)) {
      if (opts?.inGroup) {
        const close = findLiteral(c.src, i + 2, "\\]");
        const end = close === -1 ? c.src.length : close + 2;
        flush();
        nodes.push({ type: "mathInline", attrs: { src: c.src.slice(i, end) } });
        c.pos = end;
        continue;
      }
      flush();
      return nodes;
    }

    if (c.src.startsWith("\\(", i)) {
      const close = findLiteral(c.src, i + 2, "\\)");
      const end = close === -1 ? c.src.length : close + 2;
      flush();
      nodes.push({ type: "mathInline", attrs: { src: c.src.slice(i, end) } });
      c.pos = end;
      continue;
    }

    // \\ line breaks
    if (c.src[i + 1] === "\\") {
      let j = i + 2;
      if (c.src[j] === "*") j++;
      if (c.src[j] === "[") {
        const k = findBracketEnd(c.src, j);
        if (k !== -1) j = k;
      }
      flush();
      nodes.push({ type: "hardBreak", attrs: { src: c.src.slice(i, j) } });
      c.pos = j;
      continue;
    }

    const begin = matchBegin(c.src, i);
    if (begin !== null) {
      if (opts?.inGroup) {
        const body = envBody(c.src, i, begin.env);
        flush();
        nodes.push({ type: "rawTexInline", attrs: { src: c.src.slice(i, body.end) } });
        c.pos = body.end;
        continue;
      }
      flush();
      return nodes;
    }

    const section = matchSection(c.src, i);
    if (section !== null) {
      if (opts?.inGroup) {
        const token = readCommandToken(c.src, i);
        flush();
        nodes.push({ type: "rawTexInline", attrs: { src: token.text } });
        c.pos = token.end;
        continue;
      }
      flush();
      return nodes;
    }

    // Escaped specials
    const next = c.src[i + 1];
    if (next !== undefined && "{}$&%#_".includes(next)) {
      text += next;
      c.pos = i + 2;
      continue;
    }

    // Command
    const cmdMatch = /^\\([a-zA-Z]+)/.exec(c.src.slice(i, i + 64));
    const cmd = cmdMatch?.[1];
    if (cmd === undefined) {
      // \, \; \! spacing and bare backslashes: raw, verbatim
      const token = readCommandToken(c.src, i);
      flush();
      nodes.push({ type: "rawTexInline", attrs: { src: token.text } });
      c.pos = token.end;
      continue;
    }

    if (FORMAT_MARKS[cmd] !== undefined) {
      const afterCmd = i + 1 + cmd.length;
      const g =
        c.src[afterCmd] === "{"
          ? readBalancedGroup(c.src, afterCmd)
          : null;
      if (g !== null) {
        const mark: Mark = { type: FORMAT_MARKS[cmd], attrs: { cmd } };
        flush();
        nodes.push(...parseInlineString(g.inner, [...marks, mark], { inGroup: true }));
        c.pos = g.end;
        continue;
      }
    }

    if (cmd === "label" || REF_CMDS.has(cmd) || isCiteCmd(cmd)) {
      const token = readCommandToken(c.src, i);
      flush();
      const type = cmd === "label" ? "label" : REF_CMDS.has(cmd) ? "ref" : "cite";
      nodes.push({ type, attrs: { src: token.text } } as Inline);
      c.pos = token.end;
      continue;
    }

    if (cmd === "footnote") {
      const token = readCommandToken(c.src, i);
      flush();
      nodes.push({ type: "footnote", attrs: { src: token.text } });
      c.pos = token.end;
      continue;
    }

    // Unknown command: raw with its attached arguments
    const token = readCommandToken(c.src, i);
    flush();
    nodes.push({ type: "rawTexInline", attrs: { src: token.text } });
    c.pos = token.end;
  }

  flush();
  return nodes;
}

// ---------------------------------------------------------------------------
// Block parsing

/** Which environments parse as modeled blocks, and which are theorem-like. */
interface EnvCtx {
  modeled: Set<string>;
  theorems: Set<string>;
}

function parseBody(src: string, ctx: EnvCtx): Block[] {
  const blocks: Block[] = [];
  const c: Cursor = { src, pos: 0 };
  while (c.pos < src.length) {
    skipBlank(c);
    if (c.pos >= src.length) break;
    const before = c.pos;
    const produced = parseBlockAt(c, ctx);
    if (c.pos === before && produced.length === 0) {
      c.pos++; // never stall
      continue;
    }
    blocks.push(...produced);
  }
  return blocks;
}

function skipBlank(c: Cursor) {
  while (c.pos < c.src.length && /\s/.test(c.src[c.pos])) c.pos++;
}

function parseBlockAt(c: Cursor, ctx: EnvCtx): Block[] {
  const src = c.src;
  const i = c.pos;

  const begin = matchBegin(src, i);
  if (begin !== null) return [parseEnv(c, begin.env, ctx)];

  if (src.startsWith("\\[", i)) {
    const close = findLiteral(src, i + 2, "\\]");
    if (close !== -1) {
      const end = close + 2;
      c.pos = end;
      return [{ type: "mathBlock", attrs: { src: src.slice(i, end) } }];
    }
  }

  if (src.startsWith("$$", i)) {
    const close = src.indexOf("$$", i + 2);
    if (close !== -1) {
      const end = close + 2;
      c.pos = end;
      return [{ type: "mathBlock", attrs: { src: src.slice(i, end) } }];
    }
  }

  const section = matchSection(src, i);
  if (section !== null) return [parseHeading(c, section)];

  // \maketitle renders as the document's title card.
  if (src.startsWith("\\maketitle", i) && !/[a-zA-Z]/.test(src[i + 10] ?? "")) {
    const token = readCommandToken(src, i);
    c.pos = token.end;
    return [{ type: "titleBlock", attrs: { src: token.text } }];
  }

  const content = parseInlineRun(c, []);
  if (content.length === 0) return [];
  return [{ type: "paragraph", content }];
}

function parseHeading(
  c: Cursor,
  section: { cmd: string; opt?: string; brace: number },
): Block {
  const title = readBalancedGroup(c.src, section.brace);
  if (title === null) {
    // Unbalanced title braces: raw fallback for the rest of the file.
    const rest = c.src.slice(c.pos);
    c.pos = c.src.length;
    return { type: "rawTexBlock", attrs: { src: rest } };
  }
  const titleInline = parseInlineString(title.inner, [], { inGroup: true });
  c.pos = title.end;
  // Labels and comments may follow on the same line; keep them in the heading.
  const restInline = parseInlineRun(c, []);
  const level = SECTION_LEVELS[section.cmd.replace(/\*$/, "")] ?? 3;
  return {
    type: "heading",
    attrs: { level, cmd: section.cmd, opt: section.opt },
    content: [...titleInline, ...restInline],
  };
}

function parseEnv(c: Cursor, env: string, ctx: EnvCtx): Block {
  const start = c.pos;
  const body = envBody(c.src, start, env);
  c.pos = body.end;
  const raw = c.src.slice(start, body.end);

  if (ctx.modeled.has(env)) {
    let inner = body.inner;
    let opt: string | null = null;
    if (ctx.theorems.has(env)) {
      const m = /^\s*\[([^\]]*)\]/.exec(inner);
      if (m !== null) {
        opt = m[1];
        inner = inner.slice(m[0].length);
      }
    }
    const content = parseBody(inner, ctx);
    if (content.length === 0) content.push({ type: "paragraph", content: [] });
    return { type: "envBlock", attrs: { env, opt }, content };
  }
  if (LIST_ENVS.has(env)) {
    const items = parseItems(body.inner, ctx);
    if (items !== null) {
      return { type: env === "itemize" ? "bulletList" : "orderedList", content: items };
    }
  }
  if (MATH_ENVS.has(env)) return { type: "mathBlock", attrs: { src: raw } };
  if (FLOAT_ENVS.has(env)) return { type: "figureBlock", attrs: { src: raw } };
  return { type: "rawTexBlock", attrs: { src: raw } };
}

/** `\item` positions at nesting depth 0 of the environment body. */
function itemPositions(inner: string): number[] {
  const positions: number[] = [];
  let i = 0;
  let depth = 0;
  let inComment = false;
  while (i < inner.length) {
    const ch = inner[i];
    if (inComment) {
      if (ch === "\n") inComment = false;
      i++;
      continue;
    }
    if (ch === "%") {
      inComment = true;
      i++;
      continue;
    }
    if (ch === "\\") {
      const begin = matchBegin(inner, i);
      if (begin !== null) {
        depth++;
        i = begin.after;
        continue;
      }
      if (inner.startsWith("\\end{", i)) {
        const close = inner.indexOf("}", i + 5);
        if (close !== -1) {
          depth--;
          i = close + 1;
          continue;
        }
      }
      if (inner.startsWith("\\item", i) && !/[a-zA-Z]/.test(inner[i + 5] ?? "")) {
        if (depth === 0) positions.push(i);
        i += 5;
        continue;
      }
      i += 2;
      continue;
    }
    i++;
  }
  return positions;
}

function parseItems(inner: string, ctx: EnvCtx): ListItemNode[] | null {
  const positions = itemPositions(inner);
  if (positions.length === 0) return null;
  const items: ListItemNode[] = [];
  for (let k = 0; k < positions.length; k++) {
    const start = positions[k] + 5;
    const end = k + 1 < positions.length ? positions[k + 1] : inner.length;
    let seg = inner.slice(start, end);
    let label: string | undefined;
    const lm = /^\s*\[([^\]]*)\]/.exec(seg);
    if (lm !== null) {
      label = lm[1];
      seg = seg.slice(lm[0].length);
    }
    let content = parseBody(seg, ctx);
    if (content.length === 0) content = [{ type: "paragraph", content: [] }];
    items.push({ type: "listItem", attrs: { label }, content });
  }
  return items;
}

/**
 * Split a preamble into the pieces the visual editor models. The
 * well-known commands (`\documentclass`, `\usepackage`, `\title`,
 * `\author`, `\date`) are extracted verbatim; everything else stays
 * in `src`, byte-for-byte. Comment-aware, so commented-out commands
 * are not extracted.
 */
export function splitPreamble(preamble: string): PreambleAttrs {
  const attrs: PreambleAttrs = {
    documentclassSrc: null,
    packagesSrc: null,
    titleSrc: null,
    authorSrc: null,
    dateSrc: null,
    src: "",
  };
  const packages: string[] = [];
  const removals: [number, number][] = [];
  const extract = (from: number, to: number, slot: keyof PreambleAttrs) => {
    const value = preamble.slice(from, to);
    if (slot === "packagesSrc") {
      packages.push(value);
    } else if (attrs[slot] === null) {
      attrs[slot] = value;
    } else {
      return; // a duplicate (e.g. a second \author) stays in the raw rest
    }
    removals.push([from, to]);
  };
  let i = 0;
  let inComment = false;
  while (i < preamble.length) {
    const ch = preamble[i];
    if (inComment) {
      if (ch === "\n") inComment = false;
      i++;
      continue;
    }
    if (ch === "%") {
      inComment = true;
      i++;
      continue;
    }
    if (ch === "\\") {
      const m = /^\\(documentclass|usepackage|title|author|date)(?![a-zA-Z])/.exec(
        preamble.slice(i, i + 20),
      );
      if (m !== null) {
        const token = readCommandToken(preamble, i);
        const slot: keyof PreambleAttrs =
          m[1] === "documentclass"
            ? "documentclassSrc"
            : m[1] === "usepackage"
              ? "packagesSrc"
              : m[1] === "title"
                ? "titleSrc"
                : m[1] === "author"
                  ? "authorSrc"
                  : "dateSrc";
        extract(i, token.end, slot);
        i = token.end;
        continue;
      }
      i += 2; // another command or escaped char: not ours to take
      continue;
    }
    i++;
  }
  let rest = preamble;
  for (let k = removals.length - 1; k >= 0; k--) {
    const [from, to] = removals[k]!;
    rest = rest.slice(0, from) + rest.slice(to);
  }
  attrs.packagesSrc = packages.length > 0 ? packages.join("\n") : null;
  attrs.src = rest;
  return attrs;
}

// ---------------------------------------------------------------------------
// Entry point

/**
 * Parse a `.tex` file into the visual editor's document. The preamble
 * (everything before `\begin{document}`) becomes a `preamble` node
 * with the well-known commands split out, and text after
 * `\end{document}` is kept in the `postamble` doc attribute; both
 * round-trip verbatim.
 */
export function parseTex(source: string): DocNode {
  const beginIdx = source.indexOf("\\begin{document}");
  const content: Block[] = [];
  let body = source;
  let postamble = "";

  // A preamble can declare more theorem environments (\newtheorem).
  let envs: EnvCtx | null = null;

  if (beginIdx !== -1) {
    const afterBegin = beginIdx + "\\begin{document}".length;
    const preamble = source.slice(0, beginIdx);
    const endIdx = source.indexOf("\\end{document}", afterBegin);
    body = endIdx === -1 ? source.slice(afterBegin) : source.slice(afterBegin, endIdx);
    postamble = endIdx === -1 ? "" : source.slice(endIdx + "\\end{document}".length);
    if (preamble.trim().length > 0) {
      content.push({ type: "preamble", attrs: splitPreamble(preamble) });
    }
    const theorems = new Set([...THEOREM_ENVS, ...newtheoremEnvs(preamble)]);
    envs = { modeled: new Set([...QUOTE_ENVS, ...theorems]), theorems };
  }

  content.push(...parseBody(body, envs ?? { modeled: modeledEnvs(), theorems: THEOREM_ENVS }));

  return {
    type: "doc",
    attrs: { wrapped: beginIdx !== -1, postamble },
    content,
  };
}
