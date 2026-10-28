import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GrammarError } from "@/lib/tauri";

const checked: string[][] = [];
const failures: GrammarError[] = [];
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  checkGrammar: vi.fn(async (blocks: string[]) => {
    checked.push(blocks);
    const failure = failures.shift();
    if (failure) throw failure;
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

import {
  checkBlocks,
  clearGrammarCache,
  placeIssues,
  useGrammarStatus,
} from "@/lib/grammar-check";
import { extractProse } from "@/lib/prose";
import { useSettingsStore } from "@/store/settings";

describe("grammar check", () => {
  beforeEach(() => {
    checked.length = 0;
    failures.length = 0;
    clearGrammarCache();
    useGrammarStatus.setState({ problem: null, retry: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("checks again when the provider changes", async () => {
    const grammar = useSettingsStore.getState().grammar;
    await checkBlocks(extractProse("One an test."));
    useSettingsStore.setState({ grammar: { ...grammar, provider: "polemic" } });
    await checkBlocks(extractProse("One an test."));
    useSettingsStore.setState({ grammar });
    expect(checked).toEqual([["One an test."], ["One an test."]]);
  });

  it("reports why a check failed until one succeeds", async () => {
    failures.push({
      kind: "planRequired",
      message: "Needs Professional",
      retryAfter: null,
    });
    expect(await checkBlocks(extractProse("One."))).toBeNull();
    expect(useGrammarStatus.getState().problem?.kind).toBe("planRequired");
    // Failed blocks are not cached: the next check asks again.
    expect(await checkBlocks(extractProse("One."))).not.toBeNull();
    expect(checked).toEqual([["One."], ["One."]]);
    expect(useGrammarStatus.getState().problem).toBeNull();
  });

  it("asks the editors to check again once a rate limit's wait is over", async () => {
    vi.useFakeTimers();
    failures.push({ kind: "rateLimited", message: "Wait", retryAfter: 5 });
    await checkBlocks(extractProse("One."));
    expect(useGrammarStatus.getState()).toMatchObject({ retry: 0 });
    vi.advanceTimersByTime(4_999);
    expect(useGrammarStatus.getState().retry).toBe(0);
    vi.advanceTimersByTime(1);
    expect(useGrammarStatus.getState()).toEqual({ problem: null, retry: 1 });
  });

  it("ignores failures that are not the checker's (no backend)", async () => {
    failures.push("no backend" as unknown as GrammarError);
    expect(await checkBlocks(extractProse("One."))).toBeNull();
    expect(useGrammarStatus.getState().problem).toBeNull();
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
