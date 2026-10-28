/**
 * Track changes in the Visual view: `insertion`, `deletion` and
 * `changeHighlight` marks (read and written by parse.ts/serialize.ts
 * from the `changes` markup), accept and reject on the document, and
 * suggest mode as a plugin that turns each typed or deleted piece of
 * text into marks: typing is marked as an insertion (extending an
 * adjacent own one), deleting puts the text back struck out (merging
 * with an adjacent own deletion), typing over a selection pairs both
 * into one `\replaced`, and text that was the author's own insertion
 * is simply removed. Edits that change structure (joining paragraphs,
 * node attributes, formatting) are refused with a short message.
 */

import { Extension, Mark, mergeAttributes } from "@tiptap/core";
import { closeHistory, isHistoryTransaction } from "@tiptap/pm/history";
import {
  Fragment,
  type Mark as PMMark,
  type MarkType,
  type Node as PMNode,
} from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { Mapping, ReplaceStep, type StepMap } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";
import { applyEdits, ensurePreamble, noteOfOptions } from "@/lib/changes";
import {
  reportSuggestMessage,
  requestSuggestSetup,
  type SuggestAuthor,
} from "@/lib/changes-view";
import type { PreambleAttrs } from "./doc-types";
import { splitPreamble } from "./parse";
import { preambleText } from "./serialize";

/** Marks a transaction of ours: suggest mode leaves it alone. */
const SKIP = "trackChangesSkip";

const changeAttributes = {
  author: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute("data-author"),
    renderHTML: (attrs: Record<string, unknown>) =>
      attrs.author ? { "data-author": attrs.author } : {},
  },
  opts: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute("data-opts"),
    renderHTML: (attrs: Record<string, unknown>) =>
      attrs.opts ? { "data-opts": attrs.opts } : {},
  },
  pair: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute("data-pair"),
    renderHTML: (attrs: Record<string, unknown>) =>
      attrs.pair ? { "data-pair": attrs.pair } : {},
  },
};

function changeMark(name: string, className: string, priority: number) {
  return Mark.create({
    name,
    // Before the formatting marks: a suggestion wraps its formatting.
    priority,
    // Typing next to a suggestion is not part of it (suggest mode
    // extends own suggestions itself).
    inclusive: false,
    keepOnSplit: true,
    clearable: false,
    // Another author's new text can be struck out.
    excludes: name,
    addAttributes: () => changeAttributes,
    parseHTML: () => [{ tag: `span.${className}` }],
    renderHTML: ({ HTMLAttributes }) => [
      "span",
      mergeAttributes({ class: `vis-change ${className}` }, HTMLAttributes),
      0,
    ],
  });
}

export const DeletionMark = changeMark("deletion", "vis-del", 1003);
export const InsertionMark = changeMark("insertion", "vis-ins", 1002);
export const ChangeHighlightMark = changeMark("changeHighlight", "vis-hl", 1001);

export type ChangeKindName = "insertion" | "deletion";

/** One suggestion in the document: its runs (a replacement has two). */
export interface VisualChange {
  author: string | null;
  opts: string | null;
  note: string | null;
  kind: "added" | "deleted" | "replaced";
  runs: { from: number; to: number; type: ChangeKindName; mark: PMMark }[];
}

const isChange = (mark: PMMark) =>
  mark.type.name === "insertion" || mark.type.name === "deletion";

/** The contiguous run of inline content around `index` in `parent`
 *  (starting at `start`) carrying `mark`. */
function runAround(parent: PMNode, start: number, index: number, mark: PMMark) {
  let first = index;
  while (first > 0 && mark.isInSet(parent.child(first - 1).marks)) first--;
  let last = index;
  while (last < parent.childCount - 1 && mark.isInSet(parent.child(last + 1).marks))
    last++;
  let from = start;
  for (let i = 0; i < first; i++) from += parent.child(i).nodeSize;
  let to = from;
  for (let i = first; i <= last; i++) to += parent.child(i).nodeSize;
  return { from, to, first, last };
}

