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
    deleteEntry: vi.fn(async (_dir: string, target: string) => {
      for (const path of Object.keys(disk)) {
        if (path === target || path.startsWith(`${target}/`)) delete disk[path];
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

/** Labels, refs, cite keys and the rest follow renamed and deleted files. */
describe("per-file metadata on rename and delete", () => {
  beforeEach(async () => {
    for (const key of Object.keys(disk)) delete disk[key];
    disk["main.tex"] = "\\input{ch/one}\n";
    disk["ch/one.tex"] = "\\label{sec:one}\n";
    disk["refs.bib"] = "@book{knuth,}\n";
    const byFile = <T>(main: T, one: T) => ({ "main.tex": main, "ch/one.tex": one });
    useProjectStore.setState({
      project: { path: "/p" } as ProjectInfo,
      files: await listFiles("/p"),
      activeFile: null,
      mainFile: null,
      buffers: {},
      openFiles: [],
      labelsByFile: byFile(["sec:main"], ["sec:one"]),
      refsByFile: byFile(["sec:one"], []),
      citeKeysByFile: { "refs.bib": ["knuth"] },
      graphicsPathsByFile: byFile([], ["figures/"]),
      biblatexByFile: byFile(true, false),
      natbibByFile: byFile(false, true),
    });
  });

  const metadataKeys = () => {
    const s = useProjectStore.getState();
    return [
      s.labelsByFile,
      s.refsByFile,
      s.graphicsPathsByFile,
      s.biblatexByFile,
      s.natbibByFile,
    ].map((byFile) => Object.keys(byFile).sort());
  };

  it("drops a deleted .tex file's labels", async () => {
    await useProjectStore.getState().deleteEntry("ch/one.tex");
    expect(useProjectStore.getState().allLabels()).toEqual(["sec:main"]);
    expect(metadataKeys()).toEqual(Array(5).fill(["main.tex"]));
  });

  it("drops a deleted .bib file's cite keys", async () => {
    await useProjectStore.getState().deleteEntry("refs.bib");
    expect(useProjectStore.getState().allCiteKeys()).toEqual([]);
  });

  it("drops everything under a deleted folder", async () => {
    await useProjectStore.getState().deleteEntry("ch");
    expect(useProjectStore.getState().allLabels()).toEqual(["sec:main"]);
    expect(metadataKeys()).toEqual(Array(5).fill(["main.tex"]));
  });

  it("re-keys a renamed file", async () => {
    await useProjectStore.getState().renameEntry("ch/one.tex", "ch/first.tex");
    const s = useProjectStore.getState();
    expect(s.labelsByFile).toEqual({ "main.tex": ["sec:main"], "ch/first.tex": ["sec:one"] });
    expect(metadataKeys()).toEqual(Array(5).fill(["ch/first.tex", "main.tex"]));
    expect(s.natbibByFile["ch/first.tex"]).toBe(true);
  });

  it("re-keys a renamed .bib file", async () => {
    await useProjectStore.getState().renameEntry("refs.bib", "lit.bib");
    expect(useProjectStore.getState().citeKeysByFile).toEqual({ "lit.bib": ["knuth"] });
  });

  it("re-keys everything under a renamed folder", async () => {
    await useProjectStore.getState().renameEntry("ch", "chapters");
    const s = useProjectStore.getState();
    expect(s.graphicsPathsByFile["chapters/one.tex"]).toEqual(["figures/"]);
    expect(metadataKeys()).toEqual(Array(5).fill(["chapters/one.tex", "main.tex"]));
  });
});
