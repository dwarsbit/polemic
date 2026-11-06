/**
 * The spellchecker, for builds without the desktop app's Rust side (the
 * browser build): a port of src-tauri/src/spell.rs, with the same word
 * lists and the same suggestions (spell.test.ts mirrors its tests).
 */

/** Words a downloaded frequency list needs this many uses of to count. */
export const MIN_WORD_FREQUENCY = 5;

/** The words of a hermitdave/FrequencyWords list ("word count" lines). */
export function parseFrequencyList(content: string): string[] {
  const words: string[] = [];
  for (const line of content.split("\n")) {
    const [word, count] = line.trim().split(/\s+/);
    if (word && count && Number(count) >= MIN_WORD_FREQUENCY) {
      words.push(word.toLowerCase());
    }
  }
  return words;
}

/** Optimal string alignment distance, or null when it is above `max`. */
export function editDistance(a: string[], b: string[], max: number): number | null {
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = new Array<number>(b.length + 1).fill(i);
    let best = row[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j], prev2[j - 2] + 1);
      }
      best = Math.min(best, row[j]);
    }
    if (best > max) return null;
    prev2 = prev;
    prev = row;
  }
  const distance = prev[b.length];
  return distance <= max ? distance : null;
}

const isUpper = (c: string) => c !== c.toLowerCase() && c === c.toUpperCase();
const isLower = (c: string) => c !== c.toUpperCase() && c === c.toLowerCase();

/** `word` in the case of `original`: ALL CAPS, Capitalized or as is. */
function matchCase(original: string, word: string): string {
  const chars = [...original];
  const firstUpper = chars.length > 0 && isUpper(chars[0]);
  if (firstUpper && chars.length > 1 && chars.every((c) => !isLower(c))) {
    return word.toUpperCase();
  }
  if (firstUpper) {
    const [first = "", ...rest] = [...word];
    return first.toUpperCase() + rest.join("");
  }
  return word;
}

const CONTRACTION_SUFFIXES = ["s", "t", "re", "ve", "ll", "d", "m", "er"];

/** Compares as Rust's derived tuple order: numbers, then false before true, then strings. */
type Candidate = [number, boolean, boolean, number, string];

function compareCandidates(a: Candidate, b: Candidate): number {
  for (let i = 0; i < 4; i++) {
    if (a[i] !== b[i]) return Number(a[i]) - Number(b[i]);
  }
  return a[4] < b[4] ? -1 : a[4] > b[4] ? 1 : 0;
}

/** Code points in order, as Rust's sorted chars. */
const sortedChars = (chars: string[]) =>
  [...chars].sort((x, y) => x.codePointAt(0)! - y.codePointAt(0)!).join("");

export class SpellState {
  private known: Set<string>;

  constructor(words: Iterable<string>, userWords: readonly string[] = []) {
    this.known = new Set(words);
    for (const word of userWords) this.known.add(word.toLowerCase());
  }

  /** The bundled English list, one word per line. */
  static fromLines(text: string, userWords: readonly string[] = []): SpellState {
    const words: string[] = [];
    for (const line of text.split("\n")) {
      const word = line.trim().toLowerCase();
      if (word) words.push(word);
    }
    return new SpellState(words, userWords);
  }

  check(words: readonly string[]): boolean[] {
    return words.map((word) => this.checkOne(word));
  }

  checkOne(word: string): boolean {
    const lower = word.toLowerCase();
    if (this.known.has(lower)) return true;
    const apostrophe = lower.indexOf("'");
    if (apostrophe >= 0) {
      const stem = lower.slice(0, apostrophe);
      const suffix = lower.slice(apostrophe + 1);
      if (this.known.has(stem) && CONTRACTION_SUFFIXES.includes(suffix)) return true;
    }
    return false;
  }

  /** Corrections for a misspelled word, closest first. */
  suggest(word: string, limit: number): string[] {
    const target = [...word.toLowerCase()];
    const first = target[0];
    const sortedTarget = sortedChars(target);
    const found: Candidate[] = [];
    for (const candidate of this.known) {
      // Cheap length check first: code units bound code points from above.
      if (candidate.length < target.length - 2 || candidate.includes("'")) continue;
      const chars = [...candidate];
      const lengthGap = Math.abs(chars.length - target.length);
      if (lengthGap > 2) continue;
      const distance = editDistance(target, chars, 2);
      if (distance === null || distance === 0) continue;
      found.push([
        distance,
        sortedChars(chars) !== sortedTarget,
        chars[0] !== first,
        lengthGap,
        candidate,
      ]);
    }
    found.sort(compareCandidates);
    return found.slice(0, limit).map((c) => matchCase(word, c[4]));
  }

  add(word: string): void {
    this.known.add(word.toLowerCase());
  }
}