/** The suggestion at `pos` (the node right after it, else before). */
export function changeAt(state: EditorState, pos: number): VisualChange | null {
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  if (!parent.inlineContent) return null;
  const start = $pos.start();
  const candidates: number[] = [];
  const { index, offset } = parent.childAfter($pos.parentOffset);
  if (index < parent.childCount) candidates.push(index);
  if (offset === $pos.parentOffset && index > 0) candidates.push(index - 1);
  for (const i of candidates) {
    const node = parent.child(i);
    // A deletion wraps an insertion it strikes out: take the deletion.
    const mark =
      node.marks.find((m) => m.type.name === "deletion") ??
      node.marks.find((m) => m.type.name === "insertion");
    if (!mark) continue;
    const run = runAround(parent, start, i, mark);
    const runs: VisualChange["runs"] = [
      { from: run.from, to: run.to, type: mark.type.name as ChangeKindName, mark },
    ];
    const pair = mark.attrs.pair as string | null;
    if (pair !== null) {
      // The other half of a replacement sits right before or after.
      const neighbor = mark.type.name === "deletion" ? run.last + 1 : run.first - 1;
      const other =
        neighbor >= 0 && neighbor < parent.childCount
          ? parent
              .child(neighbor)
              .marks.find(
                (m) => isChange(m) && m.type !== mark.type && m.attrs.pair === pair,
              )
          : undefined;
      if (other) {
        const half = runAround(parent, start, neighbor, other);
        runs.push({
          from: half.from,
          to: half.to,
          type: other.type.name as ChangeKindName,
          mark: other,
        });
        runs.sort((a, b) => a.from - b.from);
      }
    }
    return {
      author: mark.attrs.author ?? null,
      opts: mark.attrs.opts ?? null,
      note: noteOfOptions(mark.attrs.opts ?? null),
      kind:
        runs.length === 2
          ? "replaced"
          : mark.type.name === "insertion"
            ? "added"
            : "deleted",
      runs,
    };
  }
  return null;
}

/** Accepts or rejects a suggestion as one undo step. */
export function resolveVisualChange(
  view: EditorView,
  change: VisualChange,
  how: "accept" | "reject",
): void {
  const tr = view.state.tr;
  // Back to front, so earlier positions stay valid.
  for (const run of [...change.runs].sort((a, b) => b.from - a.from)) {
    const keep = (run.type === "insertion") === (how === "accept");
    if (keep) tr.removeMark(run.from, run.to, run.mark);
    else tr.delete(run.from, run.to);
  }
  tr.setMeta(SKIP, true);
  closeHistory(tr);
  view.dispatch(tr);
}

// ---------------------------------------------------------------------------
// Suggest mode

let suggestAuthor: SuggestAuthor | null = null;

/** Turns suggest mode on (with the author) or off (null). */
export function setVisualSuggestAuthor(author: SuggestAuthor | null) {
  suggestAuthor = author;
}

let pairSeq = 0;
const newPair = () => `v${Date.now().toString(36)}${++pairSeq}`;

function isUserEdit(tr: Transaction): boolean {
  return (
    tr.docChanged &&
    !tr.getMeta(SKIP) &&
    !tr.getMeta("appendedTransaction") &&
    !tr.getMeta("preventUpdate") &&
    tr.getMeta("addToHistory") !== false &&
    !isHistoryTransaction(tr)
  );
}

/** Why a user transaction can't be suggested, or null when it can. */
function problemWith(tr: Transaction): string | null {
  for (let k = 0; k < tr.steps.length; k++) {
    const step = tr.steps[k];
    if (!(step instanceof ReplaceStep)) {
      return "This change can't be suggested. Turn Suggest off to make it.";
    }
    const { from, to } = step as unknown as { from: number; to: number };
    if (from < to) {
      const doc = tr.docs[k];
      if (!doc.resolve(from).sameParent(doc.resolve(to))) {
        return doc.textBetween(from, to, "", "\ufffc").length === 0
          ? "Can't suggest joining paragraphs."
          : "Can't suggest across paragraphs. Select within one paragraph.";
      }
    }
  }
  return null;
}

const ownMark = (marks: readonly PMMark[], type: MarkType, author: string) =>
  marks.find(
    (m) => m.type === type && m.attrs.author === author && m.attrs.pair === null,
  );

/** The preamble node's attrs with the track changes setup added. */
function setUpPreamble(
  attrs: PreambleAttrs,
  author: SuggestAuthor,
): PreambleAttrs | null {
  const end = "\\begin{document}";
  const text = preambleText(attrs) + end;
  const { edits } = ensurePreamble(text, author);
  if (edits.length === 0) return null;
  const next = applyEdits(text, edits);
  return splitPreamble(next.slice(0, next.length - end.length));
}

