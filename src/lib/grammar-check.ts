import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { extractProse, sourceRange, type ProseBlock } from "@/lib/prose";
import { checkGrammar, type GrammarIssue } from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";

/**
 * Grammar and style hints over a document's prose (see lib/prose and
 * the Rust `grammar` module). Results are cached per prose block, so
 * an edit re-checks only the paragraphs it touched — which keeps a
 * LanguageTool server's rate limits in reach.
 */

/** An issue placed in the document. */
export interface PlacedIssue extends GrammarIssue {
  /** The prose text the issue covers. */
  text: string;
  /** Whether a replacement can be applied: the source holds exactly
   *  the prose text (no markup inside the range). */
  replaceable: boolean;
}

const cache = new Map<string, GrammarIssue[]>();
let cacheKey = "";

/** Forget cached results (the rules or the checker changed). */
export function clearGrammarCache() {
  cache.clear();
}

/** The settings results depend on: a change empties the cache. */
function settingsKey(): string {
  const { grammar, spellcheckLanguage } = useSettingsStore.getState();
  return JSON.stringify([
    grammar.languageToolUrl,
    grammar.englishVariant,
    grammar.disabledRules,
    spellcheckLanguage,
  ]);
}

/** Whether grammar checking is on. */
export function grammarEnabled(): boolean {
  return useSettingsStore.getState().grammar.enabled !== false;
}

/**
 * Issues per block, from the cache or the checker. Issues touching a
 * placeholder (math, citations) are dropped: they are about text the
 * user did not write. Null when the checker is unavailable.
 */
export async function checkBlocks(
  blocks: ProseBlock[],
): Promise<GrammarIssue[][] | null> {
  const key = settingsKey();
  if (key !== cacheKey) {
    cache.clear();
    cacheKey = key;
  }
  const missing = [...new Set(blocks.map((b) => b.text).filter((t) => !cache.has(t)))];
  if (missing.length > 0) {
    try {
      const results = await checkGrammar(missing);
      missing.forEach((text, i) => cache.set(text, results[i] ?? []));
    } catch {
      return null; // no backend (browser) or the server failed
    }
  }
  return blocks.map((block) =>
    (cache.get(block.text) ?? []).filter(
      (issue) =>
        !block.placeholders.some((p) => issue.from < p.to && p.from < issue.to),
    ),
  );
}

/** Place a block's issues in a source text. */
export function placeIssues(
  source: string,
  block: ProseBlock,
  issues: GrammarIssue[],
): PlacedIssue[] {
  return issues.map((issue) => {
    const range = sourceRange(block, issue.from, issue.to);
    const text = block.text.slice(issue.from, issue.to);
    return {
      ...issue,
      from: range.from,
      to: range.to,
      text,
      replaceable: source.slice(range.from, range.to) === text,
    };
  });
}

// --- Code view (CodeMirror) ---------------------------------------------------

export const setGrammarIssues = StateEffect.define<DecorationSet>();

export const grammarField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setGrammarIssues)) next = effect.value;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Check the document's prose and underline the issues. */
export async function runGrammarCheck(view: EditorView): Promise<void> {
  const doc = view.state.doc;
  const source = doc.toString();
  const blocks = extractProse(source);
  const results = await checkBlocks(blocks);
  // Stale (the text changed meanwhile) or no checker: keep what is shown.
  if (results === null || view.state.doc !== doc) return;
  const marks = blocks.flatMap((block, i) =>
    placeIssues(source, block, results[i])
      .filter((issue) => issue.to > issue.from)
      .map((issue) =>
        Decoration.mark({
          class: "cm-grammar",
          attributes: { title: `${issue.message} (right-click for fixes)` },
          issue,
        }).range(issue.from, issue.to),
      ),
  );
  if (view.state.field(grammarField, false) !== undefined) {
    view.dispatch({ effects: setGrammarIssues.of(Decoration.set(marks, true)) });
  }
}

/** The grammar issue at a position, if any. */
export function grammarIssueAt(view: EditorView, pos: number): PlacedIssue | null {
  const iter = view.state.field(grammarField).iter();
  while (iter.value !== null) {
    if (iter.from > pos) break;
    if (iter.from <= pos && pos < iter.to) {
      const issue = iter.value.spec.issue as PlacedIssue;
      return { ...issue, from: iter.from, to: iter.to };
    }
    iter.next();
  }
  return null;
}
