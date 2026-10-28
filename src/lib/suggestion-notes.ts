/**
 * Notes on suggestions (`comment=` in the markup) as the Comments panel
 * and gutter show them, next to ordinary comments. A note is found by
 * its key, the author and the note text: replies in comments.json carry
 * that key, so a thread follows its suggestion while the suggested text
 * is edited, and is resolved when the suggestion is accepted or
 * rejected.
 */

import { parseChanges, type Change } from "@/lib/changes";

export interface SuggestionNote {
  file: string;
  key: string;
  note: string;
  author: string | null;
  kind: Change["kind"];
  /** The suggestion's start in the file. */
  at: number;
  /** 1-based line of the suggestion. */
  line: number;
}

/** The key of a note: who wrote the suggestion, and the note. */
export const noteKey = (author: string | null, note: string) =>
  `${author ?? ""}\u0000${note}`;

/** Every suggestion with a note in a file, in document order. */
export function notesIn(file: string, source: string): SuggestionNote[] {
  const notes: SuggestionNote[] = [];
  for (const change of parseChanges(source)) {
    if (change.note === null || change.kind === "highlight") continue;
    notes.push({
      file,
      key: noteKey(change.author, change.note),
      note: change.note,
      author: change.author,
      kind: change.kind,
      at: change.range.from,
      line: source.slice(0, change.range.from).split("\n").length,
    });
  }
  return notes;
}

/** The suggestion a note key points at in a source, or null. */
export function changeForNote(source: string, key: string): Change | null {
  return (
    parseChanges(source).find(
      (c) => c.note !== null && noteKey(c.author, c.note) === key,
    ) ?? null
  );
}
