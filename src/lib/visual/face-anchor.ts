/**
 * Keeping your place when the Visual/Code face flips: an anchor holds
 * the nearest sectioning command's index plus the text at the cursor,
 * and each face resolves it approximately — heading granularity with
 * a text match, silently doing nothing when the text is gone.
 */

import type { Node as PMNode } from "@tiptap/pm/model";

export interface FaceAnchor {
  /** How many sectioning commands precede (or contain) the cursor;
   *  -1 means before the first one. */
  headingIndex: number;
  /** The trimmed text block at the cursor, capped; "" when none. */
  text: string;
}

let anchor: FaceAnchor | null = null;

/** Store the anchor written by the face being left. */
export function setFaceAnchor(next: FaceAnchor | null): void {
  anchor = next;
}

/** Take (and clear) the anchor for the face being entered. */
export function takeFaceAnchor(): FaceAnchor | null {
  const taken = anchor;
  anchor = null;
  return taken;
}

/** Sectioning command lines, 1-based line numbers, in order. */
export function headingLines(content: string): number[] {
  const re = /^\s*\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*[{[]/;
  const lines: number[] = [];
  const split = content.split("\n");
  for (let i = 0; i < split.length; i++) {
    if (re.test(split[i]!)) lines.push(i + 1);
  }
  return lines;
}

/** The first N characters of a line's text, comment-stripped. */
export function lineText(content: string, line: number, max = 60): string {
  const raw = content.split("\n")[line - 1] ?? "";
  const bare = raw.replace(/%.*$/, "").trim();
  return bare.slice(0, max);
}

/** The 1-based line the anchor points at in the given source, or null. */
export function lineForAnchor(content: string, a: FaceAnchor): number | null {
  const headings = headingLines(content);
  if (a.headingIndex >= headings.length) return null;
  const from = headings[a.headingIndex]!;
  if (a.text.length === 0) return from;
  const needle = a.text.slice(0, 24);
  const split = content.split("\n");
  for (let line = from; line <= split.length; line++) {
    if (lineText(content, line).startsWith(needle)) return line;
  }
  return from;
}

/**
 * The anchor for a 1-based source line: the heading it sits in (or
 * is), plus the line's text. Heading lines anchor with empty text, so
 * they land right after themselves; lines before the first heading
 * carry headingIndex -1.
 */
export function anchorForLine(content: string, line: number): FaceAnchor {
  const headings = headingLines(content);
  let index = -1;
  for (let i = 0; i < headings.length; i++) {
    if (headings[i]! <= line) index = i;
    else break;
  }
  if (index === -1) return { headingIndex: -1, text: lineText(content, line) };
  if (headings[index]! === line) return { headingIndex: index, text: "" };
  return { headingIndex: index, text: lineText(content, line) };
}

/**
 * The doc position of the anchor in a parsed visual document: after
 * the heading it names, inside the paragraph containing its text when
 * findable. Null when the heading is gone.
 */
export function posForAnchor(doc: PMNode, a: FaceAnchor): number | null {
  if (a.headingIndex === -1) {
    // Before the first heading: the doc start, or the first paragraph
    // matching the text from the top.
    if (a.text.length === 0) return 1;
    const needle = a.text.slice(0, 24);
    let match: number | null = null;
    doc.descendants((node, pos) => {
      if (match !== null) return false;
      if (node.type.name === "paragraph" && node.textContent.includes(needle)) {
        match = pos + 1;
        return false;
      }
      return true;
    });
    return match ?? 1;
  }
  let headingEnd: number | null = null;
  let index = -1;
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      index++;
      if (index === a.headingIndex) {
        headingEnd = pos + node.nodeSize;
        return false;
      }
    }
    return true;
  });
  if (headingEnd === null) return null;
  if (a.text.length === 0) return headingEnd;
  const needle = a.text.slice(0, 24);
  let match: number | null = null;
  doc.descendants((node, pos) => {
    if (match !== null) return false;
    if (pos < headingEnd!) return true;
    if (node.type.name === "paragraph" && node.textContent.includes(needle)) {
      match = pos + 1;
      return false;
    }
    return true;
  });
  return match ?? headingEnd;
}
