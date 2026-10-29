/**
 * Visual document JSON → LaTeX source. The inverse of `parseTex`.
 *
 * Modeled nodes are re-generated in the house style (blocks separated
 * by blank lines, environments indented two spaces); raw fallbacks are
 * emitted byte-for-byte. The output is stable: serializing the parse
 * of this serializer's output yields the same text again.
 */

import {
  CHANGE_MARKS,
  type Block,
  type DocNode,
  type EnvBlockNode,
  type Inline,
  type ListItemNode,
  type ListNode,
  type Mark,
  type PreambleAttrs,
} from "./doc-types";

/** Two spaces per environment nesting level, matching latex-format.ts. */
const INDENT_WIDTH = 2;

const FORMAT_DEFAULTS: Record<string, string> = {
  bold: "textbf",
  italic: "emph",
  code: "texttt",
  underline: "underline",
};

/** Characters that must be backslash-escaped in plain text. */
const ESCAPED = /[#$%&_{}]/g;

function escapeText(t: string): string {
  return t.replace(ESCAPED, (ch) => `\\${ch}`).replace(/\u00A0/g, "~");
}

function serializeNode(node: Inline): string {
  switch (node.type) {
    case "text": {
      const isComment = node.marks?.some((m) => m.type === "comment") ?? false;
      // Comment content is raw, and the newline it consumed returns.
      if (isComment) return node.text + "\n";
      return escapeText(node.text);
    }
    case "hardBreak":
    case "mathInline":
    case "cite":
    case "ref":
    case "label":
    case "footnote":
    case "rawTexInline":
      return node.attrs.src;
  }
}

const isFormat = (m: Mark) => m.type !== "comment" && !CHANGE_MARKS.has(m.type);

const formatCmd = (m: Mark) => m.attrs?.cmd ?? FORMAT_DEFAULTS[m.type];

const sameFormat = (a: Mark, b: Mark) =>
  a.type === b.type && formatCmd(a) === formatCmd(b);

/** The outermost change mark of a node: deletions wrap insertions
 *  (another author's new text struck out), both wrap highlights. */
const CHANGE_ORDER = ["deletion", "insertion", "changeHighlight"];

function changeMarkOf(node: Inline): Mark | null {
  let best: Mark | null = null;
  for (const mark of node.marks ?? []) {
    if (!CHANGE_MARKS.has(mark.type)) continue;
    if (
      best === null ||
      CHANGE_ORDER.indexOf(mark.type) < CHANGE_ORDER.indexOf(best.type)
    ) {
      best = mark;
    }
  }
  return best;
}

const sameChange = (a: Mark | null, b: Mark | null) =>
  a !== null &&
  b !== null &&
  a.type === b.type &&
  (a.attrs?.author ?? null) === (b.attrs?.author ?? null) &&
  (a.attrs?.opts ?? null) === (b.attrs?.opts ?? null) &&
  (a.attrs?.pair ?? null) === (b.attrs?.pair ?? null);

const without = (node: Inline, same: (m: Mark) => boolean): Inline => {
  const marks = (node.marks ?? []).filter((m) => !same(m));
  return { ...node, marks } as Inline;
};

const CHANGE_CMD: Record<string, string> = {
  insertion: "added",
  deletion: "deleted",
  changeHighlight: "highlight",
};

/**
 * Inline content as LaTeX: a run of nodes sharing a change mark is one
 * `\added` / `\deleted` / `\highlight`, and the two halves of a
 * replacement (same `pair`, old text first) one `\replaced`. A run
 * sharing a formatting mark, atoms included, is one `\textbf{...}` etc.
 */
function serializeInline(nodes: Inline[] | undefined): string {
  const list = nodes ?? [];
  let out = "";
  let i = 0;
  // The run of nodes from `start` sharing `mark`, the mark removed.
  const runFrom = (start: number, mark: Mark) => {
    let end = start;
    while (end < list.length && sameChange(changeMarkOf(list[end]), mark)) end++;
    const same = (m: Mark) => m === mark || sameChange(m, mark);
    return { end, inner: list.slice(start, end).map((n) => without(n, same)) };
  };
  // The end of the run from `start` whose nodes all carry `mark`.
  const formatRunEnd = (start: number, mark: Mark) => {
    let end = start;
    while (
      end < list.length &&
      (list[end].marks ?? []).some((m) => isFormat(m) && sameFormat(m, mark))
    )
      end++;
    return end;
  };
  while (i < list.length) {
    const mark = changeMarkOf(list[i]);
    if (mark === null) {
      // The formatting mark spanning the most nodes wraps the others.
      let best: { mark: Mark; end: number } | null = null;
      for (const m of (list[i].marks ?? []).filter(isFormat)) {
        const end = formatRunEnd(i, m);
        if (best === null || end > best.end) best = { mark: m, end };
      }
      if (best === null) {
        out += serializeNode(list[i]);
        i++;
        continue;
      }
      const fmt = best.mark;
      const inner = list
        .slice(i, best.end)
        .map((n) => without(n, (m) => isFormat(m) && sameFormat(m, fmt)));
      out += `\\${formatCmd(fmt)}{${serializeInline(inner)}}`;
      i = best.end;
      continue;
    }
    const run = runFrom(i, mark);
    const opts = mark.attrs?.opts ?? "";
    const pair = mark.attrs?.pair ?? null;
    if (mark.type === "deletion" && pair !== null) {
      const next = changeMarkOf(
        list[run.end] ?? ({ type: "text", text: "" } as Inline),
      );
      if (next !== null && next.type === "insertion" && next.attrs?.pair === pair) {
        const added = runFrom(run.end, next);
        out += `\\replaced${opts}{${serializeInline(added.inner)}}{${serializeInline(run.inner)}}`;
        i = added.end;
        continue;
      }
    }
    out += `\\${CHANGE_CMD[mark.type]}${opts}{${serializeInline(run.inner)}}`;
    i = run.end;
  }
  return out;
}

function serializeList(node: ListNode, indent: number): string {
  const env = node.type === "bulletList" ? "itemize" : "enumerate";
  const pad = " ".repeat(indent);
  const items = (node.content ?? []).map((item) =>
    serializeItem(item, indent + INDENT_WIDTH),
  );
  return `${pad}\\begin{${env}}\n${items.join("\n")}\n${pad}\\end{${env}}`;
}

function serializeItem(item: ListItemNode, indent: number): string {
  const pad = " ".repeat(indent);
  const label = item.attrs?.label;
  const tag = `${pad}\\item${label !== undefined && label !== null ? `[${label}]` : ""}`;
  const blocks = (item.content ?? [])
    .map((b) =>
      serializeBlock(
        b,
        b.type === "bulletList" || b.type === "orderedList"
          ? indent + INDENT_WIDTH
          : indent,
      ),
    )
    .join("\n\n");
  const [first, ...rest] = splitFirstLine(blocks);
  const head = rest.length > 0 || first.length > 0 ? `${tag} ${first}` : tag;
  return [head, ...rest].join("\n");
}

/** First line of `text` split off (lines re-joined for the caller). */
function splitFirstLine(text: string): string[] {
  const nl = text.indexOf("\n");
  if (nl === -1) return [text];
  return [text.slice(0, nl), text.slice(nl + 1)];
}

/**
 * Reassemble the preamble text from its decomposed attrs: document
 * class first, then packages, then the raw remainder, then the title
 * metadata — a canonical order, stable across parse/serialize cycles.
 * Always ends with a blank line, so the body (or the
 * `\begin{document}`) never glues onto the last preamble command.
 */
export function preambleText(attrs: PreambleAttrs): string {
  const parts: string[] = [];
  if (attrs.documentclassSrc !== null) parts.push(attrs.documentclassSrc);
  if (attrs.packagesSrc !== null) parts.push(attrs.packagesSrc);
  const rest = attrs.src.replace(/^\s+/, "").replace(/\s+$/, "");
  if (rest.length > 0) parts.push(rest);
  if (attrs.titleSrc !== null) parts.push(attrs.titleSrc);
  if (attrs.authorSrc !== null) parts.push(attrs.authorSrc);
  if (attrs.dateSrc !== null) parts.push(attrs.dateSrc);
  if (parts.length === 0) return "";
  return `${parts.join("\n").replace(/\s+$/, "")}\n\n`;
}

/**
 * A modeled environment: `\begin{env}[opt]`, the body indented two
 * spaces, `\end{env}`. Children serialize at top-level style and the
 * whole body shifts uniformly, so nested lists keep their relative
 * indentation.
 */
function serializeEnvBlock(node: EnvBlockNode, indent: number): string {
  const pad = " ".repeat(indent);
  const opt =
    node.attrs.opt !== null && node.attrs.opt !== undefined
      ? `[${node.attrs.opt}]`
      : "";
  const body = (node.content ?? [])
    .map((b) => serializeBlock(b, 0))
    .filter((s) => s.length > 0)
    .join("\n\n");
  const open = `${pad}\\begin{${node.attrs.env}}${opt}`;
  const close = `${pad}\\end{${node.attrs.env}}`;
  if (body.length === 0) return `${open}\n${close}`;
  const bodyPad = pad + " ".repeat(INDENT_WIDTH);
  const indented = body
    .split("\n")
    .map((line) => (line.length === 0 ? line : bodyPad + line))
    .join("\n");
  return `${open}\n${indented}\n${close}`;
}

export function serializeBlock(block: Block, indent = 0): string {
  switch (block.type) {
    case "preamble":
      return preambleText(block.attrs);
    case "titleBlock":
      return block.attrs.src;
    case "heading": {
      // opt is null when the editor normalizes an absent attribute.
      const opt = block.attrs.opt ? `[${block.attrs.opt}]` : "";
      // Trailing labels go after the closing brace, where LaTeX wants them.
      const content = [...(block.content ?? [])];
      const labels: Inline[] = [];
      for (;;) {
        const last = content[content.length - 1];
        if (last?.type === "label") labels.unshift(content.pop()!);
        else if (
          last?.type === "text" &&
          !last.marks?.length &&
          last.text.trim() === ""
        )
          content.pop();
        else break;
      }
      const title = serializeInline(content).replace(/[ \t]+$/, "");
      return `\\${block.attrs.cmd}${opt}{${title}}${serializeInline(labels)}`;
    }
    case "paragraph":
      // Trailing spaces before a paragraph break carry no meaning, nor
      // does the newline of a closing comment: the break supplies it.
      return serializeInline(block.content)
        .replace(/[ \t]+$/, "")
        .replace(/\n$/, "");
    case "mathBlock":
    case "figureBlock":
    case "rawTexBlock":
      return block.attrs.src;
    case "envBlock":
      return serializeEnvBlock(block, indent);
    case "bulletList":
    case "orderedList":
      return serializeList(block, indent);
  }
}

/**
 * Serialize the visual document back to `.tex`. With `wrapped` set, the
 * preamble node and `\begin{document}` / `\end{document}` framing are
 * regenerated; the postamble attribute is appended verbatim.
 */
export function serializeTex(doc: DocNode): string {
  const wrapped = doc.attrs?.wrapped === true;
  const blocks = doc.content ?? [];

  let preambleAttrs: PreambleAttrs | null = null;
  const bodyBlocks: Block[] = [];
  for (const block of blocks) {
    if (
      block.type === "preamble" &&
      preambleAttrs === null &&
      bodyBlocks.length === 0
    ) {
      preambleAttrs = block.attrs;
    } else {
      bodyBlocks.push(block);
    }
  }

  const body = bodyBlocks
    .map((b) => serializeBlock(b, 0))
    .filter((s) => s.length > 0)
    .join("\n\n");

  if (!wrapped) {
    const pre = preambleAttrs !== null ? preambleText(preambleAttrs) : "";
    return (pre.length > 0 ? pre + body : body).replace(/\s+$/, "") + "\n";
  }

  const pre = preambleAttrs !== null ? preambleText(preambleAttrs) : "";
  const post = doc.attrs?.postamble ?? "";
  const postOut = post.trim().length > 0 ? "\n\n" + post.trim() : "";

  let out = pre + "\\begin{document}\n";
  if (body.length > 0) out += "\n" + body + "\n\n";
  out += "\\end{document}" + postOut;
  return out + "\n";
}
