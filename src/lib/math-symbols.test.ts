import { describe, expect, it } from "vitest";
import { MATH_SYMBOL_CATEGORIES } from "@/lib/math-symbols";

describe("math symbols data", () => {
  it("has non-empty categories with unique ids", () => {
    const ids = MATH_SYMBOL_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const category of MATH_SYMBOL_CATEGORIES) {
      expect(category.name.length).toBeGreaterThan(0);
      expect(category.symbols.length).toBeGreaterThan(0);
    }
  });

  it("cursor offsets point inside the inserted text", () => {
    for (const category of MATH_SYMBOL_CATEGORIES) {
      for (const symbol of category.symbols) {
        expect(symbol.insert.length).toBeGreaterThan(0);
        expect(symbol.insert).not.toContain("|");
        if (symbol.cursorOffset !== undefined) {
          expect(symbol.cursorOffset).toBeLessThanOrEqual(symbol.insert.length);
        }
      }
    }
  });

  it("gives fractions a cursor inside the first braces", () => {
    const frac = MATH_SYMBOL_CATEGORIES.flatMap((c) => c.symbols).find(
      (s) => s.insert === "\\frac{}{}",
    );
    expect(frac?.cursorOffset).toBe("\\frac{".length);
  });
});
