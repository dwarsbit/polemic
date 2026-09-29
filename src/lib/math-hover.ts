import { Facet, StateEffect, StateField } from "@codemirror/state";
import { EditorView, showTooltip, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import katex from "katex";
import {
  findMathRegion,
  stripMathAnnotations,
  type MathRegion,
} from "@/lib/math-region";

/** Delay before a hover preview shows. */
const HOVER_DELAY_MS = 300;

/** Whether math hover previews are enabled (per settings). */
export const mathHoverEnabled = Facet.define<boolean, boolean>({
  combine: (values) => values.length > 0 && values.every(Boolean),
});

/** The math region currently previewed, if any. */
const setPreview = StateEffect.define<MathRegion | null>();

const previewField = StateField.define<MathRegion | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setPreview)) value = effect.value;
    if (tr.docChanged) value = null; // stale after edits
    return value;
  },
});

function regionAt(view: EditorView, pos: number): MathRegion | null {
  return findMathRegion(view.state.doc.toString(), pos);
}

/**
 * Environments KaTeX renders on its own. The region source is the env
 * body (`&` only parses inside an environment), so these are wrapped
 * back into \begin{env}...\end{env}. The rest (equation, multline,
 * eqnarray, ...) are rendered bare; eqnarray's `&` then fails on
 * purpose (deprecated environment).
 */
const KATEX_ENVIRONMENTS = new Set([
  "align",
  "align*",
  "alignat",
  "alignat*",
  "aligned",
  "alignedat",
  "cases",
  "dcases",
  "gather",
  "gather*",
  "gathered",
  "split",
  "subarray",
  "array",
  "matrix",
  "pmatrix",
  "bmatrix",
  "Bmatrix",
  "vmatrix",
  "Vmatrix",
  "smallmatrix",
]);

/** The source to hand to the renderer, annotations stripped. */
export function renderableSource(region: MathRegion): string {
  const stripped = stripMathAnnotations(region.source);
  return region.environment !== null && KATEX_ENVIRONMENTS.has(region.environment)
    ? `\\begin{${region.environment}}${stripped}\\end{${region.environment}}`
    : stripped;
}

/**
 * Triggers: hovering math for HOVER_DELAY_MS, or the cursor entering
 * or leaving math. The cursor recompute runs as a microtask on the
 * same update cycle, so typing inside a block keeps the card visible
 * with its content updating per keystroke. Whichever fired last wins.
 */
const triggerPlugin = ViewPlugin.fromClass(
  class {
    mouseTimer: ReturnType<typeof setTimeout> | undefined;
    destroyed = false;

    constructor(readonly view: EditorView) {}

    onHover = (event: MouseEvent) => {
      // Moving over the card itself must not flicker the preview.
      if ((event.target as HTMLElement).closest(".cm-tooltip") !== null) return;
      clearTimeout(this.mouseTimer);
      this.mouseTimer = setTimeout(() => {
        const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
        this.view.dispatch({ effects: setPreview.of(pos === null ? null : regionAt(this.view, pos)) });
      }, HOVER_DELAY_MS);
    };

    onLeave = () => clearTimeout(this.mouseTimer);

    update(update: ViewUpdate) {
      if (!update.selectionSet && !update.docChanged) return;
      queueMicrotask(() => {
        if (this.destroyed) return;
        const head = this.view.state.selection.main.head;
        this.view.dispatch({ effects: setPreview.of(regionAt(this.view, head)) });
      });
    }

    destroy() {
      this.destroyed = true;
      clearTimeout(this.mouseTimer);
    }
  },
  {
    eventHandlers: {
      mousemove(event: MouseEvent) {
        this.onHover(event);
      },
      mouseleave() {
        this.onLeave();
      },
    },
  },
);

/** The preview card above the math block; hidden on render errors. */
const previewTooltip = showTooltip.compute(
  [previewField, mathHoverEnabled],
  (state) => {
    const region = state.field(previewField);
    if (region === null || !state.facet(mathHoverEnabled)) return null;
    let html: string;
    try {
      html = katex.renderToString(renderableSource(region), {
        displayMode: region.display,
        throwOnError: true,
      });
    } catch {
      // Mid-typing or unsupported input: show nothing.
      return null;
    }
    return {
      pos: region.from,
      above: true,
      overlap: true,
      create(view) {
        const dom = document.createElement("div");
        // showTooltip does not apply Tooltip.class, so the styling
        // hook lives on the dom itself (see index.css).
        dom.className = "math-hover-card";
        dom.innerHTML = html;
        // Never wider than the editor panel (wide equations scroll
        // inside the card instead of falling outside the panel).
        const maxWidth = Math.max(200, Math.min(480, view.contentDOM.clientWidth - 32));
        dom.style.maxWidth = `${maxWidth}px`;
        return { dom };
      },
    };
  },
);

/** Math hover + cursor preview (see .math-hover-card in index.css). */
export const mathHover = [previewField, triggerPlugin, previewTooltip];
