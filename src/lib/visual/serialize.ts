/**
 * Visual document JSON → LaTeX source. The inverse of `parseTex`.
 *
 * Modeled nodes are re-generated in the house style (blocks separated
 * by blank lines, environments indented two spaces); raw fallbacks are
 * emitted byte-for-byte. The output is stable: serializing the parse
 * of this serializer's output yields the same text again.
 */

import {
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

/** Wrap `text` in its formatting commands, innermost mark first. */
function applyMarks(text: string, marks: Mark[]): string {
  let out = text;
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i];
    if (mark.type === "comment") continue; // handled by the caller
    const cmd = mark.attrs?.cmd ?? FORMAT_DEFAULTS[mark.type];
    out = `\\${cmd}{${out}}`;
  }
  return out;
}

function serializeInline(nodes: Inline[] | undefined): string {
  let out = "";
  for (const node of nodes ?? []) {
    switch (node.type) {
      case "text": {
        const isComment = node.marks?.some((m) => m.type === "comment") ?? false;
        if (isComment) {
          // Comment content is raw, and the newline it consumed returns.
          out += node.text + "\n";
        } else {
          out += applyMarks(escapeText(node.text), node.marks ?? []);
        }
        break;
      }
      case "hardBreak":
        out += node.attrs.src;
        break;
      case "mathInline":
      case "cite":
      case "ref":
      case "label":
      case "rawTexInline":
        out += node.attrs.src;
        break;
    }
  }
  return out;
}

function serializeList(node: ListNode, indent: number): string {
  const env = node.type === "bulletList" ? "itemize" : "enumerate";
  const pad = " ".repeat(indent);
  const items = (node.content ?? []).map((item) => serializeItem(item, indent + INDENT_WIDTH));
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
  return parts.join("\n").replace(/\s+$/, "\n\n");
}

/**
 * A modeled environment: `\begin{env}[opt]`, the body indented two
 * spaces, `\end{env}`. Children serialize at top-level style and the
 * whole body shifts uniformly, so nested lists keep their relative
 * indentation.
 */
function serializeEnvBlock(node: EnvBlockNode, indent: number): string {
  const pad = " ".repeat(indent);
  const opt = node.attrs.opt !== null && node.attrs.opt !== undefined ? `[${node.attrs.opt}]` : "";
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
      const title = serializeInline(block.content).replace(/[ \t]+$/, "");
      return `\\${block.attrs.cmd}${opt}{${title}}`;
    }
    case "paragraph":
      // Trailing spaces before a paragraph break carry no meaning.
      return serializeInline(block.content).replace(/[ \t]+$/, "");
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
    if (block.type === "preamble" && preambleAttrs === null && bodyBlocks.length === 0) {
      preambleAttrs = block.attrs;
    } else {
      bodyBlocks.push(block);
    }
  }

  const body = bodyBlocks.map((b) => serializeBlock(b, 0)).filter((s) => s.length > 0).join("\n\n");

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
