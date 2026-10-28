// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

import { OutlinePanel } from "@/components/OutlinePanel";
import { setApplyEditsHandler, setHistoryHandler } from "@/lib/editor-edits";
import { applyEdits, type SourceEdit } from "@/lib/label-index";
import {
  clearCrossFileMove,
  recordCrossFileMove,
  undoCrossFileMove,
} from "@/lib/outline-move";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";

/**
 * Sections move by pointer drag: HTML5 drag never fires in the
 * webview, so the panel follows pointer events and finds the drop
 * target under the pointer.
 */

const file = (path: string) => ({
  name: path,
  path,
  isDir: false,
  size: null,
  modified: null,
  children: [],
});

let root: Root | null = null;

async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<OutlinePanel />);
  });
  // Document order, then the outline itself, are debounced.
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
  }
  return host;
}

function row(host: HTMLElement, title: string): HTMLElement {
  const found = [
    ...host.querySelectorAll<HTMLElement>("[data-outline-drop=section]"),
  ].find((el) => el.textContent?.includes(title));
  if (found === undefined) throw new Error(`no ${title} row`);
  return found;
}

/** Drag `from` and release over the lower half of `to`. */
async function drag(from: HTMLElement, to: HTMLElement) {
  vi.spyOn(document, "elementFromPoint").mockReturnValue(to);
  vi.spyOn(to, "getBoundingClientRect").mockReturnValue({
    top: 0,
    height: 20,
  } as DOMRect);
  await act(async () => {
    from.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 0,
        clientY: 0,
      }),
    );
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 0, clientY: 15 }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 0, clientY: 15 }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  disk["main.tex"] = "";
  useProjectStore.setState({
    project: { name: "p", path: "/p" },
    files: [file("main.tex")],
    mainFile: "main.tex",
    activeFile: "main.tex",
    buffers: {},
  });
  useEditorStore.setState({
    content: "\\section{One}\nfirst\n\\section{Two}\nsecond\n",
  });
  setApplyEditsHandler((edits: SourceEdit[]) => {
    const state = useEditorStore.getState();
    useEditorStore.setState({ content: applyEdits(state.content, edits) });
    return true;
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  setApplyEditsHandler(null);
  setHistoryHandler(null);
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("OutlinePanel drag", () => {
  it("moves a section below another with pointer events", async () => {
    const host = await mount();
    await drag(row(host, "One"), row(host, "Two"));
    expect(useEditorStore.getState().content).toBe(
      "\\section{Two}\nsecond\n\\section{One}\nfirst\n",
    );
  });
});

describe("OutlinePanel undo", () => {
  function press(target: EventTarget, init: KeyboardEventInit) {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  }

  it("takes Ctrl+Z and Ctrl+Shift+Z to the editor while focus is in the panel", async () => {
    const host = await mount();
    const original = useEditorStore.getState().content;
    await drag(row(host, "One"), row(host, "Two"));
    const moved = useEditorStore.getState().content;
    // The editor's history: the drag is its last step.
    const history = vi.fn((direction: "undo" | "redo") => {
      useEditorStore.setState({ content: direction === "undo" ? original : moved });
      return true;
    });
    setHistoryHandler(history);

    const button = row(host, "Two").querySelector("button[data-outline-key]")!;
    let event!: KeyboardEvent;
    await act(async () => {
      event = press(button, { key: "z", ctrlKey: true });
    });
    expect(event.defaultPrevented).toBe(true);
    expect(history).toHaveBeenLastCalledWith("undo");
    expect(useEditorStore.getState().content).toBe(original);

    // Nothing focused at all (WebKit leaves clicked buttons unfocused).
    await act(async () => {
      press(document.body, { key: "Z", metaKey: true, shiftKey: true });
    });
    expect(history).toHaveBeenLastCalledWith("redo");
    expect(useEditorStore.getState().content).toBe(moved);
  });

  it("leaves Ctrl+Z alone in other panels and fields", async () => {
    await mount();
    const history = vi.fn(() => true);
    setHistoryHandler(history);
    const field = document.createElement("input");
    document.body.append(field);
    const event = press(field, { key: "z", ctrlKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(history).not.toHaveBeenCalled();
  });
});

describe("OutlinePanel move status", () => {
  it("follows an undo started outside the panel and offers Redo", async () => {
    const before = useEditorStore.getState().content;
    const after = "\\section{One}\nfirst\n";
    useEditorStore.setState({ content: after });
    disk["chapter.tex"] = "\\section{Two}\nsecond\n";
    recordCrossFileMove("/p", [
      { file: "main.tex", before, after },
      { file: "chapter.tex", before: "", after: disk["chapter.tex"] },
    ]);
    const host = await mount();

    // Ctrl+Z in an editor (either face) steps the move directly.
    await act(async () => {
      await undoCrossFileMove();
    });
    expect(useEditorStore.getState().content).toBe(before);
    expect(host.textContent).toContain("Move undone.");
    const redo = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Redo",
    );
    expect(redo).toBeDefined();

    await act(async () => {
      redo!.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(useEditorStore.getState().content).toBe(after);
    expect(host.textContent).toContain("Move redone.");
    clearCrossFileMove();
  });
});
