import { StateField, type EditorState, type Text } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";

/**
 * Git's conflict markers in the Code view: each hunk is tinted (mine
 * above the `=======`, theirs below) and carries Keep mine / Keep
 * theirs / Keep both buttons that rewrite it in place.
 */

export interface ConflictHunk {
  /** The whole hunk, from the `<<<<<<<` line to the end of the `>>>>>>>` line. */
  from: number;
  to: number;
  /** Our lines (between `<<<<<<<` and `=======` or `|||||||`), newline included. */
  oursFrom: number;
  oursTo: number;
  /** Their lines (between `=======` and `>>>>>>>`), newline included. */
  theirsFrom: number;
  theirsTo: number;
  oursLabel: string;
  theirsLabel: string;
  /** Line numbers (1-based) of the marker lines, for the decorations. */
  markerLines: number[];
}

export type ConflictChoice = "ours" | "theirs" | "both";

/** A quick check for a whole file: does it carry conflict markers at all? */
export function hasConflictMarkers(text: string): boolean {
  return text.startsWith("<<<<<<< ") || text.includes("\n<<<<<<< ");
}

/** Every well-formed conflict hunk in the document, in order. */
export function findConflictHunks(doc: Text): ConflictHunk[] {
  const hunks: ConflictHunk[] = [];
  let open: {
    from: number;
    line: number;
    oursFrom: number;
    oursLabel: string;
    oursTo: number | null;
    base: number | null;
    theirsFrom: number | null;
    markerLines: number[];
  } | null = null;
  for (let number = 1; number <= doc.lines; number++) {
    const line = doc.line(number);
    const text = line.text;
    // The newline after a line belongs to it; the last line has none.
    const lineEnd = number < doc.lines ? line.to + 1 : line.to;
    if (text.startsWith("<<<<<<< ")) {
      open = {
        from: line.from,
        line: number,
        oursFrom: lineEnd,
        oursLabel: text.slice(8).trim(),
        oursTo: null,
        base: null,
        theirsFrom: null,
        markerLines: [number],
      };
    } else if (!open) {
      continue;
    } else if (text.startsWith("||||||| ") && open.oursTo === null) {
      // diff3 style: the common ancestor sits between here and =======.
      open.oursTo = line.from;
      open.base = lineEnd;
      open.markerLines.push(number);
    } else if (text === "=======" && open.theirsFrom === null) {
      if (open.oursTo === null) open.oursTo = line.from;
      open.theirsFrom = lineEnd;
      open.markerLines.push(number);
    } else if (text.startsWith(">>>>>>> ") && open.theirsFrom !== null) {
      open.markerLines.push(number);
      hunks.push({
        from: open.from,
        to: line.to,
        oursFrom: open.oursFrom,
        oursTo: open.oursTo!,
        theirsFrom: open.theirsFrom,
        theirsTo: line.from,
        oursLabel: open.oursLabel,
        theirsLabel: text.slice(8).trim(),
        markerLines: open.markerLines,
      });
      open = null;
    }
  }
  return hunks;
}

/** The text that replaces a hunk for a choice, newline-terminated like the hunk's lines. */
export function resolutionText(
  doc: Text,
  hunk: ConflictHunk,
  choice: ConflictChoice,
): string {
  const ours = doc.sliceString(hunk.oursFrom, hunk.oursTo);
  const theirs = doc.sliceString(hunk.theirsFrom, hunk.theirsTo);
  const kept = choice === "ours" ? ours : choice === "theirs" ? theirs : ours + theirs;
  // The hunk's `>>>>>>>` line keeps no newline of its own: drop the
  // kept text's last one when the hunk ends the document.
  const hunkEndsDoc = hunk.to === doc.length;
  return hunkEndsDoc ? kept.replace(/\n$/, "") : kept;
}

/** Rewrite one hunk of the view's document with the chosen side(s). */
export function resolveConflictHunk(
  view: EditorView,
  hunk: ConflictHunk,
  choice: ConflictChoice,
): void {
  const doc = view.state.doc;
  // The hunk's `>>>>>>>` line is followed by a newline unless it ends
  // the document; the replacement text carries its own.
  const to = hunk.to < doc.length ? hunk.to + 1 : hunk.to;
  view.dispatch({
    changes: { from: hunk.from, to, insert: resolutionText(doc, hunk, choice) },
    userEvent: "conflict.resolve",
  });
}

const hunksField = StateField.define<ConflictHunk[]>({
  create: (state) => findConflictHunks(state.doc),
  update(value, tr) {
    return tr.docChanged ? findConflictHunks(tr.state.doc) : value;
  },
});

/** The hunks of an editor state (for tests and the panel). */
export function conflictHunks(state: EditorState): ConflictHunk[] {
  return state.field(hunksField, false) ?? [];
}

class ConflictWidget extends WidgetType {
  constructor(
    private oursLabel: string,
    private theirsLabel: string,
  ) {
    super();
  }

  override eq(other: ConflictWidget): boolean {
    return other.oursLabel === this.oursLabel && other.theirsLabel === this.theirsLabel;
  }

  override toDOM(view: EditorView): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "cm-conflict-bar";
    const label = document.createElement("span");
    label.className = "cm-conflict-bar-label";
    label.textContent = `Conflict: mine (${this.oursLabel}) against theirs (${this.theirsLabel})`;
    bar.append(label);
    const choices: [ConflictChoice, string, string][] = [
      ["ours", "Keep mine", "Keep the lines above the ======="],
      ["theirs", "Keep theirs", "Keep the lines below the ======="],
      ["both", "Keep both", "Keep mine, then theirs"],
    ];
    for (const [choice, text, title] of choices) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cm-conflict-button";
      button.textContent = text;
      button.title = title;
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        const pos = view.posAtDOM(bar);
        const hunk = conflictHunks(view.state).find((h) => h.from === pos);
        if (hunk) resolveConflictHunk(view, hunk, choice);
      });
      bar.append(button);
    }
    return bar;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

const markerLine = Decoration.line({ class: "cm-conflict-marker" });
const oursLine = Decoration.line({ class: "cm-conflict-ours" });
const theirsLine = Decoration.line({ class: "cm-conflict-theirs" });

function decorate(state: EditorState): DecorationSet {
  const doc = state.doc;
  const ranges = [];
  for (const hunk of conflictHunks(state)) {
    ranges.push(
      Decoration.widget({
        widget: new ConflictWidget(hunk.oursLabel, hunk.theirsLabel),
        block: true,
        side: -1,
      }).range(hunk.from),
    );
    const markers = new Set(hunk.markerLines);
    const first = doc.lineAt(hunk.from).number;
    const last = doc.lineAt(hunk.to).number;
    for (let number = first; number <= last; number++) {
      const line = doc.line(number);
      const kind = markers.has(number)
        ? markerLine
        : line.from >= hunk.theirsFrom
          ? theirsLine
          : line.from < hunk.oursTo
            ? oursLine
            : null;
      if (kind) ranges.push(kind.range(line.from));
    }
  }
  return Decoration.set(ranges, true);
}

const decorationsField = StateField.define<DecorationSet>({
  create: decorate,
  update(value, tr) {
    return tr.docChanged ? decorate(tr.state) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** The conflict-marker extension for the Code view. */
export const conflictMarkers = [hunksField, decorationsField];
