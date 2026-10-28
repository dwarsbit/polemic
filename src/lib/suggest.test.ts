import { describe, expect, it } from "vitest";
import {
  suggestDelete,
  suggestDeleteChar,
  suggestInsert,
  suggestReplace,
  type SuggestResult,
} from "@/lib/suggest";

/** The result with the caret marked as `|`. */
function show(result: SuggestResult): string {
  if (!result.ok) return `refused: ${result.message}`;
  return (
    result.source.slice(0, result.cursor) + "|" + result.source.slice(result.cursor)
  );
}

/** Splits "a|b" into the source and the caret offset. */
function at(marked: string): [string, number] {
  const i = marked.indexOf("|");
  return [marked.slice(0, i) + marked.slice(i + 1), i];
}

const type = (marked: string, text: string) => {
  const [source, pos] = at(marked);
  return show(suggestInsert(source, pos, text, "LG"));
};

const backspace = (marked: string) => {
  const [source, pos] = at(marked);
  return show(suggestDeleteChar(source, pos, "backward", "LG"));
};

const del = (marked: string) => {
  const [source, pos] = at(marked);
  return show(suggestDeleteChar(source, pos, "forward", "LG"));
};

/** Deletes or replaces the text between the two `|`. */
function overSelection(marked: string, text: string) {
  const from = marked.indexOf("|");
  const to = marked.indexOf("|", from + 1) - 1;
  const source = marked.replace(/\|/g, "");
  return show(
    text === ""
      ? suggestDelete(source, from, to, "LG")
      : suggestReplace(source, from, to, text, "LG"),
  );
}

describe("typing", () => {
  it("wraps new text in \\added, the caret inside", () => {
    expect(type("The |model.", "new ")).toBe("The \\added[id=LG]{new |}model.");
  });

  it("extends an adjacent own \\added, before or after it", () => {
    expect(type("The \\added[id=LG]{new}| model.", "er")).toBe(
      "The \\added[id=LG]{newer|} model.",
    );
    expect(type("The |\\added[id=LG]{new} model.", "a ")).toBe(
      "The \\added[id=LG]{a |new} model.",
    );
    expect(type("The \\added[id=LG]{n|ew} model.", "X")).toBe(
      "The \\added[id=LG]{nX|ew} model.",
    );
  });

  it("extends the new text of an own replacement", () => {
    expect(type("\\replaced[id=LG]{conf}{suggest}| it", "irm")).toBe(
      "\\replaced[id=LG]{confirm|}{suggest} it",
    );
  });

  it("does not extend another author's \\added", () => {
    expect(type("\\added[id=AN]{new}| x", "!")).toBe(
      "\\added[id=AN]{new}\\added[id=LG]{!|} x",
    );
  });

  it("types after struck-out text", () => {
    expect(type("a \\deleted[id=AN]{ol|d} b", "X")).toBe(
      "a \\deleted[id=AN]{old}\\added[id=LG]{X|} b",
    );
  });

  it("splits at a paragraph break and leaves line breaks plain", () => {
    expect(type("x|", "one\n\ntwo")).toBe(
      "x\\added[id=LG]{one}\n\n\\added[id=LG]{two|}",
    );
    expect(type("x|", "\n")).toBe("x\n|");
    expect(type("\\added[id=LG]{one\n}| x", "\n")).toBe("\\added[id=LG]{one}\n\n| x");
  });

  it("keeps a half-typed command editable", () => {
    const [source, pos] = at("Hello |world");
    const first = suggestInsert(source, pos, "\\", "LG");
    expect(first.ok && first.pending).toBeTruthy();
    if (!first.ok) return;
    const second = suggestInsert(first.source, first.cursor, "%", "LG", first.pending);
    expect(show(second)).toBe("Hello \\added[id=LG]{\\%|}world");
    expect(second.ok && second.pending).toBeNull();
  });

  it("refuses inside math, command names and comments", () => {
    expect(type("$x|+y$", "z")).toMatch(/^refused: .*math/);
    expect(type("\\emph|{x}", "z")).toMatch(/^refused: .*command name/);
    expect(type("\\begin{ite|mize}", "z")).toMatch(/^refused: .*command name/);
    expect(type("a |b", "50%")).toMatch(/^refused: Comments/);
  });

  it("types next to math, not in it", () => {
    expect(type("$x$| and", " too")).toBe("$x$\\added[id=LG]{ too|} and");
  });
});

describe("deleting", () => {
  it("wraps a deleted character and merges further backspaces", () => {
    const once = backspace("The model|.");
    expect(once).toBe("The mode|\\deleted[id=LG]{l}.");
    expect(backspace(once)).toBe("The mod|\\deleted[id=LG]{el}.");
  });

  it("merges forward deletes and puts the caret after the struck text", () => {
    const once = del("The |model.");
    expect(once).toBe("The \\deleted[id=LG]{m}|odel.");
    expect(del(once)).toBe("The \\deleted[id=LG]{mo}|del.");
  });

  it("skips over text that is already struck out", () => {
    expect(backspace("ab\\deleted[id=AN]{cd}|e")).toBe(
      "a|\\deleted[id=LG]{b}\\deleted[id=AN]{cd}e",
    );
  });

  it("edits own new text directly and drops an emptied suggestion", () => {
    expect(backspace("a \\added[id=LG]{xy|} b")).toBe("a \\added[id=LG]{x|} b");
    expect(backspace("a \\added[id=LG]{x|} b")).toBe("a | b");
  });

  it("turns an own replacement emptied of new text into a deletion", () => {
    expect(backspace("a \\replaced[id=LG]{n|}{old} b")).toBe(
      "a |\\deleted[id=LG]{old} b",
    );
  });

  it("strikes another author's new text with a nested deletion", () => {
    expect(backspace("\\added[id=AN]{new|} x")).toBe(
      "\\added[id=AN]{ne|\\deleted[id=LG]{w}} x",
    );
  });

  it("deletes a selection across suggestions in one run", () => {
    expect(
      overSelection(
        "Keep |old \\deleted[id=LG]{gone }and \\added[id=LG]{mine }text| end",
        "",
      ),
    ).toBe("Keep |\\deleted[id=LG]{old gone and text} end");
  });

  it("splits a deletion at a paragraph break", () => {
    expect(overSelection("a|b\n\nc|d", "")).toBe(
      "a|\\deleted[id=LG]{b}\n\n\\deleted[id=LG]{c}d",
    );
  });

  it("steps over a brace instead of breaking a command", () => {
    expect(backspace("\\emph{word}| x")).toBe("\\emph{word|} x");
  });

  it("refuses a selection that cuts a formula", () => {
    expect(overSelection("a |b $x+|y$", "")).toMatch(/^refused: .*math/);
  });
});

describe("typing over a selection", () => {
  it("makes one \\replaced, the caret after the new text", () => {
    expect(overSelection("The |suggest| it.", "confirm")).toBe(
      "The \\replaced[id=LG]{confirm|}{suggest} it.",
    );
  });

  it("changes own new text directly", () => {
    expect(overSelection("\\added[id=LG]{a |big| cat}", "small")).toBe(
      "\\added[id=LG]{a small| cat}",
    );
  });

  it("deletes then inserts when the selection spans suggestions", () => {
    expect(overSelection("|a \\added[id=AN]{b}| c", "X")).toBe(
      "\\deleted[id=LG]{a \\added[id=AN]{b}}\\added[id=LG]{X|} c",
    );
  });
});
