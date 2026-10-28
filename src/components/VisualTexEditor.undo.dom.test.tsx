// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const disk: Record<string, string> = {};

vi.mock("@/lib/query-client", () => ({ invalidateGitState: vi.fn(async () => {}) }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  readProjectFile: vi.fn(async (_dir: string, path: string) => disk[path]),
  writeProjectFile: vi.fn(async (_dir: string, path: string, content: string) => {
    disk[path] = content;
  }),
}));

import { VisualTexEditor } from "@/components/VisualTexEditor";
import { setApplyEditsHandler } from "@/lib/editor-edits";
import { applyEdits } from "@/lib/label-index";
import { clearCrossFileMove, recordCrossFileMove } from "@/lib/outline-move";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";
import type { ProjectInfo } from "@/lib/tauri";

/**
 * Ctrl+Z / Ctrl+Shift+Z in the Visual face after a section moved into
 * another file: both files step together, as from the Code face. Tiptap's
 * history only holds the active file's half.
 */

const BEFORE = "\\begin{document}\n\\section{A}\na\n\\section{B}\nb\n\\end{document}\n";
const AFTER = "\\begin{document}\n\\section{A}\na\n\\end{document}\n";
const CHAPTER = "\\section{M}\nm\n";
const CHAPTER_AFTER = "\\section{M}\nm\n\\section{B}\nb\n";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  setApplyEditsHandler(null);
  clearCrossFileMove();
  useProjectStore.setState({ project: null, activeFile: null, buffers: {} });
});

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
}

function press(target: HTMLElement, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe("Visual face undo of a cross-file move", () => {
  it("steps both files on Ctrl+Z and Ctrl+Shift+Z", async () => {
    disk["chapter.tex"] = CHAPTER_AFTER;
    useProjectStore.setState({
      project: { path: "/p" } as ProjectInfo,
      activeFile: "main.tex",
      buffers: {},
    });
    useEditorStore.getState().loadContent(AFTER);
    // The hidden Code view applies edits to the store, then reloads.
    setApplyEditsHandler((edits) => {
      useEditorStore
        .getState()
        .loadContent(applyEdits(useEditorStore.getState().content, edits));
      return true;
    });
    recordCrossFileMove("/p", [
      { file: "main.tex", before: BEFORE, after: AFTER },
      { file: "chapter.tex", before: CHAPTER, after: CHAPTER_AFTER },
    ]);

    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<VisualTexEditor />);
    });
    await settle();
    const pm = host.querySelector(".ProseMirror") as HTMLElement;

    let event!: KeyboardEvent;
    await act(async () => {
      event = press(pm, { key: "z", ctrlKey: true });
    });
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(useEditorStore.getState().content).toBe(BEFORE);
    expect(disk["chapter.tex"]).toBe(CHAPTER);
    expect(pm.textContent).toContain("B");

    await act(async () => {
      press(pm, { key: "Z", metaKey: true, shiftKey: true });
    });
    await settle();
    expect(useEditorStore.getState().content).toBe(AFTER);
    expect(disk["chapter.tex"]).toBe(CHAPTER_AFTER);
  });

  it("leaves Ctrl+Z to the editor's history once the file changed", async () => {
    useProjectStore.setState({
      project: { path: "/p" } as ProjectInfo,
      activeFile: "main.tex",
      buffers: {},
    });
    useEditorStore.getState().loadContent(AFTER + "edited\n");
    recordCrossFileMove("/p", [{ file: "main.tex", before: BEFORE, after: AFTER }]);
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<VisualTexEditor />);
    });
    await settle();
    press(host.querySelector(".ProseMirror") as HTMLElement, {
      key: "z",
      ctrlKey: true,
    });
    await settle();
    expect(useEditorStore.getState().content).toBe(AFTER + "edited\n");
    // The move did not step: the key stayed with Tiptap's history.
  });
});
