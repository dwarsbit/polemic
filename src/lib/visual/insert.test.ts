import { describe, expect, it } from "vitest";
import { fragmentToContent, looksLikeLatex } from "./insert";

describe("looksLikeLatex", () => {
  it("accepts commands", () => {
    expect(looksLikeLatex("\\cite{x}")).toBe(true);
    expect(looksLikeLatex("$x^2$")).toBe(false);
    expect(looksLikeLatex("plain prose")).toBe(false);
  });
});

describe("fragmentToContent", () => {
  it("unwraps a lone paragraph so citations land inline", () => {
    expect(fragmentToContent("\\cite{knuth1984}")).toEqual([
      { type: "cite", attrs: { src: "\\cite{knuth1984}" } },
    ]);
  });

  it("keeps prose as text", () => {
    expect(fragmentToContent("just words")).toEqual([
      { type: "text", text: "just words" },
    ]);
  });

  it("parses figure scaffolds into figure cards", () => {
    const fragment =
      "\\begin{figure}\n  \\includegraphics{assets/plot.png}\n  \\caption{A plot.}\n\\end{figure}";
    const content = fragmentToContent(fragment);
    expect(content).toHaveLength(1);
    expect(content[0]?.type).toBe("figureBlock");
    expect(content[0]?.attrs?.src).toContain("\\includegraphics{assets/plot.png}");
  });

  it("parses list skeletons into lists", () => {
    const content = fragmentToContent(
      "\\begin{itemize}\n  \\item \n\\end{itemize}",
    );
    expect(content[0]?.type).toBe("bulletList");
  });

  it("parses mixed fragments as multiple blocks", () => {
    const content = fragmentToContent(
      "Intro \\emph{word}.\n\n\\begin{tikzpicture}\n\\end{tikzpicture}",
    );
    expect(content.map((block) => block.type)).toEqual([
      "paragraph",
      "rawTexBlock",
    ]);
  });
});
