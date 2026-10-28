/**
 * Track changes in the Code view: the `changes` markup is hidden, the
 * suggested text is colored by author (insertions tinted, deletions
 * struck out), the caret skips the hidden markup, a gutter bar marks
 * every line with a suggestion, and hovering one offers Accept and
 * Reject (one undo step each). The model is lib/changes.ts.
 */

import {
  ChangeSet,
  EditorSelection,
  EditorState,
  RangeSet,
  StateEffect,
  StateField,
  Transaction,
  type ChangeSpec,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  WidgetType,
  gutter,
  hoverTooltip,
  type DecorationSet,
} from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import {
  acceptChange,
  finalText,
  parseAuthors,
  parseChanges,
  rejectChange,
  type Change,
  type ChangeAuthor,
  type SourceRange,
} from "@/lib/changes";

/** CSS colors for the xcolor names authors are usually given. */
const XCOLORS: Record<string, string> = {
  orange: "#e8730c",
  blue: "#2563eb",
  red: "#dc2626",
  teal: "#0d9488",
  violet: "#7c3aed",
  olive: "#84851a",
  magenta: "#c026d3",
  cyan: "#0891b2",
  brown: "#a16207",
  purple: "#9333ea",
  green: "#16a34a",
  lime: "#65a30d",
  pink: "#db2777",
  yellow: "#ca8a04",
  black: "#52525b",
  gray: "#71717a",
  darkgray: "#52525b",
  lightgray: "#a1a1aa",
};

/** Colors for authors without a usable one, in order of appearance. */
const FALLBACK = ["#e8730c", "#2563eb", "#dc2626", "#0d9488", "#7c3aed", "#c026d3"];

/** The color of suggestions without an author id. */
const ANONYMOUS = "#64748b";

export interface AuthorStyle {
  /** The display name: the declared name, else the id. */
  name: string;
  /** A CSS color. */
  color: string;
}

/** An xcolor expression's CSS color (`red!60!black` reads as red). */
function cssColor(xcolor: string | null): string | null {
  if (xcolor === null) return null;
  const base = xcolor.trim().toLowerCase().split("!")[0];
  return XCOLORS[base] ?? null;
}

/**
 * Name and color per author id: declared authors first, then the ids
 * only seen on suggestions. `null` stands for suggestions without id.
 */
export function authorStyles(
  authors: ChangeAuthor[],
  ids: Iterable<string | null>,
): Map<string | null, AuthorStyle> {
  const styles = new Map<string | null, AuthorStyle>();
  let fallback = 0;
  const add = (id: string, name: string | null, color: string | null) => {
    if (styles.has(id)) return;
    styles.set(id, {
      name: name ?? id,
      color: cssColor(color) ?? FALLBACK[fallback++ % FALLBACK.length],
    });
  };
  for (const author of authors) add(author.id, author.name, author.color);
  for (const id of ids) {
    if (id === null) styles.set(null, { name: "Unknown author", color: ANONYMOUS });
    else add(id, null, null);
  }
  return styles;
}

/** The authors declared in another file (the main file's preamble). */
export const setChangeAuthors = StateEffect.define<ChangeAuthor[]>();

interface ChangesState {
  /** Every suggestion, nested ones included, in document order. */
  changes: Change[];
  /** Authors declared elsewhere (the main file). */
  external: ChangeAuthor[];
  styles: Map<string | null, AuthorStyle>;
  decorations: DecorationSet;
  /** The hidden markup: atomic for the caret, protected from edits. */
  hidden: { range: SourceRange; change: Change }[];
  hiddenSet: RangeSet<Decoration>;
}

/** The struck-out old text of a `\replaced`, shown before the new. */
class OldTextWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly color: string,
  ) {
    super();
  }

  override eq(other: OldTextWidget) {
    return other.text === this.text && other.color === this.color;
  }

  override toDOM() {
    const span = document.createElement("span");
    span.className = "cm-change-del cm-change-old";
    span.style.setProperty("--change-color", this.color);
    span.textContent = this.text;
    return span;
  }

  override ignoreEvent() {
    return false;
  }
}

const hiddenMark = Decoration.replace({});

