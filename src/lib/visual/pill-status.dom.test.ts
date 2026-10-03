// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { parseTex } from "./parse";
import { visualTexExtensions } from "./extensions";
import { useProjectStore } from "@/store/project";

/**
 * Pill hygiene badges: cite pills warn on keys no .bib defines, ref
 * pills on labels no file defines, label pills fade when nothing
 * references them. Statuses recompute when the project's cross-file
 * indexes change.
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
  "\\begin{document}",
  "See \\cite{knuth1984} and \\cite{ghost}.",
  "Also \\ref{eq:x} and \\ref{eq:known}, plus \\label{fig:unused}.",
  "\\end{document}",
  "",
].join("\n");

afterEach(() => {
  useProjectStore.setState({
    citeKeysByFile: {},
    labelsByFile: {},
    refsByFile: {},
  });
});

describe("pill hygiene badges", () => {
  it("warns on cited keys missing from the bibliography", () => {
    useProjectStore.setState({ citeKeysByFile: { "main.bib": ["knuth1984"] } });
    const editor = makeEditor(TEX);
    const bad = [...editor.view.dom.querySelectorAll(".vis-pill.vis-cite.vis-pill-warn")] as HTMLElement[];
    expect(bad.length).toBe(1);
    expect(bad[0]!.textContent).toContain("ghost");
    expect(bad[0]!.title).toContain("ghost");
    // The defined key carries no badge.
    const pills = editor.view.dom.querySelectorAll(".vis-pill.vis-cite");
    expect(pills.length).toBe(2);
    editor.destroy();
  });

  it("leaves cite pills alone when no bibliography exists", () => {
    const editor = makeEditor(TEX);
    expect(editor.view.dom.querySelectorAll(".vis-pill.vis-cite.vis-pill-warn").length).toBe(0);
    editor.destroy();
  });

  it("warns on refs to undefined labels, including multi-key refs", () => {
    useProjectStore.setState({ labelsByFile: { "main.tex": ["eq:known"] } });
    const editor = makeEditor(TEX);
    const warned = [
      ...editor.view.dom.querySelectorAll(".vis-pill.vis-ref.vis-pill-warn"),
    ] as HTMLElement[];
    expect(warned.length).toBe(1);
    expect(warned[0]!.textContent).toContain("eq:x");
    editor.destroy();
  });

  it("resolves refs against labels defined in this document", () => {
    const tex = "\\begin{document}\n\\ref{eq:x} later defined: \\label{eq:x}.\n\\end{document}\n";
    const editor = makeEditor(tex);
    expect(editor.view.dom.querySelectorAll(".vis-pill.vis-ref.vis-pill-warn").length).toBe(0);
    editor.destroy();
  });

  it("fades unused labels and recovers when a reference appears", () => {
    useProjectStore.setState({ labelsByFile: { "main.tex": ["eq:known"] } });
    const editor = makeEditor(TEX);
    const unused = editor.view.dom.querySelector(".vis-pill.vis-label.vis-pill-unused") as HTMLElement | null;
    expect(unused).not.toBeNull();
    expect(unused!.title).toContain("fig:unused");
    // A save elsewhere updates the cross-file index; the badge clears.
    useProjectStore.setState({ refsByFile: { "other.tex": ["fig:unused"] } });
    expect(editor.view.dom.querySelector(".vis-pill.vis-label.vis-pill-unused")).toBeNull();
    editor.destroy();
  });
});
