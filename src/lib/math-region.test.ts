import { describe, expect, it } from "vitest";
import { findMathRegion, stripMathAnnotations } from "./math-region";

describe("findMathRegion", () => {
  it("finds inline math around the cursor", () => {
    const doc = "text $a + b$ rest";
    const region = findMathRegion(doc, 7);
    expect(region).not.toBeNull();
    expect(region?.source).toBe("a + b");
    expect(region?.display).toBe(false);
    expect(region?.from).toBe(5);
    expect(region?.to).toBe(12);
  });

  it("finds the second region, not one before the cursor", () => {
    const doc = "$x$ and $y$";
    expect(findMathRegion(doc, 10)?.source).toBe("y");
    expect(findMathRegion(doc, 2)?.source).toBe("x");
  });

  it("finds display math \\[ ... \\]", () => {
    const doc = "\\[ E = mc^2 \\]";
    const region = findMathRegion(doc, 6);
    expect(region?.source).toBe(" E = mc^2 ");
    expect(region?.display).toBe(true);
  });

  it("finds \\( ... \\) as inline math", () => {
    expect(findMathRegion("\\(x\\)", 2)?.display).toBe(false);
  });

  it("finds $$ display math and distinguishes it from $", () => {
    const doc = "$$x = y$$";
    const region = findMathRegion(doc, 4);
    expect(region?.display).toBe(true);
    expect(region?.source).toBe("x = y");
  });

  it("finds math environments with the body stripped", () => {
    const doc = "\\begin{align}\nx &= y \\\\\n\\end{align}\n";
    const region = findMathRegion(doc, 15);
    expect(region?.source).toBe("\nx &= y \\\\\n");
    expect(region?.display).toBe(true);
    expect(region?.from).toBe(0);
    expect(region?.environment).toBe("align");
  });

  it("labels delimiter regions with a null environment", () => {
    expect(findMathRegion("$x$", 1)?.environment).toBeNull();
    expect(findMathRegion("\\[x\\]", 2)?.environment).toBeNull();
  });

  it("prefers the enclosing environment for nested math", () => {
    const doc = "\\begin{equation}\\begin{aligned}x &= y\\end{aligned}\\end{equation}";
    const region = findMathRegion(doc, 30);
    expect(region?.source).toContain("aligned");
    expect(region?.source).not.toContain("equation");
  });

  it("spans multiple lines", () => {
    const doc = "$a\nb$";
    expect(findMathRegion(doc, 3)?.source).toBe("a\nb");
  });

  it("ignores escaped dollar signs", () => {
    const doc = "50\\% of \\$ not math $real$";
    expect(findMathRegion(doc, 3)).toBeNull();
    expect(findMathRegion(doc, 9)).toBeNull();
    expect(findMathRegion(doc, 26)?.source).toBe("real");
  });

  it("ignores math in comments", () => {
    expect(findMathRegion("a % $x$ nope\n$b$", 6)).toBeNull();
    expect(findMathRegion("a % $x$ nope\n$b$", 14)?.source).toBe("b");
  });

  it("returns null for incomplete math (mid-typing)", () => {
    expect(findMathRegion("$x^", 2)).toBeNull();
    expect(findMathRegion("\\[x", 2)).toBeNull();
    expect(findMathRegion("\\begin{align}x", 13)).toBeNull();
  });

  it("returns null outside any math", () => {
    expect(findMathRegion("plain text", 5)).toBeNull();
  });

  it("handles non-math environments as no math", () => {
    expect(findMathRegion("\\begin{itemize}\\item $x$\\end{itemize}", 22)?.source).toBe("x");
  });
});

describe("stripMathAnnotations", () => {
  it("strips \\label{...} anywhere in the source", () => {
    expect(stripMathAnnotations("x = y \\label{eq:newton}")).toBe("x = y ");
    expect(stripMathAnnotations("\\label{eq:a}\nx &= y")).toBe("\nx &= y");
  });

  it("strips \\nonumber and \\notag", () => {
    expect(stripMathAnnotations("a \\\\ b \\nonumber")).toBe("a \\\\ b ");
    expect(stripMathAnnotations("a \\notag \\\\ b")).toBe("a  \\\\ b");
  });

  it("leaves the rest untouched", () => {
    expect(stripMathAnnotations("E = mc^2")).toBe("E = mc^2");
    expect(stripMathAnnotations("\\tag{3} x = y")).toBe("\\tag{3} x = y");
  });
});
