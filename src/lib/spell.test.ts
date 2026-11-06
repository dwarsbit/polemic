// Mirrors the tests in src-tauri/src/spell.rs.
import { describe, expect, it } from "vitest";
import { editDistance, parseFrequencyList, SpellState } from "@/lib/spell";

describe("SpellState", () => {
  it("parses frequency lists with a threshold", () => {
    const list = "der 100\ntraurig 12\neinmal 5\ntypo 4\nandere 1\n";
    expect(parseFrequencyList(list)).toEqual(["der", "traurig", "einmal"]);
    expect(parseFrequencyList("Haus 7\r\n")).toEqual(["haus"]);
  });

  it("suggests close words in the original case", () => {
    let state = new SpellState(["world", "word", "would", "wild", "house", "ward"]);
    expect(state.suggest("wrold", 3)).toEqual(["world", "would", "wild"]);
    expect(state.suggest("Wrold", 1)).toEqual(["World"]);
    expect(state.suggest("WROLD", 1)).toEqual(["WORLD"]);
    expect(state.suggest("zzzzzz", 3)).toEqual([]);
    state = new SpellState(["tea", "tech", "ted", "the", "teh"]);
    expect(state.suggest("Teh", 1)).toEqual(["The"]);
  });

  it("measures edits with swaps", () => {
    const chars = (s: string) => [...s];
    expect(editDistance(chars("teh"), chars("the"), 2)).toBe(1);
    expect(editDistance(chars("cat"), chars("dog"), 2)).toBeNull();
    expect(editDistance(chars("mädchen"), chars("madchen"), 2)).toBe(1);
  });

  it("checks words from any source", () => {
    const state = new SpellState(["haus", "buch"]);
    expect(state.checkOne("Haus")).toBe(true);
    expect(state.checkOne("Hauss")).toBe(false);
  });

  it("knows contractions, added words and the user's words", () => {
    const state = SpellState.fromLines("don\nit\r\n", ["Polemic"]);
    expect(state.check(["don't", "it's", "it'x", "polemic", "zotero"])).toEqual([
      true,
      true,
      false,
      true,
      false,
    ]);
    state.add("Zotero");
    expect(state.checkOne("zotero")).toBe(true);
  });
});
