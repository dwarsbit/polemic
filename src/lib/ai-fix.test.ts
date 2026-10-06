import { describe, expect, it } from "vitest";
import { buildUserPrompt, parseAiFixResponse, promptWindow } from "./ai-fix";
import type { CompileIssue } from "./tauri";

const DOC = [
  "\\documentclass{article}",
  "\\begin{document}",
  "Hello world.",
  "The value x_1 is nice.",
  "\\end{document}",
  "",
].join("\n");

function issue(partial: Partial<CompileIssue>): CompileIssue {
  return {
    severity: "error",
    file: "main.tex",
    line: null,
    message: "Missing $ inserted.",
    detail: [],
    ...partial,
  };
}

describe("promptWindow", () => {
  it("windows around the error line", () => {
    const long = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
    const window = promptWindow(long, 50);
    expect(window.firstLine).toBe(20);
    expect(window.text.split("\n").length).toBe(71);
    expect(window.text.split("\n")[30]).toBe("line 50");
  });

  it("clamps a line beyond the document", () => {
    const window = promptWindow(DOC, 99);
    expect(window.firstLine).toBe(1);
    expect(window.text).toBe(DOC);
  });
});

describe("buildUserPrompt", () => {
  it("includes the message, context, and the error line", () => {
    const prompt = buildUserPrompt(
      issue({ line: 4, detail: ["l.4 ...x_1"] }),
      DOC,
    );
    expect(prompt).toContain("Missing $ inserted.");
    expect(prompt).toContain("l.4 ...x_1");
    expect(prompt).toContain("The value x_1 is nice.");
    expect(prompt).toContain("starts at line 1");
  });
});

describe("parseAiFixResponse", () => {
  it("validates find/replace pairs into edits", () => {
    const result = parseAiFixResponse(
      JSON.stringify({
        explanation: "Wrap the subscript in math mode.",
        replacements: [{ find: "x_1", replace: "$x_1$" }],
      }),
      DOC,
      4,
    );
    if (!("fix" in result)) throw new Error("expected a fix");
    expect(result.fix.edits).toEqual([
      { from: DOC.indexOf("x_1"), to: DOC.indexOf("x_1") + 3, insert: "$x_1$" },
    ]);
    expect(result.fix.fixed).toContain("The value $x_1$ is nice.");
  });

  it("unwraps markdown fences and caps the replacements", () => {
    const content = "```json\n" +
      JSON.stringify({
        explanation: "Many changes.",
        replacements: [
          { find: "Hello", replace: "Hi" },
          { find: "world", replace: "planet" },
          { find: "x_1", replace: "$x_1$" },
          { find: "extra", replace: "ignored" },
        ],
      }) +
      "\n```";
    const result = parseAiFixResponse(content, DOC, null);
    if (!("fix" in result)) throw new Error("expected a fix");
    expect(result.fix.edits.length).toBe(3);
  });

  it("prefers the occurrence closest to the error line", () => {
    const twice = "alpha\nalpha\nalpha\n";
    const result = parseAiFixResponse(
      JSON.stringify({
        explanation: "Fix the second alpha.",
        replacements: [{ find: "alpha", replace: "beta" }],
      }),
      twice,
      3,
    );
    if (!("fix" in result)) throw new Error("expected a fix");
    expect(result.fix.fixed.split("\n")[2]).toBe("beta");
  });

  it("rejects a find that is not in the document", () => {
    const result = parseAiFixResponse(
      JSON.stringify({
        explanation: "Whatever.",
        replacements: [{ find: "not in the file", replace: "x" }],
      }),
      DOC,
      null,
    );
    expect("error" in result).toBe(true);
  });

  it("carries the explanation when no edit is needed", () => {
    const result = parseAiFixResponse(
      JSON.stringify({ explanation: "Recompile to settle labels.", replacements: [] }),
      DOC,
      null,
    );
    expect(result).toEqual({ error: "Recompile to settle labels." });
  });
});
