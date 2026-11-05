/**
 * The assistant's proposed changes: find/replace pairs checked against
 * a file's current text, and a word comparison of the prose before and
 * after, so a change in LaTeX mode can say when it touches the text.
 * Pure: no app state.
 */

import { applyEdits, type SourceEdit } from "@/lib/label-index";
import { extractProse } from "@/lib/prose";

export interface Replacement {
  find: string;
  replace: string;
}

export type PlannedEdits = { edits: SourceEdit[]; after: string } | { error: string };

/**
 * Edits for the replacements against `text`. Every `find` must occur
 * exactly once, and no two may overlap; the error says what to fix, so
 * the model can try again. An empty `find` on an empty file writes the
 * whole file (a new file).
 */
export function planReplacements(
  text: string,
  replacements: Replacement[],
): PlannedEdits {
  if (replacements.length === 0) return { error: "No replacements were given." };
  if (text === "" && replacements.length === 1 && replacements[0].find === "") {
    const insert = replacements[0].replace;
    return { edits: [{ from: 0, to: 0, insert }], after: insert };
  }
  const edits: SourceEdit[] = [];
  for (const [index, { find, replace }] of replacements.entries()) {
    const n = index + 1;
    if (find === "") {
      return {
        error: `Replacement ${n} has an empty "find"; quote the text to change.`,
      };
    }
    const at = text.indexOf(find);
    if (at === -1) {
      return {
        error: `Replacement ${n}: "find" does not occur in the file. Copy it exactly from read_file, without the line numbers.`,
      };
    }
    if (text.indexOf(find, at + 1) !== -1) {
      return {
        error: `Replacement ${n}: "find" occurs more than once. Include more of the surrounding text so it is unique.`,
      };
    }
    const edit = { from: at, to: at + find.length, insert: replace };
    if (edits.some((e) => edit.from < e.to && e.from < edit.to)) {
      return { error: `Replacement ${n} overlaps an earlier one; merge them.` };
    }
    edits.push(edit);
  }
  return { edits, after: applyEdits(text, edits) };
}

/** The words of a LaTeX source's prose, in order. */
export function proseWords(source: string): string[] {
  return extractProse(source)
    .flatMap((block) => block.text.split(/[^\p{L}\p{N}'’-]+/u))
    .filter((word) => /[\p{L}\p{N}]/u.test(word));
}

export interface ProseChange {
  removed: string[];
  added: string[];
}

/**
 * The prose words a change removes and adds (as multisets), or null
 * when the text reads the same. Markup-only changes return null.
 */
export function proseChange(before: string, after: string): ProseChange | null {
  const counts = new Map<string, number>();
  for (const word of proseWords(before)) counts.set(word, (counts.get(word) ?? 0) + 1);
  const added: string[] = [];
  for (const word of proseWords(after)) {
    const left = counts.get(word) ?? 0;
    if (left > 0) counts.set(word, left - 1);
    else added.push(word);
  }
  const removed = [...counts.entries()].flatMap(([word, n]) =>
    Array<string>(n).fill(word),
  );
  if (removed.length === 0 && added.length === 0) return null;
  return { removed, added };
}

/** A short line naming the changed words, for the warning on a card. */
export function describeProseChange(change: ProseChange, limit = 6): string {
  const list = (words: string[]) => {
    const shown = words
      .slice(0, limit)
      .map((w) => `“${w}”`)
      .join(", ");
    return words.length > limit ? `${shown} and ${words.length - limit} more` : shown;
  };
  const parts: string[] = [];
  if (change.removed.length > 0) parts.push(`removes ${list(change.removed)}`);
  if (change.added.length > 0) parts.push(`adds ${list(change.added)}`);
  return `This change edits your text: it ${parts.join(" and ")}.`;
}
