import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { extractProse, sourceRange } from "@/lib/prose";
import { checkWords } from "@/lib/tauri";
import { useProjectStore } from "@/store/project";

/** Set the misspelled-word decorations for the current document. */
export const setMisspells = StateEffect.define<DecorationSet>();

export const misspellField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setMisspells)) next = effect.value;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const spellcheckExtension = [misspellField];

interface WordRange {
  from: number;
  to: number;
  word: string;
}

const CONTRACTION_SUFFIXES = new Set(["s", "t", "re", "ve", "ll", "d", "m"]);

/** Letters of any script, with apostrophe-joined parts (don't, l'eau). */
const WORD_RE = /\p{L}+(?:['’]\p{L}+)*/gu;

/**
 * Candidate word ranges for spellchecking: the words of the document's
 * prose (see extractProse), so the preamble, commands, math, comments,
 * environment names and identifier arguments are skipped. Acronyms (all
 * capitals) are skipped too, and a contraction's short suffix.
 */
export function extractWordRanges(text: string): WordRange[] {
  const ranges: WordRange[] = [];
  for (const block of extractProse(text)) {
    for (const match of block.text.matchAll(WORD_RE)) {
      const at = match.index;
      const token = match[0];
      if (block.placeholders.some((p) => at < p.to && p.from < at + token.length)) {
        continue;
      }
      if (token.length > 1 && token === token.toUpperCase()) continue;
      let pos = at;
      for (const [k, segment] of token.split(/['’]/).entries()) {
        if (
          k === 0 ||
          segment.length > 1 ||
          !CONTRACTION_SUFFIXES.has(segment.toLowerCase())
        ) {
          ranges.push({
            ...sourceRange(block, pos, pos + segment.length),
            word: segment,
          });
        }
        pos += segment.length + 1;
      }
    }
  }
  return ranges;
}

// Cache of words verified against the dictionary (lowercase -> correct).
const knownWords = new Map<string, boolean>();

export function clearSpellcheckCache() {
  knownWords.clear();
}

/** Check the document and set the misspelled-word decorations. */
export async function runSpellcheck(view: EditorView) {
  const ranges = extractWordRanges(view.state.doc.toString());
  const toCheck = new Set<string>();
  for (const range of ranges) {
    const lower = range.word.toLowerCase();
    if (!knownWords.has(lower)) toCheck.add(lower);
  }
  const words = [...toCheck];
  if (words.length > 0) {
    try {
      const flags = await checkWords(words);
      words.forEach((word, index) => knownWords.set(word, flags[index]));
    } catch {
      return; // spellcheck unavailable (e.g. running in a browser)
    }
  }
  const ignored = new Set(useProjectStore.getState().ignoredWords);
  const misspelled: { from: number; to: number }[] = [];
  for (const range of ranges) {
    const lower = range.word.toLowerCase();
    if (knownWords.get(lower) === false && !ignored.has(lower)) {
      misspelled.push({ from: range.from, to: range.to });
    }
  }
  misspelled.sort((a, b) => a.from - b.from);
  const decorations = misspelled.map((range) =>
    Decoration.mark({ class: "cm-misspelled" }).range(range.from, range.to),
  );
  const set = Decoration.set(decorations, true);
  if (view.state.field(misspellField, false)) {
    view.dispatch({ effects: setMisspells.of(set) });
  }
}

/** The misspelled word at a position, if any. */
export function misspelledWordAt(
  view: EditorView,
  pos: number,
): { from: number; to: number; word: string } | null {
  const iter = view.state.field(misspellField).iter();
  while (iter.value !== null) {
    if (iter.from > pos) break; // decorations are sorted
    if (
      iter.from <= pos &&
      pos < iter.to &&
      iter.value.spec.class === "cm-misspelled"
    ) {
      return {
        from: iter.from,
        to: iter.to,
        word: view.state.doc.sliceString(iter.from, iter.to),
      };
    }
    iter.next();
  }
  return null;
}
