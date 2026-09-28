import { describe, expect, it } from "vitest";
import { fuzzyMatch, fuzzyRank } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("matches everything for an empty query", () => {
    expect(fuzzyMatch("", "Save File")).toEqual({ score: 0, indices: [] });
  });

  it("is case-insensitive", () => {
    const result = fuzzyMatch("SET", "Settings");
    expect(result).not.toBeNull();
    expect(result?.indices).toEqual([0, 1, 2]);
  });

  it("matches scattered subsequences", () => {
    const result = fuzzyMatch("sgs", "settings");
    expect(result).not.toBeNull();
    expect(result?.indices).toEqual([0, 6, 7]);
  });

  it("returns null when a character is missing", () => {
    expect(fuzzyMatch("xyz", "settings")).toBeNull();
  });

  it("skips spaces in the query", () => {
    expect(fuzzyMatch("save file", "Save File")).not.toBeNull();
    expect(fuzzyMatch("open main", "Open: main.tex")).not.toBeNull();
  });

  it("scores a prefix higher than a scattered match", () => {
    const prefix = fuzzyMatch("set", "Settings");
    const scattered = fuzzyMatch("set", "reset text");
    expect(prefix && scattered ? prefix.score > scattered.score : false).toBe(true);
  });

  it("scores consecutive runs higher than spread matches", () => {
    const consecutive = fuzzyMatch("main", "main.tex");
    const spread = fuzzyMatch("main", "my aunt in norway");
    expect(consecutive && spread ? consecutive.score > spread.score : false).toBe(true);
  });

  it("gives separator boundaries a bonus", () => {
    const atBoundary = fuzzyMatch("old", "tex-old");
    const midWord = fuzzyMatch("old", "golden");
    expect(atBoundary && midWord ? atBoundary.score > midWord.score : false).toBe(true);
  });
});

describe("fuzzyRank", () => {
  const words = ["Save File", "Settings", "Export PDF as…"];

  it("ranks better matches first", () => {
    const ranked = fuzzyRank("set", words, (w) => [w]).map((r) => r.item);
    expect(ranked[0]).toBe("Settings");
  });

  it("drops non-matching entries", () => {
    const ranked = fuzzyRank("pdf", words, (w) => [w]);
    expect(ranked.map((r) => r.item)).toEqual(["Export PDF as…"]);
  });

  it("matches against any provided field", () => {
    const entries = [{ title: "Compile", keywords: "build latex" }];
    const ranked = fuzzyRank("build", entries, (e) => [e.title, e.keywords]);
    expect(ranked).toHaveLength(1);
  });

  it("respects the limit", () => {
    const ranked = fuzzyRank("e", words, (w) => [w], 2);
    expect(ranked).toHaveLength(2);
  });
});
