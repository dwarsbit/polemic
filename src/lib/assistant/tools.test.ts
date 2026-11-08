import { describe, expect, it } from "vitest";
import type { CompileIssue } from "@/lib/tauri";
import {
  describeCall,
  numberLines,
  runTool,
  type AssistantHost,
  type ProposedChange,
} from "./tools";

const files: Record<string, string> = {
  "main.tex":
    "\\documentclass{article}\n\\begin{document}\nHello world.\n\\input{sections/intro}\n\\end{document}",
  "sections/intro.tex": "\\section{Intro}\nThe intro text.",
  "figures/plot.pdf": "",
};

const issue: CompileIssue = {
  severity: "error",
  file: "main.tex",
  line: 3,
  message: "Undefined control sequence.",
  detail: ["l.3 \\foo"],
};

function fakeHost(overrides: Partial<AssistantHost> = {}) {
  const proposed: Omit<ProposedChange, "id">[] = [];
  const host: AssistantHost = {
    listFiles: () => Object.keys(files),
    mainFile: () => "main.tex",
    readFile: async (path) => files[path] ?? null,
    issues: () => [issue],
    compile: async () => ({ success: true, issues: [] }),
    packageInfo: async (names) =>
      names.map((n) => ({ installed: n !== "nope", description: `${n} package` })),
    propose: (change) => {
      proposed.push(change);
      return proposed.length;
    },
    mode: () => "syntax",
    ...overrides,
  };
  return { host, proposed };
}

describe("numberLines", () => {
  it("numbers a range of lines and says what is left", () => {
    expect(numberLines("a\nb\nc\nd", 2, 3)).toBe("2| b\n3| c\n[lines 4-4 not shown]");
    expect(numberLines("a\nb", 1)).toBe("1| a\n2| b");
  });
});

describe("runTool", () => {
  it("lists files with the main file marked", async () => {
    const { host } = fakeHost();
    expect(await runTool(host, "list_files", {})).toBe(
      "main.tex (main file)\nsections/intro.tex\nfigures/plot.pdf",
    );
  });

  it("reads files and reports missing ones", async () => {
    const { host } = fakeHost();
    expect(await runTool(host, "read_file", { path: "sections/intro.tex" })).toBe(
      "1| \\section{Intro}\n2| The intro text.",
    );
    expect(await runTool(host, "read_file", { path: "nope.tex" })).toMatch(/^Error/);
  });

  it("searches the text files of the project", async () => {
    const { host } = fakeHost();
    expect(await runTool(host, "search_project", { query: "INTRO" })).toBe(
      "main.tex:4: \\input{sections/intro}\nsections/intro.tex:1: \\section{Intro}\nsections/intro.tex:2: The intro text.",
    );
  });

  it("reports compile issues and compile results", async () => {
    const { host } = fakeHost();
    expect(await runTool(host, "get_compile_issues", {})).toBe(
      "error main.tex:3: Undefined control sequence.\n  l.3 \\foo",
    );
    expect(await runTool(host, "compile", {})).toBe(
      "The compile succeeded.\nNo errors or warnings.",
    );
    const declined = fakeHost({ compile: async () => null });
    expect(await runTool(declined.host, "compile", {})).toMatch(/did not allow/);
  });

  it("looks up packages", async () => {
    const { host } = fakeHost();
    expect(await runTool(host, "package_info", { names: ["booktabs", "nope"] })).toBe(
      "booktabs: installed, booktabs package\nnope: not installed, nope package",
    );
  });

  it("proposes a valid change and flags prose edits", async () => {
    const { host, proposed } = fakeHost();
    const result = await runTool(host, "propose_change", {
      path: "main.tex",
      explanation: "Greets the reader.",
      replacements: [{ find: "Hello world.", replace: "Hello reader." }],
    });
    expect(result).toMatch(/^Proposed as change 1\./);
    expect(result).toMatch(/removes “world” and adds “reader”/);
    expect(proposed[0].after).toContain("Hello reader.");
    expect(proposed[0].creates).toBe(false);
    expect(proposed[0].prose).toEqual({ removed: ["world"], added: ["reader"] });
  });

  it("does not flag prose outside Syntax mode", async () => {
    const { host, proposed } = fakeHost({ mode: () => "prose" });
    await runTool(host, "propose_change", {
      path: "main.tex",
      explanation: "",
      replacements: [{ find: "Hello world.", replace: "Hello reader." }],
    });
    expect(proposed[0].prose).toBeNull();
  });

  it("turns down a Prose mode change that alters a number", async () => {
    const { host, proposed } = fakeHost({
      mode: () => "prose",
      readFile: async (path) =>
        path === "main.tex" ? "\\section{Intro}\nWe measured 3 streets." : null,
    });
    const args = {
      path: "main.tex",
      explanation: "",
      replacements: [
        { find: "We measured 3 streets.", replace: "We measured four streets." },
      ],
    };
    const result = await runTool(host, "propose_change", args);
    expect(result).toMatch(/^Turned down: this change changes a number\./);
    expect(proposed).toHaveLength(0);
    expect(describeCall("propose_change", args, result)).toBe(
      "Held back a change to main.tex that changes a number",
    );
  });

  it("proposes a new file", async () => {
    const { host, proposed } = fakeHost();
    const result = await runTool(host, "propose_change", {
      path: "./macros.sty",
      explanation: "Adds a package.",
      replacements: [{ find: "", replace: "\\ProvidesPackage{macros}" }],
    });
    expect(result).toMatch(/^Proposed/);
    expect(proposed[0]).toMatchObject({
      path: "macros.sty",
      creates: true,
      before: "",
    });
  });

  it("refuses changes that do not match or leave the project", async () => {
    const { host, proposed } = fakeHost();
    expect(
      await runTool(host, "propose_change", {
        path: "main.tex",
        explanation: "",
        replacements: [{ find: "Goodbye", replace: "x" }],
      }),
    ).toMatch(/does not occur/);
    expect(
      await runTool(host, "propose_change", {
        path: "../outside.tex",
        explanation: "",
        replacements: [{ find: "", replace: "x" }],
      }),
    ).toMatch(/inside the project/);
    expect(proposed).toHaveLength(0);
  });
});
