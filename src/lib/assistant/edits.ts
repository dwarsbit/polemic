/**
 * The assistant's proposed changes: find/replace pairs checked against
 * a file's current text, and a word comparison of the prose before and
 * after, so a change in Syntax mode can say when it touches the text,
 * and the checks that keep a Prose mode change to rewording.
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

/** Commands whose argument names something: a citation, reference,
 *  label, environment or file. The whole call, options included. */
const NAMING_RE =
  /\\(?:[a-zA-Z]*(?:cite|ref)[a-zA-Z]*|label|begin|end|input|include|includegraphics)\*?\s*(?:\[[^\]]*\]\s*)*\{[^}]*\}/g;
const MATH_RE =
  /\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\\])+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\\begin\{(equation|align|gather|multline|eqnarray|math|displaymath)(\*?)\}[\s\S]*?\\end\{\1\2\}/g;
const COMMAND_RE = /\\(?:[a-zA-Z@]+\*?|[^a-zA-Z@\s])/g;
const NUMBER_RE = /\d+(?:[.,]\d+)*/g;
const NEGATIONS = new Set([
  "not",
  "no",
  "never",
  "none",
  "nor",
  "neither",
  "nobody",
  "nothing",
  "nowhere",
  "cannot",
]);
const PARAGRAPH_BREAK_RE = /\n[ \t]*\n/g;
const PARAGRAPH_BREAK = /\n[ \t]*\n/;

function sameMultiset(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const x of a) counts.set(x, (counts.get(x) ?? 0) + 1);
  for (const x of b) {
    const left = counts.get(x) ?? 0;
    if (left === 0) return false;
    counts.set(x, left - 1);
  }
  return true;
}

const matches = (text: string, re: RegExp) =>
  [...text.matchAll(re)].map((m) => m[0].replace(/\s+/g, " "));

function negations(text: string): number {
  return proseWords(text).filter((word) => {
    const w = word.toLowerCase().replace(/’/g, "'");
    return NEGATIONS.has(w) || w.endsWith("n't");
  }).length;
}

/** Which paragraph of `text` the offset falls in, counted from 0. */
function paragraphAt(text: string, at: number): number {
  return [...text.slice(0, at).matchAll(PARAGRAPH_BREAK_RE)].length;
}

/**
 * Why a change goes beyond rewording, for Prose mode: it edits a file
 * other than a .tex file, spans paragraphs, or changes a citation,
 * reference, label, math, a number, a negation or a command. Null when
 * it only rewords. Says "this change …", to finish a sentence.
 */
export function proseViolation(
  path: string,
  before: string,
  after: string,
  edits: SourceEdit[],
): string | null {
  if (!path.toLowerCase().endsWith(".tex") || before === "")
    return "edits a file other than your text";
  const paragraphs = new Set(edits.map((e) => paragraphAt(before, e.from)));
  const breaks = edits.some(
    (e) =>
      PARAGRAPH_BREAK.test(before.slice(e.from, e.to)) ||
      PARAGRAPH_BREAK.test(e.insert),
  );
  if (paragraphs.size > 1 || breaks) return "spans more than one paragraph";
  if (!sameMultiset(matches(before, NAMING_RE), matches(after, NAMING_RE)))
    return "changes a citation, reference or label";
  if (!sameMultiset(matches(before, MATH_RE), matches(after, MATH_RE)))
    return "changes math";
  if (!sameMultiset(matches(before, NUMBER_RE), matches(after, NUMBER_RE)))
    return "changes a number";
  if (negations(before) !== negations(after)) return "adds or drops a negation";
  if (!sameMultiset(matches(before, COMMAND_RE), matches(after, COMMAND_RE)))
    return "changes a command";
  return null;
}
