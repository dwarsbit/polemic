import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { useSettingsStore } from "@/store/settings";
import type { EditorView } from "@codemirror/view";

export type DollarAction = "wrap" | "skip" | "plain" | "pair" | "convert";

function countUnescapedDollars(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "$" && (i === 0 || text[i - 1] !== "\\")) {
      count++;
    }
  }
  return count;
}

/**
 * Decide what typing "$" should do, based on the current line's text
 * before the cursor and the character right after it.
 *
 * With convertDoubleDollar, typing the second "$" of a fresh pair
 * ($|$) converts both dollars into display-math brackets: \[|\].
 */
export function decideDollar(
  textBefore: string,
  textAfter: string,
  hasSelection: boolean,
  convertDoubleDollar: boolean,
): DollarAction {
  // \$ is a literal dollar, never a math delimiter.
  if (textBefore.endsWith("\\")) return "plain";
  if (hasSelection) return "wrap";
  if (convertDoubleDollar && textBefore.endsWith("$") && textAfter.startsWith("$")) {
    return "convert";
  }
  if (textAfter.startsWith("$")) return "skip";
  // An odd number of delimiters before the cursor means math is open:
  // this "$" closes it, so never pair.
  if (countUnescapedDollars(textBefore) % 2 === 1) return "plain";
  return "pair";
}

export type BracketAction = "pair-display" | "skip-close" | "default";

/**
 * Typing "[" right after a backslash starts display math: pair it with
 * "\]". Typing "]" right after a backslash in front of "\]" jumps over
 * the closing bracket.
 */
export function decideBracket(textBefore: string, textAfter: string): BracketAction {
  if (!textBefore.endsWith("\\")) return "default";
  if (textAfter.startsWith("\\]")) return "skip-close";
  return "pair-display";
}

function applyDollar(view: EditorView): boolean {
  const state = view.state;
  if (state.selection.ranges.length > 1) return false;
  const range = state.selection.main;
  const line = state.doc.lineAt(range.head);
  const before = state.doc.sliceString(line.from, range.from);
  const after = state.doc.sliceString(range.from, line.to);
  const convert = useSettingsStore.getState().convertDoubleDollar;

  switch (decideDollar(before, after, !range.empty, convert)) {
    case "convert": {
      // The cursor sits between "$|$": both dollars become display math.
      view.dispatch({
        changes: {
          from: range.from - 1,
          to: range.from + 1,
          insert: "\\[\\]",
        },
        selection: { anchor: range.from + 1 },
        userEvent: "input.type",
      });
      return true;
    }
    case "skip":
      view.dispatch({
        selection: { anchor: range.from + 1 },
        userEvent: "input.type",
      });
      return true;
    case "wrap": {
      const selected = state.doc.sliceString(range.from, range.to);
      view.dispatch({
        changes: {
          from: range.from,
          to: range.to,
          insert: `$${selected}$`,
        },
        selection: { anchor: range.from, head: range.to + 2 },
        userEvent: "input.type",
      });
      return true;
    }
    case "plain":
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: "$" },
        selection: { anchor: range.from + 1 },
        userEvent: "input.type",
      });
      return true;
    case "pair":
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: "$$" },
        selection: { anchor: range.from + 1 },
        userEvent: "input.type",
      });
      return true;
  }
}

/**
 * With auto-braces enabled, ^ and _ insert braces (^{} / _{}) with the
 * cursor inside; a selection is wrapped inside the braces.
 */
function applySupSub(view: EditorView, token: string): boolean {
  if (!useSettingsStore.getState().supsubBraces) return false;
  const state = view.state;
  if (state.selection.ranges.length > 1) return false;
  const range = state.selection.main;
  // If a brace is already next, let the default behavior through.
  if (state.doc.sliceString(range.to, range.to + 1) === "{") return false;
  if (range.empty) {
    view.dispatch({
      changes: { from: range.from, insert: `${token}{}` },
      selection: { anchor: range.from + token.length + 1 },
      userEvent: "input.type",
    });
  } else {
    const selected = state.doc.sliceString(range.from, range.to);
    const insert = `${token}{${selected}}`;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert },
      selection: { anchor: range.from + insert.length },
      userEvent: "input.type",
    });
  }
  return true;
}

function applyBracket(view: EditorView): boolean {
  const state = view.state;
  if (state.selection.ranges.length > 1) return false;
  const range = state.selection.main;
  const before = state.doc.sliceString(0, range.from);
  const after = state.doc.sliceString(range.from, state.doc.length);

  switch (decideBracket(before, after)) {
    case "pair-display": {
      if (range.empty) {
        // The backslash is already there; add "[" and the closing "\]".
        view.dispatch({
          changes: { from: range.from, insert: "[\\]" },
          selection: { anchor: range.from + 1 },
          userEvent: "input.type",
        });
      } else {
        const selected = state.doc.sliceString(range.from, range.to);
        const insert = `[${selected}\\]`;
        view.dispatch({
          changes: { from: range.from, to: range.to, insert },
          selection: { anchor: range.from + insert.length },
          userEvent: "input.type",
        });
      }
      return true;
    }
    case "skip-close": {
      // The user just typed a backslash in front of "\]": jump over it
      // and drop the backslash they typed to close the bracket.
      view.dispatch({
        changes: { from: range.from - 1, to: range.from, insert: "" },
        selection: { anchor: range.from + 1 },
        userEvent: "input.type",
      });
      return true;
    }
    default:
      return false;
  }
}

/** Math input helpers, at the highest precedence so they run before keymaps. */
export const mathPairing = Prec.highest(
  keymap.of([
    { key: "$", run: (view) => applyDollar(view) },
    { key: "[", run: (view) => applyBracket(view) },
    { key: "^", run: (view) => applySupSub(view, "^") },
    { key: "_", run: (view) => applySupSub(view, "_") },
  ]),
);