function appendSuggestions(
  trs: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
): Transaction | null {
  const author = suggestAuthor;
  if (author === null || !trs.some(isUserEdit)) return null;
  const schema = newState.schema;
  const insertion = schema.marks.insertion;
  const deletion = schema.marks.deletion;
  const opts = `[id=${author.id}]`;

  // Every step map in order, to carry positions to the new document.
  const maps: StepMap[] = trs.flatMap((tr) => tr.mapping.maps as StepMap[]);
  const inserts: { from: number; to: number; pair: string | null }[] = [];
  const removals: {
    pos: number;
    content: Fragment;
    pair: string | null;
    forward: boolean;
  }[] = [];
  let g = 0;
  for (const tr of trs) {
    const user = isUserEdit(tr);
    for (let k = 0; k < tr.steps.length; k++, g++) {
      if (!user) continue;
      const step = tr.steps[k] as ReplaceStep;
      const { from, to, slice } = step as unknown as {
        from: number;
        to: number;
        slice: ReplaceStep["slice"];
      };
      const toFinal = new Mapping(maps.slice(g + 1));
      const before = tr.docs[k];
      // The deleted inline content, the author's own new text left out
      // (deleting it just removes it).
      const removed: PMNode[] = [];
      if (from < to) {
        const $from = before.resolve(from);
        const inner = $from.parent.slice(
          $from.parentOffset,
          $from.parentOffset + (to - from),
        );
        inner.content.forEach((node) => {
          const own = node.marks.some(
            (m) => m.type === insertion && m.attrs.author === author.id,
          );
          if (!own && node.isInline) removed.push(node);
        });
      }
      const typed =
        slice.content.textBetween(0, slice.content.size, "", "\ufffc").length > 0;
      // Typing over a selection: one replacement.
      const pair =
        typed && removed.some((n) => !deletion.isInSet(n.marks)) ? newPair() : null;
      if (typed) {
        inserts.push({
          from: toFinal.map(from, 1),
          to: toFinal.map(from + slice.size, -1),
          pair,
        });
      }
      if (removed.length > 0) {
        // Delete (not Backspace): the caret goes past the struck text.
        const sel = oldState.selection;
        const forward =
          !typed &&
          k === 0 &&
          tr.before === oldState.doc &&
          sel.empty &&
          sel.head === from;
        removals.push({
          pos: toFinal.map(from, -1),
          content: Fragment.from(removed),
          pair,
          forward,
        });
      }
    }
  }
  if (inserts.length === 0 && removals.length === 0) return null;

  const out = newState.tr;
  let marked = false;
  for (const ins of inserts) {
    if (ins.from >= ins.to) continue;
    const $from = out.doc.resolve(ins.from);
    const $to = out.doc.resolve(ins.to);
    const reuse =
      ins.pair === null
        ? (ownMark($from.nodeBefore?.marks ?? [], insertion, author.id) ??
          ownMark($to.nodeAfter?.marks ?? [], insertion, author.id) ??
          $from.nodeBefore?.marks.find(
            (m) => m.type === insertion && m.attrs.author === author.id,
          ) ??
          null)
        : null;
    const mark = reuse ?? insertion.create({ author: author.id, opts, pair: ins.pair });
    if (!reuse) marked = true;
    out.removeMark(ins.from, ins.to, deletion);
    out.removeMark(ins.from, ins.to, insertion);
    out.addMark(ins.from, ins.to, mark);
  }
  let caret: number | null = null;
  for (const removal of removals) {
    const pos = out.mapping.map(removal.pos, -1);
    const $pos = out.doc.resolve(pos);
    const reuse =
      removal.pair === null
        ? (ownMark($pos.nodeBefore?.marks ?? [], deletion, author.id) ??
          ownMark($pos.nodeAfter?.marks ?? [], deletion, author.id))
        : null;
    const mark =
      reuse ?? deletion.create({ author: author.id, opts, pair: removal.pair });
    const nodes: PMNode[] = [];
    removal.content.forEach((node) => {
      if (deletion.isInSet(node.marks)) nodes.push(node);
      else {
        nodes.push(node.mark(mark.addToSet(node.marks)));
        if (!reuse) marked = true;
      }
    });
    const content = Fragment.from(nodes);
    out.insert(pos, content);
    caret = removal.forward ? pos + content.size : pos;
  }
  if (caret !== null && inserts.length === 0) {
    out.setSelection(TextSelection.create(out.doc, caret));
  }

  if (marked) {
    const first = out.doc.firstChild;
    if (author.hasPreamble && first?.type.name === "preamble") {
      const attrs = setUpPreamble(first.attrs as PreambleAttrs, author);
      if (attrs !== null) out.setNodeMarkup(0, undefined, attrs);
    } else if (!author.hasPreamble) {
      queueMicrotask(requestSuggestSetup);
    }
  }
  out.setMeta(SKIP, true);
  return out.docChanged || out.selectionSet ? out : null;
}

const suggestKey = new PluginKey("visualSuggest");

/** Suggest mode for the Visual view (on while an author is set). */
export const VisualSuggest = Extension.create({
  name: "visualSuggest",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: suggestKey,
        filterTransaction(tr) {
          if (suggestAuthor === null || !isUserEdit(tr)) return true;
          const problem = problemWith(tr);
          if (problem === null) return true;
          queueMicrotask(() => reportSuggestMessage(problem));
          return false;
        },
        appendTransaction: appendSuggestions,
      }),
    ];
  },
});

export const trackChangesExtensions = [
  DeletionMark,
  InsertionMark,
  ChangeHighlightMark,
  VisualSuggest,
];
