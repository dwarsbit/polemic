import { beforeEach, describe, expect, it, vi } from "vitest";

const disk: Record<string, string> = {};

vi.mock("@/lib/query-client", () => ({ invalidateGitState: vi.fn(async () => {}) }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  readProjectFile: vi.fn(async (_dir: string, path: string) => disk[path]),
}));

import { planIssueFixes } from "@/lib/fix-issue";
import type { CompileIssue, FileEntry, ProjectInfo } from "@/lib/tauri";
import { useEditorStore } from "@/store/editor";
import { useProjectStore } from "@/store/project";

function warning(message: string, line: number | null = null): CompileIssue {
  return { severity: "warning", file: null, line, message, detail: [] };
}

const citation = warning(
  "LaTeX Warning: Citation 'leon2002' on page 1 undefined on input line 18",
  18,
);

/**
 * Fix is offered only where a rule has something to do, and citation
 * keys come from the project's own .bib files too.
 */
describe("planIssueFixes", () => {
  beforeEach(() => {
    disk["bibliography.bib"] = "@article{leon2002,\n  title = {Superism},\n}\n";
    useProjectStore.setState({
      project: { path: "/p" } as ProjectInfo,
      activeFile: "main.tex",
      mainFile: "main.tex",
      buffers: {},
      files: [
        {
          name: "bibliography.bib",
          path: "bibliography.bib",
          isDir: false,
          size: 0,
          modified: 0,
          children: [],
        } satisfies FileEntry,
      ],
    });
    useEditorStore.setState({ content: "\\cite{leon2002}\n" });
  });

  it("finds keys in the project's .bib files", async () => {
    const [fix] = await planIssueFixes([citation]);
    expect(fix?.action).toBe("recompile");
  });

  it("offers nothing for issues no rule covers or a rule declines", async () => {
    useProjectStore.setState({ files: [] });
    const fixes = await planIssueFixes([
      citation,
      warning("LaTeX Warning: Empty bibliography on input line 25", 25),
    ]);
    expect(fixes).toEqual([null, null]);
  });

  it("offers no recompile for citations while biber is failing", async () => {
    const biber: CompileIssue = {
      severity: "error",
      file: null,
      line: null,
      message:
        "biber failed: biber: extracting arm64 binary with lipo failed (wstatus=256)",
      detail: [],
      hint: "Update your TeX distribution.",
    };
    expect(await planIssueFixes([biber, citation])).toEqual([null, null]);
  });
});
