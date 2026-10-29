import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Comment } from "@/lib/tauri";

// comments.json per project, written when a save settles.
const disk = new Map<string, Comment[]>();
// Saves and loads in flight, settled by the test in any order.
let saves: { dir: string; comments: Comment[]; settle: () => void }[] = [];
let loads: { dir: string; settle: () => void }[] = [];

vi.mock("@/lib/tauri", () => ({
  saveComments: (dir: string, comments: Comment[]) =>
    new Promise<void>((resolve) => {
      saves.push({
        dir,
        comments,
        settle: () => {
          disk.set(dir, comments);
          resolve();
        },
      });
    }),
  listComments: (dir: string) =>
    new Promise<Comment[]>((resolve) => {
      loads.push({ dir, settle: () => resolve(disk.get(dir) ?? []) });
    }),
}));

vi.mock("@/store/project", async () => {
  const { create } = await import("zustand");
  return {
    useProjectStore: create<{ project: { path: string } | null }>(() => ({
      project: null,
    })),
  };
});

const { useCommentsStore } = await import("@/store/comments");
const { useProjectStore } = await import("@/store/project");

function openProject(path: string) {
  useProjectStore.setState({ project: { path } } as never);
}

/** Settles whatever is in flight, newest first, until nothing is left. */
async function settleSavesNewestFirst() {
  for (;;) {
    await new Promise((r) => setTimeout(r, 0));
    if (saves.length === 0) return;
    const pending = saves;
    saves = [];
    for (const save of pending.reverse()) save.settle();
  }
}

beforeEach(() => {
  disk.clear();
  saves = [];
  loads = [];
  useCommentsStore.setState({ comments: [], loaded: false });
  openProject("/a");
});

describe("comments store", () => {
  it("leaves the latest list on disk when saves finish out of order", async () => {
    const adding = useCommentsStore
      .getState()
      .add({ file: "main.tex", category: "note", text: "first", anchor: null });
    const id = useCommentsStore.getState().comments[0].id;
    const resolving = useCommentsStore.getState().update(id, { resolved: true });
    const editing = useCommentsStore.getState().update(id, { text: "edited" });

    await settleSavesNewestFirst();
    await Promise.all([adding, resolving, editing]);

    expect(disk.get("/a")).toEqual(useCommentsStore.getState().comments);
    expect(disk.get("/a")?.[0]).toMatchObject({ text: "edited", resolved: true });
  });

  it("drops a load that finishes after the project changed", async () => {
    disk.set("/a", [
      {
        id: "x",
        file: "main.tex",
        category: "note",
        text: "from a",
        createdAt: 0,
        resolved: false,
        anchor: null,
      },
    ]);
    const loading = useCommentsStore.getState().load();
    openProject("/b");
    loads[0].settle();
    await loading;

    expect(useCommentsStore.getState().comments).toEqual([]);
    expect(useCommentsStore.getState().loaded).toBe(false);
  });
});
