import { describe, expect, it } from "vitest";
import katex from "katex";
import { findMathRegion } from "@/lib/math-region";
import { renderableSource } from "@/lib/math-hover";

function regionIn(doc: string) {
  const region = findMathRegion(doc, Math.floor(doc.length / 2));
  if (region === null) throw new Error("no region found");
  return region;
}

describe("renderableSource", () => {
  it("strips \\label from an equation body", () => {
    const region = regionIn("\\begin{equation}\nx = y \\label{eq:a}\n\\end{equation}\n");
    expect(renderableSource(region)).toBe("\nx = y \n");
  });

  it("wraps align bodies back into the environment", () => {
    const region = regionIn("\\begin{align}\nx &= y\n\\end{align}\n");
    expect(renderableSource(region)).toBe("\\begin{align}\nx &= y\n\\end{align}");
  });

  it("renders an equation with a label (KaTeX end to end)", () => {
    const region = regionIn(
      "\\begin{equation}\nE = mc^2 \\label{eq:energy}\n\\end{equation}\n",
    );
    expect(() =>
      katex.renderToString(renderableSource(region), {
        displayMode: true,
        throwOnError: true,
      }),
    ).not.toThrow();
  });

  it("renders an align block with alignment ampersands (KaTeX end to end)", () => {
    const region = regionIn(
      "\\begin{align}\nx &= y \\\\ \\label{eq:x}\nz &= w\n\\end{align}\n",
    );
    expect(() =>
      katex.renderToString(renderableSource(region), {
        displayMode: true,
        throwOnError: true,
      }),
    ).not.toThrow();
  });
});
