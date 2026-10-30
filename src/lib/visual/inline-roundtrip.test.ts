import { describe, expect, it } from "vitest";
import { parseTex } from "./parse";
import { serializeTex } from "./serialize";

/** serialize(parse(x)) must reproduce `x` byte-for-byte. */
const rt = (tex: string) => serializeTex(parseTex(tex));

describe("inline roundtrip preserves source", () => {
  it.each([
    ["bare brace group", "A {\\bfseries B} C\n"],
    ["nested bare groups", "A {x {y} z} C\n"],
    ["symbol accent with braced argument", "caf\\'{e}\n"],
    ["accent forms", 'Go \\"{o} \\`{a} \\^{e} \\~{n} \\={o} \\.{z}\n'],
    ["symbol accent without braces", "caf\\'e na\\\"ive\n"],
    ["letter accents", "Go \\c{c} \\v{s} \\u{g} \\H{o}\n"],
    ["brace group inside a format mark", "Go \\textbf{a {\\itshape b} c}\n"],
    ["cite inside a format mark", "See \\emph{as in \\cite{knuth} here}\n"],
    ["math and footnote inside bold", "Go \\textbf{$x$ and\\footnote{n} y}\n"],
    ["raw atom at a mark edge", "Go \\textbf{\\foo{} y}\n"],
    ["nested marks around an atom", "Go \\emph{a \\textbf{b \\ref{r}} c}\n"],
    ["suggestion inside a format mark", "Go \\textbf{a \\added{b} c}\n"],
    ["trailing space inside a format mark", "Go \\textbf{a }b\n"],
    ["trailing space before an atom in a mark", "Go \\emph{a \\foo }b\n"],
    ["trailing space inside a suggestion", "Go \\added{new }text\n"],
    ["trailing space inside nested marks", "Go \\emph{a \\textbf{b }}c\n"],
    ["\\verb body", "x \\verb|a_b  c| y\n"],
    ["\\verb* body", "x \\verb*+a_b  {c+ y\n"],
    ["\\verb with % inside", "x \\verb!50%! y\n"],
    ["comment before paragraph break", "text % c\n\nmore\n"],
    [
      "comment before paragraph break in quote",
      "\\begin{quote}\n  text % c\n\n  more\n\\end{quote}\n",
    ],
    [
      "comment before paragraph break in theorem",
      "\\begin{theorem}\n  text % c\n\n  more\n\\end{theorem}\n",
    ],
  ])("%s", (_name, tex) => {
    expect(rt(tex)).toBe(tex);
  });

  it("keeps a comment that only ends a line inside the paragraph", () => {
    const tex = "text % c\nmore\n";
    expect(rt(tex)).toBe(tex);
    expect(parseTex(tex).content).toHaveLength(1);
  });

  it("keeps a % inside \\verb out of comments", () => {
    const doc = parseTex("x \\verb!50%! y\n");
    expect(doc.content[0]).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "x " },
        { type: "rawTexInline", attrs: { src: "\\verb!50%!" } },
        { type: "text", text: " y" },
      ],
    });
  });

  it("splits paragraphs at a blank line after a comment", () => {
    expect(parseTex("text % c\n\nmore\n").content).toHaveLength(2);
  });

  it("collapses trailing whitespace inside a group to one space", () => {
    expect(rt("Go \\textbf{a \n  }b\n")).toBe("Go \\textbf{a }b\n");
  });

  it("still drops trailing whitespace in a heading title", () => {
    expect(rt("\\section{Intro }\n")).toBe("\\section{Intro}\n");
  });

  describe("\\verb bodies are opaque to the scanners", () => {
    it.each([
      [
        "\\end inside \\verb in a quote",
        "\\begin{quote}\n  a \\verb|\\end{quote}| b\n\\end{quote}\n",
      ],
      [
        "% inside \\verb before \\end on the same line",
        "\\begin{quote}\n  a \\verb|%| b \\end{quote}\n\nafter\n",
      ],
      [
        "\\item inside \\verb",
        "\\begin{itemize}\n  \\item a \\verb|\\item| b\n\\end{itemize}\n",
      ],
      [
        "\\begin inside \\verb in an item",
        "\\begin{itemize}\n  \\item a \\verb|\\begin{x}|\n  \\item b\n\\end{itemize}\n",
      ],
    ])("%s", (_name, tex) => {
      const once = rt(tex);
      expect(rt(once)).toBe(once);
      expect(once).toContain(tex.includes("\\item") ? "\\verb|" : "a \\verb|");
    });

    it("keeps \\end{quote} inside \\verb in the quote", () => {
      const doc = parseTex(
        "\\begin{quote}\n  a \\verb|\\end{quote}| b\n\\end{quote}\n",
      );
      expect(doc.content).toHaveLength(1);
      expect(doc.content[0]).toMatchObject({
        type: "envBlock",
        attrs: { env: "quote" },
      });
    });

    it("finds \\end{quote} after a % inside \\verb on its line", () => {
      const doc = parseTex("\\begin{quote}\n  a \\verb|%| b \\end{quote}\n\nafter\n");
      expect(doc.content.map((b) => b.type)).toEqual(["envBlock", "paragraph"]);
    });

    it("does not split an item at \\item inside \\verb", () => {
      const doc = parseTex(
        "\\begin{itemize}\n  \\item a \\verb|\\item| b\n\\end{itemize}\n",
      );
      expect(doc.content[0]).toMatchObject({ type: "bulletList" });
      expect((doc.content[0] as { content: unknown[] }).content).toHaveLength(1);
    });

    it("counts items after \\begin inside \\verb", () => {
      const doc = parseTex(
        "\\begin{itemize}\n  \\item a \\verb|\\begin{x}|\n  \\item b\n\\end{itemize}\n",
      );
      expect((doc.content[0] as { content: unknown[] }).content).toHaveLength(2);
    });

    it("keeps a brace inside \\verb inside a bare group", () => {
      const doc = parseTex("Go {\\small \\verb|}|} end\n");
      expect(doc.content[0]).toMatchObject({
        type: "paragraph",
        content: [
          { type: "text", text: "Go " },
          { type: "rawTexInline", attrs: { src: "{\\small \\verb|}|}" } },
          { type: "text", text: " end" },
        ],
      });
    });
  });
});
