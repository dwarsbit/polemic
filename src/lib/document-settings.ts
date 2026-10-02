/**
 * Document-level settings (class, font size, paper, columns, draft
 * mode, title metadata) of the main `.tex` file — read and applied on
 * the file's text, independent of any editor instance. The visual
 * editor's preamble node and the settings dialog are both views over
 * this, sharing `splitPreamble` / `preambleText` with the parser.
 */

import { splitPreamble } from "./visual/parse";
import { preambleText } from "./visual/serialize";
import type { PreambleAttrs } from "./visual/doc-types";

/** Option tokens the settings UI owns; the rest stay verbatim. */
const FONT_SIZES = ["10pt", "11pt", "12pt"];
const PAPER_SIZES = ["a4paper", "letterpaper", "a5paper", "legalpaper"];
const COLUMN_OPTS = ["onecolumn", "twocolumn"];
const DRAFT_OPTS = ["draft", "final"];
const MANAGED = new Set([...FONT_SIZES, ...PAPER_SIZES, ...COLUMN_OPTS, ...DRAFT_OPTS]);

/** The settings shown in the dialog. */
export interface DocumentSettings {
  className: string;
  /** Font size option, "" for the class default. */
  fontSize: string;
  /** Paper size option, "" for the class default. */
  paper: string;
  /** Two-column layout. */
  twoColumn: boolean;
  /** Draft mode (large margins, no floats). */
  draft: boolean;
  /** Options outside the four controls, comma-separated, verbatim. */
  customOptions: string;
  /** Title metadata; empty means the command is absent. */
  title: string;
  author: string;
  date: string;
  /** How many \usepackage lines the preamble declares. */
  packageCount: number;
}

/** The options list of a `\documentclass[...]{...}` source line. */
function parseOptions(documentclassSrc: string | null): string[] {
  if (documentclassSrc === null) return [];
  const m = /\\documentclass\[([^\]]*)\]/.exec(documentclassSrc);
  if (m === null) return [];
  return m[1].split(",").map((opt) => opt.trim()).filter((opt) => opt.length > 0);
}

function classNameOf(documentclassSrc: string | null): string {
  if (documentclassSrc === null) return "";
  const m = /\\documentclass(?:\[[^\]]*\])?\{([^}]*)\}/.exec(documentclassSrc);
  return m === null ? "" : m[1];
}

/** The inner `{…}` of a command source, or "" when absent. */
function innerOf(src: string | null): string {
  if (src === null) return "";
  const m = /^\s*\\[a-zA-Z]+\*?\s*(?:\[[^\]]*\])?\s*\{([\s\S]*)\}\s*$/.exec(src);
  return m === null ? src : m[1].trim();
}

/**
 * The document settings of a `.tex` file, or null when the file has no
 * `\documentclass` (nothing to configure).
 */
export function readDocumentSettings(content: string): DocumentSettings | null {
  const beginIdx = content.indexOf("\\begin{document}");
  if (beginIdx === -1) return null;
  const attrs = splitPreamble(content.slice(0, beginIdx));
  if (attrs.documentclassSrc === null) return null;
  const options = parseOptions(attrs.documentclassSrc);
  return {
    className: classNameOf(attrs.documentclassSrc),
    fontSize: FONT_SIZES.find((opt) => options.includes(opt)) ?? "",
    paper: PAPER_SIZES.find((opt) => options.includes(opt)) ?? "",
    twoColumn: options.includes("twocolumn"),
    draft: options.includes("draft"),
    customOptions: options.filter((opt) => !MANAGED.has(opt)).join(", "),
    title: innerOf(attrs.titleSrc),
    author: innerOf(attrs.authorSrc),
    date: innerOf(attrs.dateSrc),
    packageCount:
      attrs.packagesSrc === null
        ? 0
        : attrs.packagesSrc.split("\n").filter((line) => line.trim().length > 0).length,
  };
}

/** Apply settings to a file's content; null when nothing can be applied. */
export function applyDocumentSettings(
  content: string,
  next: Omit<DocumentSettings, "packageCount">,
): string | null {
  const beginIdx = content.indexOf("\\begin{document}");
  if (beginIdx === -1) return null;
  const attrs: PreambleAttrs = splitPreamble(content.slice(0, beginIdx));
  if (attrs.documentclassSrc === null) return null;

  const options: string[] = [];
  if (next.fontSize !== "") options.push(next.fontSize);
  if (next.paper !== "") options.push(next.paper);
  if (next.twoColumn) options.push("twocolumn");
  if (next.draft) options.push("draft");
  for (const opt of next.customOptions.split(",")) {
    const trimmed = opt.trim();
    if (trimmed.length > 0) options.push(trimmed);
  }

  attrs.documentclassSrc =
    `\\documentclass${options.length > 0 ? `[${options.join(", ")}]` : ""}{${next.className}}`;
  attrs.titleSrc = next.title.trim().length > 0 ? `\\title{${next.title}}` : null;
  attrs.authorSrc = next.author.trim().length > 0 ? `\\author{${next.author}}` : null;
  attrs.dateSrc = next.date.trim().length > 0 ? `\\date{${next.date}}` : null;

  const rest = content.slice(beginIdx);
  return preambleText(attrs) + rest;
}
