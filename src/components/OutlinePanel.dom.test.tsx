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
import { setApplyEditsHandler } from "@/lib/editor-edits";
import { applyEdits, type SourceEdit } from "@/lib/label-index";
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
