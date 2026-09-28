import { describe, expect, it } from "vitest";
import { decideDollar } from "@/lib/math-pairing";

describe("decideDollar", () => {
  it("pairs an opening dollar at the end of text", () => {
    expect(decideDollar("The value is ", "", false)).toBe("pair");
  });

  it("pairs an opening dollar before punctuation or whitespace", () => {
    expect(decideDollar("value", " is next", false)).toBe("pair");
    expect(decideDollar("value", ", next", false)).toBe("pair");
  });

  it("does not pair when math is already open (odd delimiter count)", () => {
    expect(decideDollar("The value $x", "", false)).toBe("plain");
    expect(decideDollar("$x^2", " done", false)).toBe("plain");
  });

  it("types over a dollar in front of the cursor", () => {
    expect(decideDollar("$x", "$ more", false)).toBe("skip");
  });

  it("wraps a selection", () => {
    expect(decideDollar("value ", "is selected", true)).toBe("wrap");
    // even with open math, a selection is wrapped
    expect(decideDollar("$x ", "y", true)).toBe("wrap");
  });

  it("never pairs an escaped dollar", () => {
    // The user just typed a backslash; the next "$" is a literal.
    expect(decideDollar("price is \\", "", false)).toBe("plain");
  });

  it("ignores escaped dollars when counting delimiters", () => {
    // \$5 costs $ leaves the count at 1 (odd) -> typing $ closes math
    expect(decideDollar("Costs \\$5 and $x", "", false)).toBe("plain");
    // \\\\$ is a literal dollar (escaped backslash + dollar); count is 0 -> pair
    expect(decideDollar("\\\\$ or ", "", false)).toBe("pair");
  });

  it("counts delimiters only on the current line", () => {
    expect(decideDollar("previous line $x$\nnext ", "", false)).toBe("pair");
  });
});
