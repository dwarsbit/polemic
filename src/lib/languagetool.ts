/**
 * The LanguageTool client, for builds without the desktop app's Rust
 * side (the browser build): a port of the LanguageTool half of
 * src-tauri/src/grammar.rs. Blocks are joined into as few /check
 * requests as the endpoint's limit allows, and the matches split back.
 * Offsets are UTF-16 units, as Java and JavaScript count.
 */

import type { GrammarError, GrammarIssue } from "@/lib/tauri";

/** The blank line joining blocks into one request. */
export const SEPARATOR = "\n\n";

/** The Polemic server's limit per check (GRAMMAR_MAX_CHARS). */
export const POLEMIC_MAX_CHARS = 100_000;

/** How long to wait when a 429 carries no usable Retry-After. */
export const DEFAULT_RETRY_AFTER = 60;

/** A match of LanguageTool's /v2/check answer, the parts read here. */
export interface LtMatch {
  message: string;
  offset: number;
  length: number;
  replacements: { value: string }[];
  rule: { id: string; category: { name: string } };
}

/** The blocks as one text, and each block's start in it. */
export function joinBlocks(blocks: readonly string[]): {
  text: string;
  starts: number[];
} {
  let text = "";
  const starts: number[] = [];
  blocks.forEach((block, i) => {
    if (i > 0) text += SEPARATOR;
    starts.push(text.length);
    text += block;
  });
  return { text, starts };
}

/** Matches in the joined text, back into per-block issues. */
export function splitMatches(
  matches: readonly LtMatch[],
  blocks: readonly string[],
  starts: readonly number[],
): GrammarIssue[][] {
  const out: GrammarIssue[][] = blocks.map(() => []);
  for (const m of matches) {
    let index = starts.length - 1;
    while (index >= 0 && starts[index] > m.offset) index--;
    if (index < 0) continue;
    const from = m.offset - starts[index];
    const to = from + m.length;
    if (to > blocks[index].length) continue; // spans the separator
    out[index].push({
      from,
      to,
      message: m.message,
      rule: m.rule.id,
      category: m.rule.category.name,
      replacements: m.replacements.slice(0, 5).map((r) => r.value),
    });
  }
  return out;
}

/** Block indices in requests of at most `max` units once joined; a
 *  block longer than `max` on its own is left out (it gets no issues). */
export function chunkBlocks(blocks: readonly string[], max: number): number[][] {
  const chunks: number[][] = [];
  let current: number[] = [];
  let length = 0;
  blocks.forEach((block, i) => {
    const size = block.length;
    if (size > max) return;
    const added = current.length === 0 ? size : SEPARATOR.length + size;
    if (length + added > max) {
      chunks.push(current);
      current = [];
      length = size;
    } else {
      length += added;
    }
    current.push(i);
  });
  if (current.length > 0) chunks.push(current);
  return chunks;
}

const grammarError = (
  kind: GrammarError["kind"],
  message: string,
  retryAfter: number | null = null,
): GrammarError => ({ kind, message, retryAfter });

export function rateLimited(seconds: number): GrammarError {
  return grammarError(
    "rateLimited",
    `Too many grammar checks. Checking again in ${seconds} s.`,
    seconds,
  );
}

/** The error for a non-2xx answer of a Polemic server, as grammar.rs
 *  maps them; LanguageTool's own 4xx text passes through. */
export function errorFor(
  status: number,
  retryAfter: string | null,
  body: string,
): GrammarError {
  if (status === 401) {
    return grammarError("signedOut", "Sign in again to check grammar with Polemic.");
  }
  if (status === 402) {
    return grammarError(
      "planRequired",
      "Grammar checking with Polemic needs a paid plan on this server.",
    );
  }
  if (status === 404) {
    return grammarError("unavailable", "This Polemic server has no grammar checking.");
  }
  if (status === 413)
    return grammarError("tooLong", "A paragraph is too long to check.");
  if (status === 429) {
    const seconds = /^\s*\d+\s*$/.test(retryAfter ?? "")
      ? Number(retryAfter)
      : DEFAULT_RETRY_AFTER;
    return rateLimited(Math.min(3600, Math.max(1, seconds)));
  }
  if (status >= 500) {
    return grammarError(
      "unavailable",
      "Polemic grammar checking is unavailable right now.",
    );
  }
  const text = body.trim();
  return grammarError(
    "failed",
    text === "" || text.startsWith("<") || text.startsWith("{")
      ? `LanguageTool answered ${status}`
      : `LanguageTool: ${[...text].slice(0, 300).join("")}`,
  );
}
