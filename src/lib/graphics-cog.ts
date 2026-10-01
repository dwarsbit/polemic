import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

/**
 * The inline "image options" cog: a zero-width widget right after the
 * hovered \includegraphics command. It lives inside the editor text,
 * so there is no gap between the command and the icon (a floating
 * button above the line was repeatedly unreachable) and no layout
 * shift.
 */

class CogWidget extends WidgetType {
  override eq() {
    return true;
  }

  override toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "cm-graphics-cog";
    wrap.title = "Image options (or Cmd/Ctrl+click the command)";
    wrap.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M20 7h-9"/>' +
      '<path d="M14 17H5"/>' +
      '<circle cx="17" cy="17" r="3"/>' +
      '<circle cx="7" cy="7" r="3"/>' +
      "</svg>";
    wrap.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      cogOpenHandler?.();
    });
    return wrap;
  }

  override ignoreEvent() {
    return false;
  }
}

// The open handler is registered by the editor component (the same
// pattern as editor-insert): it reads the current command span from
// the editor state, so it never goes stale.
let cogOpenHandler: (() => void) | null = null;

export function setCogOpenHandler(handler: (() => void) | null) {
  cogOpenHandler = handler;
}

const cogWidget = new CogWidget();

/** Sets the hovered command (or null to hide the cog). */
export const setCogHover = StateEffect.define<{
  from: number;
  to: number;
} | null>();

export const cogHoverField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setCogHover)) {
        value =
          effect.value === null
            ? Decoration.none
            : Decoration.set([
                Decoration.widget({ widget: cogWidget, side: 1 }).range(
                  effect.value.to,
                ),
              ]);
      }
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