function build(
  state: EditorState,
  external: ChangeAuthor[],
): Omit<ChangesState, "external"> {
  const source = state.doc.toString();
  const changes = parseChanges(source);
  if (changes.length === 0) {
    return {
      changes,
      styles: new Map(),
      decorations: Decoration.none,
      hidden: [],
      hiddenSet: RangeSet.empty,
    };
  }
  const styles = authorStyles(
    [...parseAuthors(source), ...external],
    changes.map((c) => c.author),
  );
  const decos: Range<Decoration>[] = [];
  const hidden: ChangesState["hidden"] = [];
  // The old text of a \replaced is shown as a widget: nothing inside.
  const skipped: SourceRange[] = [];
  const hide = (change: Change, from: number, to: number, widget?: WidgetType) => {
    if (from >= to) return;
    decos.push((widget ? Decoration.replace({ widget }) : hiddenMark).range(from, to));
    hidden.push({ range: { from, to }, change });
  };
  const mark = (className: string, color: string, range: SourceRange | null) => {
    if (range === null || range.from >= range.to) return;
    decos.push(
      Decoration.mark({
        class: className,
        attributes: { style: `--change-color: ${color}` },
      }).range(range.from, range.to),
    );
  };
  for (const change of changes) {
    const { range, added, deleted } = change;
    if (skipped.some((r) => range.from >= r.from && range.to <= r.to)) continue;
    const color = styles.get(change.author)?.color ?? ANONYMOUS;
    if (change.kind === "replaced" && added !== null && deleted !== null) {
      const old = finalText(source.slice(deleted.from, deleted.to)).text;
      hide(
        change,
        range.from,
        added.from,
        new OldTextWidget(old.replace(/\s*\n\s*/g, " "), color),
      );
      mark("cm-change-ins", color, added);
      hide(change, added.to, range.to);
      skipped.push(deleted);
      continue;
    }
    const body = (added ?? deleted)!;
    hide(change, range.from, body.from);
    if (change.kind === "added") mark("cm-change-ins", color, added);
    else if (change.kind === "deleted") mark("cm-change-del", color, deleted);
    hide(change, body.to, range.to);
  }
  const hiddenSet = RangeSet.of(
    hidden.map((h) => hiddenMark.range(h.range.from, h.range.to)),
    true,
  );
  return {
    changes,
    styles,
    decorations: Decoration.set(decos, true),
    hidden,
    hiddenSet,
  };
}

export const changesField = StateField.define<ChangesState>({
  create: (state) => ({ external: [], ...build(state, []) }),
  update(value, tr) {
    let external = value.external;
    for (const effect of tr.effects) {
      if (effect.is(setChangeAuthors)) external = effect.value;
    }
    if (!tr.docChanged && external === value.external) return value;
    return { external, ...build(tr.state, external) };
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).hiddenSet),
  ],
});

/** The innermost suggestion (not a highlight) at `pos`, ends included. */
export function changeAt(state: EditorState, pos: number): Change | null {
  let best: Change | null = null;
  for (const change of state.field(changesField).changes) {
    if (change.kind === "highlight") continue;
    if (change.range.from <= pos && pos <= change.range.to) best = change;
  }
  return best;
}

/**
 * Accepts or rejects the suggestion at `ref` (an offset or its range)
 * as one undo step. False when there is none.
 */
export function resolveChangeIn(
  view: EditorView,
  ref: number | SourceRange,
  how: "accept" | "reject",
): boolean {
  const source = view.state.doc.toString();
  const edits = (how === "accept" ? acceptChange : rejectChange)(source, ref);
  if (edits.length === 0) return false;
  view.dispatch({
    changes: edits,
    userEvent: how === "accept" ? "input.acceptChange" : "input.rejectChange",
    annotations: isolateHistory.of("full"),
  });
  return true;
}

const KIND_LABEL: Record<Change["kind"], string> = {
  added: "Added",
  deleted: "Deleted",
  replaced: "Replaced",
  highlight: "Highlighted",
};

function actionButton(label: string, title: string, run: () => void): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-change-action";
  button.textContent = label;
  button.title = title;
  // Keep the editor's selection and focus.
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", run);
  return button;
}

/** The hover card: author, kind, note, Accept and Reject. */
const changeHover = hoverTooltip(
  (view, pos) => {
    const change = changeAt(view.state, pos);
    if (change === null) return null;
    const style = view.state.field(changesField).styles.get(change.author);
    return {
      pos: change.range.from,
      end: change.range.to,
      above: true,
      create() {
        const dom = document.createElement("div");
        dom.className = "change-card";
        const head = document.createElement("div");
        head.className = "change-card-head";
        const dot = document.createElement("span");
        dot.className = "change-card-dot";
        dot.style.background = style?.color ?? ANONYMOUS;
        const who = document.createElement("span");
        who.className = "change-card-author";
        who.textContent = style?.name ?? change.author ?? "Unknown author";
        const kind = document.createElement("span");
        kind.className = "change-card-kind";
        kind.textContent = KIND_LABEL[change.kind];
        head.append(dot, who, kind);
        dom.append(head);
        if (change.note !== null) {
          const note = document.createElement("div");
          note.className = "change-card-note";
          note.textContent = change.note;
          dom.append(note);
        }
        const actions = document.createElement("div");
        actions.className = "change-card-actions";
        const at = { ...change.range };
        actions.append(
          actionButton("Accept", "Accept this suggestion", () => {
            resolveChangeIn(view, at, "accept");
            view.focus();
          }),
          actionButton("Reject", "Reject this suggestion", () => {
            resolveChangeIn(view, at, "reject");
            view.focus();
          }),
        );
        dom.append(actions);
        return { dom };
      },
    };
  },
  { hideOnChange: true },
);

class ChangeBar extends GutterMarker {
  constructor(
    readonly color: string,
    readonly pos: number,
  ) {
    super();
  }

  override eq(other: ChangeBar) {
    return other.color === this.color && other.pos === this.pos;
  }

