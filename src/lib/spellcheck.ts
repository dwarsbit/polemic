import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { checkWords } from "@/lib/tauri";

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

/** Commands whose brace arguments are identifiers, not prose. */
const NON_PROSE_COMMANDS = new Set([
  "label",
  "ref",
  "eqref",
  "cite",
  "citep",
  "citet",
  "usepackage",
  "documentclass",
  "includegraphics",
  "graphicspath",
  "input",
  "include",
  "bibliography",
  "addbibresource",
  "bibliographystyle",
  "url",
  "href",
  "hypersetup",
  "setlength",
  "setcounter",
  "newcommand",
  "renewcommand",
  "providecommand",
  "DeclareMathOperator",
]);

const CONTRACTION_SUFFIXES = new Set(["s", "t", "re", "ve", "ll", "d", "m"]);

/** Is the brace at position `i` the argument of a non-prose command? */
function isNonProseBrace(text: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && /[A-Za-z@*]/.test(text[j])) j--;
  const identifier = text.slice(j + 1, i);
  if (identifier === "begin" || identifier === "end") {
    return j >= 0 && text[j] === "\\";
  }
  if (j >= 0 && text[j] === "\\" && NON_PROSE_COMMANDS.has(identifier)) {
    return true;
  }
  return false;
}

/**
 * Extract candidate word ranges for spellchecking. Skips the preamble,
 * commands, math (inline $ and the common math environments), comments,
 * environment names, and identifier arguments of non-prose commands.
 */
export function extractWordRanges(text: string): WordRange[] {
  const beginDoc = text.indexOf("\\begin{document}");
  const start = beginDoc === -1 ? 0 : beginDoc + "\\begin{document}".length;
  // LaTeX ignores everything after \end{document}; so does the spellcheck.
  const endDoc = text.indexOf("\\end{document}", start);
  const end = endDoc === -1 ? text.length : endDoc;
  const ranges: WordRange[] = [];
  const braceStack: boolean[] = [];
  let inlineMath = false;
  let comment = false;

  let i = start;
  while (i < end) {
    const ch = text[i];
    if (ch === "\n") {
      comment = false;
      i++;
      continue;
    }
    if (comment) {
      i++;
      continue;
    }
    if (ch === "%") {
      comment = true;
      i++;
      continue;
    }
    if (ch === "$" && (i === 0 || text[i - 1] !== "\\")) {
      inlineMath = !inlineMath;
      i++;
      continue;
    }
    if (ch === "{" && !inlineMath) {
      braceStack.push(isNonProseBrace(text, i));
      i++;
      continue;
    }
    if (ch === "}" && !inlineMath) {
      braceStack.pop();
      i++;
      continue;
    }
    if (!inlineMath && !braceStack.includes(true) && /[A-Za-z]/.test(ch)) {
      const isCommandName = i > 0 && text[i - 1] === "\\";
      if (isCommandName) {
        i++;
        continue;
      }
      // Consume letters, then (apostrophe + letters)* groups.
      let j = i;
      while (j < text.length && /[A-Za-z]/.test(text[j])) j++;
      const segments: string[] = [text.slice(i, j)];
      while (j < text.length && text[j] === "'" && /[A-Za-z]/.test(text[j + 1] ?? "")) {
        j++;
        const segStart = j;
        while (j < text.length && /[A-Za-z]/.test(text[j])) j++;
        segments.push(text.slice(segStart, j));
      }
      const token = segments.join("'");
      if (!(token.length > 1 && token === token.toUpperCase())) {
        ranges.push({ from: i, to: i + segments[0].length, word: segments[0] });
        let pos = i + segments[0].length;
        for (let k = 1; k < segments.length; k++) {
          pos += 1;
          if (
            segments[k].length > 1 ||
            !CONTRACTION_SUFFIXES.has(segments[k].toLowerCase())
          ) {
            ranges.push({ from: pos, to: pos + segments[k].length, word: segments[k] });
          }
          pos += segments[k].length;
        }
      }
      i = j;
      continue;
    }
    // Math environment bodies are skipped wholesale until the matching \end.
    if (ch === "\\" && text.startsWith("\\begin{", i)) {
      const envName = /^\\begin\{([a-zA-Z*]+)\}/.exec(text.slice(i));
      if (envName && MATH_ENVIRONMENTS.has(envName[1])) {
        const endPattern = `\\end{${envName[1]}}`;
        const endIdx = text.indexOf(endPattern, i);
        i = endIdx === -1 ? text.length : endIdx;
        continue;
      }
    }
    i++;
  }
  return ranges;
}

const MATH_ENVIRONMENTS = new Set([
  "equation",
  "equation*",
  "align",
  "align*",
  "alignat",
  "alignat*",
  "gather",
  "gather*",
  "math",
  "displaymath",
  "eqnarray",
  "eqnarray*",
  "multline",
  "multline*",
]);

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
  const misspelled: { from: number; to: number }[] = [];
  for (const range of ranges) {
    if (knownWords.get(range.word.toLowerCase()) === false) {
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
