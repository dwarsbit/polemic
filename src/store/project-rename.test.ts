import { beforeEach, describe, expect, it, vi } from "vitest";

const disk: Record<string, string> = {};

vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true) }));
vi.mock("@/lib/query-client", () => ({ invalidateGitState: vi.fn(async () => {}) }));
vi.mock("@/lib/tauri", async (importOriginal) => {
  const entry = (path: string) => ({
    name: path.split("/").pop()!,
    path,
    isDir: false,
    size: 1,
    modified: 0,
    children: [],
  });
  return {
    ...(await importOriginal<typeof import("@/lib/tauri")>()),
    readProjectFile: vi.fn(async (_dir: string, path: string) => disk[path]),
    writeProjectFile: vi.fn(async (_dir: string, path: string, content: string) => {
      disk[path] = content;
    }),
    renameEntry: vi.fn(async (_dir: string, from: string, to: string) => {
      for (const path of Object.keys(disk)) {
        if (path === from || path.startsWith(`${from}/`)) {
          disk[to + path.slice(from.length)] = disk[path];
          delete disk[path];
        }
      }
    }),
    listFiles: vi.fn(async () => Object.keys(disk).sort().map(entry)),
  };
});

import { listFiles, type ProjectInfo } from "@/lib/tauri";
import { useProjectStore } from "@/store/project";

/** Renaming an image or its folder keeps \includegraphics pointing at it. */
describe("renameEntry and graphics references", () => {
  beforeEach(async () => {
    for (const key of Object.keys(disk)) delete disk[key];
    disk["main.tex"] =
      "\\graphicspath{{figures/}}\n\\includegraphics{plot}\n\\includegraphics{figures/map.pdf}\n";
    disk["figures/plot.png"] = "";
    disk["figures/map.pdf"] = "";
    useProjectStore.setState({
      project: { path: "/p" } as ProjectInfo,
      files: await listFiles("/p"),
      activeFile: null,
      buffers: {},
      openFiles: [],
      graphicsPathsByFile: { "main.tex": ["figures/"] },
    });
  });

  it("follows a renamed image", async () => {
    await useProjectStore
      .getState()
      .renameEntry("figures/map.pdf", "figures/world.pdf");
    expect(disk["main.tex"]).toContain("\\includegraphics{figures/world.pdf}");
  });

  it("follows a renamed folder, \\graphicspath included", async () => {
    await useProjectStore.getState().renameEntry("figures", "img");
    expect(disk["main.tex"]).toBe(
      "\\graphicspath{{img/}}\n\\includegraphics{plot}\n\\includegraphics{img/map.pdf}\n",
    );
  });
});
