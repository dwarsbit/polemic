/**
 * Inserting LaTeX fragments (panels, dialogs, paste) into the visual
 * editor: parse the snippet with the document parser and hand the
 * nodes to Tiptap, so a figure scaffold arrives as a rendered figure
 * card and a citation as a pill — not as gray text.
 */

import type { JSONContent } from "@tiptap/core";
import { parseTex } from "./parse";

/** Does a plain-text snippet look like LaTeX worth parsing? A stray
 *  backslash-command is the bar; plain prose passes through as text. */
export function looksLikeLatex(text: string): boolean {
  return /\\[a-zA-Z]{2,}/.test(text);
}

/**
 * Parse a LaTeX fragment into insertable Tiptap content: a body of
 * blocks, with a lone paragraph unwrapped to its inline content so
 * citations and symbols land inside the text at the cursor instead
 * of splitting it.
 */
export function fragmentToContent(tex: string): JSONContent[] {
  const doc = parseTex(tex) as unknown as JSONContent;
  const blocks = (doc.content ?? []) as JSONContent[];
  if (blocks.length === 1 && blocks[0]?.type === "paragraph") {
    return (blocks[0].content ?? []) as JSONContent[];
  }
  return blocks;
}
