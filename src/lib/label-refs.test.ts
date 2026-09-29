import { describe, expect, it } from "vitest";
import {
  extractLabelPositions,
  extractRefPositions,
  labelAt,
  labelLine,
  refAt,
} from "./label-refs";

describe("label-refs", () => {
  it("finds label and ref positions", () => {
    const doc = "See \\ref{eq:a} and \\label{eq:b}\n";
    const refs = extractRefPositions(doc);
    expect(refs).toHaveLength(1);
    expect(refs[0].name).toBe("eq:a");
    expect(doc.slice(refs[0].from, refs[0].to)).toBe("\\ref{eq:a}");
    const labels = extractLabelPositions(doc);
    expect(labels[0].name).toBe("eq:b");
    expect(doc.slice(labels[0].from, labels[0].to)).toBe("\\label{eq:b}");
  });

  it("recognizes all ref command variants", () => {
    const doc = "\\ref{x} \\eqref{x} \\pageref{x} \\autoref{x} \\vref{x} \\cref{x} \\Cref{x}";
    expect(extractRefPositions(doc)).toHaveLength(7);
  });

  it("does not match prefix-similar commands", () => {
    const doc = "\\references{x}";
    expect(extractRefPositions(doc)).toHaveLength(0);
  });

  it("ignores commands in comments", () => {
    expect(extractRefPositions("a % \\ref{x}\n\\ref{y}")).toHaveLength(1);
    expect(extractRefPositions("a % \\ref{x}\n\\ref{y}")[0].name).toBe("y");
  });

  it("ignores escaped backslashes before commands", () => {
    expect(extractRefPositions("\\\\ref{x}")).toHaveLength(0);
    expect(extractRefPositions("\\\\\\\\ \\ref{x}")).toHaveLength(1);
  });

  it("stops cleanly at an unclosed command (mid-typing)", () => {
    expect(extractRefPositions("\\ref{not-typed")).toHaveLength(0);
  });

  it("refAt finds the command containing the position", () => {
    const doc = "before \\ref{eq:a} after";
    expect(refAt(doc, doc.indexOf("eq:a"))?.name).toBe("eq:a");
    expect(refAt(doc, 2)).toBeNull();
  });

  it("labelAt and labelLine locate a label", () => {
    const doc = "a\n\\section{X}\\label{sec:x}\nb";
    expect(labelAt(doc, doc.indexOf("sec:x"))?.name).toBe("sec:x");
    expect(labelLine(doc, "sec:x")).toBe(2);
    expect(labelLine(doc, "missing")).toBeNull();
  });
});
