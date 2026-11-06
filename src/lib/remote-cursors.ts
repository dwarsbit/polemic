/**
 * Other people's cursors and selections in the code editor (the
 * browser build's presence): a caret in their color with their name,
 * which shows when they move and on hover, and their selection
 * tinted. The editor hands in where they are with `setRemoteCursors`;
 * between updates the marks move with the text.
 */

import { StateEffect, StateField, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";

export interface RemoteCursor {
  id: number;
  name: string;
  color: string;
  anchor: number;
  head: number;
}

export const setRemoteCursors = StateEffect.define<RemoteCursor[]>();

class CaretWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly color: string,
    /** Changes when they move, so the name shows again. */
    readonly key: string,
  ) {
    super();
  }

  eq(other: CaretWidget): boolean {
    return other.key === this.key;
  }

  toDOM(): HTMLElement {
    const caret = document.createElement("span");
    caret.className = "cm-remote-caret";
    caret.style.borderColor = this.color;
    caret.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "cm-remote-caret-label";
    label.style.backgroundColor = this.color;
    label.textContent = this.name;
    caret.append(label);
    return caret;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function build(cursors: RemoteCursor[], length: number): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const clamp = (pos: number) => Math.max(0, Math.min(pos, length));
  for (const cursor of cursors) {
    const anchor = clamp(cursor.anchor);
    const head = clamp(cursor.head);
    if (anchor !== head) {
      ranges.push(
        Decoration.mark({
          class: "cm-remote-selection",
          attributes: { style: `background-color: ${cursor.color}33` },
        }).range(Math.min(anchor, head), Math.max(anchor, head)),
      );
    }
    ranges.push(
      Decoration.widget({
        widget: new CaretWidget(
          cursor.name,
          cursor.color,
          `${cursor.id}:${head}:${anchor}`,
        ),
        side: 1,
      }).range(head),
    );
  }
  return Decoration.set(ranges, true);
}

const remoteCursorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setRemoteCursors)) return build(effect.value, tr.state.doc.length);
    }
    return value.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const remoteCursorTheme = EditorView.baseTheme({
  ".cm-remote-caret": {
    position: "relative",
    borderLeft: "2px solid",
    marginLeft: "-1px",
    marginRight: "-1px",
  },
  ".cm-remote-caret-label": {
    position: "absolute",
    bottom: "100%",
    left: "-2px",
    padding: "0 4px",
    borderRadius: "3px 3px 3px 0",
    color: "#fff",
    fontFamily: "var(--font-sans, system-ui, sans-serif)",
    fontSize: "10px",
    lineHeight: "15px",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    zIndex: "10",
    animation: "cm-remote-caret-label 3s forwards",
  },
  ".cm-remote-caret:hover .cm-remote-caret-label": {
    animation: "none",
    opacity: "1",
  },
  "@keyframes cm-remote-caret-label": {
    "0%, 70%": { opacity: "1" },
    "100%": { opacity: "0" },
  },
});

export const remoteCursors = [remoteCursorField, remoteCursorTheme];
