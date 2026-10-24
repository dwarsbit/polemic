// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const disk: Record<string, string> = {};

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true) }));
vi.mock("@/lib/query-client", () => ({ invalidateGitState: vi.fn(async () => {}) }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  readProjectFile: vi.fn(async (_dir: string, path: string) => disk[path]),
  writeProjectFile: vi.fn(async (_dir: string, path: string, content: string) => {
    disk[path] = content;
  }),
}));

import { SearchPanel } from "@/components/SearchPanel";
import { setApplyEditsHandler } from "@/lib/editor-edits";
import { applyEdits, type SourceEdit } from "@/lib/label-index";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";
import { useSearchStore } from "@/store/search";

/**
 * Project-wide replace: the active file changes through the editor
 * (one undo step), dirty buffers in memory, other files on disk; the
 * scope filter applies to replace as it does to search.
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
    root!.render(<SearchPanel onToggle={() => {}} />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 300));
  });
  return host;
}

function button(host: HTMLElement, text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === text,
  );
  if (found === undefined) throw new Error(`no ${text} button`);
  return found;
}

beforeEach(() => {
  disk["main.tex"] = "unused";
  disk["chapters/a.tex"] = "Alpha and $alpha$\n";
  useProjectStore.setState({
    project: { name: "p", path: "/p" },
    files: [file("main.tex"), file("chapters/a.tex"), file("chapters/b.tex")],
    activeFile: "main.tex",
    buffers: { "chapters/b.tex": "alpha in a buffer\n" },
  });
  useEditorStore.setState({ content: "alpha main\n" });
  setApplyEditsHandler((edits: SourceEdit[]) => {
    const state = useEditorStore.getState();
    useEditorStore.setState({ content: applyEdits(state.content, edits) });
    return true;
  });
  useSearchStore.setState({
    query: "alpha",
    scope: "text",
    caseSensitive: false,
    replaceOpen: true,
    replacement: "beta",
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  setApplyEditsHandler(null);
  document.body.innerHTML = "";
});

describe("SearchPanel replace", () => {
  it("replaces across the editor, buffers and disk, outside math only", async () => {
    const host = await mount();
    expect(host.textContent).toContain("3 matches in 3 files");
    await act(async () => {
      button(host, "Replace all").click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(useEditorStore.getState().content).toBe("beta main\n");
    expect(useProjectStore.getState().buffers["chapters/b.tex"]).toBe(
      "beta in a buffer\n",
    );
    expect(disk["chapters/a.tex"]).toBe("beta and $alpha$\n");
  });

  it("replaces a single line", async () => {
    useSearchStore.setState({ scope: "all" });
    const host = await mount();
    const lineButtons = [...host.querySelectorAll("button")].filter(
      (b) => b.textContent === "Replace",
    );
    // Hits in tree order: main.tex, chapters/a.tex, chapters/b.tex.
    await act(async () => {
      lineButtons[1].click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(disk["chapters/a.tex"]).toBe("beta and $beta$\n");
    expect(useEditorStore.getState().content).toBe("alpha main\n");
  });
});
