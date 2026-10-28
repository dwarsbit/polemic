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

import { SuggestionsPanel } from "@/components/SuggestionsPanel";
import { applyEdits, type SourceEdit } from "@/lib/changes";
import { setApplyEditsHandler, type ApplyEditsOptions } from "@/lib/editor-edits";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";

const file = (path: string) => ({
  name: path,
  path,
  isDir: false,
  size: null,
  modified: null,
  children: [],
});

const PREAMBLE =
  "\\documentclass{article}\n\\usepackage{changes}\n" +
  "\\definechangesauthor[name={Ann}, color=blue]{AN}\n" +
  "\\definechangesauthor[name={Bob}, color=red]{BO}\n\\begin{document}\n";

let root: Root | null = null;
let applied: { edits: SourceEdit[]; userEvent?: string; options?: ApplyEditsOptions }[];

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 300));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<SuggestionsPanel />);
  });
  await settle();
  return host;
}

const rows = (host: HTMLElement) => [
  ...host.querySelectorAll<HTMLElement>("[data-suggestion-row]"),
];

function button(host: ParentNode, title: string): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
  if (found === null) throw new Error(`no button "${title}"`);
  return found;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await settle();
}

beforeEach(() => {
  applied = [];
  disk["chapter.tex"] = "Old \\deleted[id=BO]{gone} text.\n";
  useProjectStore.setState({
    project: { name: "p", path: "/p" },
    files: [file("main.tex"), file("chapter.tex")],
    mainFile: "main.tex",
    activeFile: "main.tex",
    buffers: {},
  });
  useEditorStore.setState({
    content:
      PREAMBLE +
      "We \\added[id=AN]{really} \\replaced[id=BO, comment={Too strong?}]{confirm}{suggest} it.\n" +
      "\\end{document}\n",
  });
  setApplyEditsHandler((edits, userEvent, options) => {
    applied.push({ edits, userEvent, options });
    const state = useEditorStore.getState();
    useEditorStore.setState({ content: applyEdits(state.content, edits) });
    return true;
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  setApplyEditsHandler(null);
  document.body.innerHTML = "";
});

describe("SuggestionsPanel", () => {
  it("lists suggestions by file with author, kind, snippet and note", async () => {
    const host = await mount();
    const list = rows(host);
    expect(list.map((row) => row.textContent)).toEqual([
      "reallyAnn · Added · line 6",
      "suggest → confirmToo strong?Bob · Replaced · line 6",
      "goneBob · Deleted · line 1",
    ]);
    // The active file comes first.
    expect(host.textContent!.indexOf("main.tex")).toBeLessThan(
      host.textContent!.indexOf("chapter.tex"),
    );
  });

  it("accepts one suggestion in the editor as its own undo step", async () => {
    const host = await mount();
    await click(button(rows(host)[0], "Accept this suggestion"));
    expect(useEditorStore.getState().content).toContain("We really \\replaced");
    expect(applied).toHaveLength(1);
    expect(applied[0].userEvent).toBe("input.acceptChange");
    expect(applied[0].options?.isolate).toBe(true);
  });

  it("rejects one author's suggestions in every file", async () => {
    const host = await mount();
    const bob = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Bob",
    )!;
    await click(bob);
    expect(rows(host)).toHaveLength(2);
    await click(button(host, "Reject all of Bob's suggestions"));
    expect(useEditorStore.getState().content).toContain(
      "We \\added[id=AN]{really} suggest it.",
    );
    // The closed file is written on disk.
    expect(disk["chapter.tex"]).toBe("Old gone text.\n");
  });

  it("offers to remove the setup once no suggestion is left", async () => {
    useEditorStore.setState({ content: PREAMBLE + "Plain.\n\\end{document}\n" });
    disk["chapter.tex"] = "Plain.\n";
    const host = await mount();
    expect(rows(host)).toHaveLength(0);
    await click(
      [...host.querySelectorAll("button")].find(
        (b) => b.textContent === "Remove track changes setup",
      )!,
    );
    expect(useEditorStore.getState().content).toBe(
      "\\documentclass{article}\n\\begin{document}\nPlain.\n\\end{document}\n",
    );
  });
});
