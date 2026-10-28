import { beforeEach, describe, expect, it, vi } from "vitest";
import { Text } from "@codemirror/state";

const disk: Record<string, string> = {};

vi.mock("@/lib/query-client", () => ({ invalidateGitState: vi.fn(async () => {}) }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  readProjectFile: vi.fn(async (_dir: string, path: string) => disk[path]),
  writeProjectFile: vi.fn(async (_dir: string, path: string, content: string) => {
    disk[path] = content;
  }),
}));

import { setApplyEditsHandler } from "@/lib/editor-edits";
import { applyEdits } from "@/lib/label-index";
import { planMoveToFile } from "@/lib/outline-edit";
import {
  applyCrossFileMove,
  canRedoCrossFileMove,
  canUndoCrossFileMove,
  clearCrossFileMove,
  redoCrossFileMove,
  undoCrossFileMove,
} from "@/lib/outline-move";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";
import type { ProjectInfo } from "@/lib/tauri";

/**
 * A section moved from the active file into a file on disk: both
 * change, the editor history is left alone, and undo restores both
 * only while neither changed since.
 */
describe("cross-file move", () => {
  const main = "\\section{A}\na\n\\section{B}\nb\n";
  const chapter = "\\section{M}\nm\n";
  let history: boolean[];

  beforeEach(() => {
    clearCrossFileMove();
    history = [];
    disk["chapter.tex"] = chapter;
    useProjectStore.setState({
      project: { path: "/p" } as ProjectInfo,
      activeFile: "main.tex",
      buffers: {},
    });
    useEditorStore.setState({ content: main });
    // The editor: applies edits to the store content, noting history.
    setApplyEditsHandler((edits, _event, options) => {
      history.push(options?.addToHistory !== false);
      useEditorStore.setState({
        content: applyEdits(useEditorStore.getState().content, edits),
      });
      return true;
    });
  });

  async function moveB() {
    const plan = planMoveToFile(main, 1, chapter, { position: "end" })!;
    return applyCrossFileMove(
      "/p",
      "main.tex",
      main,
      plan.sourceEdits,
      "chapter.tex",
      chapter,
      plan.targetEdits,
    );
  }

  it("moves, then undoes in both files", async () => {
    expect(await moveB()).toBe(true);
    const moved = useEditorStore.getState().content;
    expect(moved).toBe("\\section{A}\na\n");
    expect(disk["chapter.tex"]).toBe("\\section{M}\nm\n\\section{B}\nb\n");
    expect(history).toEqual([false]);

    expect(canUndoCrossFileMove("main.tex", Text.of(moved.split("\n")))).toBe(true);
    expect(await undoCrossFileMove()).toBe(true);
    expect(useEditorStore.getState().content).toBe(main);
    expect(disk["chapter.tex"]).toBe(chapter);
    expect(history).toEqual([false, false]);
    // Undone once: nothing left to undo.
    expect(await undoCrossFileMove()).toBe(false);
  });

  it("does not undo when the other file changed since", async () => {
    await moveB();
    disk["chapter.tex"] += "more\n";
    expect(await undoCrossFileMove()).toBe(false);
    expect(useEditorStore.getState().content).toBe("\\section{A}\na\n");
  });

  it("does not offer Ctrl+Z once the active file was edited", async () => {
    await moveB();
    const edited = useEditorStore.getState().content + "x";
    expect(canUndoCrossFileMove("main.tex", Text.of(edited.split("\n")))).toBe(false);
  });

  it("redoes an undone move in both files, and undoes it again", async () => {
    await moveB();
    const moved = useEditorStore.getState().content;
    const movedChapter = disk["chapter.tex"];
    expect(await redoCrossFileMove()).toBe(false); // nothing undone yet
    await undoCrossFileMove();

    expect(canRedoCrossFileMove("main.tex", Text.of(main.split("\n")))).toBe(true);
    expect(await redoCrossFileMove()).toBe(true);
    expect(useEditorStore.getState().content).toBe(moved);
    expect(disk["chapter.tex"]).toBe(movedChapter);
    expect(history).toEqual([false, false, false]);
    expect(await redoCrossFileMove()).toBe(false);

    expect(await undoCrossFileMove()).toBe(true);
    expect(useEditorStore.getState().content).toBe(main);
    expect(disk["chapter.tex"]).toBe(chapter);
  });

  it("does not redo when a file changed after the undo", async () => {
    await moveB();
    await undoCrossFileMove();
    disk["chapter.tex"] += "more\n";
    expect(await redoCrossFileMove()).toBe(false);
    expect(useEditorStore.getState().content).toBe(main);
    const edited = main + "x";
    expect(canRedoCrossFileMove("main.tex", Text.of(edited.split("\n")))).toBe(false);
  });

  it("forgets the undone move once another move is recorded", async () => {
    await moveB();
    await undoCrossFileMove();
    await moveB();
    expect(await redoCrossFileMove()).toBe(false);
  });
});
