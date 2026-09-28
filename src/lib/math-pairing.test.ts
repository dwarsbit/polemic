import { describe, expect, it } from "vitest";
import { decideBracket, decideDollar } from "@/lib/math-pairing";

describe("decideDollar", () => {
  it("pairs an opening dollar at the end of text", () => {
    expect(decideDollar("The value is ", "", false, true)).toBe("pair");
  });

  it("pairs an opening dollar before punctuation or whitespace", () => {
    expect(decideDollar("value", " is next", false, true)).toBe("pair");
    expect(decideDollar("value", ", next", false, true)).toBe("pair");
  });

  it("does not pair when math is already open (odd delimiter count)", () => {
    expect(decideDollar("The value $x", "", false, true)).toBe("plain");
    expect(decideDollar("$x^2", " done", false, true)).toBe("plain");
  });

  it("types over a dollar in front of the cursor", () => {
    expect(decideDollar("$x", "$ more", false, true)).toBe("skip");
  });

  it("wraps a selection", () => {
    expect(decideDollar("value ", "is selected", true, true)).toBe("wrap");
    // even with open math, a selection is wrapped
    expect(decideDollar("$x ", "y", true, true)).toBe("wrap");
  });

  it("never pairs an escaped dollar", () => {
    // The user just typed a backslash; the next "$" is a literal.
    expect(decideDollar("price is \\", "", false, true)).toBe("plain");
  });

  it("ignores escaped dollars when counting delimiters", () => {
    // \$5 costs $ leaves the count at 1 (odd) -> typing $ closes math
    expect(decideDollar("Costs \\$5 and $x", "", false, true)).toBe("plain");
    // \\$ is a literal dollar (escaped backslash + dollar); count is 0 -> pair
    expect(decideDollar("\\\\$ or ", "", false, true)).toBe("pair");
  });

  it("counts delimiters only on the current line", () => {
    expect(decideDollar("previous line $x$\nnext ", "", false, true)).toBe("pair");
  });

  it("converts the second dollar of a fresh pair to display math", () => {
    // Cursor state after pairing: "$|$" -> typing $ gives \[ \]
    expect(decideDollar("$", "$", false, true)).toBe("convert");
    // Even with text following the pair.
    expect(decideDollar("$", "$x", false, true)).toBe("convert");
  });

  it("keeps $$ behavior when conversion is disabled", () => {
    expect(decideDollar("$", "$", false, false)).toBe("skip");
    expect(decideDollar("$", "$x", false, false)).toBe("skip");
  });
});

describe("decideBracket", () => {
  it("pairs display math after a backslash", () => {
    expect(decideBracket("text \\", "")).toBe("pair-display");
  });

  it("wraps a selection in display math", () => {
    expect(decideBracket("text \\", "selected")).toBe("pair-display");
  });

  it("jumps over a closing display bracket", () => {
    expect(decideBracket("text \\", "\\] more")).toBe("skip-close");
  });

  it("leaves ordinary brackets alone", () => {
    expect(decideBracket("sqrt", "")).toBe("default");
    expect(decideBracket("left", "[x")).toBe("default");
    expect(decideBracket("", "")).toBe("default");
  });
});
