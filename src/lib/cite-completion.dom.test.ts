// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  acceptCompletion,
  completionStatus,
  currentCompletions,
  startCompletion,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "codemirror";
import { citeCommandOptions, latexAutocompletion } from "@/lib/completion";
import { useProjectStore } from "@/store/project";

const labels = (packages: { natbib: boolean; biblatex: boolean }) =>
  citeCommandOptions(packages).map((option) => option.label);

describe("citeCommandOptions", () => {
  it("offers \\cite and \\nocite without a citation package", () => {
    expect(labels({ natbib: false, biblatex: false })).toEqual(["\\cite", "\\nocite"]);
  });

  it("adds natbib's commands when natbib is loaded", () => {
    const natbib = labels({ natbib: true, biblatex: false });
    expect(natbib).toContain("\\citep");
    expect(natbib).toContain("\\citet");
    expect(natbib).not.toContain("\\parencite");
  });

  it("adds biblatex's commands, once each", () => {
    const both = labels({ natbib: true, biblatex: true });
    expect(both).toContain("\\parencite");
    expect(both).toContain("\\textcite");
    expect(both.filter((label) => label === "\\citeauthor")).toHaveLength(1);
  });
});

/** Wait for the completion state to settle (sources run async). */
async function settle(view: EditorView) {
  for (let i = 0; i < 20 && completionStatus(view.state) === "pending"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("accepting a cite command", () => {
  it("inserts braces and opens the key list inside them", async () => {
    useProjectStore.setState({
      biblatexByFile: { "main.tex": true },
      natbibByFile: {},
      citeKeysByFile: { "bibliography.bib": ["leon2002"] },
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({ doc: "\\parenc", extensions: [latexAutocompletion] }),
      parent,
    });
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.focus();
    startCompletion(view);
    await settle(view);
    expect(currentCompletions(view.state)[0]?.label).toBe("\\parencite");
    // What Enter does, once past CodeMirror's 75ms interaction delay.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(acceptCompletion(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("\\parencite{}");
    expect(view.state.selection.main.head).toBe("\\parencite{".length);
    await settle(view);
    expect(currentCompletions(view.state).map((o) => o.label)).toEqual(["leon2002"]);
    view.destroy();
  });
});
