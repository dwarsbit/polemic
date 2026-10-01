import { describe, expect, it } from "vitest";
import { envNameAt, parseEnvPairs } from "./env-pairs";

const doc = [
  "a",
  "\\begin{figure}",
  "  \\begin{tabular}{ll}",
  "  \\end{tabular}",
  "  \\begin{figure}", // nested same-name
  "  \\end{figure}",
  "\\end{figure}",
  "b",
].join("\n");

describe("parseEnvPairs", () => {
  it("pairs begins with ends, nesting-correct for same names", () => {
    const pairs = parseEnvPairs(doc);
    expect(pairs.map((pair) => pair.name)).toEqual([
      "figure",
      "tabular",
      "figure",
    ]);
    const figures = pairs.filter((pair) => pair.name === "figure");
    // The inner begin pairs with the first end, the outer with the last.
    expect(figures[0].endName!.from).toBe(doc.lastIndexOf("\\end{figure}") + 5);
    expect(figures[1].endName!.from).toBe(doc.indexOf("\\end{figure}") + 5);
  });

  it("leaves unclosed begins without an end", () => {
    const pairs = parseEnvPairs("\\begin{figure}x");
    expect(pairs).toHaveLength(1);
    expect(pairs[0].endName).toBeNull();
  });

  it("finds closed pairs' name ranges", () => {
    const pairs = parseEnvPairs(doc);
    const tabular = pairs.find((pair) => pair.name === "tabular")!;
    expect(doc.slice(tabular.beginName.from, tabular.beginName.to)).toBe("tabular");
    expect(doc.slice(tabular.endName!.from, tabular.endName!.to)).toBe("tabular");
  });
});

describe("envNameAt", () => {
  it("locates a name and its partner", () => {
    const beginNameFrom = doc.indexOf("tabular");
    const loc = envNameAt(doc, beginNameFrom + 3);
    expect(doc.slice(loc!.range.from, loc!.range.to)).toBe("tabular");
    expect(doc.slice(loc!.partner!.from, loc!.partner!.to)).toBe("tabular");
  });

  it("returns null outside environment names", () => {
    expect(envNameAt(doc, 0)).toBeNull();
  });
});
