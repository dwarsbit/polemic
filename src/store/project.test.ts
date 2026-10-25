import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory project folder behind the Tauri commands.
const disk = new Map<string, string>();
const ask = vi.fn(() => Promise.resolve(true));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...args: unknown[]) => ask(...(args as [])),
}));

vi.mock("@/lib/tauri", () => ({
  readProjectFile: (_dir: string, path: string) => {
    const content = disk.get(path);
    return content === undefined
      ? Promise.reject(new Error(`no ${path}`))
      : Promise.resolve(content);
  },
  writeProjectFile: (_dir: string, path: string, content: string) => {
    disk.set(path, content);
    return Promise.resolve();
  },
  listFiles: () =>
    Promise.resolve(
      [...disk.keys()].map((path) => ({
        name: path,
        path,
        isDir: false,
        children: [],
      })),
    ),
  renameEntry: (_dir: string, from: string, to: string) => {
    for (const [path, content] of [...disk]) {
      if (path === from || path.startsWith(`${from}/`)) {
        disk.delete(path);
        disk.set(to + path.slice(from.length), content);
      }
    }
    return Promise.resolve();
  },
  setOpenFiles: () => Promise.resolve(),
  updatePreferences: () => Promise.resolve(),
  restoreSnapshot: () => Promise.resolve(),
  listSnapshots: () => Promise.resolve([]),
  compileProject: () => Promise.resolve({ success: false, issues: [], log: "" }),
  getPdf: () => Promise.resolve(new Uint8Array()),
  setPreviewZoom: () => Promise.resolve(),
}));

vi.mock("@/lib/query-client", () => ({
  invalidateGitState: () => Promise.resolve(),
}));

const { useProjectStore } = await import("./project");
const { useEditorStore } = await import("./editor");
const { usePreviewStore } = await import("./preview");

const project = { name: "p", path: "/p" };

async function openMain(content: string) {
  disk.clear();
  disk.set("main.tex", content);
  useProjectStore.setState({ project, buffers: {}, openFiles: [], activeFile: null });
  await useProjectStore.getState().openFile("main.tex");
}

function type(content: string) {
  useEditorStore.getState().setContent(content);
  useProjectStore.getState().markDirty("main.tex", content);
}

beforeEach(() => {
  ask.mockClear();
  ask.mockImplementation(() => Promise.resolve(true));
});

describe("saving against outside changes", () => {
  it("saves normally when the file is unchanged on disk", async () => {
    await openMain("one");
    type("two");
    expect(await useProjectStore.getState().saveActiveFile()).toBe(true);
    expect(disk.get("main.tex")).toBe("two");
    expect(ask).not.toHaveBeenCalled();
    expect(useProjectStore.getState().buffers).toEqual({});
  });

  it("asks before overwriting a version changed outside the app", async () => {
    await openMain("one");
    type("mine");
    disk.set("main.tex", "theirs");
    ask.mockImplementation(() => Promise.resolve(false));
    expect(await useProjectStore.getState().saveActiveFile()).toBe(false);
    expect(disk.get("main.tex")).toBe("theirs");
    expect(ask).toHaveBeenCalledOnce();

    ask.mockImplementation(() => Promise.resolve(true));
    expect(await useProjectStore.getState().saveActiveFile()).toBe(true);
    expect(disk.get("main.tex")).toBe("mine");
  });

  it("does not mistake a tab's own unsaved edits for an outside change", async () => {
    await openMain("one");
    disk.set("other.tex", "a");
    type("mine");
    await useProjectStore.getState().openFile("other.tex");
    await useProjectStore.getState().openFile("main.tex");
    expect(useEditorStore.getState().content).toBe("mine");
    expect(await useProjectStore.getState().saveActiveFile()).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    expect(disk.get("main.tex")).toBe("mine");
  });

  it("never overwrites outside changes on a background save", async () => {
    await openMain("one");
    type("mine");
    disk.set("main.tex", "theirs");
    expect(await useProjectStore.getState().saveActiveFile({ background: true })).toBe(
      false,
    );
    expect(disk.get("main.tex")).toBe("theirs");
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("syncFromDisk", () => {
  it("reloads a clean active file changed outside the app", async () => {
    await openMain("one");
    disk.set("main.tex", "two");
    await useProjectStore.getState().syncFromDisk();
    expect(useEditorStore.getState().content).toBe("two");
    expect(useProjectStore.getState().lastSavedContent).toBe("two");
  });

  it("keeps unsaved edits instead of reloading", async () => {
    await openMain("one");
    type("mine");
    disk.set("main.tex", "theirs");
    await useProjectStore.getState().syncFromDisk();
    expect(useEditorStore.getState().content).toBe("mine");
  });
});

describe("restoring a snapshot", () => {
  it("writes unsaved edits to disk first, so the safety snapshot has them", async () => {
    await openMain("one");
    type("unsaved");
    await useProjectStore.getState().restoreSnapshot("snap-1");
    expect(disk.get("main.tex")).toBe("unsaved");
  });
});

describe("the preview follows the project", () => {
  it("drops the previous project's PDF when another project opens", () => {
    useProjectStore.setState({ project });
    usePreviewStore.setState({ pdfBytes: new Uint8Array([1]), status: "ok" });
    useProjectStore.setState({ project: { name: "q", path: "/q" } });
    expect(usePreviewStore.getState().pdfBytes).toBeNull();
    expect(usePreviewStore.getState().status).toBe("idle");
  });
});

describe("renaming assets", () => {
  it("rewrites graphics and bibliography references in every .tex file", async () => {
    await openMain("\\graphicspath{{figs/}}\n\\includegraphics{plot}\n\\input{chapter}");
    disk.set("chapter.tex", "\\includegraphics{figs/plot.pdf}\n\\bibliography{refs}");
    disk.set("figs/plot.pdf", "%PDF");
    disk.set("refs.bib", "");
    await useProjectStore.getState().refreshFiles();
    useProjectStore.getState().refreshDocMeta("main.tex", useEditorStore.getState().content);

    await useProjectStore.getState().renameEntry("figs/plot.pdf", "figs/results.pdf");
    expect(useEditorStore.getState().content).toContain("\\includegraphics{results}");
    expect(disk.get("chapter.tex")).toContain("\\includegraphics{figs/results.pdf}");

    await useProjectStore.getState().renameEntry("refs.bib", "bib/refs.bib");
    expect(disk.get("chapter.tex")).toContain("\\bibliography{bib/refs}");
  });
});
