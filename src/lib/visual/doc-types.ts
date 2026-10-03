/**
 * The Tiptap-compatible JSON shapes produced by `parseTex` and consumed
 * by `serializeTex`. The visual editor's document is exactly this tree,
 * so parse and serialize stay testable without a DOM.
 *
 * Anything the schema does not model is carried verbatim in a `src`
 * attribute (Overleaf's "unparseable" pattern): nothing is ever lost,
 * and untouched fallbacks round-trip byte-for-byte.
 */

export type MarkType = "bold" | "italic" | "code" | "underline" | "comment";

export interface Mark {
  type: MarkType;
  /** The LaTeX command the mark came from, e.g. "textbf" or "emph". */
  attrs?: { cmd?: string };
}

export interface TextNode {
  type: "text";
  text: string;
  marks?: Mark[];
}

/** A `\\`, `\\*`, or `\\[len]` line break inside a paragraph. */
export interface HardBreakNode {
  type: "hardBreak";
  attrs: { src: string };
}

/** Inline math; `src` includes its delimiters, e.g. `$x^2$` or `\(x\)`. */
export interface MathInlineNode {
  type: "mathInline";
  attrs: { src: string };
}

/** A citation command such as `\cite[p.~3]{key}`, verbatim. */
export interface CiteNode {
  type: "cite";
  attrs: { src: string };
}

/** A reference command such as `\ref{eq:foo}`, verbatim. */
export interface RefNode {
  type: "ref";
  attrs: { src: string };
}

/** A `\label{...}` node, verbatim. */
export interface LabelNode {
  type: "label";
  attrs: { src: string };
}

/** An unmodelled inline construct (`\footnote{...}`, `\LaTeX`, ...), verbatim. */
export interface RawInlineNode {
  type: "rawTexInline";
  attrs: { src: string };
}

export type Inline =
  | TextNode
  | HardBreakNode
  | MathInlineNode
  | CiteNode
  | RefNode
  | LabelNode
  | RawInlineNode;

/**
 * The file's preamble, split into the pieces the visual editor models.
 * Everything that stays raw (`src`: comments, `\newcommand`s, geometry,
 * …) round-trips verbatim; the extracted commands are re-serialized in
 * a canonical order.
 */
export interface PreambleAttrs {
  /** `\documentclass[11pt,a4paper]{article}`, verbatim, or null. */
  documentclassSrc: string | null;
  /** All `\usepackage` lines joined by newlines, verbatim, or null. */
  packagesSrc: string | null;
  /** `\title{…}`, verbatim, or null. */
  titleSrc: string | null;
  /** `\author{…}`, verbatim, or null. */
  authorSrc: string | null;
  /** `\date{…}`, verbatim, or null. */
  dateSrc: string | null;
  /** The remaining preamble, verbatim. */
  src: string;
}

export interface PreambleNode {
  type: "preamble";
  attrs: PreambleAttrs;
}

/** A `\maketitle` in the body: rendered as the document's title card. */
export interface TitleBlockNode {
  type: "titleBlock";
  attrs: { src: string };
}

export interface HeadingNode {
  type: "heading";
  attrs: {
    /** 1 (part) … 6 (subparagraph); display only, serialization uses `cmd`. */
    level: number;
    /** Sectioning command without the backslash, e.g. "section" or "section*". */
    cmd: string;
    /** Short-title optional argument, e.g. `[short]`. */
    opt?: string;
  };
  content: Inline[];
}

export interface ParagraphNode {
  type: "paragraph";
  content: Inline[];
}

/** Display math; `src` is the whole construct (`\[...\]`, `$$...$$`, or the env), verbatim. */
export interface MathBlockNode {
  type: "mathBlock";
  attrs: { src: string };
}

/** A float environment (figure, table, ...); `src` verbatim, rendered with a thumbnail. */
export interface FigureBlockNode {
  type: "figureBlock";
  attrs: { src: string };
}

/**
 * A modeled environment (quote, quotation, center, abstract, and the
 * theorem family): its body is parsed content, not a verbatim blob.
 * Everything unmodeled stays `rawTexBlock`.
 */
export interface EnvBlockNode {
  type: "envBlock";
  attrs: {
    /** The environment name, e.g. "quote" or "theorem". */
    env: string;
    /** The optional argument right after `\begin{env}[...]`, e.g. a theorem title. */
    opt: string | null;
  };
  content: Block[];
}

/** An unmodelled block (verbatim env, tikzpicture, theorem, standalone commands), verbatim. */
export interface RawBlockNode {
  type: "rawTexBlock";
  attrs: { src: string };
}

export interface ListNode {
  type: "bulletList" | "orderedList";
  content: ListItemNode[];
}

export interface ListItemNode {
  type: "listItem";
  attrs: { label?: string };
  content: Block[];
}

export type Block =
  | PreambleNode
  | TitleBlockNode
  | HeadingNode
  | ParagraphNode
  | MathBlockNode
  | FigureBlockNode
  | EnvBlockNode
  | RawBlockNode
  | ListNode;

export interface DocAttrs {
  /** Whether the file is wrapped in `\begin{document}...\end{document}`. */
  wrapped: boolean;
  /** Everything after `\end{document}`, verbatim (usually empty). */
  postamble: string;
}

export interface DocNode {
  type: "doc";
  attrs?: DocAttrs;
  content: Block[];
}
