// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { diagnosticCount } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { refLabelLint, refreshRefLabelLint } from "@/lib/ref-label-lint";
import type { FileEntry } from "@/lib/tauri";
import { useProjectStore } from "@/store/project";

function file(path: string): FileEntry {
  return { name: path, path, isDir: false, size: 1, modified: 0, children: [] };
}

/**
 * The missing-graphics hint follows the file tree: adding the image
 * clears it without editing the document.
 */
describe("refLabelLint refresh", () => {
  let view: EditorView;

  beforeEach(() => {
    vi.useFakeTimers();
    useProjectStore.setState({ activeFile: "main.tex", files: [file("main.tex")] });
    view = new EditorView({
      state: EditorState.create({
        doc: "\\includegraphics{plot.png}",
        extensions: [refLabelLint],
      }),
      parent: document.body,
    });
  });

  afterEach(() => {
    view.destroy();
    vi.useRealTimers();
  });

  async function settle() {
    await vi.advanceTimersByTimeAsync(2000);
  }

  it("re-lints when the refresh effect is dispatched", async () => {
    view.dispatch({ effects: refreshRefLabelLint.of(null) });
    await settle();
    expect(diagnosticCount(view.state)).toBe(1);

    useProjectStore.setState({ files: [file("main.tex"), file("plot.png")] });
    view.dispatch({ effects: refreshRefLabelLint.of(null) });
    await settle();
    expect(diagnosticCount(view.state)).toBe(0);
  });
});
