/**
 * Floats in a LaTeX source — figures, tables, listings, algorithms —
 * with their caption, label, and first graphic, for the floats
 * navigator. Comment-aware; nested floats (e.g. a subfigure's own
 * environment) are not listed separately.
 */

export type FloatKind = "figure" | "table" | "listing" | "algorithm";

export interface FloatInfo {
  kind: FloatKind;
  /** The environment name, e.g. "figure*" or "wraptable". */
  env: string;
  /** 1-based line of \begin. */
  line: number;
  /** The \caption text (long form), or null when there is none. */
  caption: string | null;
  label: string | null;
  /** The first \includegraphics path, if any. */
  graphic: string | null;
}

const KIND_OF_ENV: Record<string, FloatKind> = {
  figure: "figure",
  "figure*": "figure",
  wrapfigure: "figure",
  sidewaysfigure: "figure",
  table: "table",
  "table*": "table",
  wraptable: "table",
  sidewaystable: "table",
  listing: "listing",
  algorithm: "algorithm",
};

/** Blank out % comments (keeping offsets), escape-aware. */
function stripComments(source: string): string {
  return source.replace(/(^|[^\\])((?:\\\\)*)%[^\n]*/g, (match, pre: string, esc: string) =>
    pre + esc + " ".repeat(match.length - pre.length - esc.length),
  );
}

/** The balanced {...} group starting at `open`, or null. */
function bracedAt(text: string, open: number): { body: string; end: number } | null {
  if (text[open] !== "{") return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { body: text.slice(open + 1, i), end: i + 1 };
    }
  }
  return null;
}

/** The body without its subfigure/subtable environments. */
function outerPart(body: string): string {
  return body.replace(/\\begin\{(sub(?:figure|table))\}[\s\S]*?\\end\{\1\}/g, "");
}

function labelOf(body: string): string | null {
  const label = /\\label\s*\{([^}]*)\}/.exec(body)?.[1].trim();
  return label === undefined || label === "" ? null : label;
}

/** The long caption text of the first \caption in the text. */
function captionOf(body: string): string | null {
  const m = /\\caption\*?\s*(?:\[[^\]]*\]\s*)?(?=\{)/.exec(body);
  if (m === null) return null;
  const group = bracedAt(body, m.index + m[0].length);
  if (group === null) return null;
  const text = group.body.replace(/\\label\{[^}]*\}/g, "").replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

/** All floats in document order. */
export function parseFloats(source: string): FloatInfo[] {
  const text = stripComments(source);
  const out: FloatInfo[] = [];
  const beginRe = /\\begin\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = beginRe.exec(text)) !== null) {
    const env = m[1].trim();
    const kind = KIND_OF_ENV[env];
    if (kind === undefined) continue;
    const endTag = `\\end{${env}}`;
    // Same-name nesting is rare; take the first matching \end.
    const endAt = text.indexOf(endTag, beginRe.lastIndex);
    const bodyEnd = endAt === -1 ? text.length : endAt;
    const body = text.slice(beginRe.lastIndex, bodyEnd);
    // The float's own caption and label (outside subfigures) win;
    // else the first one anywhere in the body.
    const outer = outerPart(body);
    const graphic =
      /\\includegraphics\*?\s*(?:\[[^\]]*\]\s*)*\{([^}]*)\}/.exec(body)?.[1].trim() ?? null;
    out.push({
      kind,
      env,
      line: text.slice(0, m.index).split("\n").length,
      caption: captionOf(outer) ?? captionOf(body),
      label: labelOf(outer) ?? labelOf(body),
      graphic: graphic === "" ? null : graphic,
    });
    if (endAt !== -1) beginRe.lastIndex = endAt + endTag.length;
  }
  return out;
}
