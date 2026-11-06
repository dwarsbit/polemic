// Mirrors the LanguageTool tests in src-tauri/src/grammar.rs.
import { describe, expect, it } from "vitest";
import {
  chunkBlocks,
  DEFAULT_RETRY_AFTER,
  errorFor,
  joinBlocks,
  splitMatches,
  type LtMatch,
} from "@/lib/languagetool";

const match = (offset: number, length: number): LtMatch => ({
  message: "m",
  offset,
  length,
  replacements: [{ value: "x" }],
  rule: { id: "R", category: { name: "C" } },
});

describe("LanguageTool client", () => {
  it("splits matches back into blocks", () => {
    const blocks = ["One é.", "Two two."];
    const { text, starts } = joinBlocks(blocks);
    expect(text).toBe("One é.\n\nTwo two.");
    expect(starts).toEqual([0, 8]);
    const issues = splitMatches(
      [match(4, 1), match(8, 7), match(5, 4)],
      blocks,
      starts,
    );
    expect([issues[0][0].from, issues[0][0].to]).toEqual([4, 5]);
    expect([issues[1][0].from, issues[1][0].to]).toEqual([0, 7]);
    // The separator-spanning match is dropped.
    expect(issues[0].length + issues[1].length).toBe(2);
  });

  it("splits long checks below the limit", () => {
    const blocks = ["aaaa", "bb", "cccccc", "dd", "é"];
    expect(chunkBlocks(blocks, 10)).toEqual([[0, 1], [2, 3], [4]]);
    // A block over the limit on its own is left out.
    expect(chunkBlocks(blocks, 5)).toEqual([[0], [1], [3, 4]]);
    expect(chunkBlocks(blocks, Number.MAX_SAFE_INTEGER)).toEqual([[0, 1, 2, 3, 4]]);
    expect(chunkBlocks([], 10)).toEqual([]);
  });

  it("maps server answers to states", () => {
    const kind = (status: number) => errorFor(status, null, "").kind;
    expect(kind(401)).toBe("signedOut");
    expect(kind(402)).toBe("planRequired");
    expect(kind(404)).toBe("unavailable");
    expect(kind(413)).toBe("tooLong");
    expect(kind(502)).toBe("unavailable");
    const limited = errorFor(429, "17", "");
    expect([limited.kind, limited.retryAfter]).toEqual(["rateLimited", 17]);
    expect(errorFor(429, "soon", "").retryAfter).toBe(DEFAULT_RETRY_AFTER);
    expect(errorFor(429, "99999", "").retryAfter).toBe(3600);
    const bad = errorFor(400, null, "Error: 'xx' is not a language code");
    expect(bad.kind).toBe("failed");
    expect(bad.message).toContain("'xx' is not a language code");
    expect(errorFor(400, null, '{"error":"x"}').message).toBe(
      "LanguageTool answered 400",
    );
  });
});
