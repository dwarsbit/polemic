import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory project folder behind the Tauri commands.
const disk = new Map<string, string>();
/** Runs inside a disk write, before it resolves: an edit racing it. */
let duringWrite: ((path: string) => void) | null = null;
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
    duringWrite?.(path);
    return Promise.resolve();
  },
  deleteEntry: (_dir: string, path: string) => {
    disk.delete(path);
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
  setOpenFiles: () => Promise.resolve(),
  renameEntry: (_dir: string, from: string, to: string) => {
    disk.set(to, disk.get(from)!);
    disk.delete(from);
    return Promise.resolve();
  },
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
  duringWrite = null;
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

describe("undoing back to the saved text", () => {
  function edit(content: string) {
    useEditorStore.getState().setContent(content);
    useProjectStore.getState().noteActiveEdit(content);
  }

  it("drops the buffer, so closing the tab does not write the undone edit", async () => {
    await openMain("X");
    edit("Xa");
    expect(useProjectStore.getState().buffers).toEqual({ "main.tex": "Xa" });
    edit("X");
    expect(useProjectStore.getState().buffers).toEqual({});
    await useProjectStore.getState().closeFile("main.tex");
    expect(disk.get("main.tex")).toBe("X");
  });

  it("does not flush the undone edit on window close", async () => {
    await openMain("X");
    edit("Xa");
    edit("X");
    await useProjectStore.getState().flushBuffers();
    expect(disk.get("main.tex")).toBe("X");
  });

  it("does not bring the undone edit back when the tab is reopened", async () => {
    await openMain("X");
    disk.set("other.tex", "O");
    edit("Xa");
    edit("X");
    await useProjectStore.getState().openFile("other.tex");
    await useProjectStore.getState().openFile("main.tex");
    expect(useEditorStore.getState().content).toBe("X");
  });
});

describe("edits landing during an async store action", () => {
  it("closeFile keeps a buffer marked dirty during its write", async () => {
    await openMain("one");
    type("two");
    const closing = useProjectStore.getState().closeFile("main.tex");
    useProjectStore.getState().markDirty("other.tex", "edited");
    await closing;
    expect(disk.get("main.tex")).toBe("two");
    expect(useProjectStore.getState().buffers).toEqual({ "other.tex": "edited" });
  });

  it("renameEntry keeps a buffer marked dirty during the rename", async () => {
    await openMain("one");
    disk.set("old.tex", "old");
    const renaming = useProjectStore.getState().renameEntry("old.tex", "new.tex");
    useProjectStore.getState().markDirty("main.tex", "edited");
    await renaming;
    expect(useProjectStore.getState().buffers).toEqual({ "main.tex": "edited" });
  });

  it("deleteEntry keeps a buffer marked dirty during the delete", async () => {
    await openMain("one");
    disk.set("old.png", "");
    const deleting = useProjectStore.getState().deleteEntry("old.png");
    useProjectStore.getState().markDirty("other.tex", "edited");
    await deleting;
    expect(useProjectStore.getState().buffers).toEqual({ "other.tex": "edited" });
  });

  it("an include sync keeps a buffer marked dirty during its write", async () => {
    // Deleting ch.tex drops its \input from main.tex (applyContentUpdate).
    await openMain("\\input{ch}\nbody");
    disk.set("ch.tex", "chapter");
    duringWrite = (path) => {
      if (path === "main.tex") {
        useProjectStore.getState().markDirty("other.tex", "edited");
      }
    };
    await useProjectStore.getState().deleteEntry("ch.tex");
    expect(disk.get("main.tex")).toBe("body");
    expect(useProjectStore.getState().buffers).toEqual({ "other.tex": "edited" });
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
