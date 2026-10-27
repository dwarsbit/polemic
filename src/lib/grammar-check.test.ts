import { beforeEach, describe, expect, it, vi } from "vitest";

const checked: string[][] = [];
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  checkGrammar: vi.fn(async (blocks: string[]) => {
    checked.push(blocks);
    return blocks.map((text) => {
      const issues = [];
      const an = text.indexOf("an test");
      if (an !== -1) {
        issues.push({
          from: an,
          to: an + 2,
          message: "Use a",
          rule: "AnA",
          category: "Grammar",
          replacements: ["a"],
        });
      }
      const x = text.indexOf("X");
      if (x !== -1) {
        issues.push({
          from: x,
          to: x + 1,
          message: "Lowercase",
          rule: "Case",
          category: "Style",
          replacements: ["x"],
        });
      }
      return issues;
    });
  }),
}));

import { checkBlocks, clearGrammarCache, placeIssues } from "@/lib/grammar-check";
import { extractProse } from "@/lib/prose";

describe("grammar check", () => {
  beforeEach(() => {
    checked.length = 0;
    clearGrammarCache();
  });

  it("places issues in the source and drops those on placeholders", async () => {
    const source = "This is an test with $x$.";
    const blocks = extractProse(source);
    const results = await checkBlocks(blocks);
    const placed = placeIssues(source, blocks[0], results![0]);
    expect(placed).toHaveLength(1);
    expect(source.slice(placed[0].from, placed[0].to)).toBe("an");
    expect(placed[0].replaceable).toBe(true);
  });

  it("checks each paragraph once, then from the cache", async () => {
    await checkBlocks(extractProse("One an test.\n\nTwo."));
    await checkBlocks(extractProse("One an test.\n\nTwo, edited."));
    expect(checked).toEqual([["One an test.", "Two."], ["Two, edited."]]);
  });

  it("offers no replacement across markup", async () => {
    const source = "This is \\emph{an} test.";
    const blocks = extractProse(source);
    const results = await checkBlocks(blocks);
    const [issue] = placeIssues(source, blocks[0], results![0]);
    expect(issue.text).toBe("an");
    // The source range is "an" itself here; markup only around it.
    expect(issue.replaceable).toBe(true);
    const spanning = placeIssues(source, blocks[0], [
      { ...results![0][0], from: 8, to: 15 }, // "an test" across "}"
    ]);
    expect(spanning[0].replaceable).toBe(false);
  });
});
