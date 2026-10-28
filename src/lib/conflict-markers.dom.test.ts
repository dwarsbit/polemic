// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { conflictHunks, conflictMarkers } from "@/lib/conflict-markers";

/**
 * The conflict bar above a hunk rewrites it in place; the tints follow
 * the sides and go away with the markers.
 */
describe("conflictMarkers in a view", () => {
  let view: EditorView;

  beforeEach(() => {
    view = new EditorView({
      state: EditorState.create({
        doc: [
          "before",
          "<<<<<<< HEAD",
          "mine",
          "=======",
          "theirs",
          ">>>>>>> origin/main",
          "after",
          "<<<<<<< HEAD",
          "mine 2",
          "=======",
          "theirs 2",
          ">>>>>>> origin/main",
          "",
        ].join("\n"),
        extensions: [conflictMarkers],
      }),
      parent: document.body,
    });
  });

  afterEach(() => {
    view.destroy();
  });

  const buttons = (label: string) =>
    [...view.dom.querySelectorAll<HTMLButtonElement>(".cm-conflict-button")].filter(
      (b) => b.textContent === label,
    );

  it("tints the sides and names them on the bar", () => {
    expect(view.dom.querySelectorAll(".cm-conflict-bar")).toHaveLength(2);
    expect(view.dom.querySelector(".cm-conflict-bar")!.textContent).toContain(
      "mine (HEAD) against theirs (origin/main)",
    );
    expect(view.dom.querySelectorAll(".cm-conflict-ours")).toHaveLength(2);
    expect(view.dom.querySelectorAll(".cm-conflict-theirs")).toHaveLength(2);
    expect(view.dom.querySelectorAll(".cm-conflict-marker")).toHaveLength(6);
  });

  it("keeps mine on the first hunk, then both on the second", () => {
    buttons("Keep mine")[0]!.click();
    expect(view.state.doc.toString()).toBe(
      [
        "before",
        "mine",
        "after",
        "<<<<<<< HEAD",
        "mine 2",
        "=======",
        "theirs 2",
        ">>>>>>> origin/main",
        "",
      ].join("\n"),
    );
    expect(conflictHunks(view.state)).toHaveLength(1);
    expect(view.dom.querySelectorAll(".cm-conflict-bar")).toHaveLength(1);

    buttons("Keep both")[0]!.click();
    expect(view.state.doc.toString()).toBe(
      ["before", "mine", "after", "mine 2", "theirs 2", ""].join("\n"),
    );
    expect(conflictHunks(view.state)).toHaveLength(0);
    expect(
      view.dom.querySelectorAll(".cm-conflict-bar, .cm-conflict-ours"),
    ).toHaveLength(0);
  });

  it("keeps theirs on the second hunk while the first stays", () => {
    buttons("Keep theirs")[1]!.click();
    expect(view.state.doc.toString()).toBe(
      [
        "before",
        "<<<<<<< HEAD",
        "mine",
        "=======",
        "theirs",
        ">>>>>>> origin/main",
        "after",
        "theirs 2",
        "",
      ].join("\n"),
    );
    expect(conflictHunks(view.state)).toHaveLength(1);
  });
});
