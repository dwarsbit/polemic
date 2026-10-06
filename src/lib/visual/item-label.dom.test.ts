// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { parseTex } from "./parse";
import { serializeTex } from "./serialize";
import { visualTexExtensions } from "./extensions";

/**
 * List item labels: `\item[label]` (already parsed and serialized)
 * becomes a visible chip reading as the marker, edited in place with
 * the meta-pill input pattern; unlabeled items can gain one.
 */

function makeEditor(tex: string): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({
        document: false,
        heading: false,
        listItem: false,
        hardBreak: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        link: false,
        strike: false,
      }),
      ...visualTexExtensions,
    ],
    content: parseTex(tex) as never,
  });
}

const TEX = [
  "\\begin{itemize}",
  "  \\item[Note] First point",
  "  \\item Second point",
  "\\end{itemize}",
  "",
].join("\n");

describe("list item labels", () => {
  it("shows a labeled item's chip as its marker", () => {
    const editor = makeEditor(TEX);
    const chip = editor.view.dom.querySelector(".vis-item-label:not(.vis-item-label-add)");
    expect(chip?.textContent).toBe("(Note)");
    // The label replaces the bullet marker.
    expect(editor.view.dom.querySelector("li.has-label")).not.toBeNull();
    expect(serializeTex(editor.getJSON() as never)).toContain("\\item[Note] First point");
    editor.destroy();
  });

  it("offers an add chip on unlabeled items", () => {
    const editor = makeEditor(TEX);
    const add = editor.view.dom.querySelector(".vis-item-label-add");
    expect(add?.textContent).toBe("+");
    editor.destroy();
  });

  it("edits the label in place and serializes the edit", async () => {
    const editor = makeEditor(TEX);
    const chip = editor.view.dom.querySelector(
      ".vis-item-label:not(.vis-item-label-add)",
    ) as HTMLElement | null;
    expect(chip).not.toBeNull();
    chip!.click();
    await Promise.resolve(); // let the focus microtask run
    const input = editor.view.dom.querySelector(".vis-item-input") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input!.value).toBe("Note");
    input!.value = "Hint";
    input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const out = serializeTex(editor.getJSON() as never);
    expect(out).toContain("\\item[Hint] First point");
    expect(out).toContain("Second point");
    // One undo step.
    editor.commands.undo();
    expect(serializeTex(editor.getJSON() as never)).toContain("\\item[Note] First point");
    editor.destroy();
  });

  it("adds a label through the add chip", async () => {
    const editor = makeEditor(TEX);
    const add = editor.view.dom.querySelector(".vis-item-label-add") as HTMLElement | null;
    add!.click();
    await Promise.resolve(); // let the focus microtask run
    const input = editor.view.dom.querySelector(".vis-item-input") as HTMLInputElement | null;
    input!.value = "fresh";
    input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const out = serializeTex(editor.getJSON() as never);
    expect(out).toContain("\\item[fresh] Second point");
    editor.destroy();
  });

  it("removes the label on an empty commit", async () => {
    const editor = makeEditor(TEX);
    const chip = editor.view.dom.querySelector(
      ".vis-item-label:not(.vis-item-label-add)",
    ) as HTMLElement | null;
    chip!.click();
    await Promise.resolve(); // let the focus microtask run
    const input = editor.view.dom.querySelector(".vis-item-input") as HTMLInputElement | null;
    input!.value = "";
    input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const out = serializeTex(editor.getJSON() as never);
    expect(out).toContain("\\item First point");
    expect(out).not.toContain("[Note]");
    editor.destroy();
  });

  it("reverts an edit on Escape", async () => {
    const editor = makeEditor(TEX);
    const chip = editor.view.dom.querySelector(
      ".vis-item-label:not(.vis-item-label-add)",
    ) as HTMLElement | null;
    chip!.click();
    await Promise.resolve(); // let the focus microtask run
    const input = editor.view.dom.querySelector(".vis-item-input") as HTMLInputElement | null;
    input!.value = "Changed";
    input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    const out = serializeTex(editor.getJSON() as never);
    expect(out).toContain("\\item[Note] First point");
    expect(out).not.toContain("[Changed]");
    editor.destroy();
  });
});
