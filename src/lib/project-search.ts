/**
 * Literal project search and replace over LaTeX sources. The scope
 * filter classifies each match with the math-region detector, so a
 * replace in "math" scope leaves prose untouched and vice versa. Pure:
 * the search panel feeds it file contents and applies the edits.
 */

import type { SourceEdit } from "./label-index";
import { suggestionSkipRanges } from "./changes";
import { findMathRegion } from "./math-region";

export type SearchScope = "all" | "math" | "text";

export interface SearchOptions {
  caseSensitive: boolean;
  scope: SearchScope;
  /** Also match text that a suggestion deletes. Matches in the
   *  suggestions' own markup are never found. */
  includeDeleted?: boolean;
}

export interface LineHit {
  /** 1-based line number. */
  line: number;
  /** The full line text. */
  text: string;
  /** Match ranges within `text`. */
  matches: [number, number][];
  /** Offset of the line's first character in the file. */
  lineStart: number;
}

/** Every line of `text` with a match for `query`, in order. */
export function searchText(
  text: string,
  query: string,
  options: SearchOptions,
): LineHit[] {
  if (query.length === 0) return [];
  // A regex on the original line, not indexOf on a lowercased copy:
  // lowercasing can change a string's length (e.g. "İ"), which would
  // shift every offset after it.
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped, options.caseSensitive ? "g" : "gi");
  const hits: LineHit[] = [];
  // Track changes: the final text is searched (see SearchOptions).
  const skip = text.includes("\\")
    ? suggestionSkipRanges(text, options.includeDeleted)
    : [];
  const skipped = (from: number, to: number) =>
    skip.some((r) => r.from < to && from < r.to);
  let lineStart = 0;
  for (const [index, line] of text.split("\n").entries()) {
    const matches: [number, number][] = [];
    for (const match of line.matchAll(pattern)) {
      const at = match.index;
      const inScope =
        options.scope === "all" ||
        (options.scope === "math") === (findMathRegion(text, lineStart + at) !== null);
      if (inScope && !skipped(lineStart + at, lineStart + at + match[0].length)) {
        matches.push([at, at + match[0].length]);
      }
    }
    if (matches.length > 0)
      hits.push({ line: index + 1, text: line, matches, lineStart });
    lineStart += line.length + 1;
  }
  return hits;
}

/**
 * Edits replacing the matches of `query` with `replacement` (literal),
 * on every line or only on `line` (1-based) when given.
 */
export function replaceEdits(
  text: string,
  query: string,
  replacement: string,
  options: SearchOptions,
  line?: number,
): SourceEdit[] {
  const edits: SourceEdit[] = [];
  for (const hit of searchText(text, query, options)) {
    if (line !== undefined && hit.line !== line) continue;
    for (const [from, to] of hit.matches) {
      edits.push({
        from: hit.lineStart + from,
        to: hit.lineStart + to,
        insert: replacement,
      });
    }
  }
  return edits;
}
