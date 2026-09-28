/**
 * Greedy subsequence fuzzy matcher for palette-style search.
 * Case-insensitive; spaces in the query are skipped so "open main"
 * matches "Open: main.tex". Prefers prefix matches, matches after
 * path/word separators, and consecutive runs.
 */

export interface FuzzyResult {
  score: number;
  /** Indices of matched characters in the target, for highlighting. */
  indices: number[];
}

const SEPARATOR = /[/._\- :]/;

export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  if (!q) return { score: 0, indices: [] };

  let score = 0;
  let cursor = 0;
  let lastMatch = -2;
  const indices: number[] = [];

  for (const ch of q) {
    if (ch === " ") continue;
    const found = t.indexOf(ch, cursor);
    if (found === -1) return null;

    let bonus = 1;
    if (found === 0) bonus += 8;
    else if (SEPARATOR.test(t[found - 1])) bonus += 4;
    if (found === lastMatch + 1) bonus += 6;
    // Slight penalty for spreading matches far apart.
    bonus -= (found - cursor) * 0.1;

    score += bonus;
    indices.push(found);
    lastMatch = found;
    cursor = found + 1;
  }

  // Prefer shorter targets when scores are otherwise equal.
  score -= t.length * 0.01;

  return { score, indices };
}

export interface FuzzyItem<T> {
  item: T;
  score: number;
  indices: number[];
}

/** Sort entries by their best-matching field; unmatched entries are dropped. */
export function fuzzyRank<T>(
  query: string,
  entries: T[],
  fields: (item: T) => string[],
  limit = Infinity,
): FuzzyItem<T>[] {
  const results: FuzzyItem<T>[] = [];
  for (const item of entries) {
    let best: FuzzyResult | null = null;
    for (const field of fields(item)) {
      const result = fuzzyMatch(query, field);
      if (result && (!best || result.score > best.score)) best = result;
    }
    if (best) {
      results.push({ item, score: best.score, indices: best.indices });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
