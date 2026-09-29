// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
import {
  dedentShiftTab,
  indentTab,
  tabDedentChanges,
  tabIndentChanges,
  tabIndent,
} from "@/lib/tab-indent";

/** State with the given selection for pure change computation. */
function stateOf(doc: string, anchor: number, head?: number) {
  return EditorState.create({
    doc,
    selection: head === undefined ? { anchor } : { anchor, head },
  });
}

/** Apply the changes to the state, returning the resulting document. */
function applied(state: EditorState, changes: ReturnType<typeof tabIndentChanges>) {
  return state.update({ changes }).state.doc.toString();
}

describe("tabIndent changes (pure)", () => {
  it("Tab at the cursor inserts an indent unit of spaces", () => {
    const state = stateOf("a\\begin{x}\nb", 11);
    expect(applied(state, tabIndentChanges(state))).toBe("a\\begin{x}\n  b");
  });

  it("Tab indents every line covered by the selection", () => {
    const state = stateOf("one\ntwo\nthree", 2, 9);
    expect(applied(state, tabIndentChanges(state))).toBe("  one\n  two\n  three");
  });

  it("Shift-Tab removes one indent unit of leading spaces", () => {
    const state = stateOf("    a\nb", 1);
    expect(applied(state, tabDedentChanges(state))).toBe("  a\nb");
  });

  it("Shift-Tab removes at most the remaining leading spaces", () => {
    const state = stateOf(" a", 1);
    expect(applied(state, tabDedentChanges(state))).toBe("a");
  });

  it("Shift-Tab removes a leading tab as one unit", () => {
    const state = stateOf("\ta", 1);
    expect(applied(state, tabDedentChanges(state))).toBe("a");
  });

  it("Shift-Tab dedents every line of the selection", () => {
    const state = stateOf("  one\n  two\n  three", 4, 12);
    expect(applied(state, tabDedentChanges(state))).toBe("one\ntwo\nthree");
  });

  it("Shift-Tab on a line without leading spaces changes nothing", () => {
    const state = stateOf("a\nb", 2);
    expect(tabDedentChanges(state)).toEqual([]);
  });
});

describe("tabIndent keymap (DOM)", () => {
  function mount(doc: string, anchor: number): EditorView {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const view = new EditorView({
      state: EditorState.create({ doc, selection: { anchor }, extensions: [basicSetup, tabIndent] }),
      parent: container,
    });
    return view;
  }

  it("dispatches a single indent transaction through the view", () => {
    const view = mount("a\\begin{x}\nb", 11);
    expect(indentTab(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("a\\begin{x}\n  b");
  });

  it("keys are consumed even when nothing changes", () => {
    const view = mount("a\nb", 2);
    expect(dedentShiftTab(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("a\nb");
  });
});