  override toDOM(view: EditorView) {
    const dom = document.createElement("div");
    dom.className = "cm-change-bar";
    dom.style.background = this.color;
    dom.title = "Suggestion";
    dom.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ selection: { anchor: this.pos }, scrollIntoView: true });
      view.focus();
    });
    return dom;
  }
}

/** A bar on every line a suggestion touches, in its author's color. */
const changeGutter = gutter({
  class: "cm-change-gutter",
  markers(view) {
    const { changes, styles } = view.state.field(changesField);
    const doc = view.state.doc;
    const bars: Range<GutterMarker>[] = [];
    let lastLine = 0;
    for (const change of changes) {
      if (change.kind === "highlight") continue;
      const body = change.added ?? change.deleted ?? change.range;
      const first = doc.lineAt(change.range.from).number;
      const last = doc.lineAt(change.range.to).number;
      for (let n = Math.max(first, lastLine + 1); n <= last; n++) {
        const line = doc.line(n);
        const color = styles.get(change.author)?.color ?? ANONYMOUS;
        bars.push(
          new ChangeBar(color, Math.max(line.from, body.from)).range(line.from),
        );
        lastLine = n;
      }
    }
    return RangeSet.of(bars);
  },
});

const PROTECTED_EVENTS = ["input", "delete", "move"];

/** Typing, deleting and dropping go through the protection; accept,
 *  reject and other programmatic edits do not. */
function isUserEdit(tr: Transaction): boolean {
  return (
    PROTECTED_EVENTS.some((event) => tr.isUserEvent(event)) &&
    !tr.isUserEvent("input.acceptChange") &&
    !tr.isUserEvent("input.rejectChange")
  );
}

/**
 * The parts of [from, to) outside the hidden markup of suggestions
 * the range does not cover whole.
 */
function unprotected(
  hidden: ChangesState["hidden"],
  from: number,
  to: number,
): SourceRange[] {
  const pieces: SourceRange[] = [];
  let cursor = from;
  for (const { range, change } of hidden) {
    if (range.to <= cursor || range.from >= to) continue;
    if (change.range.from >= from && change.range.to <= to) continue;
    if (range.from > cursor) pieces.push({ from: cursor, to: range.from });
    cursor = Math.max(cursor, range.to);
  }
  if (cursor < to) pieces.push({ from: cursor, to });
  return pieces;
}

/**
 * Keeps typing and deleting from breaking the hidden markup: an edit
 * that would take part of a command loses that part. A backspace or
 * delete that only met markup removes the next visible character.
 */
const protectMarkup = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !isUserEdit(tr)) return tr;
  const state = tr.startState.field(changesField, false);
  if (!state || state.hidden.length === 0) return tr;
  const { hidden } = state;
  const isHidden = (pos: number, side: "start" | "end") =>
    hidden.find((h) => (side === "end" ? h.range.to : h.range.from) === pos);
  let altered = false;
  const specs: ChangeSpec[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const text = inserted.toString();
    if (fromA === toA) {
      // An insertion inside hidden markup moves to its end.
      const inside = hidden.find((h) => h.range.from < fromA && fromA < h.range.to);
      if (inside) altered = true;
      specs.push({ from: inside ? inside.range.to : fromA, insert: text });
      return;
    }
    const pieces = unprotected(hidden, fromA, toA);
    if (pieces.length === 1 && pieces[0].from === fromA && pieces[0].to === toA) {
      specs.push({ from: fromA, to: toA, insert: text });
      return;
    }
    altered = true;
    if (pieces.length === 0 && text === "") {
      // Only markup met: delete the visible character beyond it.
      const doc = tr.startState.doc;
      if (tr.isUserEvent("delete.backward")) {
        let pos = fromA;
        for (let h = isHidden(pos, "end"); h; h = isHidden(pos, "end"))
          pos = h.range.from;
        if (pos > 0) specs.push({ from: pos - 1, to: pos });
      } else if (tr.isUserEvent("delete.forward")) {
        let pos = toA;
        for (let h = isHidden(pos, "start"); h; h = isHidden(pos, "start"))
          pos = h.range.to;
        if (pos < doc.length) specs.push({ from: pos, to: pos + 1 });
      }
      return;
    }
    pieces.forEach((piece, i) =>
      specs.push({ from: piece.from, to: piece.to, insert: i === 0 ? text : "" }),
    );
    if (pieces.length === 0) {
      const at = hidden.find((h) => h.range.from <= fromA && fromA < h.range.to);
      specs.push({ from: at ? at.range.to : fromA, insert: text });
    }
  });
  if (!altered) return tr;
  const changes = ChangeSet.of(specs, tr.startState.doc.length);
  const selection = EditorSelection.create(
    tr.startState.selection.ranges.map((r) =>
      EditorSelection.cursor(changes.mapPos(r.head, 1)),
    ),
    tr.startState.selection.mainIndex,
  );
  const userEvent = tr.annotation(Transaction.userEvent);
  return {
    changes,
    selection,
    scrollIntoView: tr.scrollIntoView,
    ...(userEvent ? { userEvent } : {}),
  };
});

/** Everything the Code view needs for track changes. */
export const trackChanges: Extension = [
  changesField,
  protectMarkup,
  changeHover,
  changeGutter,
];
