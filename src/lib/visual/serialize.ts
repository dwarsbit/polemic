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
  type PreambleLayout,
  type PreambleSlot,
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
    if (mark.type === "comment" || CHANGE_MARKS.has(mark.type)) continue;
    const cmd = mark.attrs?.cmd ?? FORMAT_DEFAULTS[mark.type];
    out = `\\${cmd}{${out}}`;
  }
  return out;
}

function serializeNode(node: Inline): string {
  switch (node.type) {
    case "text": {
      const isComment = node.marks?.some((m) => m.type === "comment") ?? false;
      // Comment content is raw, and the newline it consumed returns.
      if (isComment) return node.text + "\n";
      return applyMarks(escapeText(node.text), node.marks ?? []);
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

const without = (node: Inline, mark: Mark): Inline => {
  const marks = (node.marks ?? []).filter((m) => m !== mark && !sameChange(m, mark));
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
 * replacement (same `pair`, old text first) one `\replaced`.
 */
function serializeInline(nodes: Inline[] | undefined): string {
  const list = nodes ?? [];
  let out = "";
  let i = 0;
  // The run of nodes from `start` sharing `mark`, the mark removed.
  const runFrom = (start: number, mark: Mark) => {
    let end = start;
    while (end < list.length && sameChange(changeMarkOf(list[end]), mark)) end++;
    return { end, inner: list.slice(start, end).map((n) => without(n, mark)) };
  };
  while (i < list.length) {
    const mark = changeMarkOf(list[i]);
    if (mark === null) {
      out += serializeNode(list[i]);
      i++;
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
 * Reassemble the preamble text from its decomposed attrs. With a
 * `layout`, the extracted commands go back where they were parsed
 * from (see `layoutPreamble`); without one, in a canonical order:
 * document class, packages, the raw remainder, the title metadata.
 * Always ends with a blank line, so the body (or the
 * `\begin{document}`) never glues onto the last preamble command.
 */
export function preambleText(attrs: PreambleAttrs): string {
  const text =
    attrs.layout !== undefined && attrs.layout !== null
      ? layoutPreamble(attrs, attrs.layout)
      : canonicalPreamble(attrs);
  const trimmed = text.replace(/^\s+/, "").replace(/\s+$/, "");
  return trimmed.length > 0 ? `${trimmed}\n\n` : "";
}

function canonicalPreamble(attrs: PreambleAttrs): string {
  const parts: string[] = [];
  if (attrs.documentclassSrc !== null) parts.push(attrs.documentclassSrc);
  if (attrs.packagesSrc !== null) parts.push(attrs.packagesSrc);
  const rest = attrs.src.replace(/^\s+/, "").replace(/\s+$/, "");
  if (rest.length > 0) parts.push(rest);
  if (attrs.titleSrc !== null) parts.push(attrs.titleSrc);
  if (attrs.authorSrc !== null) parts.push(attrs.authorSrc);
  if (attrs.dateSrc !== null) parts.push(attrs.dateSrc);
  return parts.join("\n");
}

/**
 * The preamble in its source order. Each slot of the layout is mapped
 * from the parsed raw rest onto the current one (which the raw editor
 * or `\newtheorem` insertion may have changed) and gets its command
 * back; a removed command takes its line along. Packages appended
 * after parsing follow the last parsed one; if the package list was
 * otherwise changed, it all goes to the first package's place.
 * Commands with no slot go where the canonical order puts them.
 */
function layoutPreamble(attrs: PreambleAttrs, layout: PreambleLayout): string {
  const src = attrs.src;
  const at = offsetMapper(layout.src, src);

  const parsed = layout.packages.join("\n");
  const current = attrs.packagesSrc;
  let packages: (string | null)[];
  let extra: string | null = null;
  if (current === null) {
    packages = [];
  } else if (layout.packages.length > 0 && current === parsed) {
    packages = layout.packages;
  } else if (layout.packages.length > 0 && current.startsWith(`${parsed}\n`)) {
    packages = layout.packages;
    extra = current.slice(parsed.length + 1);
  } else {
    packages = [current];
  }

  // Insertions per offset into `src`, in order; null drops a line.
  const inserts = new Map<number, (string | null)[]>();
  const insert = (offset: number, value: string | null) => {
    const list = inserts.get(offset) ?? [];
    list.push(value);
    inserts.set(offset, list);
  };
  const placed = new Set<PreambleSlot>();
  let packageIndex = 0;
  let lastPackageAt: number | null = null;
  for (const { slot, at: offset } of layout.slots) {
    const pos = at(offset);
    if (slot === "packagesSrc") {
      const value = packages[packageIndex++] ?? null;
      insert(pos, value);
      if (value !== null) lastPackageAt = pos;
    } else {
      insert(pos, attrs[slot]);
      placed.add(slot);
    }
  }
  if (extra !== null && lastPackageAt !== null) {
    insert(lastPackageAt, `\n${extra}`);
    extra = null;
  }
  // A package list with no parsed slot left to hold it goes right
  // after the document class.
  const unplaced = packageIndex === 0 ? current : extra;
  const classSlot = layout.slots.find((s) => s.slot === "documentclassSrc");
  const head: string[] = [];
  if (attrs.documentclassSrc !== null && classSlot === undefined) {
    head.push(attrs.documentclassSrc);
  }
  if (unplaced !== null) {
    if (classSlot !== undefined && attrs.documentclassSrc !== null) {
      insert(at(classSlot.at), `\n${unplaced}`);
    } else {
      head.push(unplaced);
    }
  }

  let out = "";
  for (let i = 0; i <= src.length; i++) {
    const values = inserts.get(i) ?? [];
    for (const value of values) if (value !== null) out += value;
    if (i === src.length) break;
    // A dropped command takes its line break along.
    const dropped = values.length > 0 && values.every((v) => v === null);
    if (dropped && src[i] === "\n" && (out.length === 0 || out.endsWith("\n")))
      continue;
    out += src[i];
  }

  const tail: string[] = [];
  for (const slot of ["titleSrc", "authorSrc", "dateSrc"] as const) {
    const value = attrs[slot];
    if (value !== null && !placed.has(slot)) tail.push(value);
  }
  const body = out.replace(/^\s+/, "").replace(/\s+$/, "");
  return [...head, body, ...tail].filter((part) => part.length > 0).join("\n");
}

/**
 * Map offsets in `before` onto `after`, assuming one contiguous edit:
 * offsets in the common prefix stay, those in the common suffix shift
 * by the length change, and those inside the edit land at its start.
 */
function offsetMapper(before: string, after: string): (offset: number) => number {
  if (before === after) return (offset) => offset;
  const max = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < max && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }
  const delta = after.length - before.length;
  return (offset) => {
    if (offset <= prefix) return offset;
    if (offset >= before.length - suffix) return offset + delta;
    return prefix;
  };
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
