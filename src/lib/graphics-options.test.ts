import { describe, expect, it } from "vitest";
import {
  findGraphicsSpanAt,
  getOptionFlag,
  getOptionValue,
  parseOptionEntries,
  serializeOptionEntries,
  setOptionFlag,
  setOptionValue,
} from "./graphics-options";

const doc =
  "a \\includegraphics[width=0.8\\textwidth, clip]{figures/plot.pdf} b \\includegraphics{x}";

describe("findGraphicsSpanAt", () => {
  it("finds the command and its options block", () => {
    const span = findGraphicsSpanAt(doc, 30);
    expect(span?.path).toBe("figures/plot.pdf");
    expect(span?.options).not.toBeNull();
    expect(span?.optionsAt).toBe(
      doc.indexOf("\\includegraphics") + "\\includegraphics".length,
    );
  });

  it("brackets the options block exactly (the editor deletes [from-1, to+1))", () => {
    const span = findGraphicsSpanAt(doc, 30);
    if (span === null || span.options === null) throw new Error("no span");
    expect(doc[span.options.from - 1]).toBe("[");
    expect(doc[span.options.to]).toBe("]");
    expect(doc.slice(span.options.from, span.options.to)).toBe(
      "width=0.8\\textwidth, clip",
    );
  });

  it("brackets the path argument exactly", () => {
    const span = findGraphicsSpanAt(doc, 30);
    if (span === null) throw new Error("no span");
    expect(doc[span.pathRange.from - 1]).toBe("{");
    expect(doc[span.pathRange.to]).toBe("}");
    expect(doc.slice(span.pathRange.from, span.pathRange.to)).toBe(
      "figures/plot.pdf",
    );
  });

  it("reports no options block when absent", () => {
    const bare = doc.indexOf("x", doc.lastIndexOf("\\includegraphics") + 1);
    const span = findGraphicsSpanAt(doc, doc.length - 2);
    expect(span?.path).toBe("x");
    expect(span?.options).toBeNull();
    expect(bare).toBeGreaterThan(0);
  });

  it("returns null outside any command", () => {
    expect(findGraphicsSpanAt(doc, 0)).toBeNull();
  });
});

describe("option entries", () => {
  it("parses keyed values and bare flags", () => {
    const entries = parseOptionEntries("width=0.8\\textwidth, clip");
    expect(entries).toEqual([
      { key: "width", value: "0.8\\textwidth" },
      { key: "clip", value: null },
    ]);
    expect(getOptionValue(entries, "width")).toBe("0.8\\textwidth");
    expect(getOptionValue(entries, "scale")).toBeNull();
    expect(getOptionFlag(entries, "clip")).toBe(true);
  });

  it("parses brace-aware values with commas", () => {
    const entries = parseOptionEntries("trim=1 2 3 4, scale={0.5,1}");
    expect(getOptionValue(entries, "trim")).toBe("1 2 3 4");
    expect(getOptionValue(entries, "scale")).toBe("{0.5,1}");
  });

  it("round-trips through serialize", () => {
    const inner = "width=0.8\\textwidth, clip, angle=90";
    expect(serializeOptionEntries(parseOptionEntries(inner))).toBe(inner);
  });

  it("sets, updates, and removes values", () => {
    const entries = parseOptionEntries("width=0.5\\textwidth");
    expect(getOptionValue(setOptionValue(entries, "scale", "2"), "scale")).toBe("2");
    expect(
      getOptionValue(setOptionValue(entries, "width", "0.9\\textwidth"), "width"),
    ).toBe("0.9\\textwidth");
    expect(getOptionValue(setOptionValue(entries, "width", "  "), "width")).toBeNull();
  });

  it("toggles flags", () => {
    const entries = parseOptionEntries("width=0.5\\textwidth");
    const on = setOptionFlag(entries, "keepaspectratio", true);
    expect(serializeOptionEntries(on)).toBe(
      "width=0.5\\textwidth, keepaspectratio",
    );
    const off = setOptionFlag(on, "keepaspectratio", false);
    expect(serializeOptionEntries(off)).toBe("width=0.5\\textwidth");
  });
});
